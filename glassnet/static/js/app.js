// GlassNet uses a small client-side router so each workspace has its own URL.
const workspace = document.querySelector("#workspace");
const inspector = document.querySelector("#inspector");
const pageTitle = document.querySelector("#page-title");
const pageCrumb = document.querySelector("#page-crumb");
const toast = document.querySelector("#toast");

const state = {
  scans: [],
  report: null,
  network: null,
  replayTimer: null,
  liveSource: null,
  pollTimer: null,
  routeController: new AbortController(),
  requestCache: new Map(),
  inFlightRequests: new Map(),
  reportCache: new Map(),
  density: localStorage.getItem("glassnet-density") || "comfortable",
  performanceMode: localStorage.getItem("glassnet-performance") || "standard",
  dataMode: localStorage.getItem("glassnet-data-mode") || "standard",
};

const cacheTimes = {
  "/api/scans": 15000,
  "/api/sample-report": 60000,
  "/api/features": 60000,
};

const commands = [
  { label: "Scan website", detail: "Start a new archive case", path: "/scan" },
  { label: "Open cases", detail: "Browse captured case files", path: "/cases" },
  { label: "Service inventory", detail: "Review ownership and approvals", path: "/governance/inventory" },
  { label: "Necessity analyzer", detail: "Separate core and optional dependencies", path: "/improvement/necessity" },
  { label: "Requirement tests", detail: "Run evidence-linked expectations", path: "/testing/requirements" },
  { label: "Consent quality", detail: "Evaluate interface balance carefully", path: "/consent" },
  { label: "Research studio", detail: "Evidence and reproducibility", path: "/studio/research" },
  { label: "Settings", detail: "Appearance and local account", path: "/settings" },
];

document.documentElement.dataset.theme =
  localStorage.getItem("glassnet-archive-theme") || "dark";
document.documentElement.dataset.density = state.density;
document.documentElement.dataset.performance = state.performanceMode;
document.documentElement.dataset.dataMode = state.dataMode;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[character]));
}

function safeNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

async function api(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const isGet = method === "GET";
  const cacheKey = isGet ? url : "";
  const cacheTime = Object.entries(cacheTimes).find(([prefix]) => url.startsWith(prefix))?.[1] || (url.includes("/view/") ? 30000 : 0);
  const cached = cacheTime ? state.requestCache.get(cacheKey) : null;
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (isGet && state.inFlightRequests.has(cacheKey)) return state.inFlightRequests.get(cacheKey);

  const request = (async () => {
    const response = await fetch(url, {
      ...options,
      signal: options.signal || (isGet ? state.routeController.signal : undefined),
    });
    const body = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(body?.error || "GlassNet could not complete this request.");
    if (cacheTime) state.requestCache.set(cacheKey, { value: body, expiresAt: Date.now() + cacheTime });
    return body;
  })();

  if (isGet) state.inFlightRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (isGet && state.inFlightRequests.get(cacheKey) === request) state.inFlightRequests.delete(cacheKey);
  }
}

function clearCachedRequests(prefix) {
  for (const key of state.requestCache.keys()) {
    if (key.startsWith(prefix)) state.requestCache.delete(key);
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function setPage(name, crumb) {
  pageTitle.textContent = name;
  pageCrumb.textContent = `GlassNet / ${crumb}`;
  document.title = `${name} — GlassNet`;
}

function navigate(path) {
  if (location.pathname !== path) history.pushState({}, "", path);
  renderRoute();
}

function activeNavigation(section) {
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.classList.toggle("active", link.dataset.nav === section);
  });
}

function emptyInspector() {
  inspector.classList.remove("open");
  inspector.innerHTML = `
    <div class="inspector-empty">
      <span>⌁</span>
      <strong>Context inspector</strong>
      <p>Select a domain, event, finding, or release change to inspect its evidence.</p>
    </div>`;
}

function showInspector(title, domain, rows, description = "") {
  inspector.innerHTML = `
    <p class="eyebrow">SELECTED EVIDENCE</p>
    <h2>${escapeHtml(title)}</h2>
    <div class="domain">${escapeHtml(domain)}</div>
    ${description ? `<p class="quiet-note" style="line-height:1.6;margin-top:14px">${escapeHtml(description)}</p>` : ""}
    <div class="inspector-section">
      ${rows.map((row) => `<div class="inspector-row"><span>${escapeHtml(row[0])}</span><strong>${escapeHtml(row[1])}</strong></div>`).join("")}
    </div>
    <button class="button ghost" id="close-inspector" style="width:100%;margin-top:18px">Close inspector</button>`;
  inspector.classList.add("open");
  document.querySelector("#close-inspector").addEventListener("click", emptyInspector);
}

function landingPreview() {
  return `
    <div class="observatory-preview" aria-label="Interactive preview of a GlassNet investigation">
      <div class="preview-bar"><span>INVESTIGATION / EXAMPLE.ORG</span><span class="badge pass">CAPTURED</span></div>
      <div class="preview-body">
        <span class="preview-edge edge-1"></span><span class="preview-edge edge-2"></span>
        <span class="preview-edge edge-3"></span><span class="preview-edge edge-4"></span>
        <button class="preview-node root" data-preview-node="Website">example.org<br>42 requests</button>
        <button class="preview-node n1" data-preview-node="Analytics">analytics<br>likely</button>
        <button class="preview-node n2" data-preview-node="CDN">cdn<br>verified</button>
        <button class="preview-node n3" data-preview-node="Support">support<br>unknown</button>
        <button class="preview-node n4" data-preview-node="Advertising">ads<br>attention</button>
        <span class="pulse-dot"></span>
      </div>
      <div class="preview-footer">
        <div class="mini-stream">
          <p class="eyebrow">REQUEST STREAM</p>
          <div class="stream-row"><b>+0.2s</b><span>document → example.org</span><span>200</span></div>
          <div class="stream-row"><b>+0.8s</b><span>script → analytics</span><span>js</span></div>
          <div class="stream-row"><b>+1.4s</b><span>image → cdn</span><span>img</span></div>
        </div>
        <div class="mini-inspector">
          <p class="eyebrow">NODE INSPECTOR</p>
          <strong id="preview-selection">example.org</strong>
          <p class="quiet-note">Select a node to inspect its role in the network trail.</p>
        </div>
      </div>
    </div>`;
}

function renderLanding() {
  setPage("Obsidian Archive", "Welcome");
  activeNavigation("");
  emptyInspector();
  workspace.innerHTML = `
    <section class="page landing-hero">
      <div class="landing-copy">
        <p class="eyebrow">WEBSITE INTELLIGENCE / PRIVACY OBSERVABILITY</p>
        <h2>Every website leaves a <span>network trail.</span></h2>
        <p>GlassNet captures the domains, scripts, cookies, storage systems, and third-party services a website activates—then turns them into a live privacy and dependency map.</p>
        <div class="hero-actions">
          <button class="button primary" data-go="/scan">Scan a website</button>
          <button class="button secondary" id="open-sample">Open sample case</button>
        </div>
        <div class="trust-strip"><span>FRESH ISOLATED BROWSER</span><span>NO COOKIE VALUES</span><span>EVIDENCE BEFORE SCORES</span></div>
      </div>
      ${landingPreview()}
    </section>`;

  document.querySelector("#open-sample").addEventListener("click", openSample);
  document.querySelectorAll("[data-preview-node]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector("#preview-selection").textContent = button.dataset.previewNode;
    });
  });
}

function scanForm(compact = false) {
  return `
    <form id="scan-form" class="scan-command">
      <div class="scan-command-top">
        <span>◎</span>
        <input id="url-input" name="url" aria-label="Public website address" placeholder="https://example.com" value="${escapeHtml(localStorage.getItem("glassnet-unsent-url") || "")}" required autocomplete="url">
        ${compact ? '<button class="button primary" type="submit">Launch</button>' : ""}
      </div>
      ${compact ? "" : `
        <div class="mode-grid" role="radiogroup" aria-label="Investigation type">
          ${modeTile("quick", "⚡", "Quick Scan", "Fast network summary and service count.", true)}
          ${modeTile("full", "⌁", "Full Investigation", "Network, storage, scripts, headers, and replay.")}
          ${modeTile("consent", "◐", "Consent Investigation", "Record initial consent-state activity safely.")}
          ${modeTile("developer", "⇄", "Developer Review", "Capture a release candidate for baseline review.")}
        </div>
        <div class="scan-command-foot">
          <span class="quiet-note">Public targets only. Private and local addresses are blocked.</span>
          <button class="button primary" type="submit">Launch investigation →</button>
        </div>`}
    </form>`;
}

function modeTile(value, icon, title, description, selected = false) {
  return `
    <label class="mode-option">
      <input type="radio" name="mode" value="${value}" ${selected ? "checked" : ""}>
      <span class="mode-tile"><span>${icon}</span><strong>${title}</strong><small>${description}</small></span>
    </label>`;
}

async function loadScans() {
  const page = await api(`/api/scans?limit=${state.dataMode === "reduced" ? 15 : 30}`);
  state.scans = Array.isArray(page) ? page : page.items;
  return state.scans;
}

async function renderHome() {
  setPage("Home", "Home");
  activeNavigation("home");
  emptyInspector();
  await loadScans().catch(() => []);
  const latest = state.scans[0];
  workspace.innerHTML = `
    <section class="page">
      <div class="page-heading">
        <p class="eyebrow">ARCHIVE HOME</p>
        <h2>Launch an investigation.</h2>
        <p>Follow a website's network trail, inspect evidence, and build a history of how its privacy behavior changes.</p>
      </div>
      ${scanForm(true)}
      <div class="workspace-grid" style="margin-top:18px">
        <section class="repo-panel">
          <div class="panel-head"><div><h3>Archive activity</h3><p>Recent cases and observable changes</p></div><button class="button ghost" data-go="/cases">View all</button></div>
          <div>${activityRows(state.scans.slice(0, 5))}</div>
        </section>
        <section class="repo-panel">
          <div class="panel-head"><div><h3>Featured investigation</h3><p>Most recent completed snapshot</p></div></div>
          <div class="panel-body">
            ${latest ? `
              <p class="eyebrow">${escapeHtml(latest.mode || "full")} / ${formatDate(latest.created_at)}</p>
              <h3 style="margin:0 0 5px">${escapeHtml(latest.site_name)}</h3>
              <div class="domain">${escapeHtml(latest.target_domain)}</div>
              <div class="metric-strip" style="grid-template-columns:1fr 1fr;margin-top:17px">
                <div class="metric-cell"><span>Exposure score</span><strong>${safeNumber(latest.score)}</strong></div>
                <div class="metric-cell"><span>Third parties</span><strong>${safeNumber(latest.third_parties)}</strong></div>
              </div>
              <button class="button primary" data-go="/cases/${latest.id}/summary" style="margin-top:14px;width:100%">Open case file</button>`
              : `<div class="empty-state" style="min-height:210px"><div><span>⌁</span><h3>No cases yet</h3><p>Run your first scan to create an archived website case.</p></div></div>`}
          </div>
        </section>
      </div>
      <div class="workspace-grid equal">
        <section class="repo-panel">
          <div class="panel-head"><div><h3>Network pulse</h3><p>Latest observed service mix</p></div></div>
          <div class="panel-body">${latest ? categoryBars(latest) : `<p class="quiet-note">A category pulse appears after your first scan.</p>`}</div>
        </section>
        <section class="repo-panel">
          <div class="panel-head"><div><h3>Quick actions</h3><p>Common investigation workflows</p></div></div>
          <div class="panel-body stack">
            <button class="button secondary spread" data-go="/scan"><span>Start scan</span><span>→</span></button>
            <button class="button secondary spread" data-go="/testing/architecture"><span>Compare architectures</span><span>→</span></button>
            <button class="button secondary spread" data-go="${latest ? `/cases/${latest.id}/summary` : "/cases"}"><span>Open latest case</span><span>→</span></button>
            <button class="button secondary spread" data-go="/governance/inventory"><span>Review service inventory</span><span>→</span></button>
          </div>
        </section>
      </div>
    </section>`;
  attachScanForm();
}

function activityRows(scans) {
  if (!scans.length) return `<div class="empty-state"><div><span>⌁</span><h3>No activity</h3><p>Completed scans and review changes will appear here.</p></div></div>`;
  return scans.map((scan) => `
    <button class="history-row" data-go="/cases/${scan.id}/summary" style="width:100%;color:inherit;background:transparent;border-left:0;border-right:0;border-top:0;text-align:left;cursor:pointer">
      <span class="status-dot"></span>
      <span><h4>${escapeHtml(scan.site_name)}</h4><p>${escapeHtml(scan.target_domain)} · ${safeNumber(scan.requests)} requests · ${formatDate(scan.created_at)}</p></span>
      <span class="badge pass">${safeNumber(scan.score)}/100</span>
    </button>`).join("");
}

function categoryBars(scan) {
  const groups = [
    ["Third-party services", safeNumber(scan.third_parties), 20, "var(--copper)"],
    ["Observed cookies", safeNumber(scan.cookies), 30, "var(--amber)"],
    ["Network requests", safeNumber(scan.requests), 150, "var(--mauve)"],
  ];
  return groups.map(([label, value, max, color]) => `
    <div style="margin:13px 0">
      <div class="spread" style="font-size:10px;color:var(--muted)"><span>${label}</span><span class="mono">${value}</span></div>
      <div style="height:5px;background:var(--shell-2);margin-top:7px"><div style="height:100%;width:${Math.min(100, Number(value) / Number(max) * 100)}%;background:${color}"></div></div>
    </div>`).join("");
}

function renderScan() {
  setPage("Launch Investigation", "Scan");
  activeNavigation("scan");
  emptyInspector();
  workspace.innerHTML = `
    <section class="page">
      <div class="page-heading">
        <p class="eyebrow">NEW SNAPSHOT</p>
        <h2>Trace a website's external ecosystem.</h2>
        <p>Choose the depth of observation. GlassNet always uses a fresh isolated browser and records metadata—not private browsing data.</p>
      </div>
      ${scanForm(false)}
      <div class="workspace-grid equal" style="margin-top:18px">
        <section class="repo-panel"><div class="panel-head"><h3>What GlassNet records</h3></div><div class="panel-body quiet-note" style="line-height:1.8">Public requests · domain relationships · service categories · safe cookie attributes · storage key names · script URLs · selected response security headers</div></section>
        <section class="repo-panel"><div class="panel-head"><h3>What GlassNet never records</h3></div><div class="panel-body quiet-note" style="line-height:1.8">Cookie values · passwords · form fields · request bodies · personal browser sessions · authentication tokens · private network targets</div></section>
      </div>
    </section>`;
  attachScanForm();
}

function attachScanForm() {
  const form = document.querySelector("#scan-form");
  if (!form) return;
  const input = form.querySelector("#url-input");
  input.addEventListener("input", () => localStorage.setItem("glassnet-unsent-url", input.value));
  form.addEventListener("submit", startScan);
}

async function startScan(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const url = form.querySelector("#url-input").value;
  const mode = form.querySelector('input[name="mode"]:checked')?.value || "quick";
  localStorage.setItem("glassnet-unsent-url", url);
  try {
    const job = await api("/api/scans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, mode }),
    });
    localStorage.removeItem("glassnet-unsent-url");
    renderLiveScan(job, url, mode);
    watchJob(job.jobId);
  } catch (error) {
    showScanError(error.message);
  }
}

function renderLiveScan(job, url, mode) {
  setPage("Live Investigation", `Scan / ${job.scanId}`);
  workspace.innerHTML = `
    <section class="page">
      <div class="page-heading">
        <p class="eyebrow">SCAN ${escapeHtml(String(job.scanId).padStart(6, "0"))} / ${escapeHtml(mode)}</p>
        <h2>Building the network snapshot.</h2>
        <p class="domain">${escapeHtml(url)}</p>
      </div>
      <div class="live-workspace">
        <div class="live-canvas">
          <div class="radar"><span class="scan-orbit"></span></div>
          <div style="position:absolute;left:18px;bottom:18px"><span class="badge pass">ISOLATED BROWSER</span></div>
        </div>
        <aside class="live-side">
          <p class="eyebrow">INVESTIGATION PROGRESS</p>
          <div id="stage-list">
            ${["Queued", "Opening browser", "Mapping network", "Reading storage", "Classifying services", "Completed"].map((stage, index) => `<div class="progress-stage ${index === 0 ? "active" : ""}" data-stage-index="${index}"><span>${index === 0 ? "●" : "○"}</span><span>${stage}</span></div>`).join("")}
          </div>
          <div class="live-metrics">
            <div class="live-metric"><strong id="live-domains">0</strong><span>DOMAINS</span></div>
            <div class="live-metric"><strong id="live-requests">0</strong><span>REQUESTS</span></div>
          </div>
          <p id="live-message" class="quiet-note" style="margin-top:18px;line-height:1.6">GlassNet will preserve a partial record if the target stops responding.</p>
        </aside>
      </div>
    </section>`;
}

function finishLiveJob(job) {
  state.liveSource?.close();
  state.liveSource = null;
  clearTimeout(state.pollTimer);
  state.pollTimer = null;
  if (job.status === "completed") {
    clearCachedRequests("/api/scans");
    state.reportCache.clear();
    showToast("Case archived");
    navigate(`/cases/${job.scan_id}/summary`);
    return true;
  }
  if (job.status === "failed") {
    showScanError(job.error_code || "The browser worker could not finish this scan.", job.scan_id);
    return true;
  }
  return false;
}

function watchJob(jobId) {
  if (!("EventSource" in window)) return pollJob(jobId);
  state.liveSource?.close();
  const source = new EventSource(`/api/jobs/${jobId}/events`);
  state.liveSource = source;
  source.onmessage = (event) => updateLiveProgress(JSON.parse(event.data));
  source.addEventListener("complete", (event) => finishLiveJob(JSON.parse(event.data)));
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED && state.liveSource === source) {
      state.liveSource = null;
      pollJob(jobId);
    }
  };
}

async function pollJob(jobId, delay = 900, previousStage = "") {
  try {
    const job = await api(`/api/jobs/${jobId}`);
    updateLiveProgress(job);
    if (finishLiveJob(job)) return;
    const currentStage = job.progress?.stage || job.progress_stage || "";
    const nextDelay = currentStage === previousStage ? Math.min(2200, delay + 250) : 900;
    const visibleDelay = document.hidden ? Math.max(2500, nextDelay) : nextDelay;
    state.pollTimer = setTimeout(() => pollJob(jobId, nextDelay, currentStage), visibleDelay);
  } catch (error) {
    if (error.name === "AbortError") return;
    showScanError(error.message);
  }
}

function updateLiveProgress(job) {
  const stageOrder = ["queued", "opening_browser", "mapping_network", "reading_storage", "classifying_services", "completed"];
  const stageName = job.progress?.stage || job.progress_stage || "queued";
  const currentIndex = Math.max(0, stageOrder.indexOf(stageName));
  document.querySelectorAll(".progress-stage").forEach((row, index) => {
    row.classList.toggle("done", index < currentIndex);
    row.classList.toggle("active", index === currentIndex);
    row.querySelector("span").textContent = index < currentIndex ? "✓" : index === currentIndex ? "●" : "○";
  });
  const domains = document.querySelector("#live-domains");
  const requests = document.querySelector("#live-requests");
  if (domains) domains.textContent = safeNumber(job.progress?.domains);
  if (requests) requests.textContent = safeNumber(job.progress?.requests);
}

function showScanError(message, scanId = "local") {
  setPage("Investigation Interrupted", "Scan / Error");
  workspace.innerHTML = `
    <section class="page">
      <div class="page-heading"><p class="eyebrow">REQUEST ${escapeHtml(scanId)}</p><h2>The investigation could not finish.</h2></div>
      <div class="error-state">
        <h3>Browser worker stopped</h3>
        <p>${escapeHtml(message)}</p>
        <p style="margin-top:9px">No private browser data was used. Retrying may help if the website timed out or temporarily blocked automated analysis.</p>
        <div class="row" style="margin-top:15px"><button class="button primary" data-go="/scan">Try another scan</button><button class="button ghost" data-go="/cases">Open preserved cases</button></div>
      </div>
    </section>`;
}

async function openSample() {
  state.report = await api("/api/sample-report");
  state.reportCache.set("sample:full", state.report);
  renderInvestigation(state.report, "summary");
  history.replaceState({}, "", "/cases/sample/summary");
}

async function renderInvestigations() {
  setPage("Cases", "Cases");
  activeNavigation("cases");
  emptyInspector();
  await loadScans().catch(() => []);
  workspace.innerHTML = `
    <section class="page">
      <div class="spread page-heading" style="max-width:none">
        <div><p class="eyebrow">OBSIDIAN ARCHIVE</p><h2>Case files</h2><p>Each completed scan is an organized, versioned technical analysis—not a legal or criminal case.</p></div>
        <button class="button primary" data-go="/scan">New case</button>
      </div>
      <div class="table-tools"><input class="field" id="investigation-search" placeholder="Search websites or domains" style="flex:1"><select class="field" id="investigation-sort"><option value="newest">Newest first</option><option value="score">Lowest score</option><option value="domain">Domain</option></select></div>
      <div id="investigation-table">${investigationTable(state.scans)}</div>
    </section>`;
  document.querySelector("#investigation-search").addEventListener("input", filterInvestigations);
  document.querySelector("#investigation-sort").addEventListener("change", filterInvestigations);
}

function investigationTable(scans) {
  if (!scans.length) return `<div class="empty-state"><div><span>▤</span><h3>No cases</h3><p>Start your first website case to reveal its network, storage, and third-party ecosystem.</p><button class="button primary" data-go="/scan">Start case</button></div></div>`;
  return `
    <div class="data-table-wrap"><table class="data-table">
      <thead><tr><th>Website</th><th>Version</th><th>Mode</th><th>Requests</th><th>Third parties</th><th>Cookies</th><th>Score</th></tr></thead>
      <tbody>${scans.map((scan) => `
        <tr data-open-scan="${scan.id}" tabindex="0" style="cursor:pointer">
          <td><strong>${escapeHtml(scan.site_name)}</strong><br><span class="domain">${escapeHtml(scan.target_domain)}</span></td>
          <td class="mono">scan-${String(scan.id).padStart(5, "0")}<br><span class="quiet-note">${formatDate(scan.created_at)}</span></td>
          <td><span class="badge">${escapeHtml(scan.mode || "full")}</span></td>
          <td class="mono">${safeNumber(scan.requests)}</td><td class="mono">${safeNumber(scan.third_parties)}</td><td class="mono">${safeNumber(scan.cookies)}</td>
          <td><span class="badge ${scan.score > 75 ? "pass" : scan.score > 50 ? "warn" : "fail"}">${safeNumber(scan.score)}/100</span></td>
        </tr>`).join("")}</tbody>
    </table></div>`;
}

function filterInvestigations() {
  const query = document.querySelector("#investigation-search").value.toLowerCase();
  const sort = document.querySelector("#investigation-sort").value;
  const filtered = state.scans.filter((scan) => `${scan.site_name} ${scan.target_domain}`.toLowerCase().includes(query));
  filtered.sort((left, right) => sort === "score" ? left.score - right.score : sort === "domain" ? left.target_domain.localeCompare(right.target_domain) : new Date(right.created_at) - new Date(left.created_at));
  document.querySelector("#investigation-table").innerHTML = investigationTable(filtered);
  attachGlobalActions();
}

async function getReport(scanId, tab = "summary", full = false) {
  if (scanId === "sample") return api("/api/sample-report");
  const key = `${scanId}:${full ? "full" : tab}`;
  if (state.reportCache.has(key)) return state.reportCache.get(key);
  const report = await api(full ? `/api/scans/${scanId}` : `/api/scans/${scanId}/view/${tab}`);
  state.reportCache.set(key, report);
  return report;
}

async function renderInvestigationRoute(scanId, tab = "summary") {
  try {
    const report = await getReport(scanId, tab);
    state.report = report;
    renderInvestigation(report, tab);
  } catch (error) {
    if (error.name === "AbortError") return;
    showScanError(error.message, scanId);
  }
}

function renderInvestigation(report, tab) {
  setPage(report.site_name, `Cases / ${report.id || "Sample"}`);
  activeNavigation("cases");
  emptyInspector();
  clearInterval(state.replayTimer);
  const scanId = report.id || "sample";
  workspace.innerHTML = `
    <section class="page">
      <header class="case-file-header">
        <div class="spread">
          <div>
            <p class="eyebrow">CASE ${String(scanId).toUpperCase()} / VERSION ${report.id || "DEMO"}</p>
            <h2>${escapeHtml(report.site_name)}</h2>
            <div class="investigation-meta"><span>${escapeHtml(report.target_domain)}</span><span>${escapeHtml(report.mode || "full")} scan</span><span>${formatDate(report.created_at)}</span><span>browser: isolated chromium</span><span>scanner ${escapeHtml(report.scanner_version)}</span></div>
          </div>
          <div class="row"><button class="button ghost" id="export-report">Export JSON</button>${report.id ? `<button class="button secondary" id="set-baseline">Set baseline</button>` : ""}</div>
        </div>
      </header>
      <nav class="archive-tabs" aria-label="Case sections">
        ${["summary", "map", "journeys", "evidence", "actions"].map((name) => `<button class="${tab === name ? "active" : ""}" data-investigation-tab="${name}">${titleCase(name)}</button>`).join("")}
      </nav>
      <div id="investigation-content">${investigationContent(report, tab)}</div>
    </section>`;

  document.querySelector("#export-report").addEventListener("click", async () => {
    const exportReport = report.id ? await getReport(report.id, tab, true) : report;
    downloadJson(exportReport, `glassnet-${report.target_domain}-${scanId}.json`);
  });
  document.querySelector("#set-baseline")?.addEventListener("click", () => createBaseline(report.id));
  document.querySelectorAll("[data-investigation-tab]").forEach((button) => {
    button.addEventListener("click", () => navigate(`/cases/${scanId}/${button.dataset.investigationTab}`));
  });
  attachInvestigationActions(report, tab);
}

function investigationContent(report, tab) {
  if (tab === "map") return digitalTwinView(report);
  if (tab === "journeys") return caseJourneysView(report);
  if (tab === "evidence") return evidenceView(report);
  if (tab === "actions") return caseActionsView(report);
  return overviewView(report);
}

function overviewView(report) {
  const unknown = report.services.filter((service) => service.confidence === "unknown");
  const missingSecure = report.cookies.filter((cookie) => !cookie.secure);
  return `
    <div class="metric-strip">
      ${metricCell("Exposure score", report.score, report.score_label, "score-value")}
      ${metricCell("Network requests", report.summary.requests, "captured")}
      ${metricCell("Third parties", report.summary.third_parties, "outside services")}
      ${metricCell("Cookies", report.summary.cookies, `${report.summary.third_party_cookies} third-party`)}
      ${metricCell("Unknown services", unknown.length, "needs review")}
    </div>
    <div class="workspace-grid">
      <section class="repo-panel">
        <div class="panel-head"><div><h3>Main findings</h3><p>Evidence-first summary</p></div><span class="badge ai">INTERPRETATION</span></div>
        <div>
          ${findingRow(unknown.length ? "warn" : "pass", `${unknown.length} unclassified service${unknown.length === 1 ? "" : "s"}`, unknown.length ? "Ownership and purpose need review." : "All observed domains matched the local classification rules.", "Classification")}
          ${findingRow(missingSecure.length ? "warn" : "pass", `${missingSecure.length} cookie${missingSecure.length === 1 ? "" : "s"} without Secure`, missingSecure.length ? "Only cookie attributes are retained; values are discarded." : "All observed cookies used the Secure attribute.", "Storage")}
          ${findingRow(report.security_headers?.["content-security-policy"] ? "pass" : "warn", "Content Security Policy", report.security_headers?.["content-security-policy"] ? "A CSP header was observed on the main response." : "No CSP header was observed on the main response.", "Headers")}
        </div>
      </section>
      <section class="repo-panel">
        <div class="panel-head"><div><h3>Scorecard dimensions</h3><p>Transparent indicators, not a verdict</p></div></div>
        <div class="panel-body">${scoreDimensions(report)}</div>
      </section>
    </div>
    <div class="workspace-grid equal">
      <section class="repo-panel">
        <div class="panel-head"><div><h3>Organization power map</h3><p>Grouped from observed service classifications</p></div><button class="button ghost" data-open-twin>Open twin</button></div>
        <div class="panel-body">${organizationRows(report)}</div>
      </section>
      <section class="repo-panel">
        <div class="panel-head"><div><h3>Remediation plan</h3><p>Actions tied to captured evidence</p></div></div>
        <div class="panel-body">${remediationRows(report)}</div>
      </section>
    </div>`;
}

function metricCell(label, value, note, className = "") {
  return `<div class="metric-cell"><span>${escapeHtml(label)}</span><strong class="${className}">${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></div>`;
}

function findingRow(status, title, description, category) {
  return `<button class="finding-row" data-finding-title="${escapeHtml(title)}" data-finding-description="${escapeHtml(description)}" style="width:100%;border-left:0;border-right:0;border-top:0;color:inherit;background:transparent;text-align:left;cursor:pointer"><span class="status-dot ${status}"></span><span><h4>${escapeHtml(title)}</h4><p>${escapeHtml(description)}</p></span><span class="badge ${status}">${escapeHtml(category)}</span></button>`;
}

function scoreDimensions(report) {
  const dimensions = [
    ["Third-party exposure", Math.max(0, 100 - report.summary.third_parties * 5)],
    ["Cookie persistence", Math.max(0, 100 - report.summary.cookies * 3)],
    ["Unknown services", Math.max(0, 100 - report.services.filter((item) => item.confidence === "unknown").length * 15)],
    ["Security headers", Math.min(100, Object.keys(report.security_headers || {}).length * 17)],
  ];
  return dimensions.map(([label, value]) => `
    <div style="margin-bottom:13px">
      <div class="spread" style="font-size:10px"><span>${label}</span><span class="mono">${value}/100</span></div>
      <div style="height:4px;background:var(--shell-2);margin-top:6px"><div style="height:100%;width:${value}%;background:${value > 70 ? "var(--gold)" : value > 45 ? "var(--amber)" : "var(--coral)"}"></div></div>
    </div>`).join("") + `<p class="quiet-note">Formula: each dimension starts at 100 and subtracts a visible penalty from observed counts. Limit: one public page load cannot prove legal compliance.</p>`;
}

function organizationRows(report) {
  const groups = {};
  for (const service of report.services) {
    const organization = service.name === service.domain ? "Unresolved ownership" : service.name;
    if (!groups[organization]) groups[organization] = [];
    groups[organization].push(service);
  }
  return Object.entries(groups).slice(0, 6).map(([name, services]) => `
    <button class="finding-row" data-organization="${escapeHtml(name)}" style="width:100%;border-left:0;border-right:0;border-top:0;color:inherit;background:transparent;text-align:left;cursor:pointer">
      <span class="status-dot ${name === "Unresolved ownership" ? "warn" : ""}"></span>
      <span><h4>${escapeHtml(name)}</h4><p>${services.map((item) => escapeHtml(item.category)).join(" · ")}</p></span>
      <span class="badge">${services.reduce((sum, item) => sum + item.requests, 0)} req</span>
    </button>`).join("") || `<p class="quiet-note">No outside organizations were observed.</p>`;
}

function remediationRows(report) {
  const actions = [];
  if (report.services.some((item) => item.confidence === "unknown")) actions.push(["Classify unknown domains", "Trace the loading script and document the service owner.", "medium"]);
  if (report.cookies.some((item) => !item.secure)) actions.push(["Review cookie flags", "Confirm whether each cookie can use Secure and SameSite.", "high"]);
  if (!report.security_headers?.["content-security-policy"]) actions.push(["Review CSP", "Test a restrictive Content-Security-Policy in report-only mode.", "medium"]);
  if (!actions.length) actions.push(["Preserve the baseline", "Use this snapshot as a reference for the next release.", "low"]);
  return actions.map(([title, text, severity]) => `<div class="finding-row"><span class="status-dot ${severity === "high" ? "fail" : severity === "medium" ? "warn" : ""}"></span><span><h4>${title}</h4><p>${text}</p></span><span class="badge ${severity === "high" ? "fail" : "warn"}">${severity}</span></div>`).join("");
}

function digitalTwinView(report) {
  return `
    <div class="repo-panel">
      <div class="panel-head">
        <div><h3>Website Digital Twin</h3><p>${report.graph.nodes.length} nodes · ${report.graph.edges.length} relationships · select a node to inspect</p></div>
        <div class="legend"><span><i style="background:var(--text)"></i>Website</span><span><i style="background:var(--plum)"></i>First party</span><span><i style="background:var(--amber)"></i>Analytics</span><span><i style="background:var(--coral)"></i>Advertising</span><span><i style="background:var(--copper)"></i>Organization</span></div>
      </div>
      <div class="graph-stage">
        <div class="graph-toolbar"><button id="graph-fit">Fit</button><button id="graph-labels">Simple labels</button><button id="graph-export">Export PNG</button></div>
        <div id="network-graph" aria-label="Interactive website dependency graph"></div>
      </div>
      <details class="panel-body"><summary>Read the graph as text</summary><ul>${report.services.map((service) => `<li>${escapeHtml(report.target_domain)} contacted ${escapeHtml(service.name)} (${escapeHtml(service.category)}) ${service.requests} times.</li>`).join("") || "<li>No third-party services were observed.</li>"}</ul></details>
    </div>
    <div class="workspace-grid equal">
      <section class="repo-panel"><div class="panel-head"><h3>Dependency risk</h3></div><div class="panel-body">${dependencyRisk(report)}</div></section>
      <section class="repo-panel"><div class="panel-head"><h3>What-if blocking simulator</h3></div><div class="panel-body"><label class="quiet-note">Choose a captured service</label><select class="field" id="blocking-service" style="width:100%;margin:8px 0 12px"><option value="">Select service</option>${report.services.map((item) => `<option value="${escapeHtml(item.domain)}">${escapeHtml(item.name)}</option>`).join("")}</select><div id="blocking-result" class="quiet-note">The simulation uses captured dependency relationships and never changes the live website.</div></div></section>
    </div>`;
}

function dependencyRisk(report) {
  const sorted = [...report.services].sort((left, right) => right.requests - left.requests);
  const total = Math.max(1, report.summary.requests);
  return sorted.slice(0, 5).map((service) => `<div class="inspector-row"><span>${escapeHtml(service.name)}</span><strong>${Math.round(service.requests / total * 100)}% request share</strong></div>`).join("") || `<p class="quiet-note">No outside dependencies were observed.</p>`;
}

function replayView(report) {
  const events = report.events || [];
  return `
    <div class="workspace-grid">
      <section class="repo-panel">
        <div class="panel-head"><div><h3>Data Flow Replay</h3><p>Reconstructing the captured activation sequence</p></div><span class="badge">${events.length} events</span></div>
        <div class="graph-stage" style="height:430px"><div id="replay-stage" style="position:absolute;inset:0;display:grid;place-items:center"><div class="preview-node root" style="position:relative;left:auto;top:auto">${escapeHtml(report.target_domain)}</div></div></div>
        <div class="replay-controls"><button class="button secondary" id="replay-toggle">Play</button><select class="field" id="replay-speed"><option value="900">1×</option><option value="450">2×</option><option value="1800">0.5×</option></select><input class="range" id="replay-range" type="range" min="0" max="${Math.max(0, events.length - 1)}" value="0"><span class="mono" id="replay-position">0/${events.length}</span></div>
      </section>
      <section class="repo-panel">
        <div class="panel-head"><div><h3>Event stream</h3><p>Click an event to inspect evidence</p></div></div>
        <div id="replay-events" style="max-height:510px;overflow:auto">${eventRows(events)}</div>
      </section>
    </div>`;
}

function eventRows(events) {
  return events.map((event, index) => `
    <button class="history-row" data-replay-index="${index}" style="width:100%;color:inherit;background:transparent;border-left:0;border-right:0;border-top:0;text-align:left;cursor:pointer">
      <span class="status-dot ${event.type === "cookie" ? "warn" : ""}"></span>
      <span><h4>${escapeHtml(event.type)} → ${escapeHtml(event.destination)}</h4><p>${escapeHtml(event.category)} · +${safeNumber(event.offset_ms)}ms</p></span>
      <span class="mono quiet-note">${String(event.sequence).padStart(3, "0")}</span>
    </button>`).join("") || `<div class="empty-state"><div><span>▷</span><h3>No replay events</h3><p>This older scan does not contain normalized event evidence.</p></div></div>`;
}

function consentView(report) {
  const consent = report.consent || { status: "not_tested", pre_consent_requests: 0, note: "Consent was not tested." };
  return `
    <div class="workspace-grid equal">
      <section class="repo-panel">
        <div class="panel-head"><div><h3>Initial page state</h3><p>Before any GlassNet consent action</p></div><span class="badge ${consent.status === "passive_observation" ? "warn" : ""}">${escapeHtml(consent.status)}</span></div>
        <div class="metric-strip" style="grid-template-columns:repeat(3,1fr)">
          ${metricCell("Requests", report.summary.requests, "observed")}
          ${metricCell("Cookies", report.summary.cookies, "attributes only")}
          ${metricCell("Third parties", report.summary.third_parties, "outside domains")}
        </div>
        <div class="panel-body"><p class="quiet-note" style="line-height:1.7">${escapeHtml(consent.note)}</p></div>
      </section>
      <section class="repo-panel">
        <div class="panel-head"><div><h3>Reject / Accept comparison</h3><p>Only shown after reliable consent actions</p></div><span class="badge">NOT AVAILABLE</span></div>
        <div class="empty-state"><div><span>◐</span><h3>Controlled comparison not captured</h3><p>GlassNet does not pretend a consent button was found. A future reviewed ruleset can add reject and accept states safely.</p></div></div>
      </section>
    </div>
    <section class="repo-panel" style="margin-top:12px">
      <div class="panel-head"><h3>Pre-consent activity</h3><span class="badge warn">${safeNumber(consent.pre_consent_requests)} requests</span></div>
      <div>${report.services.slice(0, 8).map((service) => findingRow(service.essential === false ? "warn" : "pass", service.name, `${service.requests} requests · ${service.category}`, service.confidence)).join("") || `<p class="panel-body quiet-note">No third-party activity was captured.</p>`}</div>
    </section>`;
}

function caseJourneysView(report) {
  return `
    <div class="case-tools" role="tablist" aria-label="Investigative tools">
      <button class="button primary" data-case-tool="attribution">Feature attribution</button>
      <button class="button ghost" data-case-tool="journey">Journey mapper</button>
      <button class="button ghost" data-case-tool="scenarios">Exposure scenarios</button>
      <button class="button ghost" data-case-tool="chain">Evidence chain</button>
      <button class="button ghost" data-case-tool="incident">Incident reconstruction</button>
    </div>
    <div id="case-tool-content" style="margin-top:12px">
      <div class="repo-panel"><div class="panel-body"><p class="quiet-note">Preparing feature attribution…</p></div></div>
    </div>`;
}

function caseActionsView(report) {
  return `
    <div class="case-tools" role="tablist" aria-label="Improvement tools">
      <button class="button primary" data-action-tool="necessity">Necessity analyzer</button>
      <button class="button ghost" data-action-tool="blueprint">Architecture blueprint</button>
      <button class="button ghost" data-action-tool="substitution">Substitution explorer</button>
      <button class="button ghost" data-action-tool="debt">Debt ledger</button>
      <button class="button ghost" data-action-tool="maturity">Maturity model</button>
    </div>
    <div id="action-tool-content" style="margin-top:12px">
      <div class="repo-panel"><div class="panel-body"><p class="quiet-note">Preparing dependency necessity analysis…</p></div></div>
    </div>`;
}

async function setupCaseJourneys(report) {
  const buttons = document.querySelectorAll("[data-case-tool]");
  const choose = async (name) => {
    buttons.forEach((button) => {
      button.classList.toggle("primary", button.dataset.caseTool === name);
      button.classList.toggle("ghost", button.dataset.caseTool !== name);
    });
    const target = document.querySelector("#case-tool-content");
    target.innerHTML = `<div class="repo-panel"><div class="panel-body"><p class="quiet-note">Loading structured case evidence…</p></div></div>`;
    if (!report.id) {
      if (name === "attribution") return target.innerHTML = attributionSurface(report.services.map((service) => ({ feature: service.category, initiating_script: report.scripts.find((script) => script.includes(service.domain)) || "Initiator not captured", service: service.name, domain: service.domain, requests: service.requests, storage: report.cookies.filter((cookie) => cookie.domain === service.domain).length, purpose: service.category, confidence: service.confidence === "verified" ? "confirmed classification" : "inferred from captured category" })));
      if (name === "scenarios") return target.innerHTML = scenarioSurface(Object.entries(report.categories).map(([category, count]) => ({ name: `${category} exposure scenario`, services: report.services.filter((service) => service.category === category).map((service) => service.name), observed_identifiers: `${report.cookies.filter((cookie) => !cookie.session).length} persistent cookie attribute records`, persistence: "Technically possible based on observed signals", evidence: `${count} classified service(s)`, assumptions: "Category indicates a possible purpose.", uncertainty: "No request bodies or personal data were inspected." })));
      if (name === "chain") return target.innerHTML = chainSurface(report.services.map((service) => ({ finding: `${service.name} observed`, confidence: service.confidence, rule_version: report.scanner_version, steps: [{ label: "Observed", detail: `${service.requests} requests to ${service.domain}`, timestamp: 0 }, { label: "Classified", detail: service.category, timestamp: 0 }, { label: "Inferred", detail: service.explanation, timestamp: 0 }] })));
      if (name === "incident") return target.innerHTML = incidentSurface({ target: report.target_domain, services: report.services.map((service) => ({ service: service.name, domain: service.domain, first_seen_scan: "sample", first_seen_at: "sample fixture", initiating_script: report.scripts.find((script) => script.includes(service.domain)) || "Not captured", consent_state: report.consent.status, persistence: 1, evidence_events: report.events.filter((event) => event.destination === service.domain).length })), versions: [] });
    }
    if (name === "journey") return renderJourneyBuilder(target);
    try {
      if (name === "attribution") target.innerHTML = attributionSurface(await api(`/api/analysis/attribution/${report.id}`));
      if (name === "scenarios") target.innerHTML = scenarioSurface(await api(`/api/analysis/scenarios/${report.id}`));
      if (name === "chain") target.innerHTML = chainSurface(await api(`/api/analysis/evidence-chain/${report.id}`));
      if (name === "incident") target.innerHTML = incidentSurface(await api(`/api/analysis/incident/${report.id}`));
    } catch (error) {
      target.innerHTML = `<div class="error-state"><h3>Case tool unavailable</h3><p>${escapeHtml(error.message)}</p></div>`;
    }
  };
  buttons.forEach((button) => button.addEventListener("click", () => choose(button.dataset.caseTool)));
  await choose("attribution");
}

function attributionSurface(items) {
  return `
    <section class="repo-panel">
      <div class="panel-head"><div><h3>Feature-to-Tracker Attribution</h3><p>Visible-purpose hypotheses connected to captured technical dependencies</p></div><span class="badge ai">INFERENCE LABELED</span></div>
      <div>${items.map((item) => `
        <div class="feature-chain panel-body" style="border-bottom:1px solid var(--line)">
          <div class="chain-step"><span class="evidence-label inferred">Inferred feature</span><strong>${escapeHtml(item.feature)}</strong></div>
          <div class="chain-step"><span class="evidence-label observed">Initiator</span><strong class="mono">${escapeHtml(item.initiating_script)}</strong></div>
          <div class="chain-step"><span class="evidence-label classified">Service</span><strong>${escapeHtml(item.service)}</strong></div>
          <div class="chain-step"><span class="evidence-label observed">Footprint</span><strong>${safeNumber(item.requests)} requests · ${safeNumber(item.storage)} storage signals</strong></div>
          <div class="chain-step"><span class="evidence-label inferred">Confidence</span><strong>${escapeHtml(item.confidence)}</strong></div>
        </div>`).join("") || `<div class="empty-state"><div><span>⌁</span><h3>No feature attribution available</h3><p>No third-party services were captured in this case.</p></div></div>`}</div>
    </section>`;
}

function scenarioSurface(items) {
  return `<div class="archive-grid">${items.map((item) => `
    <article class="evidence-sheet">
      <span class="evidence-label inferred">Scenario</span>
      <h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml(item.persistence)}</p>
      <div class="inspector-row"><span>Services</span><strong>${escapeHtml((item.services || []).join(", ") || "None")}</strong></div>
      <div class="inspector-row"><span>Identifiers</span><strong>${escapeHtml(item.observed_identifiers)}</strong></div>
      <p class="quiet-note"><strong>Evidence:</strong> ${escapeHtml(item.evidence)}</p>
      <p class="quiet-note"><strong>Assumption:</strong> ${escapeHtml(item.assumptions)}</p>
      <p class="quiet-note"><strong>Uncertainty:</strong> ${escapeHtml(item.uncertainty)}</p>
    </article>`).join("") || `<div class="empty-state"><div><h3>No scenarios generated</h3><p>The case did not contain enough category evidence.</p></div></div>`}</div>`;
}

function chainSurface(chains) {
  return `<div class="stack">${chains.map((chain) => `
    <section class="repo-panel">
      <div class="panel-head"><div><h3>${escapeHtml(chain.finding)}</h3><p>Rule ${escapeHtml(chain.rule_version)} · confidence ${escapeHtml(chain.confidence)}</p></div></div>
      <div class="panel-body feature-chain">${chain.steps.slice(0, 5).map((step) => `<div class="chain-step"><span class="evidence-label ${step.label.toLowerCase()}">${escapeHtml(step.label)}</span><strong>${escapeHtml(step.detail)}</strong><small class="mono quiet-note">+${safeNumber(step.timestamp)}ms</small></div>`).join("")}</div>
    </section>`).join("") || `<div class="empty-state"><div><h3>No evidence chain</h3><p>No connected observations were captured.</p></div></div>`}</div>`;
}

function incidentSurface(incident) {
  return `
    <section class="repo-panel">
      <div class="panel-head"><div><h3>Incident Reconstruction</h3><p>${escapeHtml(incident.target)} · evidence timeline</p></div><button class="button ghost" id="export-incident">Export evidence</button></div>
      <div>${incident.services.map((item) => `<div class="history-row"><span class="status-symbol attention">!</span><span><h4>${escapeHtml(item.service)}</h4><p>First seen case ${escapeHtml(item.first_seen_scan)} · ${escapeHtml(formatDate(item.first_seen_at))} · persisted across ${safeNumber(item.persistence)} version(s)</p><p class="mono">${escapeHtml(item.initiating_script)}</p></span><span class="badge">${safeNumber(item.evidence_events)} events</span></div>`).join("") || `<div class="empty-state"><div><h3>No incident candidates</h3><p>No third-party appearance could be reconstructed.</p></div></div>`}</div>
    </section>`;
}

async function renderJourneyBuilder(target) {
  const journeys = await api("/api/journeys").catch(() => []);
  target.innerHTML = `
    <div class="workspace-grid equal">
      <section class="repo-panel">
        <div class="panel-head"><div><h3>User Journey Mapper</h3><p>Define safe, public, non-submitting navigation only</p></div></div>
        <form id="journey-form" class="panel-body archive-form">
          <label>Name<input class="field" name="name" required placeholder="Landing to pricing"></label>
          <label>Start URL<input class="field" name="start_url" required placeholder="https://example.com"></label>
          <label class="wide">Navigation steps<textarea class="field" name="steps" required placeholder="Open pricing link&#10;Open cookie preferences"></textarea></label>
          <button class="button primary" type="submit">Save safe journey</button>
        </form>
      </section>
      <section class="repo-panel">
        <div class="panel-head"><div><h3>Defined journeys</h3><p>Definitions are not executed automatically</p></div></div>
        <div>${journeys.map((journey) => `<div class="history-row"><span class="status-symbol unknown">○</span><span><h4>${escapeHtml(journey.name)}</h4><p>${escapeHtml(journey.start_url)} · ${journey.steps.length} safe step(s)</p></span><span class="badge">${escapeHtml(journey.status)}</span></div>`).join("") || `<div class="empty-state"><div><h3>No journeys</h3><p>Define a public route sequence without submitting forms or signing in.</p></div></div>`}</div>
      </section>
    </div>`;
  document.querySelector("#journey-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await api("/api/journeys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: values.get("name"), start_url: values.get("start_url"), steps: String(values.get("steps")).split("\n").map((step) => step.trim()).filter(Boolean) }) });
    showToast("Safe journey definition archived");
    renderJourneyBuilder(target);
  });
}

async function setupCaseActions(report) {
  const buttons = document.querySelectorAll("[data-action-tool]");
  const choose = async (name) => {
    buttons.forEach((button) => {
      button.classList.toggle("primary", button.dataset.actionTool === name);
      button.classList.toggle("ghost", button.dataset.actionTool !== name);
    });
    const target = document.querySelector("#action-tool-content");
    target.innerHTML = `<div class="repo-panel"><div class="panel-body"><p class="quiet-note">Loading improvement evidence…</p></div></div>`;
    if (name === "debt") return renderDebtLedger(target, report);
    if (!report.id) {
      const necessity = report.services.map((service) => ({ domain: service.domain, service: service.name, purpose: service.category, verdict: service.essential === true ? "Essential" : service.confidence === "unknown" ? "Unknown" : service.category === "Advertising" ? "Likely unnecessary" : "Optional", triggered_by: service.types.includes("script") ? "page script" : service.types[0], activates_before_interaction: true, feature_dependency: service.category, removal_risk: service.essential === true ? "High" : "Unknown until tested", first_party_alternative: "Architectural review possible", confidence: service.confidence, evidence: `${service.requests} requests` }));
      if (name === "necessity") return target.innerHTML = necessitySurface(necessity);
      if (name === "substitution") return target.innerHTML = substitutionSurface(necessity);
      if (name === "blueprint") return target.innerHTML = blueprintSurface({ current: { first_party_domains: report.first_party.map((item) => item.domain), third_party_services: necessity, consent_boundary: report.consent.status, storage_keys: report.summary.storage_keys }, proposed: { preserve: necessity.filter((item) => item.verdict === "Essential").map((item) => item.service), delay_until_choice_or_interaction: necessity.filter((item) => item.verdict === "Optional").map((item) => item.service), consolidate: [], first_party_opportunities: [], storage_actions: ["Review storage boundaries"], implementation_order: ["Confirm ownership", "Validate necessity", "Test delayed loading", "Verify with a new case"], verification: "Compare a new case against this archived version." }, limitations: "Guidance only." });
      if (name === "maturity") return target.innerHTML = maturitySurface({ dimensions: [{ name: "Service inventory", level: 2, label: "Documented", evidence: "Sample inventory", next_action: "Add owners" }, { name: "Ownership", level: 1, label: "Unmanaged", evidence: "No owners in sample", next_action: "Assign owners" }], disclaimer: "Maturity is not legal compliance." });
    }
    try {
      if (name === "necessity") target.innerHTML = necessitySurface(await api(`/api/analysis/necessity/${report.id}`));
      if (name === "blueprint") target.innerHTML = blueprintSurface(await api(`/api/analysis/blueprint/${report.id}`));
      if (name === "substitution") target.innerHTML = substitutionSurface(await api(`/api/analysis/necessity/${report.id}`));
      if (name === "maturity") target.innerHTML = maturitySurface(await api(`/api/analysis/maturity/${report.id}`));
    } catch (error) {
      target.innerHTML = `<div class="error-state"><h3>Improvement tool unavailable</h3><p>${escapeHtml(error.message)}</p></div>`;
    }
  };
  buttons.forEach((button) => button.addEventListener("click", () => choose(button.dataset.actionTool)));
  await choose("necessity");
}

function necessitySurface(items) {
  return `
    <section class="repo-panel">
      <div class="panel-head"><div><h3>Third-Party Necessity Analyzer</h3><p>Necessity considers purpose and breakage risk—not “third party” alone</p></div></div>
      <div class="data-table-wrap" style="border:0"><table class="data-table"><thead><tr><th>Service</th><th>Purpose</th><th>Verdict</th><th>Trigger</th><th>Removal risk</th><th>Evidence</th></tr></thead><tbody>${items.map((item) => `<tr><td><strong>${escapeHtml(item.service)}</strong><br><span class="domain">${escapeHtml(item.domain)}</span></td><td>${escapeHtml(item.purpose)}</td><td><span class="badge ${item.verdict === "Essential" ? "pass" : item.verdict === "Likely unnecessary" ? "fail" : "warn"}">${escapeHtml(item.verdict)}</span></td><td>${escapeHtml(item.triggered_by)}</td><td>${escapeHtml(item.removal_risk)}</td><td class="mono">${escapeHtml(item.evidence)}</td></tr>`).join("")}</tbody></table></div>
    </section>`;
}

function blueprintSurface(data) {
  return `
    <div class="workspace-grid equal">
      <section class="repo-panel"><div class="panel-head"><h3>Current architecture</h3><span class="evidence-label observed">Observed</span></div><div class="panel-body"><div class="inspector-row"><span>First-party domains</span><strong>${escapeHtml((data.current.first_party_domains || []).join(", ") || "None captured")}</strong></div><div class="inspector-row"><span>Third-party services</span><strong>${data.current.third_party_services.length}</strong></div><div class="inspector-row"><span>Consent boundary</span><strong>${escapeHtml(data.current.consent_boundary)}</strong></div><div class="inspector-row"><span>Storage keys</span><strong>${safeNumber(data.current.storage_keys)}</strong></div></div></section>
      <section class="evidence-sheet"><span class="evidence-label recommended">Proposed</span><h3>Privacy architecture blueprint</h3><div class="inspector-row"><span>Preserve</span><strong>${escapeHtml(data.proposed.preserve.join(", ") || "Confirm core services")}</strong></div><div class="inspector-row"><span>Delay</span><strong>${escapeHtml(data.proposed.delay_until_choice_or_interaction.join(", ") || "None identified")}</strong></div><div class="inspector-row"><span>Consolidate</span><strong>${escapeHtml(data.proposed.consolidate.join(", ") || "No duplicate category observed")}</strong></div><ol>${data.proposed.implementation_order.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol><p class="quiet-note">${escapeHtml(data.limitations)}</p></section>
    </div>`;
}

function substitutionSurface(items) {
  const alternatives = [
    ["First-party implementation", "Lower external exposure", "High", "Higher maintenance", "Verify with a new case"],
    ["Delayed optional loading", "Reduces pre-interaction activity", "Medium", "Feature loads later", "Compare initial event sequence"],
    ["Consent-gated loading", "Aligns optional service activation", "Medium", "Depends on reliable consent state", "Run consent evidence case"],
    ["Feature removal", "Removes associated dependency", "Low–Medium", "Visible feature unavailable", "Confirm graph node disappears"],
  ];
  return `<div class="archive-grid">${items.map((item) => `<article class="repo-panel"><div class="panel-head"><div><h3>${escapeHtml(item.service)}</h3><p>${escapeHtml(item.verdict)} · ${escapeHtml(item.purpose)}</p></div></div><div class="panel-body">${alternatives.map((option) => `<div class="inspector-row"><span>${option[0]}</span><strong>${option[1]} · ${option[2]}</strong></div>`).join("")}<p class="quiet-note">Architectural categories only; GlassNet does not recommend an unverified commercial vendor.</p></div></article>`).join("")}</div>`;
}

function maturitySurface(data) {
  return `
    <section class="repo-panel"><div class="panel-head"><div><h3>Website Privacy Maturity Model</h3><p>Observable process evidence, not legal compliance</p></div></div><div>${data.dimensions.map((item) => `<div class="finding-row"><span class="status-symbol ${item.level >= 3 ? "verified" : item.level === 2 ? "attention" : "unknown"}"><span>${item.level >= 3 ? "✓" : item.level}</span></span><span><h4>${escapeHtml(item.name)} · ${escapeHtml(item.label)}</h4><p>${escapeHtml(item.evidence)} · Next: ${escapeHtml(item.next_action)}</p><div class="maturity-levels">${[1,2,3,4,5].map((level) => `<i class="maturity-level ${level <= item.level ? "active" : ""}"></i>`).join("")}</div></span><span class="badge">${item.level}/5</span></div>`).join("")}</div><div class="panel-body quiet-note">${escapeHtml(data.disclaimer)}</div></section>`;
}

async function renderDebtLedger(target, report) {
  const items = await api("/api/improvement/debt").catch(() => []);
  target.innerHTML = `
    <div class="workspace-grid equal">
      <section class="repo-panel"><div class="panel-head"><div><h3>Privacy Debt Ledger</h3><p>Age, impact, effort, and ownership stay visible</p></div></div><div>${items.map((item) => `<div class="issue-row"><span class="status-symbol ${item.impact === "serious" || item.impact === "high" ? "serious" : "attention"}">!</span><span><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.domain || "case-wide")} · ${escapeHtml(item.impact)} impact · ${safeNumber(item.effort_hours)}h · owner ${escapeHtml(item.owner || "unassigned")}</p></span><button class="button ghost" data-debt-resolve="${item.id}">${item.status === "resolved" ? "Resolved" : "Resolve"}</button></div>`).join("") || `<div class="empty-state"><div><h3>No debt items</h3><p>Archive a recurring or aging privacy problem here.</p></div></div>`}</div></section>
      <section class="repo-panel"><div class="panel-head"><h3>Record debt</h3></div><form id="debt-form" class="panel-body archive-form"><input type="hidden" name="scan_id" value="${report.id || ""}"><label>Title<input class="field" name="title" required></label><label>Domain<input class="field" name="domain"></label><label>Impact<select class="field" name="impact"><option>moderate</option><option>high</option><option>serious</option><option>low</option></select></label><label>Complexity<select class="field" name="complexity"><option>medium</option><option>low</option><option>high</option></select></label><label>Effort hours<input class="field" name="effort_hours" type="number" min="1" value="4"></label><label>Owner<input class="field" name="owner"></label><label class="wide">Evidence<textarea class="field" name="evidence" required></textarea></label><button class="button primary" type="submit">Archive debt item</button></form></section>
    </div>`;
  document.querySelector("#debt-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await api("/api/improvement/debt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, category: "case evidence", effort_hours: Number(values.effort_hours), scan_id: Number(values.scan_id) || undefined }) });
    showToast("Debt item archived");
    renderDebtLedger(target, report);
  });
  document.querySelectorAll("[data-debt-resolve]").forEach((button) => button.addEventListener("click", async () => {
    await api(`/api/improvement/debt/${button.dataset.debtResolve}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "resolved" }) });
    renderDebtLedger(target, report);
  }));
}

function evidenceView(report) {
  const evidenceRows = [
    ...Object.entries(report.security_headers || {}).map(([name, value]) => ({ type: "header", source: report.target_domain, detail: `${name}: ${value}` })),
    ...report.cookies.map((cookie) => ({ type: "cookie", source: cookie.domain, detail: `Secure=${cookie.secure} HttpOnly=${cookie.httpOnly} SameSite=${cookie.sameSite}` })),
    ...report.storage.map((item) => ({ type: item.type, source: item.origin, detail: `key: ${item.key}` })),
    ...report.scripts.map((script) => ({ type: "script", source: new URL(script).hostname, detail: script })),
  ];
  return `
    <div class="evidence-sheet" style="margin-bottom:12px"><span class="evidence-label observed">Observed</span> <span class="evidence-label classified">Classified</span> <span class="evidence-label inferred">Inferred</span> <span class="evidence-label recommended">Recommended</span> <span class="evidence-label confirmed">Confirmed by reviewer</span><p class="quiet-note">This surface separates captured technical facts from classification, interpretation, recommendations, and human confirmation.</p></div>
    <div class="table-tools"><input class="field" id="evidence-search" placeholder="Search evidence" style="flex:1"><select class="field" id="evidence-filter"><option value="">All evidence</option><option value="header">Headers</option><option value="cookie">Cookies</option><option value="script">Scripts</option><option value="localStorage">Local storage</option></select><button class="button ghost" id="export-evidence">Export</button></div>
    <div class="data-table-wrap"><table class="data-table"><thead><tr><th>Type</th><th>Source</th><th>Observed metadata</th></tr></thead><tbody id="evidence-body">${evidenceTableRows(evidenceRows.slice(0, 50))}</tbody></table></div>
    <div class="panel-body spread"><span id="evidence-count" class="quiet-note">Showing ${Math.min(50, evidenceRows.length)} of ${evidenceRows.length}</span><button class="button ghost" id="evidence-more" ${evidenceRows.length > 50 ? "" : "hidden"}>Load 50 more</button></div>
    <div class="evidence-sheet" style="margin-top:12px"><span class="evidence-label observed">Methodology</span><h3>Limitations and reproducibility</h3><ul class="quiet-note" style="line-height:1.8">${report.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><div class="inspector-row"><span>Scanner version</span><strong class="mono">${escapeHtml(report.scanner_version)}</strong></div><div class="inspector-row"><span>Mode</span><strong>${escapeHtml(report.mode || "full")}</strong></div></div>`;
}

function evidenceTableRows(rows) {
  return rows.map((row) => `<tr data-evidence-type="${escapeHtml(row.type)}"><td><span class="badge">${escapeHtml(row.type)}</span></td><td class="domain">${escapeHtml(row.source)}</td><td class="mono" style="word-break:break-all">${escapeHtml(row.detail)}</td></tr>`).join("") || `<tr><td colspan="3">No evidence of this type was captured.</td></tr>`;
}

function attachInvestigationActions(report, tab) {
  document.querySelectorAll("[data-finding-title]").forEach((button) => button.addEventListener("click", () => showInspector(button.dataset.findingTitle, report.target_domain, [["Scan", String(report.id || "sample")], ["Status", button.querySelector(".badge")?.textContent || "Observed"], ["Evidence", "Captured metadata"]], button.dataset.findingDescription)));
  document.querySelectorAll("[data-organization]").forEach((button) => button.addEventListener("click", () => showInspector(button.dataset.organization, "organization group", [["Requests", button.querySelector(".badge").textContent], ["Confidence", button.dataset.organization === "Unresolved ownership" ? "unknown" : "likely"]], "Organization grouping is based on the local service classification catalog.")));
  document.querySelector("[data-open-twin]")?.addEventListener("click", () => navigate(`/cases/${report.id || "sample"}/map`));
  if (tab === "map") setupDigitalTwin(report);
  if (tab === "journeys") setupCaseJourneys(report);
  if (tab === "evidence") setupEvidence(report);
  if (tab === "actions") setupCaseActions(report);
}

async function setupDigitalTwin(report, forceGraph = false) {
  const graphContainer = document.querySelector("#network-graph");
  const graphToolbar = document.querySelector(".graph-toolbar");
  const deferGraph = !forceGraph && (matchMedia("(max-width: 680px)").matches || state.dataMode === "reduced");
  if (deferGraph) {
    graphToolbar.hidden = true;
    graphContainer.innerHTML = `<div class="empty-state"><div><span>⌁</span><h3>Simplified map mode</h3><p>The accessible dependency list is ready. Load the interactive graph only when you need it.</p><button class="button primary" id="load-interactive-graph">Load interactive graph</button></div></div>`;
    document.querySelector("#load-interactive-graph").addEventListener("click", () => setupDigitalTwin(report, true), { once: true });
  } else try {
    graphToolbar.hidden = false;
    const { createCaseGraph } = await import("/js/graph.js?v=1");
    state.network = await createCaseGraph({
      report,
      container: graphContainer,
      onSelect: (data) => {
        const service = data.details;
        showInspector(data.label, data.id, [
          ["Category", service?.category || "Website"],
          ["Requests", String(service?.requests || report.summary.requests)],
          ["Confidence", service?.confidence || "captured"],
          ["Resource types", service?.types?.join(", ") || "document"],
        ], service?.explanation || "The central website node.");
      },
    });
    document.querySelector("#graph-fit").addEventListener("click", () => state.network.fit(undefined, 55));
    document.querySelector("#graph-labels").addEventListener("click", (event) => {
      const simple = event.currentTarget.textContent.includes("Simple");
      state.network.style().selector("node").style("label", simple ? "data(kind)" : "data(label)").update();
      event.currentTarget.textContent = simple ? "Technical labels" : "Simple labels";
    });
    document.querySelector("#graph-export").addEventListener("click", () => {
      const link = document.createElement("a");
      link.href = state.network.png({ full: true, scale: 2, bg: "#211a20" });
      link.download = `glassnet-twin-${report.target_domain}.png`;
      link.click();
    });
  } catch (error) {
    document.querySelector("#network-graph").innerHTML = `<div class="empty-state"><div><span>⌁</span><h3>Graph unavailable</h3><p>${escapeHtml(error.message)}</p></div></div>`;
  }

  if (!forceGraph) document.querySelector("#blocking-service").addEventListener("change", (event) => {
    const service = report.services.find((item) => item.domain === event.target.value);
    const output = document.querySelector("#blocking-result");
    if (!service) {
      output.textContent = "The simulation uses captured dependency relationships and never changes the live website.";
      return;
    }
    const privacyGain = Math.min(20, service.weight + Math.round(service.requests / 3));
    output.innerHTML = `<div class="inspector-row"><span>Requests removed</span><strong>${service.requests}</strong></div><div class="inspector-row"><span>Graph reduction</span><strong>1 node</strong></div><div class="inspector-row"><span>Estimated score change</span><strong>+${privacyGain}</strong></div><div class="inspector-row"><span>Possible impact</span><strong>${service.essential === true ? "Feature risk" : service.essential === false ? "Likely optional" : "Uncertain"}</strong></div>`;
  });
}

function setupReplay(report) {
  const events = report.events || [];
  const range = document.querySelector("#replay-range");
  const toggle = document.querySelector("#replay-toggle");
  const speed = document.querySelector("#replay-speed");
  document.querySelectorAll("[data-replay-index]").forEach((button) => button.addEventListener("click", () => {
    range.value = button.dataset.replayIndex;
    renderReplayEvent(report, Number(range.value));
  }));
  range.addEventListener("input", () => renderReplayEvent(report, Number(range.value)));
  toggle.addEventListener("click", () => {
    if (state.replayTimer) {
      clearInterval(state.replayTimer);
      state.replayTimer = null;
      toggle.textContent = "Play";
      return;
    }
    toggle.textContent = "Pause";
    state.replayTimer = setInterval(() => {
      const next = Number(range.value) + 1;
      if (next >= events.length) {
        clearInterval(state.replayTimer);
        state.replayTimer = null;
        toggle.textContent = "Play";
        return;
      }
      range.value = next;
      renderReplayEvent(report, next);
    }, Number(speed.value));
  });
  renderReplayEvent(report, 0);
}

function renderReplayEvent(report, index) {
  const events = report.events || [];
  const event = events[index];
  document.querySelector("#replay-position").textContent = `${events.length ? index + 1 : 0}/${events.length}`;
  if (!event) return;
  document.querySelector("#replay-stage").innerHTML = `
    <div style="position:absolute;left:18%;top:42%" class="preview-node root">${escapeHtml(report.target_domain)}</div>
    <div style="position:absolute;right:18%;top:42%;border-color:${event.type === "cookie" ? "var(--amber)" : "var(--plum)"}" class="preview-node">${escapeHtml(event.destination)}</div>
    <div style="position:absolute;left:42%;top:49%;width:18%;height:1px;background:var(--plum)"><span class="pulse-dot" style="animation-duration:.8s"></span></div>`;
  showInspector(titleCase(event.type), event.destination, [["Sequence", String(event.sequence)], ["Offset", `+${event.offset_ms}ms`], ["Category", event.category], ["Consent state", event.consent_state]], `${event.source} activated ${event.destination}.`);
}

function setupEvidence(report) {
  const allRows = [
    ...Object.entries(report.security_headers || {}).map(([name, value]) => ({ type: "header", source: report.target_domain, detail: `${name}: ${value}` })),
    ...report.cookies.map((cookie) => ({ type: "cookie", source: cookie.domain, detail: `Secure=${cookie.secure} HttpOnly=${cookie.httpOnly} SameSite=${cookie.sameSite}` })),
    ...report.storage.map((item) => ({ type: item.type, source: item.origin, detail: `key: ${item.key}` })),
    ...report.scripts.map((script) => ({ type: "script", source: script, detail: script })),
  ];
  let visibleRows = 50;
  let filterTimer;
  const applyFilters = () => {
    const query = document.querySelector("#evidence-search").value.toLowerCase();
    const type = document.querySelector("#evidence-filter").value;
    const filtered = allRows.filter((row) => (!type || row.type === type) && `${row.source} ${row.detail}`.toLowerCase().includes(query));
    const shown = filtered.slice(0, visibleRows);
    document.querySelector("#evidence-body").innerHTML = evidenceTableRows(shown);
    document.querySelector("#evidence-count").textContent = `Showing ${shown.length} of ${filtered.length}`;
    document.querySelector("#evidence-more").hidden = shown.length >= filtered.length;
  };
  document.querySelector("#evidence-search").addEventListener("input", () => {
    clearTimeout(filterTimer);
    visibleRows = 50;
    filterTimer = setTimeout(applyFilters, 180);
  });
  document.querySelector("#evidence-filter").addEventListener("change", applyFilters);
  document.querySelector("#evidence-more").addEventListener("click", () => {
    visibleRows += 50;
    applyFilters();
  });
  document.querySelector("#export-evidence").addEventListener("click", () => downloadJson({ scan_id: report.id, scanner_version: report.scanner_version, limitations: report.limitations, evidence: allRows }, `glassnet-evidence-${report.target_domain}.json`));
}

async function createBaseline(scanId) {
  await api("/api/baselines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scan_id: scanId, label: "Production baseline" }) });
  showToast("Production baseline saved");
}

async function renderCompare() {
  setPage("Compare", "Compare");
  activeNavigation("compare");
  emptyInspector();
  await loadScans().catch(() => []);
  workspace.innerHTML = `
    <section class="page">
      <div class="page-heading"><p class="eyebrow">CROSS-WEBSITE INTELLIGENCE</p><h2>Compare observable behavior.</h2><p>Select two snapshots to examine differences with context. GlassNet does not rank websites as simply “best” or “worst.”</p></div>
      <div class="repo-panel">
        <div class="panel-body row" style="flex-wrap:wrap">
          <select id="compare-left" class="field" style="flex:1">${scanOptions(state.scans, 0)}</select>
          <span>⇄</span>
          <select id="compare-right" class="field" style="flex:1">${scanOptions(state.scans, 1)}</select>
          <button class="button primary" id="run-compare" ${state.scans.length < 2 ? "disabled" : ""}>Compare snapshots</button>
        </div>
      </div>
      <div id="compare-result" style="margin-top:12px">${state.scans.length < 2 ? `<div class="empty-state"><div><span>⇄</span><h3>Two scans are required</h3><p>Run another scan to begin building privacy history and comparisons.</p><button class="button primary" data-go="/scan">Start scan</button></div></div>` : ""}</div>
    </section>`;
  document.querySelector("#run-compare")?.addEventListener("click", runComparison);
}

function scanOptions(scans, selectedIndex) {
  return scans.map((scan, index) => `<option value="${scan.id}" ${index === selectedIndex ? "selected" : ""}>${escapeHtml(scan.target_domain)} · scan-${scan.id} · ${formatDate(scan.created_at)}</option>`).join("");
}

async function runComparison() {
  const leftId = document.querySelector("#compare-left").value;
  const rightId = document.querySelector("#compare-right").value;
  if (leftId === rightId) return showToast("Choose two different snapshots");
  const reports = await api(`/api/compare?id=${leftId},${rightId}`);
  const [left, right] = reports;
  const leftDomains = new Set(left.services.map((item) => item.domain));
  const rightDomains = new Set(right.services.map((item) => item.domain));
  const added = right.services.filter((item) => !leftDomains.has(item.domain));
  const removed = left.services.filter((item) => !rightDomains.has(item.domain));
  document.querySelector("#compare-result").innerHTML = `
    <div class="metric-strip">
      ${metricCell("Score change", `${right.score - left.score >= 0 ? "+" : ""}${right.score - left.score}`, `${left.score} → ${right.score}`)}
      ${metricCell("Third parties", right.summary.third_parties - left.summary.third_parties, `${left.summary.third_parties} → ${right.summary.third_parties}`)}
      ${metricCell("Cookies", right.summary.cookies - left.summary.cookies, `${left.summary.cookies} → ${right.summary.cookies}`)}
      ${metricCell("Added", added.length, "services")}
      ${metricCell("Removed", removed.length, "services")}
    </div>
    <div class="workspace-grid equal">
      <section class="repo-panel"><div class="panel-head"><h3>Privacy behavior diff</h3></div><div class="diff-block">
        ${added.map((item) => `<div class="diff-line add">+ ${escapeHtml(item.name)} <span class="quiet-note">${escapeHtml(item.category)}</span></div>`).join("")}
        ${removed.map((item) => `<div class="diff-line remove">- ${escapeHtml(item.name)} <span class="quiet-note">${escapeHtml(item.category)}</span></div>`).join("")}
        <div class="diff-line change">~ exposure score ${left.score} → ${right.score}</div>
      </div></section>
      <section class="repo-panel"><div class="panel-head"><h3>Context</h3></div><div class="panel-body"><p class="quiet-note" style="line-height:1.7">Differences can result from release changes, consent state, time, region, experimentation, or temporary service behavior. Review the underlying evidence before drawing conclusions.</p><button class="button primary" id="create-review" style="margin-top:10px">Create privacy review</button></div></section>
    </div>`;
  document.querySelector("#create-review").addEventListener("click", async () => {
    const review = await api("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base_scan_id: Number(leftId), candidate_scan_id: Number(rightId) }) });
    showToast(`Review #${review.id} created`);
    navigate("/reviews");
  });
}

async function renderHistory() {
  setPage("Privacy Git History", "Monitor / History");
  activeNavigation("monitor");
  emptyInspector();
  await loadScans().catch(() => []);
  workspace.innerHTML = `
    <section class="page">
      <div class="page-heading"><p class="eyebrow">BEHAVIOR VERSIONS</p><h2>Privacy Git History</h2><p>Every completed scan becomes a snapshot in the website's observable privacy history.</p></div>
      <section class="repo-panel">
        <div class="panel-head"><div><h3>All scan commits</h3><p>Newest snapshot first</p></div><button class="button ghost" data-go="/compare">Compare versions</button></div>
        <div class="branch-timeline">${state.scans.map((scan) => `
          <div class="commit"><span class="commit-node"></span><div><h4>${escapeHtml(scan.site_name)}</h4><p class="mono">scan-${String(scan.id).padStart(5, "0")} · ${escapeHtml(scan.target_domain)} · ${formatDate(scan.created_at)}</p></div><button class="button ghost" data-go="/investigations/${scan.id}/overview">Open</button></div>`).join("") || `<div class="empty-state"><div><span>⑂</span><h3>No history</h3><p>Run another scan to begin building this website's privacy history.</p></div></div>`}</div>
      </section>
    </section>`;
}

async function renderReviews() {
  setPage("Privacy Reviews", "Workspace / Developer / Reviews");
  activeNavigation("workspace");
  emptyInspector();
  const [reviews, scans] = await Promise.all([api("/api/reviews"), loadScans().catch(() => [])]);
  workspace.innerHTML = `
    <section class="page">
      <div class="spread page-heading" style="max-width:none"><div><p class="eyebrow">PRIVACY PULL REQUESTS</p><h2>Release reviews</h2><p>Compare a baseline with a release candidate, then approve or request changes.</p></div><button class="button primary" data-go="/compare">Create from comparison</button></div>
      ${reviews.length ? reviews.map(reviewCard).join("") : `<div class="empty-state"><div><span>⇄</span><h3>No review</h3><p>Compare a baseline with a new release to create a privacy review.</p><button class="button primary" data-go="/compare">Compare scans</button></div></div>`}
      ${scans.length ? `<p class="quiet-note" style="margin-top:12px">${scans.length} completed snapshots are available for review.</p>` : ""}
    </section>`;
  document.querySelectorAll("[data-review-action]").forEach((button) => button.addEventListener("click", async () => {
    await api(`/api/reviews/${button.dataset.reviewId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: button.dataset.reviewAction }) });
    showToast("Review status updated");
    renderReviews();
  }));
}

function reviewCard(review) {
  const summary = review.summary;
  return `
    <section class="repo-panel" style="margin-bottom:12px">
      <div class="panel-head"><div><h3>Review #${review.id}: ${escapeHtml(summary.base.site_name)} → release candidate</h3><p>${formatDate(review.created_at)} · ${summary.base.id} → ${summary.candidate.id}</p></div><span class="badge ${summary.verdict === "fail" ? "fail" : "warn"}">${escapeHtml(review.status)}</span></div>
      <div class="workspace-grid equal" style="margin:0">
        <div class="diff-block">
          ${summary.added.map((item) => `<div class="diff-line add">+ ${escapeHtml(item.name)} · ${escapeHtml(item.category)}</div>`).join("") || `<div class="diff-line">No added services</div>`}
          ${summary.removed.map((item) => `<div class="diff-line remove">- ${escapeHtml(item.name)} · ${escapeHtml(item.category)}</div>`).join("") || ""}
          ${summary.changed.map((item) => `<div class="diff-line change">~ ${escapeHtml(item)}</div>`).join("")}
        </div>
        <div class="panel-body">
          <p class="eyebrow">REVIEW DECISION</p>
          <div class="row" style="flex-wrap:wrap"><button class="button primary" data-review-action="approved" data-review-id="${review.id}">Approve</button><button class="button danger" data-review-action="changes_requested" data-review-id="${review.id}">Request changes</button><button class="button ghost" data-review-action="expected" data-review-id="${review.id}">Mark expected</button><button class="button ghost" data-review-action="false_positive" data-review-id="${review.id}">False positive</button></div>
        </div>
      </div>
    </section>`;
}

async function renderMonitor() {
  setPage("Monitor", "Monitor");
  activeNavigation("monitor");
  emptyInspector();
  const user = await api("/api/auth/me").catch(() => ({ user: null }));
  const watches = user.user ? await api("/api/watch").catch(() => []) : [];
  workspace.innerHTML = `
    <section class="page">
      <div class="page-heading"><p class="eyebrow">CONTINUOUS OBSERVATION</p><h2>Monitor releases and regressions.</h2><p>Build privacy history, review new third parties, and keep portfolio changes visible.</p></div>
      <div class="workspace-switcher">
        <button class="workspace-tile" data-go="/history"><span class="tile-glyph">⑂</span><b>Privacy Git History</b><p>Browse scan snapshots as behavior versions and release changes.</p></button>
        <button class="workspace-tile" data-go="/portfolio"><span class="tile-glyph">▦</span><b>Portfolio Intelligence</b><p>Manage several websites and surface the highest-change properties.</p></button>
      </div>
      <section class="repo-panel" style="margin-top:12px">
        <div class="panel-head"><div><h3>Website Watch</h3><p>Account-owned monitoring targets</p></div></div>
        ${user.user ? `<div>${watches.length ? watches.map((watch) => `<div class="history-row"><span class="status-dot"></span><span><h4>${escapeHtml(watch.hostname)}</h4><p>${escapeHtml(watch.cadence)} · next ${formatDate(watch.next_check_at)}</p></span><span class="badge pass">active</span></div>`).join("") : `<div class="empty-state"><div><span>◉</span><h3>No watch targets</h3><p>Add a public website to begin monitoring it.</p></div></div>`}</div>` : `<div class="empty-state"><div><span>◉</span><h3>Sign in to manage monitors</h3><p>Local accounts keep watch targets separated. Scanning and investigations remain available without an account.</p><button class="button secondary" data-go="/workspace/settings">Open account settings</button></div></div>`}
      </section>
    </section>`;
}

async function renderPortfolio() {
  setPage("Portfolio Intelligence", "Monitor / Portfolio");
  activeNavigation("monitor");
  emptyInspector();
  const portfolios = await api("/api/portfolios");
  await loadScans().catch(() => []);
  workspace.innerHTML = `
    <section class="page">
      <div class="spread page-heading" style="max-width:none"><div><p class="eyebrow">MULTI-SITE ARCHIVE</p><h2>Portfolio Intelligence</h2><p>Track scan health, exposure, and unresolved changes across a group of websites.</p></div><button class="button primary" id="new-portfolio">New portfolio</button></div>
      <div id="portfolio-list">${portfolios.length ? portfolios.map(portfolioCard).join("") : `<div class="empty-state"><div><span>▦</span><h3>No portfolio</h3><p>Add websites to create a portfolio-level privacy overview.</p><button class="button primary" id="empty-new-portfolio">Create portfolio</button></div></div>`}</div>
    </section>`;
  document.querySelector("#new-portfolio")?.addEventListener("click", createPortfolioPrompt);
  document.querySelector("#empty-new-portfolio")?.addEventListener("click", createPortfolioPrompt);
  document.querySelectorAll("[data-add-to-portfolio]").forEach((button) => button.addEventListener("click", () => addWebsiteToPortfolio(Number(button.dataset.addToPortfolio))));
}

function portfolioCard(portfolio) {
  const websites = portfolio.websites || [];
  return `
    <section class="repo-panel" style="margin-bottom:12px">
      <div class="panel-head"><div><h3>${escapeHtml(portfolio.name)}</h3><p>${escapeHtml(portfolio.description || "Website collection")}</p></div><button class="button ghost" data-add-to-portfolio="${portfolio.id}">Add website</button></div>
      ${websites.length ? `<div class="data-table-wrap" style="border:0"><table class="data-table"><thead><tr><th>Website</th><th>Last scan</th><th>Requests</th><th>Cookies</th></tr></thead><tbody>${websites.map((site) => `<tr><td><strong>${escapeHtml(site.title || site.hostname)}</strong><br><span class="domain">${escapeHtml(site.hostname)}</span></td><td>${formatDate(site.last_scan)}</td><td class="mono">${safeNumber(site.requests)}</td><td class="mono">${safeNumber(site.cookies)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state" style="min-height:180px"><div><p>Add a completed scan to this portfolio.</p></div></div>`}
    </section>`;
}

async function createPortfolioPrompt() {
  const name = prompt("Portfolio name");
  if (!name) return;
  await api("/api/portfolios", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description: "GlassNet website portfolio" }) });
  showToast("Portfolio created");
  renderPortfolio();
}

async function addWebsiteToPortfolio(portfolioId) {
  if (!state.scans.length) return showToast("Run a scan before adding a website");
  const choices = state.scans.map((scan) => `${scan.id}: ${scan.target_domain}`).join("\n");
  const scanId = Number(prompt(`Enter a scan ID:\n${choices}`));
  if (!scanId) return;
  await api(`/api/portfolios/${portfolioId}/websites`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scan_id: scanId }) });
  showToast("Website added to portfolio");
  renderPortfolio();
}

function renderWorkspace(section = "") {
  setPage("Workspace", "Workspace");
  activeNavigation("workspace");
  emptyInspector();
  if (section === "developer") return renderDeveloper();
  if (section === "research") return renderResearch();
  if (section === "api") return renderApi();
  if (section === "settings") return renderSettings();
  workspace.innerHTML = `
    <section class="page">
      <div class="page-heading"><p class="eyebrow">SPECIALIST WORKSPACES</p><h2>Choose your working context.</h2><p>Advanced tools stay grouped by purpose so the normal scanning experience remains focused.</p></div>
      <div class="workspace-switcher">
        <button class="workspace-tile" data-go="/workspace/developer"><span class="tile-glyph">{ }</span><b>Developer</b><p>Release reviews, CI rules, regressions, issues, and remediation plans.</p></button>
        <button class="workspace-tile" data-go="/workspace/research"><span class="tile-glyph">⌕</span><b>Research</b><p>Cross-site evidence, reproducibility metadata, collections, and structured exports.</p></button>
        <button class="workspace-tile" data-go="/workspace/api"><span class="tile-glyph">↗</span><b>API</b><p>Local endpoints, scanner health, feature flags, and integration guidance.</p></button>
        <button class="workspace-tile" data-go="/workspace/settings"><span class="tile-glyph">⚙</span><b>Settings</b><p>Appearance, density, local account, privacy, and scan defaults.</p></button>
      </div>
    </section>`;
}

async function renderDeveloper() {
  setPage("Developer Workspace", "Workspace / Developer");
  activeNavigation("workspace");
  const [rules, issues, scans] = await Promise.all([api("/api/rules"), api("/api/issues"), loadScans().catch(() => [])]);
  workspace.innerHTML = `
    <section class="page">
      <div class="spread page-heading" style="max-width:none"><div><p class="eyebrow">BUILD / RELEASE SAFETY</p><h2>Developer Workspace</h2><p>Review privacy behavior like a release artifact, with evidence-linked rules and issues.</p></div><button class="button primary" data-go="/reviews">Open reviews</button></div>
      <div class="workspace-grid equal">
        <section class="repo-panel">
          <div class="panel-head"><div><h3>Privacy CI gate</h3><p>Local rules evaluated against a completed scan</p></div><span class="badge pass">WORKING API</span></div>
          <div>${rules.map((rule) => `<div class="finding-row"><span class="status-dot"></span><span><h4>${escapeHtml(rule.name)}</h4><p class="mono">${escapeHtml(rule.rule_type)} ${escapeHtml(rule.operator)} ${rule.value}</p></span><span class="badge ${rule.enabled ? "pass" : ""}">${rule.enabled ? "enabled" : "off"}</span></div>`).join("")}</div>
          <div class="panel-body row"><select class="field" id="ci-scan" style="flex:1">${scanOptions(scans, 0)}</select><button class="button primary" id="run-ci" ${scans.length ? "" : "disabled"}>Run gate</button></div>
          <div id="ci-result"></div>
        </section>
        <section class="repo-panel">
          <div class="panel-head"><div><h3>Privacy issue tracker</h3><p>Evidence that needs an owner</p></div><button class="button ghost" id="new-issue">New issue</button></div>
          <div id="issue-list">${issues.length ? issues.map(issueRow).join("") : `<div class="empty-state" style="min-height:240px"><div><span>!</span><h3>No open issues</h3><p>Create an issue from observed evidence or a review finding.</p></div></div>`}</div>
        </section>
      </div>
      <section class="repo-panel" style="margin-top:12px">
        <div class="panel-head"><div><h3>Generic CI integration</h3><p>The endpoint returns a process-friendly pass/fail document</p></div></div>
        <div class="panel-body"><pre class="mono" style="margin:0;white-space:pre-wrap;color:var(--muted);font-size:10px">GET /api/ci/:scanId
→ { "status": "pass | fail", "checks": [...] }

# In CI: start GlassNet, create a public scan, poll its job,
# then fail the build when this endpoint returns "fail".</pre></div>
      </section>
    </section>`;
  document.querySelector("#run-ci")?.addEventListener("click", runCiGate);
  document.querySelector("#new-issue")?.addEventListener("click", createIssuePrompt);
  document.querySelectorAll("[data-issue-status]").forEach((button) => button.addEventListener("click", async () => {
    await api(`/api/issues/${button.dataset.issueId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: button.dataset.issueStatus }) });
    showToast("Issue updated");
    renderDeveloper();
  }));
}

function issueRow(issue) {
  return `<div class="issue-row"><span class="status-dot ${issue.severity === "high" || issue.severity === "critical" ? "fail" : issue.severity === "medium" ? "warn" : ""}"></span><span><h4>#${issue.id} ${escapeHtml(issue.title)}</h4><p>${escapeHtml(issue.category)} · ${escapeHtml(issue.evidence)}</p></span><button class="button ghost" data-issue-status="${issue.status === "resolved" ? "reopened" : "resolved"}" data-issue-id="${issue.id}">${issue.status === "resolved" ? "Reopen" : "Resolve"}</button></div>`;
}

async function runCiGate() {
  const scanId = document.querySelector("#ci-scan").value;
  const result = await api(`/api/ci/${scanId}`);
  document.querySelector("#ci-result").innerHTML = `<div class="panel-body"><span class="badge ${result.status === "pass" ? "pass" : "fail"}">GATE ${result.status.toUpperCase()}</span>${result.checks.map((check) => `<div class="inspector-row"><span>${escapeHtml(check.name)}</span><strong style="color:${check.status === "pass" ? "var(--gold)" : "var(--coral)"}">${check.actual} / limit ${check.limit}</strong></div>`).join("")}</div>`;
}

async function createIssuePrompt() {
  const title = prompt("Issue title");
  if (!title) return;
  const evidence = prompt("What evidence supports this issue?");
  if (!evidence) return;
  await api("/api/issues", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, evidence, category: "manual review", severity: "medium", scan_id: state.scans[0]?.id }) });
  showToast("Issue created");
  renderDeveloper();
}

async function renderResearch() {
  setPage("Research Workspace", "Workspace / Research");
  activeNavigation("workspace");
  await loadScans().catch(() => []);
  workspace.innerHTML = `
    <section class="page">
      <div class="page-heading"><p class="eyebrow">REPRODUCIBLE INVESTIGATIONS</p><h2>Research Workspace</h2><p>Filter datasets, preserve methodology, compare websites, and export structured evidence.</p></div>
      <div class="metric-strip">
        ${metricCell("Snapshots", state.scans.length, "local dataset")}
        ${metricCell("Websites", new Set(state.scans.map((item) => item.target_domain)).size, "unique domains")}
        ${metricCell("Scanner", "0.3", "ruleset")}
        ${metricCell("Storage", "SQLite", "local")}
        ${metricCell("Evidence", "Safe", "no values")}
      </div>
      <div class="workspace-grid">
        <section class="repo-panel">
          <div class="panel-head"><div><h3>Dataset</h3><p>Completed investigations with reproducibility metadata</p></div><button class="button ghost" id="export-dataset">Export dataset</button></div>
          <div class="data-table-wrap" style="border:0">${investigationTable(state.scans)}</div>
        </section>
        <section class="repo-panel">
          <div class="panel-head"><h3>Methodology</h3></div>
          <div class="panel-body">
            <div class="inspector-row"><span>Browser state</span><strong>fresh isolated context</strong></div>
            <div class="inspector-row"><span>Target scope</span><strong>public URL only</strong></div>
            <div class="inspector-row"><span>Cookie data</span><strong>attributes only</strong></div>
            <div class="inspector-row"><span>Storage data</span><strong>key names only</strong></div>
            <div class="inspector-row"><span>Classification</span><strong>local rules + confidence</strong></div>
            <p class="quiet-note" style="line-height:1.65;margin-top:14px">Results can differ with geography, time, consent, experiments, device, and authentication state. GlassNet does not copy a person's private browser session.</p>
          </div>
        </section>
      </div>
    </section>`;
  document.querySelector("#export-dataset").addEventListener("click", () => downloadJson({ exported_at: new Date().toISOString(), methodology: "Fresh isolated browser, public page load, safe metadata only.", scans: state.scans }, "glassnet-research-dataset.json"));
}

async function renderApi() {
  setPage("API", "Workspace / API");
  activeNavigation("workspace");
  const [health, features] = await Promise.all([api("/api/health"), api("/api/features")]);
  workspace.innerHTML = `
    <section class="page">
      <div class="page-heading"><p class="eyebrow">LOCAL DEVELOPER INTERFACE</p><h2>GlassNet API</h2><p>Small JSON endpoints support the browser interface, local automation, and future reviewed integrations.</p></div>
      <div class="workspace-grid equal">
        <section class="repo-panel"><div class="panel-head"><h3>Runtime health</h3><span class="badge pass">${escapeHtml(health.status)}</span></div><div class="panel-body"><div class="inspector-row"><span>Scanner version</span><strong class="mono">${escapeHtml(health.scanner_version)}</strong></div><div class="inspector-row"><span>Base URL</span><strong class="mono">http://127.0.0.1:5000/api</strong></div></div></section>
        <section class="repo-panel"><div class="panel-head"><h3>Feature readiness</h3></div><div>${features.map((feature) => `<div class="finding-row"><span class="status-dot ${feature.enabled ? "" : "warn"}"></span><span><h4>${escapeHtml(feature.key)}</h4><p>${escapeHtml(feature.description)}</p></span><span class="badge ${feature.enabled ? "pass" : "warn"}">${feature.enabled ? "enabled" : "planned"}</span></div>`).join("")}</div></section>
      </div>
      <section class="repo-panel" style="margin-top:12px"><div class="panel-head"><h3>Core endpoints</h3></div><div class="data-table-wrap" style="border:0"><table class="data-table"><thead><tr><th>Method</th><th>Path</th><th>Purpose</th></tr></thead><tbody>${[
        ["POST", "/api/scans", "Queue a public website investigation"],
        ["GET", "/api/jobs/:id", "Read live scan stage and result"],
        ["GET", "/api/scans/:id", "Read a completed investigation"],
        ["POST", "/api/reviews", "Create a privacy release review"],
        ["GET", "/api/ci/:scanId", "Evaluate configured privacy thresholds"],
        ["GET", "/api/issues", "List evidence-linked workflow issues"],
      ].map((row) => `<tr><td><span class="badge">${row[0]}</span></td><td class="mono">${row[1]}</td><td>${row[2]}</td></tr>`).join("")}</tbody></table></div></section>
    </section>`;
}

async function renderSettings() {
  setPage("Settings", "Workspace / Settings");
  activeNavigation("workspace");
  const account = await api("/api/auth/me");
  workspace.innerHTML = `
    <section class="page">
      <div class="page-heading"><p class="eyebrow">LOCAL PREFERENCES</p><h2>Settings</h2><p>Appearance and accounts remain on this device unless you deliberately connect an external service.</p></div>
      <div class="workspace-grid equal">
        <section class="repo-panel"><div class="panel-head"><h3>Appearance and performance</h3></div><div class="panel-body stack"><button class="button secondary spread" id="settings-theme"><span>Color theme</span><span>${document.documentElement.dataset.theme}</span></button><button class="button secondary spread" id="settings-density"><span>Information density</span><span>${state.density}</span></button><button class="button secondary spread" id="settings-performance"><span>Device mode</span><span>${state.performanceMode}</span></button><button class="button secondary spread" id="settings-data"><span>Data usage</span><span>${state.dataMode}</span></button></div></section>
        <section class="repo-panel"><div class="panel-head"><h3>Local account</h3></div><div class="panel-body">${account.user ? `<p>Signed in as <strong>${escapeHtml(account.user.email)}</strong>.</p><button class="button danger" id="logout">Sign out</button>` : `<form id="login-form" class="stack"><input class="field" id="login-email" type="email" placeholder="Email" required><input class="field" id="login-password" type="password" placeholder="Password (8+ characters)" minlength="8" required><div class="row"><button class="button primary" type="submit" name="action" value="login">Sign in</button><button class="button secondary" type="submit" name="action" value="register">Create account</button></div></form>`}</div></section>
      </div>
      <section class="repo-panel" style="margin-top:12px"><div class="panel-head"><h3>Privacy boundaries</h3></div><div class="panel-body quiet-note" style="line-height:1.8">GlassNet scans public targets in a fresh isolated browser. It does not access your normal browser profile, export authentication cookies, read passwords, or copy personal sessions. The SQLite database stays inside this project directory.</div></section>
    </section>`;
  document.querySelector("#settings-theme").addEventListener("click", toggleTheme);
  document.querySelector("#settings-density").addEventListener("click", toggleDensity);
  document.querySelector("#settings-performance").addEventListener("click", togglePerformance);
  document.querySelector("#settings-data").addEventListener("click", toggleDataMode);
  document.querySelector("#logout")?.addEventListener("click", async () => { await api("/api/auth/logout", { method: "POST" }); showToast("Signed out"); renderSettings(); });
  document.querySelector("#login-form")?.addEventListener("submit", handleAccount);
}

async function handleAccount(event) {
  event.preventDefault();
  const action = event.submitter.value;
  const email = document.querySelector("#login-email").value;
  const password = document.querySelector("#login-password").value;
  await api(`/api/auth/${action === "register" ? "register" : "login"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (action === "register") {
    await api("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  }
  showToast("Local account ready");
  renderSettings();
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("glassnet-archive-theme", next);
  showToast(`${titleCase(next)} theme selected`);
}

function toggleDensity() {
  state.density = state.density === "compact" ? "comfortable" : "compact";
  document.documentElement.dataset.density = state.density;
  localStorage.setItem("glassnet-density", state.density);
  showToast(`${titleCase(state.density)} density selected`);
}

function togglePerformance() {
  state.performanceMode = state.performanceMode === "low" ? "standard" : "low";
  document.documentElement.dataset.performance = state.performanceMode;
  localStorage.setItem("glassnet-performance", state.performanceMode);
  showToast(`${titleCase(state.performanceMode)} device mode selected`);
  renderSettings();
}

function toggleDataMode() {
  state.dataMode = state.dataMode === "reduced" ? "standard" : "reduced";
  document.documentElement.dataset.dataMode = state.dataMode;
  localStorage.setItem("glassnet-data-mode", state.dataMode);
  clearCachedRequests("/api/scans");
  showToast(`${titleCase(state.dataMode)} data mode selected`);
  renderSettings();
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function formatDate(value) {
  if (!value) return "not yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function titleCase(value) {
  return String(value).replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function workspaceIntro(area, title, copy, records) {
  return `
    <section class="page">
      <div class="page-heading"><p class="eyebrow">${escapeHtml(area)}</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p></div>
      <div class="archive-grid">${records.map((record) => `
        <button class="archive-record" data-go="${record.path}">
          <span class="version-seal"><span>${record.icon}</span></span>
          <h3>${escapeHtml(record.title)}</h3><p>${escapeHtml(record.copy)}</p>
        </button>`).join("")}</div>
    </section>`;
}

async function renderGovernance(section = "") {
  setPage(section ? titleCase(section) : "Govern", `Govern${section ? ` / ${titleCase(section)}` : ""}`);
  activeNavigation("governance");
  emptyInspector();
  if (!section) {
    workspace.innerHTML = workspaceIntro("GOVERNANCE ARCHIVE", "Make privacy responsibility visible.", "Inventories, owners, approvals, tag controls, and architecture decisions stay connected to observed services.", [
      { icon: "I", title: "Service Inventory", copy: "A continuously updated portfolio-wide list of observed third parties.", path: "/governance/inventory" },
      { icon: "O", title: "Ownership Matrix", copy: "Assign teams, owners, purposes, review dates, and approval states.", path: "/governance/ownership" },
      { icon: "T", title: "Tag Manager Governance", copy: "Separate indirectly loaded tags from approved, owned behavior.", path: "/governance/tag-manager" },
      { icon: "A", title: "Change Approvals", copy: "Move proposed privacy changes through accountable review states.", path: "/governance/approvals" },
      { icon: "D", title: "Decision Records", copy: "Preserve why an architecture choice was made and when to revisit it.", path: "/governance/decisions" },
    ]);
    return;
  }
  if (section === "inventory" || section === "ownership" || section === "tag-manager") return renderInventory(section);
  if (section === "approvals") return renderApprovals();
  if (section === "decisions") return renderDecisions();
}

async function renderInventory(view) {
  const inventory = await api("/api/governance/inventory");
  const visible = view === "ownership" ? inventory.filter((item) => !item.owner || item.approval_status !== "approved") :
    view === "tag-manager" ? inventory.filter((item) => /tag|manager/i.test(`${item.service} ${item.category} ${item.domain}`)) : inventory;
  workspace.innerHTML = `
    <section class="page">
      <div class="spread page-heading" style="max-width:none"><div><p class="eyebrow">GOVERN / ${escapeHtml(view)}</p><h2>${view === "inventory" ? "Public Website Service Inventory" : view === "ownership" ? "Privacy Ownership Matrix" : "Tag Manager Governance Center"}</h2><p>${view === "tag-manager" ? "Only publicly observable tag behavior is shown; sensitive container configuration is not collected." : "Observed services are reconciled with reviewed purpose, ownership, consent, and approval metadata."}</p></div><button class="button secondary" data-go="/governance">Govern index</button></div>
      <div class="metric-strip">${metricCell("Services", visible.length, "visible records")}${metricCell("Unowned", visible.filter((item) => !item.owner).length, "needs owner")}${metricCell("Unapproved", visible.filter((item) => item.approval_status !== "approved").length, "needs review")}${metricCell("Websites", new Set(visible.flatMap((item) => item.websites)).size, "observed")}${metricCell("Unknown", visible.filter((item) => item.confidence === "unknown").length, "classification")}</div>
      <div class="table-tools"><input class="field" id="inventory-search" placeholder="Search service, domain, owner, or team" style="flex:1"><button class="button primary" id="edit-governance" ${visible.length ? "" : "disabled"}>Review selected service</button></div>
      <div class="data-table-wrap"><table class="data-table"><thead><tr><th>Select</th><th>Service</th><th>Websites</th><th>Purpose</th><th>Owner / team</th><th>Approval</th><th>Consent</th><th>First / last seen</th></tr></thead><tbody id="inventory-body">${inventoryRows(visible)}</tbody></table></div>
      ${view === "tag-manager" && !visible.length ? `<div class="empty-state"><div><span>§</span><h3>No tag manager classified</h3><p>No observed service matched the current public tag-manager classification. GlassNet will not invent container details.</p></div></div>` : ""}
    </section>`;
  const draw = () => {
    const query = document.querySelector("#inventory-search").value.toLowerCase();
    document.querySelector("#inventory-body").innerHTML = inventoryRows(visible.filter((item) => JSON.stringify(item).toLowerCase().includes(query)));
  };
  document.querySelector("#inventory-search").addEventListener("input", draw);
  document.querySelector("#edit-governance")?.addEventListener("click", () => editGovernanceRecord(visible));
}

function inventoryRows(items) {
  return items.map((item, index) => `<tr><td><input type="radio" name="service-domain" value="${escapeHtml(item.domain)}" ${index === 0 ? "checked" : ""} aria-label="Select ${escapeHtml(item.service)}"></td><td><strong>${escapeHtml(item.service)}</strong><br><span class="domain">${escapeHtml(item.domain)}</span></td><td>${item.websites.length}</td><td>${escapeHtml(item.purpose)}</td><td>${escapeHtml(item.owner || "Unowned")}<br><span class="quiet-note">${escapeHtml(item.team || "No team")}</span></td><td><span class="badge ${item.approval_status === "approved" ? "pass" : "warn"}">${escapeHtml(item.approval_status)}</span></td><td>${escapeHtml(item.consent_requirement)}</td><td class="mono">${formatDate(item.first_seen)}<br>${formatDate(item.last_seen)}</td></tr>`).join("");
}

async function editGovernanceRecord(items) {
  const domain = document.querySelector('input[name="service-domain"]:checked')?.value;
  const current = items.find((item) => item.domain === domain);
  if (!current) return showToast("Select a service");
  const owner = prompt("Owner name", current.owner || "");
  if (owner === null) return;
  const team = prompt("Team", current.team || "");
  if (team === null) return;
  const approval = prompt("Approval: unreviewed, technical_review, privacy_review, approved, rejected, expired", current.approval_status || "unreviewed");
  if (approval === null) return;
  await api(`/api/governance/services/${encodeURIComponent(domain)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owner, team, purpose: current.purpose, approval_status: approval, consent_requirement: current.consent_requirement, review_date: new Date().toISOString().slice(0, 10) }) });
  showToast("Governance record updated");
  renderInventory(location.pathname.split("/").at(-1));
}

async function renderApprovals() {
  const approvals = await api("/api/governance/approvals");
  workspace.innerHTML = `
    <section class="page">
      <div class="page-heading"><p class="eyebrow">GOVERN / CHANGE APPROVAL</p><h2>Privacy Change Approval Workflow</h2><p>Planned vendor, script, cookie, purpose, consent, storage, and policy changes receive accountable states before verification.</p></div>
      <div class="workspace-grid equal">
        <section class="repo-panel"><div class="panel-head"><h3>Approval queue</h3><span class="badge">${approvals.length} records</span></div><div>${approvals.map((item) => `<div class="issue-row"><span class="status-symbol ${item.status === "verified" ? "verified" : item.status === "rejected" ? "serious" : "attention"}"><span>${item.status === "verified" ? "✓" : "!"}</span></span><span><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.change_type)} · owner ${escapeHtml(item.owner)} · ${escapeHtml(item.expected_impact)}</p></span><select class="field" data-approval-state="${item.id}">${["draft","technical_review","privacy_review","approved","rejected","deployed","verified","rolled_back"].map((status) => `<option value="${status}" ${item.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></div>`).join("") || `<div class="empty-state"><div><h3>No proposed changes</h3><p>Create a draft to begin accountable review.</p></div></div>`}</div></section>
        <section class="repo-panel"><div class="panel-head"><h3>Draft change</h3></div><form id="approval-form" class="panel-body archive-form"><label>Change type<select class="field" name="change_type"><option>new vendor</option><option>new script</option><option>new cookie</option><option>consent change</option><option>service removal</option></select></label><label>Title<input class="field" name="title" required></label><label>Owner<input class="field" name="owner" required></label><label>Consent requirement<input class="field" name="consent_requirement" required value="review required"></label><label class="wide">Purpose<textarea class="field" name="purpose" required></textarea></label><label class="wide">Expected impact<textarea class="field" name="expected_impact" required></textarea></label><label class="wide">Evidence or design link<input class="field" name="evidence"></label><label><input type="checkbox" name="policy_update_required"> Policy update required</label><button class="button primary" type="submit">Create draft</button></form></section>
      </div>
    </section>`;
  document.querySelector("#approval-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await api("/api/governance/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, policy_update_required: values.policy_update_required === "on" }) });
    showToast("Approval draft created");
    renderApprovals();
  });
  document.querySelectorAll("[data-approval-state]").forEach((select) => select.addEventListener("change", async () => {
    await api(`/api/governance/approvals/${select.dataset.approvalState}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: select.value }) });
    showToast("Approval state updated");
  }));
}

async function renderDecisions() {
  const decisions = await api("/api/governance/decisions");
  workspace.innerHTML = `
    <section class="page">
      <div class="page-heading"><p class="eyebrow">GOVERN / ADR</p><h2>Privacy Architecture Decision Records</h2><p>Preserve the context, alternatives, impacts, owner, and replacement plan behind privacy-related architecture choices.</p></div>
      <div class="workspace-grid equal">
        <section class="repo-panel"><div class="panel-head"><h3>Decision archive</h3></div><div>${decisions.map((item) => `<article class="panel-body" style="border-bottom:1px solid var(--line)"><span class="evidence-label confirmed">Reviewer record</span><h3>${escapeHtml(item.title)}</h3><p class="quiet-note">${escapeHtml(item.context)}</p><div class="inspector-row"><span>Decision</span><strong>${escapeHtml(item.decision)}</strong></div><div class="inspector-row"><span>Owner</span><strong>${escapeHtml(item.owner)}</strong></div><div class="inspector-row"><span>Review</span><strong>${escapeHtml(item.review_date || "not scheduled")}</strong></div></article>`).join("") || `<div class="empty-state"><div><h3>No decision records</h3><p>Record why an approved architecture choice exists.</p></div></div>`}</div></section>
        <section class="repo-panel"><div class="panel-head"><h3>New decision record</h3></div><form id="decision-form" class="panel-body archive-form"><label class="wide">Decision title<input class="field" name="title" required></label><label class="wide">Context<textarea class="field" name="context" required></textarea></label><label class="wide">Alternatives<textarea class="field" name="alternatives" required></textarea></label><label class="wide">Selected approach<textarea class="field" name="decision" required></textarea></label><label class="wide">Privacy impact<textarea class="field" name="privacy_impact" required></textarea></label><label>Owner<input class="field" name="owner" required></label><label>Review date<input class="field" type="date" name="review_date"></label><label>Related service<input class="field" name="related_domain"></label><label class="wide">Replacement plan<textarea class="field" name="replacement_plan"></textarea></label><button class="button primary" type="submit">Archive decision</button></form></section>
      </div>
    </section>`;
  document.querySelector("#decision-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/governance/decisions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    showToast("Decision record archived");
    renderDecisions();
  });
}

async function renderImprovement(section = "") {
  setPage(section ? titleCase(section) : "Improve", `Improve${section ? ` / ${titleCase(section)}` : ""}`);
  activeNavigation("improvement");
  emptyInspector();
  if (!section) {
    workspace.innerHTML = workspaceIntro("IMPROVEMENT STUDIO", "Turn findings into architecture work.", "Analyze necessity, design a safer blueprint, explore substitutions, manage privacy debt, and measure process maturity.", [
      { icon: "N", title: "Necessity Analyzer", copy: "Separate core, useful, optional, unnecessary, and unknown dependencies.", path: "/improvement/necessity" },
      { icon: "B", title: "Architecture Blueprint", copy: "Compare observed architecture with an evidence-based proposed design.", path: "/improvement/blueprint" },
      { icon: "S", title: "Vendor Substitution", copy: "Explore architectural choices without unverified vendor recommendations.", path: "/improvement/substitution" },
      { icon: "D", title: "Privacy Debt Ledger", copy: "Prioritize problems by impact, age, effort, recurrence, and ownership.", path: "/improvement/debt" },
      { icon: "M", title: "Maturity Model", copy: "See observable process levels and the next evidence-backed action.", path: "/improvement/maturity" },
    ]);
    return;
  }
  await loadScans().catch(() => []);
  if (section === "debt") {
    workspace.innerHTML = `<section class="page"><div class="page-heading"><p class="eyebrow">IMPROVE / DEBT</p><h2>Privacy Debt Ledger</h2><p>Findings become owned engineering work with impact and effort.</p></div><div id="global-debt"></div></section>`;
    return renderDebtLedger(document.querySelector("#global-debt"), { id: state.scans[0]?.id });
  }
  const first = state.scans[0];
  workspace.innerHTML = `
    <section class="page">
      <div class="spread page-heading" style="max-width:none"><div><p class="eyebrow">IMPROVE / ${escapeHtml(section)}</p><h2>${section === "necessity" ? "Third-Party Necessity Analyzer" : section === "blueprint" ? "Website Privacy Architecture Blueprint" : section === "substitution" ? "Vendor Substitution Explorer" : "Website Privacy Maturity Model"}</h2><p>Choose a completed case; every recommendation remains tied to captured evidence and stated limitations.</p></div><div class="row"><select class="field" id="improve-case">${scanOptions(state.scans, 0)}</select><button class="button primary" id="run-improve" ${first ? "" : "disabled"}>Analyze</button></div></div>
      <div id="improve-result">${first ? `<div class="repo-panel"><div class="panel-body quiet-note">Select Analyze to load the latest case.</div></div>` : `<div class="empty-state"><div><h3>No completed cases</h3><p>Run a scan before opening this improvement system.</p></div></div>`}</div>
    </section>`;
  document.querySelector("#run-improve")?.addEventListener("click", async () => {
    const scanId = document.querySelector("#improve-case").value;
    const target = document.querySelector("#improve-result");
    if (section === "necessity") target.innerHTML = necessitySurface(await api(`/api/analysis/necessity/${scanId}`));
    if (section === "blueprint") target.innerHTML = blueprintSurface(await api(`/api/analysis/blueprint/${scanId}`));
    if (section === "substitution") target.innerHTML = substitutionSurface(await api(`/api/analysis/necessity/${scanId}`));
    if (section === "maturity") target.innerHTML = maturitySurface(await api(`/api/analysis/maturity/${scanId}`));
  });
}

async function renderTesting(section = "") {
  setPage(section ? titleCase(section) : "Test", `Test${section ? ` / ${titleCase(section)}` : ""}`);
  activeNavigation("testing");
  emptyInspector();
  if (!section) {
    workspace.innerHTML = workspaceIntro("ARCHITECTURE TEST LAB", "Test expectations before and after release.", "Detect configuration drift, forecast planned services, run requirements, and compare structural privacy architectures.", [
      { icon: "R", title: "Requirement Test Suite", copy: "Run machine-testable expectations with passed, failed, or inconclusive evidence.", path: "/testing/requirements" },
      { icon: "D", title: "Configuration Drift", copy: "Reconcile production observations with approved inventory and consent metadata.", path: "/testing/drift" },
      { icon: "F", title: "Impact Forecast", copy: "Model a proposed integration, clearly labeled as a forecast.", path: "/testing/forecast" },
      { icon: "A", title: "Architecture Comparison", copy: "Compare dependency design rather than tracker counts alone.", path: "/testing/architecture" },
    ]);
    return;
  }
  await loadScans().catch(() => []);
  if (section === "requirements") return renderRequirementSuite();
  if (section === "forecast") return renderForecasts();
  if (section === "architecture") return renderArchitectureTest();
  workspace.innerHTML = `
    <section class="page"><div class="page-heading"><p class="eyebrow">TEST / DRIFT</p><h2>Privacy Configuration Drift Detector</h2><p>Compare observed production behavior with approved service governance records.</p></div><div class="row"><select class="field" id="drift-case">${scanOptions(state.scans, 0)}</select><button class="button primary" id="run-drift" ${state.scans.length ? "" : "disabled"}>Detect drift</button></div><div id="drift-result" style="margin-top:12px"></div></section>`;
  document.querySelector("#run-drift")?.addEventListener("click", async () => {
    const result = await api(`/api/analysis/drift/${document.querySelector("#drift-case").value}`);
    document.querySelector("#drift-result").innerHTML = driftSurface(result);
  });
}

function driftSurface(result) {
  return `<section class="repo-panel"><div class="panel-head"><div><h3>Reconciliation result</h3><p>Case ${result.scan_id}</p></div><span class="badge ${result.status === "aligned" ? "pass" : "warn"}">${escapeHtml(result.status)}</span></div><div>${[
    ["Active but not approved", result.active_not_approved],
    ["Approved but not observed", result.approved_not_observed],
    ["Consent classification conflict", result.consent_conflicts],
  ].map(([label, items]) => `<div class="finding-row"><span class="status-symbol ${items.length ? "attention" : "verified"}"><span>${items.length ? "!" : "✓"}</span></span><span><h4>${label}</h4><p>${items.length ? items.map((item) => escapeHtml(item.domain || item.name)).join(", ") : "No mismatch observed"}</p></span><span class="badge">${items.length}</span></div>`).join("")}</div><div class="panel-body quiet-note">${result.limitations.map(escapeHtml).join(" · ")}</div></section>`;
}

async function renderRequirementSuite() {
  const requirements = await api("/api/testing/requirements");
  workspace.innerHTML = `
    <section class="page"><div class="page-heading"><p class="eyebrow">TEST / REQUIREMENTS</p><h2>Privacy Requirement Test Suite</h2><p>Requirements return passed, failed, or inconclusive with the exact observable value used.</p></div>
      <div class="workspace-grid equal"><section class="repo-panel"><div class="panel-head"><h3>Machine-testable requirements</h3></div><div>${requirements.map((item) => `<div class="finding-row"><span class="status-symbol unknown">?</span><span><h4>${escapeHtml(item.name)}</h4><p class="mono">${escapeHtml(item.rule_type)} ≤ ${escapeHtml(item.expected_value)}</p></span><span class="badge">${item.enabled ? "enabled" : "off"}</span></div>`).join("")}</div><div class="panel-body row"><select class="field" id="requirement-case" style="flex:1">${scanOptions(state.scans, 0)}</select><button class="button primary" id="run-requirements" ${state.scans.length ? "" : "disabled"}>Run suite</button></div></section>
      <section class="repo-panel"><div class="panel-head"><h3>Add requirement</h3></div><form id="requirement-form" class="panel-body archive-form"><label class="wide">Name<input class="field" name="name" required></label><label>Evidence rule<select class="field" name="rule_type"><option value="unknown_domains">Unknown domains</option><option value="insecure_cookies">Insecure cookie attributes</option><option value="unowned_services">Unowned services</option><option value="advertising_services">Advertising services</option><option value="third_parties">Third parties</option><option value="storage_keys">Storage keys</option></select></label><label>Maximum allowed<input class="field" name="expected_value" type="number" min="0" value="0"></label><button class="button primary" type="submit">Add requirement</button></form></section></div>
      <div id="requirement-results" style="margin-top:12px"></div></section>`;
  document.querySelector("#run-requirements")?.addEventListener("click", async () => {
    const result = await api(`/api/testing/requirements/${document.querySelector("#requirement-case").value}/run`);
    document.querySelector("#requirement-results").innerHTML = `<section class="repo-panel"><div class="panel-head"><h3>Suite result</h3><span class="badge ${result.status === "passed" ? "pass" : result.status === "failed" ? "fail" : "warn"}">${result.status}</span></div>${result.results.map((item) => `<div class="finding-row"><span class="status-symbol ${item.status === "passed" ? "verified" : item.status === "failed" ? "serious" : "unknown"}"><span>${item.status === "passed" ? "✓" : item.status === "failed" ? "!" : "?"}</span></span><span><h4>${escapeHtml(item.name)}</h4><p>${escapeHtml(item.evidence)}</p></span><span class="badge">${escapeHtml(item.status)}</span></div>`).join("")}</section>`;
  });
  document.querySelector("#requirement-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/testing/requirements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    showToast("Requirement added");
    renderRequirementSuite();
  });
}

async function renderForecasts() {
  const forecasts = await api("/api/testing/forecasts");
  workspace.innerHTML = `
    <section class="page"><div class="page-heading"><p class="eyebrow">TEST / FORECAST</p><h2>Privacy Impact Forecast</h2><p>Model planned architecture before deployment. Every output is labeled as a forecast—not an observation.</p></div>
      <div class="workspace-grid equal"><section class="repo-panel"><div class="panel-head"><h3>New forecast</h3></div><form id="forecast-form" class="panel-body archive-form"><label>Name<input class="field" name="name" required></label><label>Service category<input class="field" name="service_category" required></label><label class="wide">Expected domains<input class="field" name="domains" required placeholder="service.example, assets.example"></label><label>Expected scripts<input class="field" name="expected_scripts" type="number" min="0" value="1"></label><label>Cookie behavior<select class="field" name="cookie_behavior"><option value="none">None</option><option value="session">Session</option><option value="persistent">Persistent</option><option value="unknown">Unknown</option></select></label><label>Storage use<select class="field" name="storage_use"><option value="none">None</option><option value="local">Local storage</option><option value="session">Session storage</option><option value="unknown">Unknown</option></select></label><label>Consent requirement<input class="field" name="consent_requirement" value="review required"></label><label>Organization<input class="field" name="organization"></label><label class="wide">Page locations<input class="field" name="page_locations"></label><label class="wide">Data purpose<textarea class="field" name="data_purpose" required></textarea></label><button class="button primary" type="submit">Generate forecast</button></form></section>
      <section class="repo-panel"><div class="panel-head"><h3>Forecast archive</h3></div><div id="forecast-list">${forecasts.map(forecastCard).join("") || `<div class="empty-state"><div><h3>No forecasts</h3><p>Model a planned service before it reaches production.</p></div></div>`}</div></section></div></section>`;
  document.querySelector("#forecast-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api("/api/testing/forecasts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    document.querySelector("#forecast-list").insertAdjacentHTML("afterbegin", forecastCard({ name: event.currentTarget.name.value, service_category: event.currentTarget.service_category.value, forecast: result.forecast }));
    showToast("Forecast archived");
    event.currentTarget.reset();
  });
}

function forecastCard(item) {
  return `<article class="evidence-sheet" style="margin:12px"><span class="evidence-label inferred">Forecast — not observed</span><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.service_category)}</p>${Object.entries(item.forecast).filter(([key]) => !["label","uncertainty"].includes(key)).map(([key, value]) => `<div class="inspector-row"><span>${titleCase(key)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}<p class="quiet-note">${escapeHtml(item.forecast.uncertainty)}</p></article>`;
}

async function renderArchitectureTest() {
  workspace.innerHTML = `<section class="page"><div class="page-heading"><p class="eyebrow">TEST / ARCHITECTURE</p><h2>Privacy Architecture Comparison</h2><p>Compare structural choices—directness, concentration, optionality, storage, and consent boundaries—not only counts.</p></div><div class="repo-panel"><div class="panel-body row"><select class="field" id="arch-left" style="flex:1">${scanOptions(state.scans, 0)}</select><select class="field" id="arch-right" style="flex:1">${scanOptions(state.scans, 1)}</select><button class="button primary" id="run-architecture" ${state.scans.length < 2 ? "disabled" : ""}>Compare architecture</button></div></div><div id="architecture-result" style="margin-top:12px"></div></section>`;
  document.querySelector("#run-architecture")?.addEventListener("click", async () => {
    const left = document.querySelector("#arch-left").value;
    const right = document.querySelector("#arch-right").value;
    if (left === right) return showToast("Choose two different cases");
    const result = await api(`/api/analysis/architecture?left=${left}&right=${right}`);
    const rows = ["direct_dependencies","first_party_requests","third_party_requests","dependency_depth","organization_concentration_proxy","optional_services","storage_footprint","consent_boundary"];
    document.querySelector("#architecture-result").innerHTML = `<section class="repo-panel"><div class="panel-head"><h3>Architecture evidence</h3><span class="badge">CONTEXTUAL</span></div><div class="data-table-wrap" style="border:0"><table class="data-table"><thead><tr><th>Dimension</th><th>${escapeHtml(result.left.website)}</th><th>${escapeHtml(result.right.website)}</th></tr></thead><tbody>${rows.map((key) => `<tr><td>${titleCase(key)}</td><td>${escapeHtml(result.left[key])}</td><td>${escapeHtml(result.right[key])}</td></tr>`).join("")}</tbody></table></div><div class="panel-body quiet-note">${escapeHtml(result.context)}</div></section>`;
  });
}

async function renderConsentCenter() {
  setPage("Consent", "Studio / Consent");
  activeNavigation("");
  emptyInspector();
  const evaluations = await api("/api/consent/evaluations");
  await loadScans().catch(() => []);
  workspace.innerHTML = `
    <section class="page"><div class="page-heading"><p class="eyebrow">CONSENT / INTERFACE QUALITY</p><h2>Consent Interface Quality Evaluator</h2><p>Record observable interface qualities carefully. GlassNet reports balance and friction without declaring a dark pattern or legal violation.</p></div>
      <div class="workspace-grid equal"><section class="repo-panel"><div class="panel-head"><h3>Structured evaluator</h3><span class="badge ai">REVIEWER INPUT</span></div><form id="consent-quality-form" class="panel-body archive-form"><label>Related case<select class="field" name="scan_id"><option value="">No case</option>${scanOptions(state.scans, -1)}</select></label><label>Steps to accept<input class="field" name="accept_steps" type="number" min="0" required value="1"></label><label>Steps to reject<input class="field" name="reject_steps" type="number" min="0" required value="1"></label><label><input type="checkbox" name="reject_visible"> Reject option clearly visible</label><label><input type="checkbox" name="granular"> Granular categories available</label><label><input type="checkbox" name="revisit_available"> Preferences can be revisited</label><label><input type="checkbox" name="default_selections"> Non-essential defaults selected</label><label class="wide">Reviewer note<textarea class="field" name="evaluator_note"></textarea></label><button class="button primary" type="submit">Evaluate interface</button></form></section>
      <section class="repo-panel"><div class="panel-head"><h3>Evaluation archive</h3></div><div id="consent-evaluations">${evaluations.map((item) => `<div class="finding-row"><span class="status-symbol ${item.result === "Balanced" ? "verified" : item.result === "Result inconclusive" ? "unknown" : "attention"}"><span>${item.result === "Balanced" ? "✓" : "!"}</span></span><span><h4>${escapeHtml(item.result)}</h4><p>Accept ${item.accept_steps} step(s) · Reject ${item.reject_steps} step(s) · Reviewer record ${item.id}</p></span><span class="badge">${formatDate(item.created_at)}</span></div>`).join("") || `<div class="empty-state"><div><h3>No interface evaluations</h3><p>Record observable consent controls; do not guess absent evidence.</p></div></div>`}</div></section></div>
      <section class="evidence-sheet" style="margin-top:12px"><span class="evidence-label observed">Network evidence</span><h3>Consent behavior remains separate</h3><p>The interface-quality evaluator records reviewer-observed usability. The existing Case evidence records technical requests, cookies, and consent-state limitations. Neither substitutes for the other.</p></section></section>`;
  document.querySelector("#consent-quality-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const result = await api("/api/consent/evaluations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scan_id: Number(values.scan_id) || undefined, accept_steps: Number(values.accept_steps), reject_steps: Number(values.reject_steps), reject_visible: values.reject_visible === "on", granular: values.granular === "on", revisit_available: values.revisit_available === "on", default_selections: values.default_selections === "on", evaluator_note: values.evaluator_note }) });
    showToast(`Evaluation: ${result.result}`);
    renderConsentCenter();
  });
}

function renderStudio(section = "") {
  if (section === "research") return renderResearch();
  if (section === "integrations") return renderApi();
  if (section === "settings") return renderSettings();
  if (section === "consent") return renderConsentCenter();
  setPage("Studio", "Studio");
  activeNavigation("");
  emptyInspector();
  workspace.innerHTML = workspaceIntro("SECONDARY WORKSPACES", "Studio", "Research, consent, integrations, and settings are kept outside the six primary navigation entries.", [
    { icon: "C", title: "Consent", copy: "Evaluate interface quality and open consent evidence.", path: "/consent" },
    { icon: "R", title: "Research", copy: "Export reproducible case datasets and methodology.", path: "/studio/research" },
    { icon: "I", title: "Integrations", copy: "Review local APIs, rules, and feature readiness.", path: "/studio/integrations" },
    { icon: "S", title: "Settings", copy: "Appearance, density, account, and privacy boundaries.", path: "/settings" },
  ]);
}

function attachGlobalActions() {
  document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.go)));
  document.querySelectorAll("[data-open-scan]").forEach((row) => {
    row.addEventListener("click", () => navigate(`/cases/${row.dataset.openScan}/summary`));
    row.addEventListener("keydown", (event) => { if (event.key === "Enter") navigate(`/cases/${row.dataset.openScan}/summary`); });
  });
}

async function renderRoute() {
  state.routeController.abort();
  state.routeController = new AbortController();
  state.liveSource?.close();
  state.liveSource = null;
  clearTimeout(state.pollTimer);
  state.pollTimer = null;
  clearInterval(state.replayTimer);
  state.replayTimer = null;
  state.network?.destroy();
  state.network = null;
  const parts = location.pathname.split("/").filter(Boolean);
  const root = parts[0] || "";
  try {
    if (!root) renderLanding();
    else if (root === "home") await renderHome();
    else if (root === "scan") renderScan();
    else if (root === "cases" && parts[1]) await renderInvestigationRoute(parts[1], parts[2] || "summary");
    else if (root === "cases") await renderInvestigations();
    else if (root === "governance") await renderGovernance(parts[1] || "");
    else if (root === "improvement") await renderImprovement(parts[1] || "");
    else if (root === "testing") await renderTesting(parts[1] || "");
    else if (root === "consent") await renderConsentCenter();
    else if (root === "studio") await renderStudio(parts[1] || "");
    else if (root === "settings") await renderSettings();
    else if (root === "investigations" && parts[1]) navigate(`/cases/${parts[1]}/summary`);
    else if (root === "investigations") navigate("/cases");
    else if (root === "compare") navigate("/testing/architecture");
    else if (root === "history") await renderHistory();
    else if (root === "reviews") await renderReviews();
    else if (root === "monitor") await renderMonitor();
    else if (root === "portfolio") await renderPortfolio();
    else if (root === "workspace") navigate(`/studio/${parts[1] || ""}`.replace(/\/$/, ""));
    else navigate("/home");
  } catch (error) {
    if (error.name === "AbortError") return;
    workspace.innerHTML = `<section class="page"><div class="error-state"><h3>This workspace could not load</h3><p>${escapeHtml(error.message)}</p><button class="button primary" data-go="/home" style="margin-top:14px">Return home</button></div></section>`;
  }
  attachGlobalActions();
  workspace.focus({ preventScroll: true });
}

function setupCommandPalette() {
  const dialog = document.querySelector("#command-palette");
  const search = document.querySelector("#command-search");
  const list = document.querySelector("#command-list");
  const draw = () => {
    const query = search.value.toLowerCase();
    list.innerHTML = commands.filter((command) => `${command.label} ${command.detail}`.toLowerCase().includes(query)).map((command) => `<button class="command-item" data-command-path="${command.path}" role="option"><span>${escapeHtml(command.label)}</span><small>${escapeHtml(command.detail)}</small></button>`).join("");
    list.querySelectorAll("[data-command-path]").forEach((button) => button.addEventListener("click", () => { dialog.close(); navigate(button.dataset.commandPath); }));
  };
  document.querySelector("#command-trigger").addEventListener("click", () => { dialog.showModal(); search.value = ""; draw(); search.focus(); });
  search.addEventListener("input", draw);
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      dialog.showModal();
      search.value = "";
      draw();
      search.focus();
    }
    if (event.key === "Escape" && dialog.open) dialog.close();
  });
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("[data-link]");
  if (!link) return;
  event.preventDefault();
  navigate(link.getAttribute("href"));
});
window.addEventListener("popstate", renderRoute);
document.querySelector("#theme-button").addEventListener("click", toggleTheme);
document.querySelector("#help-button").addEventListener("click", () => document.querySelector("#help-dialog").showModal());
document.querySelector("#studio-button").addEventListener("click", () => navigate("/studio"));
document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
setupCommandPalette();
renderRoute();
