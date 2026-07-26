# GlassNet

> A simple privacy intelligence project that shows the outside services a public website contacts.

GlassNet is a privacy intelligence platform that reveals the hidden digital ecosystem behind a public website and explains it in plain English.

It opens a site in an automated Chromium browser, observes network responses and cookies, translates known technical domains into recognizable services, estimates privacy exposure, and presents the result as an interactive map.

## What this project does

- Real website observation with Playwright
- Domain and tracker classification
- Explainable, weighted privacy score
- Interactive connection map with Cytoscape.js
- Category chart with Chart.js
- Scan history stored in SQLite
- Side-by-side scan comparison
- Public-address validation to reduce SSRF risk
- Responsive interface for phones and desktops

## Languages and tools

- Python and Flask
- Playwright
- Beautiful Soup
- SQLite through Flask-SQLAlchemy
- tldextract
- Cytoscape.js and Chart.js

## Run it on your computer

You need Python 3.11 or newer.

1. Create a virtual environment:

   ```bash
   python -m venv .venv
   ```

2. Activate it:

   Windows:

   ```powershell
   .venv\Scripts\Activate.ps1
   ```

   macOS or Linux:

   ```bash
   source .venv/bin/activate
   ```

3. Install the Python packages and Chromium:

   ```bash
   pip install -r requirements.txt
   playwright install chromium
   ```

4. Copy `.env.example` to `.env` and change `SECRET_KEY`.

5. Start GlassNet:

   ```bash
   flask --app app run --debug
   ```

6. Open `http://127.0.0.1:5000`.

The SQLite database is created automatically in the `instance` folder.

## How the privacy score works

GlassNet begins at 100 and subtracts transparent weights for observable signals:

- Advertising service: 12 points
- Behavior analytics: 10 points
- Analytics service: 8 points
- Unknown third party: 3 points
- Functional services such as payments or error monitoring: 1–2 points
- Cookies: up to 20 points
- Third-party cookies: up to 20 additional points

The score describes exposure observed during one page load. It is not a declaration that a website is safe, unsafe, legal, or illegal. Websites can behave differently by location, consent choice, account status, and time.

## Where to change things

- `app.py` contains the Python backend. Read the comments there first.
- `templates/index.html` is the page structure.
- `static/css/style.css` controls the appearance.
- `static/js/app.js` makes the buttons, graph and history interactive.

## Add more known services

Open `app.py` and add a simple entry to `SERVICE_RULES`. Each rule contains:

1. Domain patterns
2. Friendly name
3. Category
4. Plain-English explanation
5. Whether it is likely essential
6. Score weight

## Deployment notes

Playwright needs a host that supports a Chromium process. A normal static host such as GitHub Pages will not run the scanner. Suitable choices include a container host or a small virtual server.

For a production deployment:

- Turn off Flask debug mode.
- Use a production server such as Gunicorn on Linux.
- Install Playwright's required system packages.
- Add rate limiting and a job queue before opening scans to many users.
- Add authentication if scan history should be private.
- Review the target websites' terms and applicable laws.
- Keep the public-IP checks; add DNS rebinding protection at your network layer.

Example Linux start command:

```bash
gunicorn --workers 2 --threads 4 --timeout 90 app:app
```

## Current limits

- A scan observes the first page load, not an entire website.
- Domain matching cannot identify every tracker.
- Some sites block automated browsers.
- Consent banners can change what is observed.
- The application does not submit forms, log in, or bypass access controls.
- AI explanations are intentionally not required in this first version; curated explanations are faster, cheaper, and easier to verify.

## Responsible use

Scan only public websites you are permitted to access. GlassNet is an educational and research tool, not legal, compliance, or security advice.
