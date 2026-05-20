# AI Harms Monitor (AIHM Horizon Scan)

A lightweight, auto-updating horizon-scanning web app to help policy teams quickly:
- find **evidence** on specific topics (e.g. **open-source/open-weight models**, **Grok**, **AI agents**),
- see **priority UK-relevant signals**,
- spot **emerging trends** via clustering,
- export quick **evidence packs** for briefings and submissions.

This version is designed to run as a **static site** (GitHub Pages) with a **GitHub Actions** job that refreshes the data on a schedule. No paid AI API is required for the current “free” semantic approximation.

---

## What this is (in one sentence)
A policy-facing dashboard that pulls in candidate stories from configured sources, scores and filters them for relevance, groups them into themes and watchlists, and presents them in a simple UI with export and feedback.

---

## What it is NOT
- Not a complete OSINT capability (no social media/forum scraping unless you add extra sources and connectivity).
- Not a definitive evidence base (it is a triage aid; users must verify sources before using in advice).
- Not a case management system (feedback is captured locally unless you later add a server/database).

---

## How it works (end-to-end)

### 1) Scheduled refresh (GitHub Actions)
A GitHub Actions workflow runs on a cron schedule (and can be triggered manually). It:
1. checks out the repo,
2. runs the Python updater (`scripts/update_news.py`),
3. writes a refreshed `public/news_data.json`,
4. builds the static site (Vite),
5. deploys to GitHub Pages.

**Output of the pipeline**: a static site + `news_data.json` containing results, clusters, watchlist hits and a briefing summary.

---

### 2) Data collection (sources)
The updater collects candidate articles from:
- Google News RSS queries (built from category query strings), and
- additional RSS feeds you configure in `public/sources.json` (if present).

Each item is normalised to:
- `title`, `summary`, `url`, `domain`, `source`, `publishedAt`.

---

### 3) Categorisation (rule-based)
Each category in `public/harm_categories.json` defines:
- `ai_terms` (signals it’s AI-related),
- `core_terms` (signals the harm/topic),
- optional `support_terms`,
- optional `uk_terms` (UK relevance signals),
- optional `sensitive: true` + `sensitive_key` for categories that should not expose raw matching terms in the UI.

An article must match:
- at least one `ai_terms`, AND
- at least one `core_terms`,
or it is rejected.

This is deliberate: it reduces “AI business/marketing fluff” and keeps the results policy-relevant.

---

### 4) Scoring + priority + UK relevance
For each retained article the updater calculates:

**Relevance score** (roughly):
- base points for having AI + harm signals,
- boosts if the harm signal appears in the title,
- boosts for UK signals,
- boosts for higher-trust domains (and extra boost for some sensitive categories from trusted domains),
- penalties for low-signal PR domains and generic business noise.

**UK-relevant** is set if UK signals are matched (`uk_terms`).

**Priority** is derived from score + UK relevance:
- **High**: typically UK-relevant + high score,
- **Medium**: relevant but weaker score or weaker UK link,
- **Watch**: lower confidence signals retained for scanning, but not shown in “Priority-only” views.

The UI explains this to users.

---

