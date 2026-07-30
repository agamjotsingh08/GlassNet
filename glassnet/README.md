# GlassNet

GlassNet is a local website intelligence and privacy observability platform. It
captures a public website's network trail and turns it into an investigation:
domains, services, safe cookie attributes, storage-key names, scripts, selected
security headers, graph relationships, and normalized replay events.

## Run GlassNet on Windows

Open PowerShell inside the `glassnet` folder and use:

```powershell
npm.cmd install
npm.cmd run install-browser
npm.cmd start
```

Then open `http://127.0.0.1:5000`.

If PowerShell allows `npm`, the shorter `npm start` command works too. Using
`npm.cmd` avoids the common PowerShell script-policy error.

## Main workspaces

- Home and Scan — launch Quick, Full, Consent, or Developer investigations.
- Investigations — browse versioned snapshots and technical evidence.
- Digital Twin — explore the website's captured dependency graph.
- Data Flow Replay — step through normalized network events over time.
- Consent Lab — review initial-state evidence without pretending a consent
  action occurred.
- Privacy Git History and Compare — inspect changes between snapshots.
- Developer — privacy reviews, CI threshold checks, issues, and remediation.
- Monitor and Portfolio — group websites and prepare ongoing observation.
- Research — export safe datasets with reproducibility notes.

## Storage

GlassNet uses Node's built-in SQLite support. The local database is
`data/glassnet.sqlite`, which Git ignores. It stores separate relational tables
for accounts, scans, jobs, baselines, reviews, issues, rules, portfolios,
monitors, feedback, and audit events.

## Privacy and safety

Every scan uses a fresh isolated browser context. GlassNet does not open a
person's normal browser profile or copy their login state. It does not retain
cookie values, storage values, passwords, form content, request bodies,
authentication tokens, or response bodies. Private and local network targets
are blocked.

## Main files

- `server.ts` — Express routes and background scan orchestration.
- `src/scanner.ts` — safe browser observation and normalized scan events.
- `src/repository.ts` — SQLite queries for investigations and workflows.
- `src/database.ts` — relational tables and local defaults.
- `templates/index.html` — accessible application shell.
- `static/css/style.css` — Network Repository Observatory visual system.
- `static/js/app.js` — routes, workspaces, graph, replay, and interactions.
- `docs/REBUILD_AUDIT.md` — audit, architecture, and implementation decisions.

## Libraries

- `express` — web server and JSON API.
- `playwright` — fresh isolated scanning browser.
- `tldts` — accurate registered-domain parsing.
- `dotenv` — local environment settings.
- `typescript` and `tsx` — TypeScript development runtime.
- `cytoscape.js` — loaded only when the Digital Twin is opened.

## Useful checks

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run check-secrets
```

The exposure score is a transparent estimate based on one observable page load.
It is not a legal, compliance, or security verdict.
