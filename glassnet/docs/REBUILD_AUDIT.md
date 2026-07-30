# GlassNet rebuild audit

## A. Why the previous interface failed

The previous product was one long page with a light dotted hero, a conventional
top navigation bar, and repeated rounded cards. Changing theme variables did not
change its composition. Scanning, history, comparison, education, and feedback
all competed on the same page. Advanced modes were short text blocks rather than
workspaces, and the graph was visually similar to a default node diagram.

The backend had good safety foundations—public URL validation, an isolated
browser, safe metadata collection, accounts, SQLite, jobs, and watch targets—but
the scan endpoint waited synchronously and the UI could not show real progress.

## B. Complete visual replacement

The new identity is **Network Repository Observatory**:

- deep graphite shell, blue-black workspace, and layered green-gray surfaces;
- mineral cyan for network flow, emerald for verified states, amber for
  uncertainty, coral for concerns, violet for interpretation, and pale sand for
  evidence exports;
- technical sans-serif interface with monospace domains, IDs, timestamps, and
  request metadata;
- compact navigation rail, workspace header, main investigation canvas, and
  context inspector;
- repository panels, diff rows, branch timelines, status strips, evidence
  tables, and node inspectors instead of generic floating cards;
- bottom navigation and drawer-like inspector behavior on small screens;
- motion is limited to data flow, live scanning, replay, and short transitions,
  and stops under reduced-motion preferences.

## C. Major feature architecture

| System | User problem | Working path | Data and security |
| --- | --- | --- | --- |
| Digital Twin | Dependencies are difficult to understand | Select, zoom, label, inspect, export, simulate blocking | Captured nodes/edges only; no private browser state |
| Privacy Git History | Behavior changes disappear between scans | Each completed scan is a versioned commit | Relational scans and website identity |
| Privacy Review | Releases add unexpected exposure | Compare two scans, create review, approve/request changes | Review state and evidence diff stored separately |
| CI Gate | Privacy limits need an objective release check | Evaluate configured thresholds through `/api/ci/:scanId` | Local rules, deterministic output, no fake external status |
| Consent Lab | Pre-consent activity is unclear | Show initial-state evidence and only claim actions actually performed | Passive observation is labeled; no guessed clicks |
| Replay | Activation order is hard to explain | Play, pause, seek, change speed, inspect event | Normalized event metadata; no request bodies |
| Passport | Teams need a reusable summary | Investigation overview and safe export are the foundation | Public publication remains disabled until explicit controls exist |
| Regression | New services and weaker behavior need detection | Baselines, diffs, reviews, and rule checks | Baselines reference immutable completed scans |
| Portfolio | Teams manage several sites | Create portfolio and add scanned websites | Separate portfolio and membership tables |
| Research | Evidence must be reproducible | Dataset view, methodology, filters, structured export | Scanner version and limitations travel with evidence |

Public passport publication, scheduled background monitors, webhook delivery,
email delivery, and a browser companion remain deliberately gated. They require
deployment identity, delivery infrastructure, and explicit privacy review.

## D. Screen-by-screen redesign

- Landing: large product statement and an interactive network observatory
  preview.
- Home: central scan command, activity stream, featured investigation, pulse,
  and four quick actions.
- Scan: four clear investigation modes and a live queued workspace.
- Investigation: version header, overview, Digital Twin, Replay, Consent Lab,
  and Evidence routes.
- History and Compare: commit timeline and evidence diff.
- Reviews: privacy pull-request rows with a decision workflow.
- Monitor and Portfolio: monitoring entry points and multi-site groups.
- Research: reproducibility metadata and structured dataset export.
- Developer: rule evaluation, reviews, issues, and integration contract.
- Settings: appearance, density, local account, and privacy boundaries.

## E. File plan and result

Replaced:

- `templates/index.html`
- `static/css/style.css`
- `static/js/app.js`
- `server.ts`
- `src/scanner.ts`
- `src/types.ts`

Extended:

- `src/database.ts`
- `src/repository.ts`
- `src/config.ts`
- `package.json`
- `README.md`

Created:

- `scripts/secret-check.mjs`
- `.github/workflows/quality.yml`
- `.githooks/pre-commit`
- `docs/REBUILD_AUDIT.md`

No giant UI framework or animation library was added. Cytoscape loads only when
the Digital Twin opens. SQLite remains local and relational.

## F. Implementation sequence

The implementation followed the requested order: visual tokens, application
shell, landing page, scan flow, live investigation, Digital Twin, history, then
developer and research workflows. The existing URL safety and isolated scanner
behavior were preserved throughout.
