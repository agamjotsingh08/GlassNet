# GlassNet master specification traceability

The master specification contains 219 product and engineering requirements plus
60 information-architecture requirements. This file prevents a local demo from
claiming production capabilities it does not yet have.

## Implemented local foundation

- Public URL validation and basic private-network blocking
- Isolated Playwright scans with a fresh browser context
- Network-domain, cookie-metadata, storage-key, and script-source observation
- No cookie values, credentials, tokens, form content, or response bodies stored
- Deterministic domain classification, confidence labels, graph data, and privacy score
- Local SQLite storage for accounts, sessions, websites, scans, jobs, watch targets,
  audit events, notifications, and feature flags
- Local report history, comparison, responsive page, graph, chart, and error messages
- Core API routes: health, scan, history, report, comparison

## Phase 1 — reliability and safety

Requirements 3–5, 12–20, 24–34, 60–67, 69–89, 150–160, 167–175, 182–190.

Status: foundation started. Remaining work includes redirect limits, rate limits,
structured logs, tests, CSP, dependency audit automation, scanner resource limits,
request timelines, security-header analysis, and failure-state UI.

## Phase 2 — data and report model

Requirements 7–14, 18–23, 90–111, 135–149, 170–176, 200–205.

Status: planned. Requires a relational database, migrations, job states, worker
queue, cache, retention controls, reproducibility metadata, and ownership dataset.

## Phase 3 — user value

Requirements 22, 39–59, 77–89, 101–109, 112–134, 185–193, plus routing 1–60.

Status: planned. Includes consent comparisons, storage/report pages, timelines,
watch targets, search, accessibility, developer/research areas, and focused routes.

## Phase 4 — hosted product features

Requirements 25–31, 35, 65, 110–118, 140–149, 156–166, 176–181, 194–199, 206–218.

Status: requires explicit hosting, identity, email/notification, database, and
monitoring decisions. It must not be represented as live in a local-only build.

## Non-negotiable safety rules

Requirements 3.7, 4, 15, 16, 28, and 72–76 apply in every phase. GlassNet must
not extract credentials or browser cookies, scan private networks, bypass access
controls, evade bot protections, or retain sensitive browser data.
