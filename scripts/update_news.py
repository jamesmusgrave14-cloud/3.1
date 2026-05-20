import json, os, re, hashlib, html, math
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus, urlparse, parse_qs
import feedparser

ROOT=os.path.dirname(os.path.dirname(__file__)); PUBLIC=os.path.join(ROOT,'public')
CATEGORIES=os.path.join(PUBLIC,'harm_categories.json'); SOURCES=os.path.join(PUBLIC,'sources.json'); TRUSTED=os.path.join(PUBLIC,'trusted_domains.json'); WATCH=os.path.join(PUBLIC,'watchlist.json'); OUT=os.path.join(PUBLIC,'news_data.json')
WINDOW=os.getenv('SCAN_WINDOW','60d'); MAX_PER_CATEGORY=int(os.getenv('MAX_PER_CATEGORY','35')); MIN_SCORE=int(os.getenv('MIN_SCORE','5'))
GLOBAL_BLOCK=['stock','share price','earnings','funding round','valuation','appoints','business solutions summit','industrial automation','workflow automation','application innovation','forex','trading bot','wallpaper','grammar','platform enhancements','showcase at gartner']
PREFERRED_DOMAINS={'gov.uk','homeoffice.gov.uk','ncsc.gov.uk','ofcom.org.uk','nationalcrimeagency.gov.uk','police.uk','cps.gov.uk','bbc.co.uk','bbc.com','reuters.com','theguardian.com','ft.com','wired.com','technologyreview.com','therecord.media','darkreading.com','bleepingcomputer.com','thehackernews.com','iwf.org.uk','nspcc.org.uk','ukfinance.org.uk','cetas.turing.ac.uk','turing.ac.uk','nist.gov','oecd.org','europa.eu','un.org','incidentdatabase.ai'}
LOW_SIGNAL_DOMAINS={'prnewswire.com','businesswire.com','globenewswire.com','accesswire.com','einnews.com','tipranks.com','benzinga.com','tradingview.com'}

def load(path,fallback):
    try:
        with open(path,encoding='utf-8') as f: return json.load(f)
    except Exception: return fallback

def clean(s):
    s=html.unescape(s or ''); s=re.sub(r'<[^<]+?>','',s); s=s.replace('\xa0',' '); return re.sub(r'\s+',' ',s).strip()
def norm(s):
    s=clean(s).lower(); s=re.sub(r'[^a-z0-9\s\-/]',' ',s); return re.sub(r'\s+',' ',s).strip()
def contains(text,phrase):
    p=norm(phrase); return bool(p) and p in text
def parse_date(s):
    if not s: return datetime.now(timezone.utc)
    for fn in (parsedate_to_datetime, lambda x: datetime.fromisoformat(x.replace('Z','+00:00'))):
        try:
            d=fn(s); return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except Exception: pass
    return datetime.now(timezone.utc)
def window_days(w):
    m=re.match(r'^(\d+)d$',str(w).strip()); return int(m.group(1)) if m else 60
def canonical_url(url):
    if not url: return ''
    try:
        q=parse_qs(urlparse(url).query)
        if 'url' in q and q['url'] and q['url'][0].startswith('http'): return q['url'][0]
    except Exception: pass
    return url
def domain_of(url):
    try:
        h=urlparse(url).netloc.lower().split(':')[0]; return h[4:] if h.startswith('www.') else h
    except Exception: return ''
def dom_in(domain, domains): return any(domain==d or domain.endswith('.'+d) for d in domains)
def stable_id(text): return hashlib.sha1(text.encode('utf-8')).hexdigest()[:16]

def load_sensitive_terms():
    raw=os.getenv('SENSITIVE_TERMS_JSON','').strip()
    if not raw: return {}
    try: return json.loads(raw)
    except Exception as e:
        print('Warning: SENSITIVE_TERMS_JSON parse failed:', e); return {}

def merge_private_terms(categories, private_terms):
    for cat in categories.values():
        key=cat.get('sensitive_key')
        if not key or key not in private_terms: continue
        extra=private_terms.get(key,{}) or {}
        for field in ('query_terms','core_terms','support_terms','ai_terms'):
            vals=extra.get(field,[])
            if isinstance(vals,list):
                if field=='query_terms': cat[field]=vals
                else: cat[field]=list(dict.fromkeys(cat.get(field,[])+vals))
    return categories

def google_url(cat):
    extra=cat.get('query_terms',[]) or []
    extra_q='' if not extra else ' OR '.join(f'"{x}"' for x in extra)
    base=cat.get('query','')
    if extra_q: base=f'({base}) OR ({extra_q})'
    q=f'{base} -stock -shares -earnings -Gartner -forex when:{WINDOW}'
    return 'https://news.google.com/rss/search?q='+quote_plus(q)+'&hl=en-GB&gl=GB&ceid=GB:en'

def feed_items(url, source_name, source_type='news'):
    feed=feedparser.parse(url)
    for e in getattr(feed,'entries',[]) or []:
        title=clean(getattr(e,'title','') or '').rsplit(' - ',1)[0].strip(); summary=clean(getattr(e,'summary','') or getattr(e,'description','') or '')[:800]
        link=canonical_url(getattr(e,'link','') or ''); published=parse_date(getattr(e,'published','') or getattr(e,'updated','') or '')
        yield {'title':title,'summary':summary,'url':link,'domain':domain_of(link),'source':source_name,'publishedAt':published.isoformat(),'source_type':source_type,'_dt':published}

def score_item(item, cat):
    text=norm(f"{item.get('title','')} {item.get('summary','')} {item.get('domain','')}"); title=norm(item.get('title','')); domain=item.get('domain','')
    if any(b in text for b in GLOBAL_BLOCK): return -100, [], 'blocked_generic_business'
    ai=[x for x in cat.get('ai_terms',[]) if contains(text,x)]; core=[x for x in cat.get('core_terms',[]) if contains(text,x)]; support=[x for x in cat.get('support_terms',[]) if contains(text,x)]; uk=[x for x in cat.get('uk_terms',[]) if contains(text,x)]
    if not ai: return 0, [], 'no_ai_signal'
    if not core: return 0, [], 'no_harm_signal'
    score=2; why=['AI-related']; title_core=[h for h in core if contains(title,h)]
    if title_core: score+=5; why.extend(title_core[:4])
    else: score+=3; why.extend(core[:4])
    if support: score+=min(2,len(support))
    if uk: score+=3; why.append('UK signal')
    if cat.get('sensitive') and dom_in(domain,PREFERRED_DOMAINS): score+=4; why.append('trusted safeguarding source')
    elif dom_in(domain,PREFERRED_DOMAINS): score+=2; why.append('higher-trust source')
    if dom_in(domain,LOW_SIGNAL_DOMAINS): score-=2
    try:
        if (datetime.now(timezone.utc)-item['_dt']).days<=7: score+=1
    except Exception: pass
    return score, why, 'kept' if score>=MIN_SCORE else 'below_threshold'

def text_vector(text):
    # Deterministic lightweight semantic approximation (hashed bag-of-words)
    words=[w for w in norm(text).split() if len(w)>2]
    vec=[0.0]*256
    for w in words:
        h=int(hashlib.md5(w.encode()).hexdigest(),16)%256
        vec[h]+=1.0
    mag=math.sqrt(sum(x*x for x in vec)) or 1.0
    return [x/mag for x in vec]

def cosine(a,b):
    # Inputs already normalised
    return sum(x*y for x,y in zip(a,b))

def add_semantic_scores(items, categories):
    profiles=[f"{name}: {cat.get('semantic_profile') or cat.get('description','')}" for name,cat in categories.items()]
    profile_vecs=[text_vector(p) for p in profiles]
    names=list(categories.keys())
    for item in items:
        avec=text_vector(f"{item.get('title','')} {item.get('summary','')}")
        sims=[cosine(avec,pv) for pv in profile_vecs]
        best=max(range(len(sims)), key=lambda i:sims[i]) if sims else 0
        item['semantic_category']=names[best]
        item['semantic_score']=round(float(sims[best]),4) if sims else 0
        item['semantic_mode']='local_hash_similarity'
        # small boost when semantic agrees with rule-based category
        if item.get('category')==item.get('semantic_category') and item['semantic_score']>0.18:
            item['relevance_score']=item.get('relevance_score',0)+1
    return 'local_hash_similarity'

def add_watchlist_hits(items, watch):
    rows=watch.get('items',[])
    for item in items:
        text=norm(f"{item.get('title','')} {item.get('summary','')} {item.get('category','')}")
        hits=[]
        for w in rows:
            aliases=(w.get('aliases',[]) or [])+[w.get('name','')]
            if any(contains(text,a) for a in aliases):
                hits.append({'name':w.get('name'), 'type':w.get('type'), 'reason':w.get('reason'), 'owner_hint':w.get('owner_hint')})
        item['watchlist_hits']=hits

def cluster_items(items):
    clusters=[]; grouped=defaultdict(list)
    for item in items:
        hits=item.get('watchlist_hits') or []
        if hits: key='Watchlist: '+hits[0]['name']
        else:
            tokens=[w for w in norm(item['title']).split() if len(w)>4 and w not in {'artificial','intelligence','generative'}]
            key=item.get('category','Uncategorised')+': '+' '.join(tokens[:3])
        grouped[key].append(item)
    for key, rows in grouped.items():
        rows_sorted=sorted(rows, key=lambda x:x.get('publishedAt',''), reverse=True)
        clusters.append({'id':stable_id(key),'title':key,'count':len(rows),'category':rows_sorted[0].get('category'),'latest':rows_sorted[0].get('publishedAt'),'first_seen':min(r.get('publishedAt','') for r in rows_sorted),'uk_count':sum(1 for r in rows if r.get('uk_relevant')),'highest_score':max(r.get('relevance_score',0) for r in rows),'item_ids':[r['id'] for r in rows_sorted[:20]],'top_titles':[r['title'] for r in rows_sorted[:5]]})
    clusters.sort(key=lambda c:(c['count'],c['uk_count'],c['highest_score'],c['latest']), reverse=True)
    return clusters[:80]

def automated_briefing(items, clusters):
    high=[i for i in items if i.get('priority')=='High']; uk=[i for i in items if i.get('uk_relevant')]
    bycat=Counter(i.get('category') for i in items)
    watch_hits=Counter(h['name'] for i in items for h in i.get('watchlist_hits',[]))
    return {'generatedAt':datetime.now(timezone.utc).replace(microsecond=0).isoformat(),'headline':f"{len(items)} items retained; {len(high)} high priority; {len(uk)} UK-relevant.",'top_categories':bycat.most_common(5),'top_watchlist_hits':watch_hits.most_common(5),'top_clusters':clusters[:5],'highest_priority_items':[{'title':i['title'],'category':i.get('category'),'priority':i.get('priority'),'score':i.get('relevance_score'),'url':i.get('url')} for i in sorted(items, key=lambda x:(x.get('priority')=='High',x.get('uk_relevant'),x.get('relevance_score',0),x.get('publishedAt','')), reverse=True)[:8]],'suggested_use':'Use this as a triage aid. Verify sources before using in advice, briefings or commissions.'}

def run():
    categories=merge_private_terms(load(CATEGORIES,{}), load_sensitive_terms()); sources=load(SOURCES,[]); trusted=[x.lower() for x in load(TRUSTED,[])]; watch=load(WATCH,{'items':[]})
    cutoff=datetime.now(timezone.utc)-timedelta(days=window_days(WINDOW)); all_items=[]; seen=set(); reject=Counter(); errors={}
    for cname,cat in categories.items():
        candidates=[]
        try: candidates.extend(feed_items(google_url(cat),'Google News','news'))
        except Exception as e: errors[f'Google News:{cname}']=str(e)
        for src in sources:
            if not src.get('enabled') or src.get('type')!='rss': continue
            try: candidates.extend(feed_items(src['url'],src.get('name','RSS'),src.get('source_type','rss')))
            except Exception as e: errors[src.get('name','RSS')]=str(e)
        bucket=[]
        for item in candidates:
            if item['_dt']<cutoff: reject['outside_window']+=1; continue
            score,why,reason=score_item(item,cat)
            if reason!='kept': reject[reason]+=1; continue
            key=norm(item['title'])[:160] or item['url']
            if key in seen: reject['duplicate']+=1; continue
            seen.add(key); item.pop('_dt',None)
            public_why=[cat.get('display_reason','Sensitive category signal'), 'UK signal' if 'UK signal' in why else None, 'trusted source' if any('source' in w for w in why) else None] if cat.get('sensitive') else why
            item.update({'id':stable_id(cname+item['title']+item.get('url','')),'category':cname,'category_family':cat.get('family','AI misuse / harms'),'relevance_score':score,'why':[x for x in public_why if x],'uk_relevant':'UK signal' in why,'link_safe':bool(item.get('url')) and any(domain_of(item.get('url'))==t or domain_of(item.get('url')).endswith('.'+t) for t in trusted),'priority':'High' if ('UK signal' in why and score>=10) else ('Medium' if score>=8 or 'UK signal' in why else 'Watch'),'sensitive':bool(cat.get('sensitive')),'policy_implications':cat.get('policy_implications',[])})
            bucket.append(item)
        bucket.sort(key=lambda x:(x['priority']=='High',x['uk_relevant'],x['relevance_score'],x['publishedAt']), reverse=True)
        all_items.extend(bucket[:MAX_PER_CATEGORY])
    add_watchlist_hits(all_items, watch)
    semantic_mode=add_semantic_scores(all_items, categories) if all_items else 'none'
    clusters=cluster_items(all_items)
    briefing=automated_briefing(all_items, clusters)
    all_items.sort(key=lambda x:(x['priority']=='High',x['uk_relevant'],x.get('publishedAt',''),x.get('relevance_score',0)), reverse=True)
    meta={'ok':True,'generatedAt':datetime.now(timezone.utc).replace(microsecond=0).isoformat(),'total':len(all_items),'window':WINDOW,'minScore':MIN_SCORE,'maxPerCategory':MAX_PER_CATEGORY,'byCategory':dict(Counter(i['category'] for i in all_items)),'byPriority':dict(Counter(i.get('priority','Watch') for i in all_items)),'rejectCounts':dict(reject),'errors':errors,'semanticMode':semantic_mode,'privateSensitiveTermSupport':bool(os.getenv('SENSITIVE_TERMS_JSON','').strip()),'mode':'advanced-free-semantic-v1'}
    os.makedirs(PUBLIC,exist_ok=True)
    with open(OUT,'w',encoding='utf-8') as f: json.dump({'meta':meta,'briefing':briefing,'clusters':clusters,'watchlist':watch.get('items',[]),'articles':all_items},f,indent=2,ensure_ascii=False)
    print(f'Wrote {OUT} with {len(all_items)} items; semantic={semantic_mode}')
if __name__=='__main__': run()
