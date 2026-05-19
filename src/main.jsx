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

const fmtDate = v => {
  if (!v) return 'Not yet';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
};

function getPriority(a) {
  if (a.uk_relevant && (a.relevance_score || 0) >= 8) return 'High';
  if (a.uk_relevant || (a.relevance_score || 0) >= 7) return 'Medium';
  return 'Watch';
}

function App() {
  const news = useJson('./news_data.json');
  const cats = useJson('./harm_categories.json');
  const [category, setCategory] = useState('Priority');
  const [priority, setPriority] = useState('All');
  const [onlyUk, setOnlyUk] = useState(false);
  const [minScore, setMinScore] = useState(3);
  const [q, setQ] = useState('');

  const articles = useMemo(() => Array.isArray(news.data?.articles) ? news.data.articles : [], [news.data]);
  const categoryNames = useMemo(() => Object.keys(cats.data || {}), [cats.data]);
  const categoryOptions = ['Priority', 'All', ...categoryNames];
  const byCat = categoryNames.map(name => ({ name, count: articles.filter(a => a.category === name).length }));

  const filtered = useMemo(() => articles.filter(a => {
    const p = getPriority(a);
    if (category === 'Priority' && p === 'Watch') return false;
    if (category !== 'Priority' && category !== 'All' && a.category !== category) return false;
    if (priority !== 'All' && p !== priority) return false;
    if (onlyUk && !a.uk_relevant) return false;
    if ((a.relevance_score || 0) < minScore) return false;
    if (q && !`${a.title} ${a.summary} ${a.source} ${a.domain} ${(a.why || []).join(' ')}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [articles, category, priority, onlyUk, minScore, q]);

  const meta = news.data?.meta || {};
  const high = articles.filter(a => getPriority(a) === 'High').length;
  const medium = articles.filter(a => getPriority(a) === 'Medium').length;

  return <main className="appShell">
    <header className="hero">
      <div>
        <p className="eyebrow">AIHM horizon scan · auto-updating</p>
        <h1>AI Harms Monitor</h1>
        <p className="lede">A cleaner policy view of AI-enabled harms, prioritising UK-relevant and high-scoring items while still allowing broader search.</p>
      </div>
      <div className="heroPanel">
        <b>{filtered.length}</b>
        <span>results shown</span>
      </div>
    </header>

    <section className="summaryGrid">
      <div className="stat"><span>Total results</span><b>{articles.length}</b></div>
      <div className="stat"><span>UK-relevant</span><b>{articles.filter(a => a.uk_relevant).length}</b></div>
      <div className="stat"><span>High priority</span><b>{high}</b></div>
      <div className="stat"><span>Medium priority</span><b>{medium}</b></div>
      <div className="stat wide"><span>Updated</span><b>{fmtDate(meta.generatedAt)}</b></div>
    </section>

    <section className="categoryGrid">
      {byCat.map(c => <button key={c.name} className={category === c.name ? 'catCard active' : 'catCard'} onClick={() => setCategory(c.name)}>
        <span>{c.name}</span><b>{c.count}</b>
      </button>)}
    </section>

    <section className="toolbar">
      <select value={category} onChange={e => setCategory(e.target.value)}>{categoryOptions.map(c => <option key={c}>{c}</option>)}</select>
      <select value={priority} onChange={e => setPriority(e.target.value)}><option>All</option><option>High</option><option>Medium</option><option>Watch</option></select>
      <label><input type="checkbox" checked={onlyUk} onChange={e => setOnlyUk(e.target.checked)} /> UK only</label>
      <label>Min score <input type="number" min="0" max="20" value={minScore} onChange={e => setMinScore(Number(e.target.value || 0))} /></label>
      <input className="search" placeholder="Search title, source, category or why included…" value={q} onChange={e => setQ(e.target.value)} />
    </section>

    {news.error && <p className="error">Could not load results: {news.error}</p>}
    {news.loading && <p className="notice">Loading…</p>}

    <section className="resultsHeader"><h2>Results</h2><p>{category === 'Priority' ? 'Default view hides lower-priority watchlist items. Select All to see everything.' : 'Filtered view.'}</p></section>

    <section className="list">
      {filtered.map((a, i) => {
        const p = getPriority(a);
        return <article className="item" key={a.id || a.url || i}>
          <div className="itemTop">
            <span className={`pill ${p.toLowerCase()}`}>{p}</span>
            {a.uk_relevant && <span className="pill uk">UK-relevant</span>}
            <span className="score">Score {a.relevance_score ?? 0}</span>
          </div>
          <p className="cat">{a.category}</p>
          <h3>{a.title}</h3>
          {a.summary && <p className="summary">{a.summary}</p>}
          <p className="meta">{a.source}{a.domain ? ` · ${a.domain}` : ''} · {fmtDate(a.publishedAt)}</p>
          {Array.isArray(a.why) && a.why.length > 0 && <p className="why">Why included: {a.why.join(', ')}</p>}
          {a.url ? <a className="open" href={a.url} target="_blank" rel="noreferrer">Open source</a> : <span className="blocked">No link</span>}
        </article>;
      })}
      {!news.loading && filtered.length === 0 && <p className="notice">No results match these filters. Try All, lower the score, or rerun the workflow.</p>}
    </section>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
