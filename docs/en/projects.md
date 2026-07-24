# Projects

Things I've built and can explain in depth. Each entry focuses on the problem solved and the key technical judgment — not just a feature list.

---

## Customer-service Analytics Agent

A multi-turn tool-use agent built on Claude that autonomously picks and calls a set of custom tools (stats, ranking, session lookup, churn reasons, batch keyword search, restricted SQL) to analyze customer-service data across platforms.

- **Safe SQL tool**: `SELECT`-only, table allowlist, forced `LIMIT 500` + timeout, backed by a read-only DB connection — the model can freely write JOINs/aggregations for cross-table analysis without ever escalating privileges.
- **SSE streaming** of reasoning and results; prompt-level cost guards so the model doesn't burn tokens on redundant cross-validation.
- Large results aren't dumped back into context — they're **returned as a summary** (row count + columns + a few samples).

> Guiding principle: let the AI orchestrate, understand and generate; leave precise computation and ground truth to deterministic systems.

---

## Data Collection Cost-cutting & Anti-bot Research

Migrated interaction-metric collection from a paid third-party API to **free public pages**, while using systematic experiments to pin down exactly what can and can't be self-built.

- **Public-page replacement (shipped)**: the numbers are rendered right into the page's `window.__INITIAL_STATE__` — no login, no auth API — driving snapshot/probe API cost to zero, with the paid API called only on demand.
- **Systematically disproving self-built content scraping**: after ruling out captcha, residential IP, account age, and TLS/JA3 fingerprint spoofing (verified working with `curl_cffi`) and still getting blocked, I located the root cause in the request-behavior layer of non-browser clients — and concluded to stop investing there.
- A well-evidenced "no" is as valuable as a successful "yes."

📖 Written up on the blog (Chinese): [Public-page snapshots](/blog/2026-07-24-public-page-scraping)

---

## High-frequency Scheduled Monitoring

A monitoring system that must run frequently for the long term without tripping platform risk controls.

- **Dynamic cron** via `ThreadPoolTaskScheduler` + `CronTrigger` + `cancel/reschedule`; cron stored in DB, front-end edits take effect instantly, no restart.
- **Adaptive back-off + circuit breaking** to cut wasted probes.
- **Front/back resource isolation** so a busy background job can't starve interactive traffic sharing the same request queue.
- **Redisson watchdog distributed lock** so only one instance runs a given task at a time under multi-instance deployment.

📖 Written up on the blog (Chinese): [Refactoring to dynamic cron](/blog/2026-07-22-dynamic-cron-scheduler)

---

## Multimodal AI Review & Vision Monitoring

- **Review pipeline**: vision model + OCR dual recognition, service-configurable prompt templates (no redeploy to change rules), async MQ queue + distributed lock.
- **Vision monitoring**: background screenshot → vision model → push. A **perceptual hash (dHash)** pre-filter skips the model call when nothing changed, and data-driven model selection cut inference cost ~8× for the high-frequency case.

---

## chat-collector: Full-stack Data Collection

A single **Chrome MV3 extension** adapted to the customer-service backends of 5 e-commerce platforms, collecting passively by reusing operators' already-logged-in sessions — lowest risk-control footprint.

- Full pipeline: extension → Express + MySQL (three-layer dedup, image hosting, migration) → AI structured analysis → Vue dashboard.
- Used **real order data as ground truth** to validate the AI's conversion judgment instead of unreliable keyword guessing.

---

## Stack

| Area | Tools |
| --- | --- |
| Backend | Java 17 · Spring Boot 3 · MySQL · Redis / Redisson · MQ |
| Frontend | Vue 3 · Vite · Pinia · Element Plus · ECharts |
| AI | Claude (tool-use / multi-turn agents) · multimodal vision · OCR · prompt engineering |
| Collection | Chrome MV3 extension · Playwright · public-page reverse-engineering · anti-bot research |
| Ops | Docker · Alibaba Cloud ECI / ECS · Nginx · GitHub Actions |

Want to talk about any of these? Find me on the [about](/en/about) page.
