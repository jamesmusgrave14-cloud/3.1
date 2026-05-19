import json, os, re, hashlib, html
from collections import Counter
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus, urlparse, parse_qs
import feedparser

ROOT = os.path.dirname(os.path.dirname(__file__))
PUBLIC = os.path.join(ROOT, 'public')
CATEGORIES = os.path.join(PUBLIC, 'harm_categories.json')
SOURCES = os.path.join(PUBLIC, 'sources.json')
TRUSTED = os.path.join(PUBLIC, 'trusted_domains.json')
OUT = os.path.join(PUBLIC, 'news_data.json')
WINDOW = os.getenv('SCAN_WINDOW', '14d')
MAX_PER_CATEGORY = int(os.getenv('MAX_PER_CATEGORY', '12'))
MIN_SCORE = int(os.getenv('MIN_SCORE', '5'))

NOISE = [
    'stock', 'share price', 'earnings', 'funding round', 'valuation', 'appoints', 'partnership',
    'conference agenda', 'forex', 'trading bot', 'industrial automation', 'workflow automation',
    'application innovation', 'business solutions summit', 'workers in ai upskilling', 'grammar',
    'wallpapers', 'blog publishing', 'legal automation', 'economic participation'
]
GENERIC_ONLY = ['automation', 'upskilling', 'identity', 'recruitment']

def window_days(w):
    m = re.match(r'^(\d+)d$', str(w).strip())
    return int(m.group(1)) if m else 14

def load(path, fallback):
    try:
        with open(path, encoding='utf-8') as f: return json.load(f)
    except Exception: return fallback

def clean(s):
    s = html.unescape(s or '')
    s = re.sub(r'<[^<]+?>', '', s)
    s = s.replace('\xa0', ' ')
    return re.sub(r'\s+', ' ', s).strip()

def norm(s):
    s = clean(s).lower()
    s = re.sub(r'[^a-z0-9\s-]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

def parse_date(s):
    if not s: return datetime.now(timezone.utc)
    for fn in (parsedate_to_datetime, lambda x: datetime.fromisoformat(x.replace('Z','+00:00'))):
        try:
            d = fn(s)
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except Exception: pass
    return datetime.now(timezone.utc)

def canonical_url(url):
    if not url: return ''
    try:
        q = parse_qs(urlparse(url).query)
        if 'url' in q and q['url'] and q['url'][0].startswith('http'):
            return q['url'][0]
    except Exception: pass
    return url

def domain_of(url):
    try:
        host = urlparse(url).netloc.lower().split(':')[0]
        return host[4:] if host.startswith('www.') else host
    except Exception: return ''

def is_trusted(url, trusted):
    d = domain_of(url)
    return bool(d) and any(d == t or d.endswith('.' + t) for t in trusted)

def stable_id(text): return hashlib.sha1(text.encode('utf-8')).hexdigest()[:16]

def score_text(text, cat):
    t = norm(text)
    if any(n in t for n in NOISE): return -99, []
    ai_hits = [x for x in cat.get('ai_terms', []) if norm(x) in t]
    harm_hits = [x for x in cat.get('harm_terms', []) if norm(x) in t]
    uk_hits = [x for x in cat.get('uk_terms', []) if norm(x) in t]
    if not ai_hits or not harm_hits: return 0, []
    # Prevent generic business items: generic terms only count if a proper harm term also matched.
    proper_harms = [h for h in harm_hits if norm(h) not in GENERIC_ONLY]
    if not proper_harms: return 0, []
    score = 2 + min(8, len(proper_harms) * 3)
    why = ['AI-related'] + proper_harms[:5]
    if uk_hits:
        score += 3
        why.append('UK signal')
    return score, why

def google_url(cat):
    base = cat.get('query') or ''
    q = f'{base} -stock -shares -earnings when:{WINDOW}'
    return 'https://news.google.com/rss/search?q=' + quote_plus(q) + '&hl=en-GB&gl=GB&ceid=GB:en'

def feed_items(url, source_name, source_type='news'):
    feed = feedparser.parse(url)
    for e in getattr(feed, 'entries', []) or []:
        title = clean(getattr(e, 'title', '') or '').rsplit(' - ', 1)[0].strip()
        summary = clean(getattr(e, 'summary', '') or getattr(e, 'description', '') or '')[:500]
        link = canonical_url(getattr(e, 'link', '') or '')
        published = parse_date(getattr(e, 'published', '') or getattr(e, 'updated', '') or '')
        yield {'title': title, 'summary': summary, 'url': link, 'domain': domain_of(link), 'source': source_name, 'publishedAt': published.isoformat(), 'source_type': source_type, '_dt': published}

def run():
    categories = load(CATEGORIES, {})
    sources = load(SOURCES, [])
    trusted = [x.lower() for x in load(TRUSTED, [])]
    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days(WINDOW))
    all_items=[]; seen=set(); errors={}
    for cat_name, cat in categories.items():
        bucket=[]
        try:
            candidates = list(feed_items(google_url(cat), 'Google News', 'news'))
        except Exception as e:
            errors[f'Google News:{cat_name}'] = str(e); candidates=[]
        for src in sources:
            if not src.get('enabled') or src.get('type') != 'rss': continue
            try:
                candidates.extend(feed_items(src['url'], src.get('name','RSS'), 'rss'))
            except Exception as e:
                errors[src.get('name','RSS')] = str(e)
        for item in candidates:
            if item['_dt'] < cutoff: continue
            text = f"{item['title']} {item.get('summary','')} {item.get('source','')} {item.get('domain','')}"
            s, why = score_text(text, cat)
            if s < MIN_SCORE: continue
            key = norm(item['title'])[:140] or item['url']
            if key in seen: continue
            seen.add(key)
            item.pop('_dt', None)
            item.update({'id': stable_id(cat_name + item['title'] + item.get('url','')), 'category': cat_name, 'relevance_score': s, 'why': why, 'uk_relevant': 'UK signal' in why, 'link_safe': is_trusted(item.get('url',''), trusted)})
            bucket.append(item)
        bucket.sort(key=lambda x: (x['uk_relevant'], x['relevance_score'], x['link_safe'], x['publishedAt']), reverse=True)
        all_items.extend(bucket[:MAX_PER_CATEGORY])
    all_items.sort(key=lambda x: (x['uk_relevant'], x['publishedAt'], x['relevance_score']), reverse=True)
    meta = {'ok': True, 'generatedAt': datetime.now(timezone.utc).replace(microsecond=0).isoformat(), 'total': len(all_items), 'window': WINDOW, 'minScore': MIN_SCORE, 'byCategory': dict(Counter(i['category'] for i in all_items)), 'errors': errors, 'mode': 'tuned-old-style'}
    os.makedirs(PUBLIC, exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f: json.dump({'meta': meta, 'articles': all_items}, f, indent=2, ensure_ascii=False)
    print(f"Wrote {OUT} with {len(all_items)} items")

if __name__ == '__main__': run()
