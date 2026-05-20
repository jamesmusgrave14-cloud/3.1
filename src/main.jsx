import { useEffect, useMemo, useState } from "react";
import "./App.css";

function formatDate(item) {
  const rawDate =
    item.publishedAt ||
    item.published_at ||
    item.pubDate ||
    item.pub_date ||
    item.date ||
    item.seendate ||
    item.seenDate ||
    item.createdAt ||
    item.updatedAt;

  if (!rawDate) return "Date not available";

  const parsedDate = new Date(rawDate);

  if (Number.isNaN(parsedDate.getTime())) {
    return String(rawDate).slice(0, 10);
  }

  return parsedDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getDateValue(item) {
  const rawDate =
    item.publishedAt ||
    item.published_at ||
    item.pubDate ||
    item.pub_date ||
    item.date ||
    item.seendate ||
    item.seenDate ||
    item.createdAt ||
    item.updatedAt;

  const parsedDate = rawDate ? new Date(rawDate) : null;
  return parsedDate && !Number.isNaN(parsedDate.getTime())
    ? parsedDate.getTime()
    : 0;
}

function getSource(item) {
  if (typeof item.source === "string") return item.source;
  if (item.source?.name) return item.source.name;
  if (item.sourceName) return item.sourceName;
  if (item.publisher) return item.publisher;
  if (item.domain) return item.domain;
  return "Unknown source";
}

function getDescription(item) {
  return (
    item.description ||
    item.summary ||
    item.contentSnippet ||
    item.snippet ||
    item.abstract ||
    ""
  );
}

function getCategory(item) {
  return item.category || item.riskArea || item.risk_area || item.theme || "";
}

function getScore(item) {
  return item.score ?? item.relevanceScore ?? item.relevance_score ?? null;
}

function normaliseArticles(rawData) {
  let items = [];

  if (Array.isArray(rawData)) {
    items = rawData;
  } else if (Array.isArray(rawData.articles)) {
    items = rawData.articles;
  } else if (Array.isArray(rawData.items)) {
    items = rawData.items;
  } else if (Array.isArray(rawData.results)) {
    items = rawData.results;
  }

  return items
    .map((item, index) => ({
      id: item.id || item.url || item.link || index,
      title: item.title || "Untitled article",
      description: getDescription(item),
      url: item.url || item.link || "",
      source: getSource(item),
      category: getCategory(item),
      score: getScore(item),
      publishedAt:
        item.publishedAt ||
        item.published_at ||
        item.pubDate ||
        item.pub_date ||
        item.date ||
        item.seendate ||
        item.seenDate ||
        item.createdAt ||
        item.updatedAt ||
        "",
      raw: item,
    }))
    .filter((item) => item.title && item.title !== "Untitled article");
}

export default function App() {
  const [articles, setArticles] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedSource, setSelectedSource] = useState("All");
  const [timeRange, setTimeRange] = useState("All");
  const [sortOrder, setSortOrder] = useState("Newest");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    async function loadArticles() {
      try {
        const baseUrl = import.meta.env.BASE_URL || "/";
        const response = await fetch(`${baseUrl}data/articles.json`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Could not load articles.json: ${response.status}`);
        }

        const rawData = await response.json();
        const cleanedArticles = normaliseArticles(rawData);

        setArticles(cleanedArticles);
        setLoadError("");
      } catch (error) {
        console.error(error);
        setLoadError(
          "Could not load monitoring data. Check that public/data/articles.json exists and is valid JSON."
        );
      } finally {
        setLoading(false);
      }
    }

    loadArticles();
  }, []);

  const categories = useMemo(() => {
    const values = articles
      .map((item) => item.category)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    return ["All", ...new Set(values)];
  }, [articles]);

  const sources = useMemo(() => {
    const values = articles
      .map((item) => item.source)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    return ["All", ...new Set(values)];
  }, [articles]);

  const filteredArticles = useMemo(() => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    return articles
      .filter((item) => {
        const text = [
          item.title,
          item.description,
          item.source,
          item.category,
          item.url,
        ]
          .join(" ")
          .toLowerCase();

        const matchesQuery = query
          ? text.includes(query.toLowerCase().trim())
          : true;

        const matchesCategory =
          selectedCategory === "All" || item.category === selectedCategory;

        const matchesSource =
          selectedSource === "All" || item.source === selectedSource;

        const itemDate = getDateValue(item.raw || item);

        let matchesTimeRange = true;

        if (timeRange === "Last 7 days") {
          matchesTimeRange = itemDate && now - itemDate <= 7 * day;
        }

        if (timeRange === "Last 30 days") {
          matchesTimeRange = itemDate && now - itemDate <= 30 * day;
        }

        if (timeRange === "Last 90 days") {
          matchesTimeRange = itemDate && now - itemDate <= 90 * day;
        }

        return (
          matchesQuery &&
          matchesCategory &&
          matchesSource &&
          matchesTimeRange
        );
      })
      .sort((a, b) => {
        if (sortOrder === "Oldest") {
          return getDateValue(a.raw || a) - getDateValue(b.raw || b);
        }

        if (sortOrder === "Highest relevance") {
          return (getScore(b.raw || b) || 0) - (getScore(a.raw || a) || 0);
        }

        return getDateValue(b.raw || b) - getDateValue(a.raw || a);
      });
  }, [
    articles,
    query,
    selectedCategory,
    selectedSource,
    timeRange,
    sortOrder,
  ]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-blue-700">
            AI harms monitoring
          </p>

          <h1 className="text-3xl font-bold tracking-tight text-slate-950">
            AI Harms Monitoring Dashboard
          </h1>

          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            Monitoring public reporting, research and official updates relevant
            to AI-enabled harms, including fraud, exploitation, abuse,
            terrorism-related misuse, and illegal item creation or acquisition.
          </p>
        </header>

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-5">
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Search
              </label>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search articles..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Category
              </label>
              <select
                value={selectedCategory}
                onChange={(event) => setSelectedCategory(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Source
              </label>
              <select
                value={selectedSource}
                onChange={(event) => setSelectedSource(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                {sources.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Timeline
              </label>
              <select
                value={timeRange}
                onChange={(event) => setTimeRange(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                <option>All</option>
                <option>Last 7 days</option>
                <option>Last 30 days</option>
                <option>Last 90 days</option>
              </select>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              Showing{" "}
              <span className="font-semibold text-slate-900">
                {filteredArticles.length}
              </span>{" "}
              of{" "}
              <span className="font-semibold text-slate-900">
                {articles.length}
              </span>{" "}
              items
            </p>

            <div>
              <label className="mr-2 text-sm font-medium text-slate-700">
                Sort
              </label>
              <select
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                <option>Newest</option>
                <option>Oldest</option>
                <option>Highest relevance</option>
              </select>
            </div>
          </div>
        </section>

        {loading && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            Loading monitoring data...
          </section>
        )}

        {!loading && loadError && (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
            {loadError}
          </section>
        )}

        {!loading && !loadError && filteredArticles.length === 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            No matching articles found. Try widening the search, timeline,
            source or category filters.
          </section>
        )}

        {!loading && !loadError && filteredArticles.length > 0 && (
          <section className="grid gap-4">
            {filteredArticles.map((item, index) => (
              <article
                key={item.id || item.url || index}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-200 hover:shadow-md"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                  <span>{formatDate(item.raw || item)}</span>

                  {item.source && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Source: {item.source}</span>
                    </>
                  )}

                  {item.category && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{item.category}</span>
                    </>
                  )}
                </div>

                <h2 className="mb-2 text-lg font-semibold leading-7 text-slate-950">
                  {item.title}
                </h2>

                {item.description && (
                  <p className="mb-4 text-sm leading-6 text-slate-700">
                    {item.description}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                    >
                      View original article
                    </a>
                  )}

                  {item.score !== undefined && item.score !== null && (
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">
                      Relevance score: {item.score}
                    </span>
                  )}
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
