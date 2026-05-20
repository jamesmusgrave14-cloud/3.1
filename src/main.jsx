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
const fmtDate = v => { if (!v) return 'Not yet'; const d = new Date(v); return Number.isNaN(d.getTime()) ? v : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); };
const dayLabel = v => { const d = new Date(v); return Number.isNaN(d.getTime()) ? 'No date' : d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }); };
const daysAgo = v => { const d = new Date(v); if (Number.isNaN(d.getTime())) return Infinity; return (Date.now() - d.getTime()) / 86400000; };
function getPriority(a) { if (a.priority) return a.priority; if (a.uk_relevant && (a.relevance_score || 0) >= 10) return 'High'; if (a.uk_relevant || (a.relevance_score || 0) >= 8) return 'Medium'; return 'Watch'; }
function hostLabel(a) { return a.domain || a.source || 'Unknown source'; }
function explainPriority(p) { return p === 'High' ? 'High = strong harm signal, usually UK-relevant and/or from a higher-trust source.' : p === 'Medium' ? 'Medium = relevant harm signal, but either lower score, less direct UK link, or weaker source signal.' : 'Watch = potentially relevant signal kept for scanning, but lower confidence.'; }

function App() {
  const news = useJson('./news_data.json');
  const cats = useJson('./harm_categories.json');
  const [category, setCategory] = useState('Priority');
  const [priority, setPriority] = useState('All');
  const [onlyUk, setOnlyUk] = useState(false);
  const [minScore, setMinScore] = useState(3);
  const [range, setRange] = useState('7');
  const [view, setView] = useState('Cards');
  const [sort, setSort] = useState('Newest');
  const [limit, setLimit] = useState('50');
  const [q, setQ] = useState('');
  const [showGuide, setShowGuide] = useState(true);

  const articles = useMemo(() => Array.isArray(news.data?.articles) ? news.data.articles : [], [news.data]);
  const categoryNames = useMemo(() => Object.keys(cats.data || {}), [cats.data]);
  const categoryOptions = ['Priority', 'All', ...categoryNames];
  const byCat = categoryNames.map(name => ({ name, count: articles.filter(a => a.category === name).length, description: cats.data?.[name]?.description || '' }));

  const filtered = useMemo(() => {
    const maxDays = range === 'All' ? Infinity : Number(range);
    const base = articles.filter(a => {
      const p = getPriority(a);
      if (category === 'Priority' && p === 'Watch') return false;
      if (category !== 'Priority' && category !== 'All' && a.category !== category) return false;
      if (priority !== 'All' && p !== priority) return false;
      if (onlyUk && !a.uk_relevant) return false;
      if ((a.relevance_score || 0) < minScore) return false;
      if (daysAgo(a.publishedAt) > maxDays) return false;
      if (q && !`${a.title} ${a.summary} ${a.source} ${a.domain} ${(a.why || []).join(' ')} ${a.category}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
    const sorted = [...base].sort((a,b) => {
      if (sort === 'Newest first') return new Date(b.publishedAt) - new Date(a.publishedAt);
      if (sort === 'Oldest first') return new Date(a.publishedAt) - new Date(b.publishedAt);
      if (sort === 'Highest score') return (b.relevance_score || 0) - (a.relevance_score || 0);
      if (sort === 'Category') return String(a.category).localeCompare(String(b.category));
      const rank = { High: 3, Medium: 2, Watch: 1 };
      return (rank[getPriority(b)] - rank[getPriority(a)]) || ((b.relevance_score || 0) - (a.relevance_score || 0)) || (new Date(b.publishedAt) - new Date(a.publishedAt));
    });
    return limit === 'All' ? sorted : sorted.slice(0, Number(limit));
  }, [articles, category, priority, onlyUk, minScore, range, sort, limit, q]);

  const timelineGroups = useMemo(() => filtered.reduce((acc, a) => { const k = dayLabel(a.publishedAt); acc[k] = acc[k] || []; acc[k].push(a); return acc; }, {}), [filtered]);
  const meta = news.data?.meta || {};
  const high = articles.filter(a => getPriority(a) === 'High').length;
  const medium = articles.filter(a => getPriority(a) === 'Medium').length;

  const resetBroad = () => { setCategory('All'); setPriority('All'); setOnlyUk(false); setMinScore(0); setRange('All'); setLimit('All'); setSort('Newest first'); };
  const resetPriority = () => { setCategory('Priority'); setPriority('All'); setOnlyUk(false); setMinScore(3); setRange('7'); setLimit('50'); setSort('Newest first'); };

  const ArticleCard = ({ a, compact=false }) => {
    const p = getPriority(a);
    return <article className={compact ? 'item compact' : 'item'}>
      <div className="itemTop"><span className={`pill ${p.toLowerCase()}`} title={explainPriority(p)}>{p}</span>{a.uk_relevant && <span className="pill uk" title="UK-relevant = matched UK geography, institution, regulator, law-enforcement body, or UK source signal.">UK-relevant</span>}<span className="score">Score {a.relevance_score ?? 0}</span></div>
      <p className="cat">{a.category}</p>
      <h3>{a.title}</h3>
      {!compact && a.summary && <p className="summary">{a.summary}</p>}
      <p className="meta">{hostLabel(a)} · {fmtDate(a.publishedAt)}</p>
      {Array.isArray(a.why) && a.why.length > 0 && <p className="why">Why included: {a.why.join(', ')}</p>}
      {a.url ? <a className="open" href={a.url} target="_blank" rel="noreferrer">Open source</a> : <span className="blocked">No link</span>}
    </article>;
  };

  return <main className="appShell">
    <header className="hero"><div><p className="eyebrow">AIHM horizon scan · auto-updating</p><h1>AI Harms Monitor</h1><p className="lede">A policy-facing scan of AI-enabled harms and AI-enabled crime-response uses, with controls for time period, priority, category and UK relevance.</p></div><div className="heroPanel"><b>{filtered.length}</b><span>results shown</span></div></header>

    <section className="summaryGrid"><div className="stat"><span>Total stored</span><b>{articles.length}</b></div><div className="stat"><span>UK-relevant</span><b>{articles.filter(a => a.uk_relevant).length}</b></div><div className="stat"><span>High priority</span><b>{high}</b></div><div className="stat"><span>Medium priority</span><b>{medium}</b></div><div className="stat wide"><span>Updated</span><b>{fmtDate(meta.generatedAt)}</b></div></section>

    {showGuide && <section className="guide"><div><h2>How to read this scan</h2><p><b>Priority</b> combines relevance score, UK signal and source quality. <b>UK-relevant</b> means the item matched a UK institution, geography, regulator, law-enforcement body or UK policy signal. <b>Watch</b> items are lower-confidence signals kept for horizon scanning rather than front-page priority.</p></div><button onClick={() => setShowGuide(false)}>Hide guide</button></section>}

    <section className="quickActions"><button onClick={resetPriority}>Priority view</button><button onClick={resetBroad}>Show everything</button><button onClick={() => { setRange('7'); setSort('Newest first'); }}>Last week</button><button onClick={() => setCategory('Use of AI to tackle crime and public safety')}>AI tackling crime</button></section>

    <section className="categoryGrid">{byCat.map(c => <button key={c.name} className={category === c.name ? 'catCard active' : 'catCard'} onClick={() => setCategory(c.name)}><span>{c.name}</span><b>{c.count}</b>{c.description && <em>{c.description}</em>}</button>)}</section>

    <section className="toolbar"><label>View<select value={view} onChange={e => setView(e.target.value)}><option>Cards</option><option>Compact</option><option>Timeline</option></select></label><label>Category<select value={category} onChange={e => setCategory(e.target.value)}>{categoryOptions.map(c => <option key={c}>{c}</option>)}</select></label><label>Priority<select value={priority} onChange={e => setPriority(e.target.value)}><option>All</option><option>High</option><option>Medium</option><option>Watch</option></select></label><label>Time period<select value={range} onChange={e => setRange(e.target.value)}><option value="1">Today</option><option value="7">Last week</option><option value="14">Last 14 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="All">All stored</option></select></label><label>Sort by<select value={sort} onChange={e => setSort(e.target.value)}><option>Newest first</option><option>Oldest first</option><option>Priority</option><option>Highest score</option><option>Category</option></select></label><label>Shown<select value={limit} onChange={e => setLimit(e.target.value)}><option>25</option><option>50</option><option>100</option><option>All</option></select></label><label className="check"><input type="checkbox" checked={onlyUk} onChange={e => setOnlyUk(e.target.checked)} /> UK only</label><label>Min score<input type="number" min="0" max="20" value={minScore} onChange={e => setMinScore(Number(e.target.value || 0))} /></label><input className="search" placeholder="Search title, source, category or why included…" value={q} onChange={e => setQ(e.target.value)} /></section>

    {news.error && <p className="error">Could not load results: {news.error}</p>}{news.loading && <p className="notice">Loading…</p>}
    <section className="resultsHeader"><h2>{view === 'Timeline' ? 'Timeline' : 'Results'}</h2><p>{filtered.length} items match current controls.</p></section>
    {view === 'Timeline' ? <section className="timeline">{Object.entries(timelineGroups).map(([day, items]) => <div className="dayGroup" key={day}><h3>{day}<span>{items.length}</span></h3><div className="dayItems">{items.map((a,i) => <ArticleCard key={a.id || a.url || i} a={a} compact />)}</div></div>)}{!news.loading && filtered.length === 0 && <p className="notice">No results match these filters.</p>}</section> : <section className={view === 'Compact' ? 'list compactList' : 'list'}>{filtered.map((a,i) => <ArticleCard key={a.id || a.url || i} a={a} compact={view === 'Compact'} />)}{!news.loading && filtered.length === 0 && <p className="notice">No results match these filters.</p>}</section>}
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);
