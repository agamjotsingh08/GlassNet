# GlassNet

GlassNet is a privacy intelligence project that shows the outside services a public website contacts and explains them in plain English.

## Node and TypeScript version

This version uses Node.js and TypeScript. Start it with:

```powershell
npm install
npm run install-browser
npm start
```

Then open `http://127.0.0.1:5000`.

## Local database

GlassNet uses Node's built-in SQLite support and stores local data in
`data/glassnet.sqlite`. This includes local accounts, sessions, websites, scans,
scan jobs, watch targets, notifications, and audit events. It avoids needing a
separate database server for a personal project.

For a public multi-user deployment, migrate the same model to hosted PostgreSQL.

## Privacy and safety

Each scan uses a fresh, isolated browser context. GlassNet does not read, copy,
export, or display cookies from normal Chrome, Edge, Firefox, or other existing
browser profiles. It does not store cookie values, storage values, passwords,
form content, or response bodies.

## Main files

- `server.ts` — Express server and API routes.
- `src/` — URL safety, scanner, classification, configuration, storage, and shared types.
- `templates/index.html` — page structure.
- `static/css/style.css` — visual design.
- `static/js/app.js` — buttons, graph, chart, and API calls.
- `data/glassnet.sqlite` — local application database; Git ignores this file.
- `package.json` — libraries and `npm` commands.

## Libraries

- `express` — sends the website page and handles API routes.
- `playwright` — opens the scanning browser and observes requests.
- `tldts` — gets the main domain from addresses such as `www.example.co.uk`.
- `dotenv` — reads settings from `.env`.
- `typescript` and `tsx` — let Node run TypeScript directly.
- `cytoscape.js` and `chart.js` — draw the graph and chart in the browser.

## Privacy-score reminder

The score is an estimate of observable privacy exposure during one page load. It does not say that a website is safe, unsafe, legal, or illegal.
