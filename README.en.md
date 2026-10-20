<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.png">
    <img src="docs/assets/banner-light.png" alt="InvestPro: every field can have its own InvestPro. Many sources flow into the selection in the middle, which then branches out to macro, markets, companies and research" width="100%">
  </picture>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-176b75?style=flat-square" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Node.js-24-176b75?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 24">
  <img src="https://img.shields.io/badge/PostgreSQL-17-176b75?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL 17">
  <img src="https://img.shields.io/badge/Docker-Compose-176b75?style=flat-square&logo=docker&logoColor=white" alt="Docker Compose">
</p>

<p align="center">
  <b>An investment information platform that finds the news and writes the daily briefing by itself.</b><br>
  It watches first-party sources — central banks, regulators, exchanges and listed companies — screens and writes Chinese titles and summaries with a model, and adds a signal-confidence score and sector trends.
</p>

<p align="center">
  <a href="README.md">简体中文</a> · <b>English</b>
</p>

<p align="center">
  <a href="#run-it">Run it</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#documentation">Documentation</a>
</p>

<br>

## What this is

InvestPro collects material from high-confidence sources (central banks, regulators, exchange filings, company disclosures, financial media and research), screens it twice with independent model scores, and writes Chinese titles and answer-first summaries. Reports of the same thing are clustered into one event, ranked by how many independent sources are talking about it. On top of that it computes a **signal confidence** score (source tier, independent coverage, discussion) and **sector trends** (last 7 days vs the 7 before), and publishes a daily briefing at 07:30 Beijing time.

**Disclaimer**: this site aggregates public information. Nothing here is investment advice.

## Sources

36 preset sources, all verified working, in three tiers:

- **T1 first-party (23)**: Federal Reserve (press, speeches, enforcement orders, banking applications, FEDS Notes), ECB, Bank of England, Bank of Japan, SEC press releases, EIA, Liberty Street Economics, Apple Newsroom, SEC EDGAR 8-K filings for Apple, Microsoft, NVIDIA, Tesla, Alphabet, Amazon, Meta, JPMorgan and Berkshire, plus China's National Bureau of Statistics (data releases and data interpretations).
- **T1.5 official media and institutions (2)**: Securities Daily (a CSRC-designated disclosure outlet) and Oxford Economics.
- **T2 media and professionals (11)**: WSJ Markets, CNBC Economy/Finance, MarketWatch, Seeking Alpha Market Currents, OilPrice, Mining.com, Net Interest, The Overshoot, TMTPost and 199IT.

Chinese sources (WeChat accounts, X accounts) can be added in the admin's source page; see [sources](docs/sources.md). The CSRC, SSE, CNInfo and HKEX sites render their lists in the browser and expose no subscribable feed, so they are not preset; use the push API or a WeChat account for them.

The macro dashboard takes **data series**, not articles, so it uses its own APIs: [FRED](https://fred.stlouisfed.org/docs/api/) (US and China CPI/PPI, Brent and WTI, monthly commodity prices, total factor productivity — free, needs a key in `FRED_API_KEY`), the [World Bank](https://datahelpdesk.worldbank.org/knowledgebase/topics/125589) open API (real GDP, fixed capital formation, industrial value added, R&D intensity, patents — free, no key), and market-data providers for gold and ETF daily bars (Twelve Data, Polygon, Alpha Vantage — configure all of them and they are tried in that order, the next one stepping in when the previous fails). One gap to know about: ETFs listed in Shanghai and Shenzhen (510300, 518880) are behind Twelve Data's paid Pro plan, so the China view shows the **US-listed ETFs that track A-shares** instead — ASHR (CSI 300), FXI (large-cap China), KWEB (China internet), priced in dollars. On-exchange ETF prices need another provider or an upgraded plan.

A Kondratiev wave is 50–60 years long, while the published series themselves only reach back sixty or seventy years: the filter has no neighbours at the two ends. **The recent end of the long wave is an estimate**, drawn dashed and revised as new data arrives. That is a limit of long-wave analysis itself; this site labels it instead of hiding it. China's public long series are annual and start in 1960, so its long-wave position is a rough guide; the Maddison Project series (from 1820) is a better base but updates once a year and has to be imported statically.

## What you get

Six source kinds (RSS, web lists, JSON APIs, X accounts, WeChat accounts, your own pushes) with tiered admission thresholds and adaptive fetch intervals; selection by two independent scores; Chinese titles, answer-first summaries and a reading reason; events with digests; a hot ranking; **/signals** (signal confidence per event) and **/trends** (sector momentum); a **macro dashboard** (**/dashboard**) with three-cycle overlays (Kondratiev 50–60y, Juglar 7–11y, Kitchin 3–5y), gold and ETF prices, crude oil, CPI/PPI and commodities, switchable between China and the US; a **daily PEST brief** (**/dashboard/report**); daily, weekly and monthly briefings; topic pages and search; local reading settings; RSS, public API, MCP and Agent Markdown; and an admin for sources, content diagnostics, selection evaluation, per-step model choice, budget breakers and run history.

## Run it

Needs [Docker](https://docs.docker.com/get-started/get-docker/), Node.js 24 (for `init-env`), and an OpenAI-compatible model API key (DeepSeek, Qwen, Zhipu all work).

```bash
git clone <your repo> investpro
cd investpro
node scripts/init-env.ts --llm-key <your model API key>
docker compose up -d --build
```

Open <http://localhost:3000>. The admin is at `/admin` (password in `.env`). Content starts after a minute or two; the first import takes about half an hour to process. See [deployment](docs/deploy.md) for running without Docker, domains, HTTPS and mainland China.

## Make it your field

This site is an industry instance of the open-source [AIHOT engine](https://github.com/KKKKhazix/AIHOT): the investment taxonomy, sources, prompts and thresholds live in `industry/` and `site/`; the engine code is in `apps/` and `packages/`. Follow [docs/customize.md](docs/customize.md) to swap the industry. The investment-specific `/signals` and `/trends` pages are the `modules/invest-signals/` module — remove it for another industry, or write your own module the same way.

The selection thresholds (T1 60 / T1_5 65 / T2 76) are the engine defaults and on the strict side; recalibrate them with your own labelled samples as described in [selection](docs/selection.md) before launch.

## Documentation

| Document | Contents |
|---|---|
| [Customize](docs/customize.md) | Site name, taxonomy, topics, sources, prompts, thresholds, models, brand |
| [Sources](docs/sources.md) | The six source kinds, tiers and full text, fetch intervals, the push API |
| [Selection](docs/selection.md) | How material becomes selected, and how to calibrate |
| [Grouping](docs/grouping.md) | Event relations and the paired-sample evaluation |
| [Digest evaluation](docs/story-digest-evaluation.md) | Comparing digest prompts side by side |
| [Deployment](docs/deploy.md) | Docker, domains and HTTPS, mainland China, updates, backups |
| [Architecture](docs/architecture.md) | Three processes, modules, migrations, exits, tests |

Stack: Node.js 24 · TypeScript · React Router (SSR) · Fastify · PostgreSQL · pg-boss · Tailwind CSS · Docker Compose.

## License

Code under the [MIT License](LICENSE).
