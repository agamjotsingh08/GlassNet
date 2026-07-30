# GlassNet

GlassNet is a local website privacy scanner. It visits one public webpage in a
fresh browser session, records safe technical metadata, and turns the observed
network activity into a report that is easier to understand.

The project is intentionally focused. It scans websites, identifies external
services, displays the evidence, stores reports locally, and compares two
reports. It is not a legal-compliance checker or a replacement for a full
security audit.

## Main features

- Quick and full website scans
- Public URL validation
- First-party and third-party domain detection
- Known-service classification
- Privacy exposure score with a plain-language label
- Safe cookie metadata, without cookie values
- Storage-key names and external script URLs in full scans
- Selected response security headers
- Interactive website dependency map
- Local scan history
- Side-by-side report comparison
- Responsive keyboard-friendly interface

## Privacy boundaries

GlassNet creates a fresh isolated browser context for every scan. It does not
use a person's normal browser profile.

GlassNet does not collect or save:

- Passwords
- Cookie values
- Authentication tokens
- Form contents
- Request bodies
- Response bodies
- Personal browser sessions
- Private or local network targets

Completed reports are stored in `data/glassnet.sqlite`. The `data` directory is
ignored by Git, so local scan history is not included when the repository is
published.

## Technology

- Node.js
- TypeScript
- Express
- Playwright
- SQLite using Node's built-in SQLite module
- tldts for registered-domain parsing
- Cytoscape.js for the dependency map

## Run on Windows

Install Node.js 24 or newer. Then open PowerShell inside the `glassnet` folder.

Install the project:

```powershell
npm.cmd install
```

Install Playwright's browser:

```powershell
npm.cmd run install-browser
```

Start GlassNet:

```powershell
npm.cmd start
```

Open:

```text
http://127.0.0.1:5000
```

After the first installation, you normally only need:

```powershell
npm.cmd start
```

Using `npm.cmd` avoids the PowerShell execution-policy error that can prevent
`npm.ps1` from running.

## Development

Start the TypeScript development server:

```powershell
npm.cmd run dev
```

Build the project:

```powershell
npm.cmd run build
```

Run all checks:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run check-secrets
```

The secret check looks through repository files for common credentials,
private-key blocks, embedded passwords, and credential-bearing URLs. Keep real
configuration values in a local `.env` file. `.env` is ignored by Git.

## Project structure

```text
glassnet/
├── server.ts                 Express server and scan queue
├── src/
│   ├── browser-pool.ts       Reuses the browser process safely
│   ├── classification.ts     Recognizes known external services
│   ├── config.ts             Reads local environment settings
│   ├── database.ts           Creates the local SQLite tables
│   ├── repository.ts         Saves and retrieves scan reports
│   ├── scanner.ts            Observes a public webpage
│   ├── types.ts              Shared TypeScript data shapes
│   └── url-safety.ts         Blocks unsafe scan targets
├── static/
│   ├── css/style.css         Website design
│   └── js/
│       ├── app.js            Pages and interactions
│       └── graph.js          Dependency-map module
├── templates/index.html      Shared page shell and copyright footer
├── tests/                    Automated checks and sanitized sample data
└── scripts/secret-check.mjs  Repository secret scanner
```

## How a scan works

1. The server validates that the submitted address is a public HTTP or HTTPS
   URL.
2. The scan waits in a small local queue.
3. Playwright opens the page in a fresh isolated browser context.
4. GlassNet records public network metadata, safe cookie attributes, and the
   selected full-scan evidence.
5. External domains are classified and the exposure score is calculated.
6. The finished report is saved locally and displayed in the browser.

## Understanding the score

GlassNet starts at 100 and subtracts transparent weights for observed
third-party services and cookie metadata. A lower score means that more
privacy-relevant external activity was observed during that visit.

The score is an educational estimate. Website behavior can change because of
location, time, experiments, account state, or consent choices.

## Current limitations

- A scan observes one page load, not an entire website.
- Some websites block automated browsers.
- Domain classification cannot identify every external service.
- The scan does not click consent banners or log into accounts.
- Results can differ between visits.
- The application is designed for local educational use, not high-volume
  production scanning.

## Responsible use

Only scan public websites that you are permitted to access. Respect website
terms, rate limits, and applicable laws.

## Copyright

Copyright © 2026 Agamjot Singh Babra. All rights reserved.
