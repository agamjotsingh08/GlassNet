# GlassNet

GlassNet is a local website privacy intelligence platform. Its **Obsidian
Archive** interface captures a public website's observable network trail and
organizes it as case evidence: domains, services, safe cookie attributes,
storage-key names, scripts, selected security headers, graph relationships,
and normalized replay events.

## Run on Windows

Open PowerShell inside the `glassnet` folder:

```powershell
npm.cmd install
npm.cmd run install-browser
npm.cmd start
```

Open `http://127.0.0.1:5000`.

`npm.cmd` avoids the PowerShell execution-policy error that can affect
`npm.ps1`. After the first installation, starting the app only requires:

```powershell
npm.cmd start
```

`npm.cmd start` runs the compiled production server. Use `npm.cmd run dev` only
while actively editing TypeScript.

## Archive workspaces

- **Home** — recent cases, archive activity, and quick actions.
- **Scan** — Quick, Full, Consent, and Developer investigations.
- **Cases** — summary, dependency map, journeys, evidence, and actions.
- **Govern** — service inventory, ownership, tag-manager records, approvals,
  and architecture decision records.
- **Improve** — necessity review, privacy blueprint, vendor substitution,
  privacy debt, and maturity planning.
- **Test** — requirements, configuration drift, impact forecasts, and
  architecture comparison.
- **Consent** — consent-interface quality records and evidence boundaries.
- **Studio** — research exports, integrations, and local settings.

The rebuild also includes feature-to-tracker attribution, data-exposure
scenarios, evidence chains, incident reconstruction, journey mapping, and
service governance. Calculated results distinguish observed evidence from
classification, inference, recommendations, and user confirmation.

## Storage

GlassNet uses Node's built-in SQLite support. The local database is
`data/glassnet.sqlite`, which Git ignores. It stores scans and evidence
separately from governance records, debt items, approvals, decisions,
requirements, forecasts, journeys, and consent evaluations.

## Privacy and safety

Every scan uses a fresh isolated browser context. GlassNet does not open a
person's normal browser profile or copy their login state. It does not retain
cookie values, storage values, passwords, form contents, request bodies,
authentication tokens, or response bodies. Private and local network targets
are blocked.

When the scanner did not observe enough evidence, the archive returns
`inconclusive`; it does not invent a result.

## Main files

- `server.ts` — Express routes and scan orchestration.
- `src/scanner.ts` — safe browser observation and normalized events.
- `src/archive-analysis.ts` — small deterministic analysis helpers.
- `src/repository.ts` — SQLite queries for cases and workflows.
- `src/database.ts` — relational tables and local defaults.
- `templates/index.html` — accessible application shell.
- `static/css/style.css` — Obsidian Archive visual system.
- `static/js/app.js` — routes, workspaces, graph, forms, and interactions.
- `docs/OBSIDIAN_ARCHIVE.md` — rebuild audit and feature map.

The measured performance baseline, results, budgets, and remaining limits are
documented in `docs/PERFORMANCE.md`.

## Performance

GlassNet reuses the Playwright browser process while creating a fresh isolated
context for every scan. Scan progress uses one cancellable event stream, case
tabs request purpose-specific data, graph code loads only on the map route, and
large evidence lists render in pages. Settings includes optional low-end-device
and reduced-data modes.

## Libraries

- `express` — local web server and JSON API.
- `playwright` — fresh isolated scanning browser.
- `tldts` — registered-domain parsing.
- `dotenv` — local environment settings.
- `typescript` and `tsx` — TypeScript development runtime.
- `cytoscape.js` — loaded only when a dependency map is opened.

## Checks

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run check-secrets
```

The exposure score and forecasts are transparent estimates based on available
evidence. They are not legal, compliance, or security verdicts.
