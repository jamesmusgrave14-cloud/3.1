import json, os, re, hashlib, html
from collections import Counter, defaultdict
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
WINDOW = os.getenv('SCAN_WINDOW', '60d')
MAX_PER_CATEGORY = int(os.getenv('MAX_PER_CATEGORY', '30'))
MIN_SCORE = int(os.getenv('MIN_SCORE', '6'))

# These were causing junk in earlier versions: generic business, HR, product launches, and investment copy.
GLOBAL_BLOCK = [
    'stock', 'share price', 'earnings', 'funding round', 'valuation', 'appoints', 'partnership', 'business solutions summit',
    'industrial automation', 'workflow automation', 'application innovation', 'forex', 'trading bot', 'wallpaper',
    'grammar', 'blog publishing', 'legal automation', 'economic participation', 'smart vision applications',
    'platform enhancements', 'showcase at gartner', 'live in vegas', 'strategic challenge for companies'
]

# Weak terms are allowed only when paired with a real harm term.
WEAK_ALONE = {'automation', 'upskilling', 'identity', 'recruitment', 'security', 'safety'}

PREFERRED_DOMAINS = {
    'gov.uk','homeoffice.gov.uk','ncsc.gov.uk','ofcom.org.uk','nationalcrimeagency.gov.uk','police.uk','cps.gov.uk',
    'bbc.co.uk','bbc.com','reuters.com','theguardian.com','ft.com','wired.com','technologyreview.com','therecord.media',
    'darkreading.com','bleepingcomputer.com','thehackernews.com','iwf.org.uk','nspcc.org.uk','ukfinance.org.uk',
    'cetas.turing.ac.uk','turing.ac.uk','nist.gov','oecd.org','europa.eu','un.org','incidentdatabase.ai'
}

LOW_SIGNAL_DOMAINS = {
    'prnewswire.com','businesswire.com','globenewswire.com','accesswire.com','einnews.com','tipranks.com','benzinga.com',
    'tradingview.com','manilatimes.net','ambcrypto.com','mexicobusiness.news'
}

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
    s = re.sub(r'[^a-z0-9\s\-/]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

def contains_phrase(text, phrase):
    p = norm(phrase)
    if not p: return False
    return p in text

def parse_date(s):
    if not s: return datetime.now(timezone.utc)
    for fn in (parsedate_to_datetime, lambda x: datetime.fromisoformat(x.replace('Z','+00:00'))):
        try:
            d = fn(s)
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except Exception: pass
    return datetime.now(timezone.utc)

def window_days(w):
    m = re.match(r'^(\d+)d$', str(w).strip())
    return int(m.group(1)) if m else 60

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

def is_preferred_domain(domain):
    return any(domain == d or domain.endswith('.' + d) for d in PREFERRED_DOMAINS)

def is_low_signal_domain(domain):
    return any(domain == d or domain.endswith('.' + d) for d in LOW_SIGNAL_DOMAINS)

def stable_id(text):
    return hashlib.sha1(text.encode('utf-8')).hexdigest()[:16]

def google_url(cat):
    q = f"{cat.get('query','')} -stock -shares -earnings -Gartner -forex when:{WINDOW}"
    return 'https://news.google.com/rss/search?q=' + quote_plus(q) + '&hl=en-GB&gl=GB&ceid=GB:en'

def feed_items(url, source_name, source_type='news'):
    feed = feedparser.parse(url)
    for e in getattr(feed, 'entries', []) or []:
        title = clean(getattr(e, 'title', '') or '').rsplit(' - ', 1)[0].strip()
        summary = clean(getattr(e, 'summary', '') or getattr(e, 'description', '') or '')[:600]
        link = canonical_url(getattr(e, 'link', '') or '')
        published = parse_date(getattr(e, 'published', '') or getattr(e, 'updated', '') or '')
        yield {
            'title': title,
            'summary': summary,
            'url': link,
            'domain': domain_of(link),
            'source': source_name,
            'publishedAt': published.isoformat(),
            'source_type': source_type,
            '_dt': published,
        }

def quality_score(item, cat):
    text = norm(f"{item.get('title','')} {item.get('summary','')} {item.get('domain','')}")
    title = norm(item.get('title',''))
    domain = item.get('domain','')

    if any(b in text for b in GLOBAL_BLOCK):
        return -100, [], 'blocked_generic_business'

    ai_hits = [x for x in cat.get('ai_terms', []) if contains_phrase(text, x)]
    core_hits = [x for x in cat.get('core_terms', []) if contains_phrase(text, x)]
    support_hits = [x for x in cat.get('support_terms', []) if contains_phrase(text, x)]
    uk_hits = [x for x in cat.get('uk_terms', []) if contains_phrase(text, x)]

    if not ai_hits:
        return 0, [], 'no_ai_signal'
    if not core_hits:
        return 0, [], 'no_harm_signal'

    # Reject cases where the only apparent match is weak/generic and no substantive harm appears.
    substantive_core = [h for h in core_hits if norm(h) not in WEAK_ALONE]
    if not substantive_core:
        return 0, [], 'weak_generic_match_only'

    score = 2  # AI signal
    why = ['AI-related']

    # Title hits matter more than body/feed summary hits.
    title_core = [h for h in substantive_core if contains_phrase(title, h)]
    if title_core:
        score += 5
        why.extend(title_core[:4])
    else:
        score += 3
        why.extend(substantive_core[:4])

    if support_hits:
        score += min(2, len(support_hits))
    if uk_hits:
        score += 3
        why.append('UK signal')
    if is_preferred_domain(domain):
        score += 2
        why.append('higher-trust source')
    if is_low_signal_domain(domain):
        score -= 2

    # Freshness boost, but don't let it save weak articles.
    try:
        age_days = (datetime.now(timezone.utc) - item['_dt']).days
        if age_days <= 7: score += 1
    except Exception:
        pass

    return score, why, 'kept' if score >= MIN_SCORE else 'below_threshold'

def run():
    categories = load(CATEGORIES, {})
    sources = load(SOURCES, [])
    trusted = [x.lower() for x in load(TRUSTED, [])]
    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days(WINDOW))
    all_items, seen = [], set()
    reject_counts = Counter()
    errors = {}

    for cat_name, cat in categories.items():
        candidates = []
        try:
            candidates.extend(feed_items(google_url(cat), 'Google News', 'news'))
        except Exception as e:
            errors[f'Google News:{cat_name}'] = str(e)
        for src in sources:
            if not src.get('enabled') or src.get('type') != 'rss':
                continue
            try:
                candidates.extend(feed_items(src['url'], src.get('name','RSS'), 'rss'))
            except Exception as e:
                errors[src.get('name','RSS')] = str(e)

        bucket = []
        for item in candidates:
            if item['_dt'] < cutoff:
                reject_counts['outside_window'] += 1
                continue
            score, why, reason = quality_score(item, cat)
            if reason != 'kept':
                reject_counts[reason] += 1
                continue
            key = norm(item['title'])[:140] or item['url']
            if key in seen:
                reject_counts['duplicate'] += 1
                continue
            seen.add(key)
            item.pop('_dt', None)
            item.update({
                'id': stable_id(cat_name + item['title'] + item.get('url','')),
                'category': cat_name,
                'relevance_score': score,
                'why': why,
                'uk_relevant': 'UK signal' in why,
                'link_safe': is_trusted(item.get('url',''), trusted),
                'priority': 'High' if ('UK signal' in why and score >= 10) else ('Medium' if score >= 8 or 'UK signal' in why else 'Watch')
            })
            bucket.append(item)
        bucket.sort(key=lambda x: (x['priority'] == 'High', x['uk_relevant'], x['relevance_score'], x['publishedAt']), reverse=True)
        all_items.extend(bucket[:MAX_PER_CATEGORY])

    all_items.sort(key=lambda x: (x['priority'] == 'High', x['uk_relevant'], x['publishedAt'], x['relevance_score']), reverse=True)
    meta = {
        'ok': True,
        'generatedAt': datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        'total': len(all_items),
        'window': WINDOW,
        'minScore': MIN_SCORE,
        'maxPerCategory': MAX_PER_CATEGORY,
        'byCategory': dict(Counter(i['category'] for i in all_items)),
        'byPriority': dict(Counter(i.get('priority','Watch') for i in all_items)),
        'rejectCounts': dict(reject_counts),
        'errors': errors,
        'mode': 'quality-balanced-rule-based-v2'
    }
    os.makedirs(PUBLIC, exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump({'meta': meta, 'articles': all_items}, f, indent=2, ensure_ascii=False)
    print(f"Wrote {OUT} with {len(all_items)} items")
    print('Rejected:', dict(reject_counts))

if __name__ == '__main__':
    run()
