# GlassNet performance audit

Measured locally on Windows against the same GlassNet repository. Browser route
times include the browser-control bridge, so they are comparative wall times
rather than laboratory Web Vitals.

## Baseline

| Measurement | Before |
| --- | ---: |
| Core JavaScript | 139,460 B raw / 32,822 B gzip-capable |
| CSS | 32,602 B raw / 7,156 B gzip-capable |
| HTML shell | 3,784 B |
| JavaScript transfer | 139,460 B, uncompressed |
| Spotify full report response | 13,392 B |
| Landing route | 477 ms |
| Home route | 601 ms |
| Cases route | 661 ms |
| Spotify summary | 488 ms |
| Spotify map | 967 ms |
| Full example.com scan | 7,618 ms |
| Browser opening stage | 2,735 ms |
| Scanner worker peak | approximately 205 MiB |
| Completed-scan query | 0.0666 ms, full scan plus temporary sort |

The existing graph already used a one-time concentric layout rather than
continuous force physics. Cytoscape was loaded only on the map route, but its
loader and lifecycle code still lived in the main application file.

## Root causes found

1. Chromium was launched and destroyed for every scan.
2. Every case tab downloaded the complete report.
3. The completed-scan list parsed full JSON reports and lacked a suitable
   status/date index.
4. Scan status used fixed 700 ms polling without route cancellation.
5. Graph instances survived after their route DOM was removed.
6. Evidence tables rendered every row and filtered on every keystroke.
7. JavaScript, CSS, and JSON were not compressed.
8. Large sticky surfaces used full-area backdrop blur.

## Result

| Measurement | After | Change |
| --- | ---: | ---: |
| Core JavaScript transfer | 33,924 B gzip | 75.7% smaller transfer |
| Separate graph route module | 3,214 B raw / 1,314 B gzip | not loaded on landing |
| Spotify summary response | 2,649 B | 80.2% smaller |
| Spotify map response | 4,390 B | purpose-specific |
| Home route | 390 ms | 35.1% faster |
| Cases route | 451 ms | 31.8% faster |
| Spotify summary | 366 ms | 25.0% faster |
| Spotify map | 653 ms | 32.5% faster |
| Warm full example.com scan | 3,304 ms | 56.6% faster |
| First optimized quick scan | 4,781 ms | cold browser |
| Second optimized quick scan | 1,205 ms | 74.8% faster than optimized cold scan |
| Completed-scan query | 0.0176 ms, covering index | 73.6% faster |

Landing-route wall time varied from 477 ms to 689 ms through the measurement
bridge, so no landing timing improvement is claimed. Its transferred
JavaScript is nevertheless compressed by the server. Graph label interaction
was 308 ms before and 310 ms after through the bridge, so no interaction claim
is made for the small six-node sample.

## Implemented controls

- One reusable Chromium process, a fresh isolated context per scan, ten-scan or
  twenty-minute recycling, crash recovery, and active-context protection.
- Maximum two active scans; additional scans remain in the queue.
- Server-sent scan progress with changed-state batching and cancellable fallback
  polling.
- Purpose-specific case summary, graph, journey, evidence, and action responses.
- Indexed, cursor-ready scan summaries without parsing every report.
- Route request cancellation, request coalescing, and short private in-memory
  freshness windows.
- Graph module lazy loading, deterministic layout caching, no layout animation,
  size-based labels and rendering options, and destruction on route exit.
- Mobile and reduced-data graph deferral with an accessible text view.
- Fifty-row evidence rendering, debounced search, and bounded storage capture.
- Gzip/Brotli-compatible Express compression and immutable versioned assets.
- Low-end device mode and reduced-data mode in Settings.
- Automated delivery budgets for the shell, CSS, core JavaScript, graph module,
  and live-update strategy.

## Budgets

- HTML shell: 6 KB raw.
- Core JavaScript: 36 KB gzip.
- CSS: 9 KB gzip.
- Graph route module: 10 KB raw, excluding Cytoscape.
- Scan status stream: at most one connection per active scan and updates no
  faster than 350–400 ms.
- Active scans: two.
- Captured network events: 500.
- Captured storage keys: 200.
- Scan list page: maximum 50 records.
- Governance workflow lists: maximum 100 records per response.

## Remaining limits

- Cytoscape is approximately 374 KB from the CDN. It remains justified for the
  interactive graph and is never loaded until the graph is explicitly opened.
- The local SQLite database is intentionally a single connection; a connection
  pool would add overhead without helping a single-process local application.
- Reports remain JSON documents in SQLite. Purpose-specific endpoints prevent
  over-delivery, but very large future research datasets may justify normalized
  event tables and true cursor pagination.
- Browser peak memory is not reduced; process reuse removes repeated startup and
  process churn. Recycling bounds its lifetime.
- CPU percentage and browser JavaScript heap were unavailable from the connected
  browser and are therefore not reported.
