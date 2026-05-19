import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

function useJson(path) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  useEffect(() => {
    fetch(path, { cache: 'no-store' })
      .then(async r => { if (!r.ok) throw new Error(`${path} returned ${r.status}`); return r.json(); })
      .then(data => setState({ loading: false, error: '', data }))
      .catch(e => setState({ loading: false, error: e.message, data: null }));
  }, [path]);
  return state;
}
const fmtDate = v => { if (!v) return 'Not yet'; const d = new Date(v); return Number.isNaN(d.getTime()) ? v : d.toLocaleString('en-GB', {dateStyle:'medium', timeStyle:'short'}); };

function App(){
  const news = useJson('./news_data.json');
  const cats = useJson('./harm_categories.json');
  const [category,setCategory]=useState('Priority view');
  const [onlyUk,setOnlyUk]=useState(false);
  const [minScore,setMinScore]=useState(5);
  const [q,setQ]=useState('');
  const articles = useMemo(()=>Array.isArray(news.data?.articles)?news.data.articles:[],[news.data]);
  const categories = useMemo(()=>['Priority view','All',...Object.keys(cats.data||{})],[cats.data]);
  const byCat = useMemo(()=>Object.keys(cats.data||{}).map(c=>({name:c,count:articles.filter(a=>a.category===c).length})),[cats.data,articles]);
  const filtered = useMemo(()=>articles.filter(a=>{
    if(category==='Priority view' && !(a.uk_relevant || (a.relevance_score||0)>=8)) return false;
    if(category!=='Priority view' && category!=='All' && a.category!==category) return false;
    if(onlyUk && !a.uk_relevant) return false;
    if((a.relevance_score||0)<minScore) return false;
    if(q && !`${a.title} ${a.summary} ${a.source} ${a.domain} ${(a.why||[]).join(' ')}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }),[articles,category,onlyUk,minScore,q]);
  const meta = news.data?.meta || {};
  return <main className="wrap">
    <header className="hero"><div><p className="kicker">AIHM horizon scan · auto-updating</p><h1>AI Harms Monitor</h1><p>Prioritised, policy-facing scan of AI-enabled harms. Stricter relevance rules reduce generic AI business noise.</p></div><div className="metric"><b>{filtered.length}</b><span>shown</span></div></header>
    <section className="stats"><div><span>Total relevant results</span><b>{articles.length}</b></div><div><span>UK-relevant</span><b>{articles.filter(a=>a.uk_relevant).length}</b></div><div><span>High priority</span><b>{articles.filter(a=>a.uk_relevant || (a.relevance_score||0)>=8).length}</b></div><div><span>Updated</span><b>{fmtDate(meta.generatedAt)}</b></div></section>
    <section className="categoryGrid">{byCat.map(c=><button key={c.name} className="catCard" onClick={()=>setCategory(c.name)}><span>{c.name}</span><b>{c.count}</b></button>)}</section>
    <section className="filters"><select value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select><label><input type="checkbox" checked={onlyUk} onChange={e=>setOnlyUk(e.target.checked)}/> UK only</label><label>Min score <input type="number" min="0" max="20" value={minScore} onChange={e=>setMinScore(Number(e.target.value||0))}/></label><input placeholder="Search results…" value={q} onChange={e=>setQ(e.target.value)}/></section>
    {news.error && <p className="error">Could not load results: {news.error}</p>}{news.loading && <p className="notice">Loading…</p>}
    <section className="list">{filtered.map((a,i)=><article className="item" key={a.id||a.url||i}><div><p className="cat">{a.category}</p><h2>{a.title}</h2>{a.summary && <p className="summary">{a.summary}</p>}<p className="meta">{a.source}{a.domain?` · ${a.domain}`:''} · {fmtDate(a.publishedAt)} · score {a.relevance_score??0}{a.uk_relevant?' · UK-relevant':''}</p>{Array.isArray(a.why)&&a.why.length>0&&<p className="why">Why included: {a.why.join(', ')}</p>}</div>{a.url ? <a className="open" href={a.url} target="_blank" rel="noreferrer">Open</a> : <span className="blocked">No link</span>}</article>)}{!news.loading&&filtered.length===0&&<p className="notice">No results match these filters. Try All, lower min score, or rerun workflow.</p>}</section>
  </main>
}
createRoot(document.getElementById('root')).render(<App/>);
