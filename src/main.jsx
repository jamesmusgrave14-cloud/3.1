import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

function useJson(path) {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  useEffect(() => {
    fetch(path, { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error(`${path} returned ${response.status}`);
        return response.json();
      })
      .then(data => setState({ loading: false, error: '', data }))
      .catch(error => setState({ loading: false, error: error.message, data: null }));
  }, [path]);
  return state;
}

const fmt = value => {
  if (!value) return 'Not yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
};
const daysAgo = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? Infinity : (Date.now() - date.getTime()) / 86400000;
};
const priority = article => article.priority || 'Watch';
const csvEscape = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
function download(name, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
function useFeedback() {
  const key = 'aihm_feedback_v1';
  const [rows, setRows] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  });
  const add = (article, label) => {
    const row = { ts: new Date().toISOString(), id: article.id, title: article.title, category: article.category, label, url: article.url };
    const next = [row, ...rows].slice(0, 500);
    setRows(next);
    localStorage.setItem(key, JSON.stringify(next));
  };
  const exportCsv = () => download('aihm-feedback.csv', ['ts,id,label,category,title,url', ...rows.map(row => [row.ts, row.id, row.label, row.category, row.title, row.url].map(csvEscape).join(','))].join('\n'), 'text/csv');
  return { rows, add, exportCsv };
}

function Metric({ label, value, tone }) {
  return <div className={`metric ${tone || ''}`}><span>{label}</span><strong>{value}</strong></div>;
}

function App() {
  const news = useJson('./news_data.json');
  const cats = useJson('./harm_categories.json');
  const fb = useFeedback();
  const articles = Array.isArray(news.data?.articles) ? news.data.articles : [];
  const clusters = Array.isArray(news.data?.clusters) ? news.data.clusters : [];
  const briefing = news.data?.briefing || {};
  const watchlist = Array.isArray(news.data?.watchlist) ? news.data.watchlist : [];
  const [view, setView] = useState('Briefing');
  const [category, setCategory] = useState('All');
  const [range, setRange] = useState('30');
  const [sort, setSort] = useState('Newest first');
  const [query, setQuery] = useState('');
  const [onlyUk, setOnlyUk] = useState(false);
  const [watch, setWatch] = useState('All');
  const categories = Object.keys(cats.data || {});

  const filtered = useMemo(() => {
    const maxDays = range === 'All' ? Infinity : Number(range);
    let rows = articles.filter(article => {
      if (category !== 'All' && article.category !== category) return false;
      if (onlyUk && !article.uk_relevant) return false;
      if (daysAgo(article.publishedAt) > maxDays) return false;
      if (watch !== 'All' && !(article.watchlist_hits || []).some(hit => hit.name === watch)) return false;
      const blob = `${article.title} ${article.summary} ${article.category} ${article.domain} ${article.source} ${(article.why || []).join(' ')} ${(article.watchlist_hits || []).map(hit => hit.name).join(' ')}`.toLowerCase();
      return !query || blob.includes(query.toLowerCase());
    });
    return rows.sort((a, b) => {
      if (sort === 'Oldest first') return new Date(a.publishedAt) - new Date(b.publishedAt);
      if (sort === 'Highest score') return (b.relevance_score || 0) - (a.relevance_score || 0);
      if (sort === 'Priority') return ({ High: 3, Medium: 2, Watch: 1 }[priority(b)] - { High: 3, Medium: 2, Watch: 1 }[priority(a)]);
      return new Date(b.publishedAt) - new Date(a.publishedAt);
    });
  }, [articles, category, range, sort, query, onlyUk, watch]);

  const exportMarkdown = () => download('aihm-evidence-pack.md', [`# AIHM evidence pack: ${query || watch || 'selected filters'}`, `Generated: ${new Date().toLocaleString('en-GB')}`, `Items: ${filtered.length}`, '', ...filtered.slice(0, 50).map((article, index) => `## ${index + 1}. ${article.title}\n- Category: ${article.category}\n- Priority: ${priority(article)} | Score: ${article.relevance_score ?? ''} | UK-relevant: ${article.uk_relevant ? 'Yes' : 'No'}\n- Source: ${article.source || article.domain || ''} | Date: ${fmt(article.publishedAt)}\n- Why included: ${(article.why || []).join(', ')}\n- Link: ${article.url || ''}\n`)].join('\n'));
  const exportCsv = () => download('aihm-results.csv', ['title,category,priority,score,uk_relevant,published,source,url,why,semantic_category,semantic_score', ...filtered.map(article => [article.title, article.category, priority(article), article.relevance_score, article.uk_relevant, article.publishedAt, article.source || article.domain, article.url, (article.why || []).join('; '), article.semantic_category, article.semantic_score].map(csvEscape).join(','))].join('\n'), 'text/csv');

  const byPriority = news.data?.meta?.byPriority || {};
  const highCount = byPriority.High || articles.filter(a => priority(a) === 'High').length;
  const ukCount = articles.filter(a => a.uk_relevant).length;

  const Card = ({ article }) => <article className="resultCard">
    <div className="resultTop"><span className={`badge ${priority(article).toLowerCase()}`}>{priority(article)}</span>{article.uk_relevant && <span className="badge uk">UK</span>}{(article.watchlist_hits || []).slice(0,2).map(hit => <span key={hit.name} className="badge watchhit">{hit.name}</span>)}<span className="score">Score {article.relevance_score}</span></div>
    <p className="categoryLabel">{article.category}</p>
    <h3>{article.title}</h3>
    {article.summary && <p className="summary">{article.summary}</p>}
    <p className="meta">{article.source || article.domain || 'Source'} · {fmt(article.publishedAt)}</p>
    {article.why?.length > 0 && <p className="why">Why included: {article.why.join(', ')}</p>}
    <div className="cardActions"><a href={article.url} target="_blank" rel="noreferrer">Open source</a><button onClick={() => fb.add(article, 'Useful')}>Useful</button><button onClick={() => fb.add(article, 'Not relevant')}>Not relevant</button><button onClick={() => fb.add(article, 'Wrong category')}>Wrong category</button></div>
  </article>;

  return <main className="appShell">
    <section className="heroPanel">
      <div className="heroCopy">
        <p className="eyebrow">AIHM horizon scan · free semantic prototype</p>
        <h1>AI Harms Monitor</h1>
        <p className="subtitle">Evidence discovery for AI-enabled harms, open-source/model risks, public-safety capability watch, and AI used to tackle crime.</p>
      </div>
      <div className="heroMetrics">
        <Metric label="Shown" value={filtered.length} tone="blue" />
        <Metric label="Total retained" value={articles.length} />
        <Metric label="High priority" value={highCount} tone="red" />
        <Metric label="UK-relevant" value={ukCount} tone="green" />
      </div>
    </section>

    <section className="toolbarCard">
      <div className="tabs">{['Briefing', 'Evidence', 'Clusters', 'Watchlist', 'Feedback', 'Diagnostics'].map(tab => <button key={tab} onClick={() => setView(tab)} className={view === tab ? 'active' : ''}>{tab}</button>)}</div>
      <div className="filters">
        <label>Search evidence<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Grok, open source, agentic AI, fraud…" /></label>
        <label>Category<select value={category} onChange={event => setCategory(event.target.value)}><option>All</option>{categories.map(name => <option key={name}>{name}</option>)}</select></label>
        <label>Watchlist<select value={watch} onChange={event => setWatch(event.target.value)}><option>All</option>{watchlist.map(item => <option key={item.name}>{item.name}</option>)}</select></label>
        <label>Time<select value={range} onChange={event => setRange(event.target.value)}><option value="7">Last week</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="All">All stored</option></select></label>
        <label>Sort<select value={sort} onChange={event => setSort(event.target.value)}><option>Newest first</option><option>Oldest first</option><option>Priority</option><option>Highest score</option></select></label>
        <label className="check"><input type="checkbox" checked={onlyUk} onChange={event => setOnlyUk(event.target.checked)} /> UK only</label>
      </div>
      <div className="quickActions"><button onClick={() => { setQuery(''); setWatch('Open-source / open-weight models'); setView('Evidence'); }}>Open-source evidence</button><button onClick={() => { setQuery('Grok'); setWatch('Grok'); setView('Evidence'); }}>Grok evidence</button><button onClick={() => { setWatch('AI agents'); setQuery(''); setView('Evidence'); }}>AI agents evidence</button><button onClick={exportMarkdown}>Export evidence pack</button><button onClick={exportCsv}>Export CSV</button></div>
    </section>

    {news.error && <p className="error">Could not load data: {news.error}</p>}{news.loading && <p className="notice">Loading…</p>}

    {view === 'Briefing' && <section className="contentGrid">
      <article className="panel wide"><div className="sectionHeader"><div><p className="label">Automated summary</p><h2>Briefing overview</h2></div><span className="smallPill">{fmt(news.data?.meta?.generatedAt)}</span></div><p className="headline">{briefing.headline || 'No briefing generated yet.'}</p></article>
      <article className="panel"><h3>Top categories</h3><ul className="cleanList">{(briefing.top_categories || []).map(([name, value]) => <li key={name}><span>{name}</span><b>{value}</b></li>)}</ul></article>
      <article className="panel"><h3>Watchlist hits</h3>{(briefing.top_watchlist_hits || []).length ? <ul className="cleanList">{briefing.top_watchlist_hits.map(([name, value]) => <li key={name}><span>{name}</span><b>{value}</b></li>)}</ul> : <p className="muted">No watchlist hits yet.</p>}</article>
      <article className="panel"><h3>Top clusters</h3><ul className="cleanList">{(briefing.top_clusters || []).map(cluster => <li key={cluster.id}><span>{cluster.title}</span><b>{cluster.count}</b></li>)}</ul></article>
      <section className="panel wide"><div className="sectionHeader"><div><p className="label">Priority evidence</p><h2>Highest-priority items</h2></div></div><div className="resultGrid">{(briefing.highest_priority_items || []).map((item, index) => <article className="miniCard" key={index}><h3>{item.title}</h3><p>{item.category} · {item.priority} · Score {item.score}</p>{item.url && <a href={item.url} target="_blank" rel="noreferrer">Open source</a>}</article>)}</div><p className="note">{briefing.suggested_use}</p></section>
    </section>}

    {view === 'Evidence' && <section className="panel"><div className="sectionHeader"><div><p className="label">Evidence finder</p><h2>{filtered.length} matching items</h2></div></div><div className="resultGrid">{filtered.map(article => <Card key={article.id} article={article} />)}</div></section>}

    {view === 'Clusters' && <section className="panel"><div className="sectionHeader"><div><p className="label">Emerging themes</p><h2>Trend clusters</h2></div></div><div className="clusterList">{clusters.map(cluster => <article className="clusterCard" key={cluster.id}><h3>{cluster.title}</h3><p>{cluster.count} items · {cluster.uk_count} UK-relevant · highest score {cluster.highest_score}</p><ul>{(cluster.top_titles || []).map(title => <li key={title}>{title}</li>)}</ul><button onClick={() => { setQuery(cluster.title.replace(/^.*?: /, '')); setView('Evidence'); }}>View matching evidence</button></article>)}</div></section>}

    {view === 'Watchlist' && <section className="panel"><div className="sectionHeader"><div><p className="label">Specific model/tool tracking</p><h2>Watchlist</h2></div></div><div className="resultGrid">{watchlist.map(item => <article className="miniCard" key={item.name}><h3>{item.name}</h3><p>{item.reason}</p><p className="muted"><b>Aliases:</b> {(item.aliases || []).join(', ')}</p><button onClick={() => { setWatch(item.name); setView('Evidence'); }}>View evidence</button></article>)}</div></section>}

    {view === 'Feedback' && <section className="panel"><h2>Feedback capture</h2><p className="muted">Feedback is stored in this browser only. Export and share it if needed.</p><button className="primaryButton" onClick={fb.exportCsv}>Export feedback CSV</button><ul className="feedbackList">{fb.rows.map((row, index) => <li key={index}>{row.ts}: {row.label} — {row.title}</li>)}</ul></section>}

    {view === 'Diagnostics' && <section className="panel"><h2>Diagnostics</h2><pre>{JSON.stringify(news.data?.meta || {}, null, 2)}</pre></section>}
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
