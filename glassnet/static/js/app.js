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
  density: localStorage.getItem("glassnet-density") || "comfortable",
};

const commands = [
  { label: "Scan website", detail: "Start a new investigation", path: "/scan" },
  { label: "Open recent investigation", detail: "Browse captured snapshots", path: "/investigations" },
  { label: "Compare scans", detail: "Review observable changes", path: "/compare" },
  { label: "Create privacy review", detail: "Developer release gate", path: "/reviews" },
  { label: "Add website monitor", detail: "Track future changes", path: "/monitor" },
  { label: "Open portfolio", detail: "View several websites", path: "/portfolio" },
  { label: "Research workspace", detail: "Evidence and reproducibility", path: "/workspace/research" },
  { label: "Developer rules", detail: "CI thresholds and issues", path: "/workspace/developer" },
];

document.documentElement.dataset.theme =
  localStorage.getItem("glassnet-observatory-theme") || "dark";
document.documentElement.dataset.density = state.density;

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

async function api(url, options) {
  const response = await fetch(url, options);
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(body?.error || "GlassNet could not complete this request.");
  return body;
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
  setPage("Network Observatory", "Welcome");
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
          <button class="button secondary" id="open-sample">Open sample investigation</button>
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
  state.scans = await api("/api/scans");
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
        <p class="eyebrow">OBSERVATORY HOME</p>
        <h2>Launch an investigation.</h2>
        <p>Follow a website's network trail, inspect evidence, and build a history of how its privacy behavior changes.</p>
      </div>
      ${scanForm(true)}
      <div class="workspace-grid" style="margin-top:18px">
        <section class="repo-panel">
          <div class="panel-head"><div><h3>Live activity</h3><p>Recent scans and observable changes</p></div><button class="button ghost" data-go="/investigations">View all</button></div>
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
              <button class="button primary" data-go="/investigations/${latest.id}/overview" style="margin-top:14px;width:100%">Open investigation</button>`
              : `<div class="empty-state" style="min-height:210px"><div><span>⌁</span><h3>No investigations yet</h3><p>Run your first scan to reveal a website's network ecosystem.</p></div></div>`}
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
            <button class="button secondary spread" data-go="/compare"><span>Compare scans</span><span>→</span></button>
            <button class="button secondary spread" data-go="${latest ? `/investigations/${latest.id}/overview` : "/investigations"}"><span>Open latest investigation</span><span>→</span></button>
            <button class="button secondary spread" data-go="/monitor"><span>Add website monitor</span><span>→</span></button>
          </div>
        </section>
      </div>
    </section>`;
  attachScanForm();
}

function activityRows(scans) {
  if (!scans.length) return `<div class="empty-state"><div><span>⌁</span><h3>No activity</h3><p>Completed scans and review changes will appear here.</p></div></div>`;
  return scans.map((scan) => `
    <button class="history-row" data-go="/investigations/${scan.id}/overview" style="width:100%;color:inherit;background:transparent;border-left:0;border-right:0;border-top:0;text-align:left;cursor:pointer">
      <span class="status-dot"></span>
      <span><h4>${escapeHtml(scan.site_name)}</h4><p>${escapeHtml(scan.target_domain)} · ${safeNumber(scan.requests)} requests · ${formatDate(scan.created_at)}</p></span>
      <span class="badge pass">${safeNumber(scan.score)}/100</span>
    </button>`).join("");
}

function categoryBars(scan) {
  const groups = [
    ["Third-party services", safeNumber(scan.third_parties), 20, "var(--cyan)"],
    ["Observed cookies", safeNumber(scan.cookies), 30, "var(--amber)"],
    ["Network requests", safeNumber(scan.requests), 150, "var(--steel)"],
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
    pollJob(job.jobId);
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

async function pollJob(jobId) {
  try {
    const job = await api(`/api/jobs/${jobId}`);
    updateLiveProgress(job);
    if (job.status === "completed" && job.report) {
      state.report = job.report;
      showToast("Investigation completed");
      navigate(`/investigations/${job.scan_id}/overview`);
      return;
    }
    if (job.status === "failed") {
      showScanError(job.error_code || "The browser worker could not finish this scan.", job.scan_id);
      return;
    }
    setTimeout(() => pollJob(jobId), 700);
  } catch (error) {
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
        <div class="row" style="margin-top:15px"><button class="button primary" data-go="/scan">Try another scan</button><button class="button ghost" data-go="/investigations">Open preserved investigations</button></div>
      </div>
    </section>`;
}

async function openSample() {
  state.report = await api("/api/sample-report");
  renderInvestigation(state.report, "overview");
  history.replaceState({}, "", "/investigations/sample/overview");
}

async function renderInvestigations() {
  setPage("Investigations", "Investigations");
  activeNavigation("investigations");
  emptyInspector();
  await loadScans().catch(() => []);
  workspace.innerHTML = `
    <section class="page">
      <div class="spread page-heading" style="max-width:none">
        <div><p class="eyebrow">SNAPSHOT REPOSITORY</p><h2>Investigations</h2><p>Each completed scan is a versioned record of observable website behavior.</p></div>
        <button class="button primary" data-go="/scan">New investigation</button>
      </div>
      <div class="table-tools"><input class="field" id="investigation-search" placeholder="Search websites or domains" style="flex:1"><select class="field" id="investigation-sort"><option value="newest">Newest first</option><option value="score">Lowest score</option><option value="domain">Domain</option></select></div>
      <div id="investigation-table">${investigationTable(state.scans)}</div>
    </section>`;
  document.querySelector("#investigation-search").addEventListener("input", filterInvestigations);
  document.querySelector("#investigation-sort").addEventListener("change", filterInvestigations);
}

function investigationTable(scans) {
  if (!scans.length) return `<div class="empty-state"><div><span>◫</span><h3>No investigations</h3><p>Start your first website investigation to reveal its network, storage, and third-party ecosystem.</p><button class="button primary" data-go="/scan">Start investigation</button></div></div>`;
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

async function getReport(scanId) {
  if (scanId === "sample") return api("/api/sample-report");
  if (state.report?.id === Number(scanId)) return state.report;
  return api(`/api/scans/${scanId}`);
}

async function renderInvestigationRoute(scanId, tab = "overview") {
  try {
    const report = await getReport(scanId);
    state.report = report;
    renderInvestigation(report, tab);
  } catch (error) {
    showScanError(error.message, scanId);
  }
}

function renderInvestigation(report, tab) {
  setPage(report.site_name, `Investigations / ${report.id || "Sample"}`);
  activeNavigation("investigations");
  emptyInspector();
  clearInterval(state.replayTimer);
  const scanId = report.id || "sample";
  workspace.innerHTML = `
    <section class="page">
      <header class="investigation-head">
        <div class="spread">
          <div>
            <p class="eyebrow">INVESTIGATION ${String(scanId).toUpperCase()} / VERSION ${report.id || "DEMO"}</p>
            <h2>${escapeHtml(report.site_name)}</h2>
            <div class="investigation-meta"><span>${escapeHtml(report.target_domain)}</span><span>${escapeHtml(report.mode || "full")} scan</span><span>${formatDate(report.created_at)}</span><span>browser: isolated chromium</span><span>scanner ${escapeHtml(report.scanner_version)}</span></div>
          </div>
          <div class="row"><button class="button ghost" id="export-report">Export JSON</button>${report.id ? `<button class="button secondary" id="set-baseline">Set baseline</button>` : ""}</div>
        </div>
      </header>
      <nav class="investigation-tabs" aria-label="Investigation sections">
        ${["overview", "digital-twin", "replay", "consent-lab", "evidence"].map((name) => `<button class="${tab === name ? "active" : ""}" data-investigation-tab="${name}">${titleCase(name)}</button>`).join("")}
      </nav>
      <div id="investigation-content">${investigationContent(report, tab)}</div>
    </section>`;

  document.querySelector("#export-report").addEventListener("click", () => downloadJson(report, `glassnet-${report.target_domain}-${scanId}.json`));
  document.querySelector("#set-baseline")?.addEventListener("click", () => createBaseline(report.id));
  document.querySelectorAll("[data-investigation-tab]").forEach((button) => {
    button.addEventListener("click", () => navigate(`/investigations/${scanId}/${button.dataset.investigationTab}`));
  });
  attachInvestigationActions(report, tab);
}

function investigationContent(report, tab) {
  if (tab === "digital-twin") return digitalTwinView(report);
  if (tab === "replay") return replayView(report);
  if (tab === "consent-lab") return consentView(report);
  if (tab === "evidence") return evidenceView(report);
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
      <div style="height:4px;background:var(--shell-2);margin-top:6px"><div style="height:100%;width:${value}%;background:${value > 70 ? "var(--emerald)" : value > 45 ? "var(--amber)" : "var(--coral)"}"></div></div>
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
        <div class="legend"><span><i style="background:var(--cyan)"></i>Website</span><span><i style="background:var(--steel)"></i>Functional</span><span><i style="background:var(--amber)"></i>Analytics</span><span><i style="background:var(--coral)"></i>Advertising</span></div>
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

function evidenceView(report) {
  const evidenceRows = [
    ...Object.entries(report.security_headers || {}).map(([name, value]) => ({ type: "header", source: report.target_domain, detail: `${name}: ${value}` })),
    ...report.cookies.map((cookie) => ({ type: "cookie", source: cookie.domain, detail: `Secure=${cookie.secure} HttpOnly=${cookie.httpOnly} SameSite=${cookie.sameSite}` })),
    ...report.storage.map((item) => ({ type: item.type, source: item.origin, detail: `key: ${item.key}` })),
    ...report.scripts.map((script) => ({ type: "script", source: new URL(script).hostname, detail: script })),
  ];
  return `
    <div class="table-tools"><input class="field" id="evidence-search" placeholder="Search evidence" style="flex:1"><select class="field" id="evidence-filter"><option value="">All evidence</option><option value="header">Headers</option><option value="cookie">Cookies</option><option value="script">Scripts</option><option value="localStorage">Local storage</option></select><button class="button ghost" id="export-evidence">Export</button></div>
    <div class="data-table-wrap"><table class="data-table"><thead><tr><th>Type</th><th>Source</th><th>Observed metadata</th></tr></thead><tbody id="evidence-body">${evidenceTableRows(evidenceRows)}</tbody></table></div>
    <div class="repo-panel" style="margin-top:12px"><div class="panel-head"><h3>Methodology and limitations</h3></div><div class="panel-body"><ul class="quiet-note" style="line-height:1.8">${report.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><div class="inspector-row"><span>Scanner version</span><strong class="mono">${escapeHtml(report.scanner_version)}</strong></div><div class="inspector-row"><span>Mode</span><strong>${escapeHtml(report.mode || "full")}</strong></div></div></div>`;
}

function evidenceTableRows(rows) {
  return rows.map((row) => `<tr data-evidence-type="${escapeHtml(row.type)}"><td><span class="badge">${escapeHtml(row.type)}</span></td><td class="domain">${escapeHtml(row.source)}</td><td class="mono" style="word-break:break-all">${escapeHtml(row.detail)}</td></tr>`).join("") || `<tr><td colspan="3">No evidence of this type was captured.</td></tr>`;
}

function attachInvestigationActions(report, tab) {
  document.querySelectorAll("[data-finding-title]").forEach((button) => button.addEventListener("click", () => showInspector(button.dataset.findingTitle, report.target_domain, [["Scan", String(report.id || "sample")], ["Status", button.querySelector(".badge")?.textContent || "Observed"], ["Evidence", "Captured metadata"]], button.dataset.findingDescription)));
  document.querySelectorAll("[data-organization]").forEach((button) => button.addEventListener("click", () => showInspector(button.dataset.organization, "organization group", [["Requests", button.querySelector(".badge").textContent], ["Confidence", button.dataset.organization === "Unresolved ownership" ? "unknown" : "likely"]], "Organization grouping is based on the local service classification catalog.")));
  document.querySelector("[data-open-twin]")?.addEventListener("click", () => navigate(`/investigations/${report.id || "sample"}/digital-twin`));
  if (tab === "digital-twin") setupDigitalTwin(report);
  if (tab === "replay") setupReplay(report);
  if (tab === "evidence") setupEvidence(report);
}

async function loadCytoscape() {
  if (window.cytoscape) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/cytoscape@3.30.4/dist/cytoscape.min.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("The graph library could not load. The text view remains available."));
    document.head.appendChild(script);
  });
}

async function setupDigitalTwin(report) {
  try {
    await loadCytoscape();
    state.network?.destroy();
    state.network = cytoscape({
      container: document.querySelector("#network-graph"),
      elements: [...report.graph.nodes, ...report.graph.edges],
      layout: { name: "concentric", padding: 58, minNodeSpacing: 55, animate: !matchMedia("(prefers-reduced-motion: reduce)").matches },
      style: [
        { selector: "node", style: { label: "data(label)", color: "#cbd7d3", "font-family": "Cascadia Code", "font-size": 9, "text-valign": "bottom", "text-margin-y": 9, "text-wrap": "wrap", "text-max-width": 84, width: 34, height: 34, "background-color": "#6d91c8", "border-width": 2, "border-color": "#9ab2d5" } },
        { selector: 'node[kind = "website"]', style: { shape: "hexagon", width: 72, height: 72, "background-color": "#58c9cf", "border-color": "#b6eef0", color: "#f0eee7", "font-size": 11 } },
        { selector: 'node[kind = "Advertising"]', style: { shape: "diamond", "background-color": "#d96f62", "border-color": "#efa69e" } },
        { selector: 'node[kind = "Analytics"]', style: { shape: "diamond", "background-color": "#d9a957", "border-color": "#efd09a" } },
        { selector: 'node[kind = "Unknown"]', style: { "background-color": "#14201f", "border-style": "dashed", "border-color": "#a894c8" } },
        { selector: "edge", style: { width: 1.3, "line-color": "#3b6663", "target-arrow-color": "#58c9cf", "target-arrow-shape": "triangle", "curve-style": "bezier", opacity: .75 } },
        { selector: ":selected", style: { "border-width": 4, "border-color": "#f0eee7", "line-color": "#58c9cf", "target-arrow-color": "#58c9cf" } },
      ],
    });
    state.network.on("tap", "node", (event) => {
      const data = event.target.data();
      const service = data.details;
      showInspector(data.label, data.id, [
        ["Category", service?.category || "Website"],
        ["Requests", String(service?.requests || report.summary.requests)],
        ["Confidence", service?.confidence || "captured"],
        ["Resource types", service?.types?.join(", ") || "document"],
      ], service?.explanation || "The central website node.");
    });
    document.querySelector("#graph-fit").addEventListener("click", () => state.network.fit(undefined, 55));
    document.querySelector("#graph-labels").addEventListener("click", (event) => {
      const simple = event.currentTarget.textContent.includes("Simple");
      state.network.style().selector("node").style("label", simple ? "data(kind)" : "data(label)").update();
      event.currentTarget.textContent = simple ? "Technical labels" : "Simple labels";
    });
    document.querySelector("#graph-export").addEventListener("click", () => {
      const link = document.createElement("a");
      link.href = state.network.png({ full: true, scale: 2, bg: "#0b1514" });
      link.download = `glassnet-twin-${report.target_domain}.png`;
      link.click();
    });
  } catch (error) {
    document.querySelector("#network-graph").innerHTML = `<div class="empty-state"><div><span>⌁</span><h3>Graph unavailable</h3><p>${escapeHtml(error.message)}</p></div></div>`;
  }

  document.querySelector("#blocking-service").addEventListener("change", (event) => {
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
    <div style="position:absolute;right:18%;top:42%;border-color:${event.type === "cookie" ? "var(--amber)" : "var(--cyan)"}" class="preview-node">${escapeHtml(event.destination)}</div>
    <div style="position:absolute;left:42%;top:49%;width:18%;height:1px;background:var(--cyan)"><span class="pulse-dot" style="animation-duration:.8s"></span></div>`;
  showInspector(titleCase(event.type), event.destination, [["Sequence", String(event.sequence)], ["Offset", `+${event.offset_ms}ms`], ["Category", event.category], ["Consent state", event.consent_state]], `${event.source} activated ${event.destination}.`);
}

function setupEvidence(report) {
  const allRows = [
    ...Object.entries(report.security_headers || {}).map(([name, value]) => ({ type: "header", source: report.target_domain, detail: `${name}: ${value}` })),
    ...report.cookies.map((cookie) => ({ type: "cookie", source: cookie.domain, detail: `Secure=${cookie.secure} HttpOnly=${cookie.httpOnly} SameSite=${cookie.sameSite}` })),
    ...report.storage.map((item) => ({ type: item.type, source: item.origin, detail: `key: ${item.key}` })),
    ...report.scripts.map((script) => ({ type: "script", source: script, detail: script })),
  ];
  const applyFilters = () => {
    const query = document.querySelector("#evidence-search").value.toLowerCase();
    const type = document.querySelector("#evidence-filter").value;
    const filtered = allRows.filter((row) => (!type || row.type === type) && `${row.source} ${row.detail}`.toLowerCase().includes(query));
    document.querySelector("#evidence-body").innerHTML = evidenceTableRows(filtered);
  };
  document.querySelector("#evidence-search").addEventListener("input", applyFilters);
  document.querySelector("#evidence-filter").addEventListener("change", applyFilters);
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
      <div class="spread page-heading" style="max-width:none"><div><p class="eyebrow">MULTI-SITE OBSERVATORY</p><h2>Portfolio Intelligence</h2><p>Track scan health, exposure, and unresolved changes across a group of websites.</p></div><button class="button primary" id="new-portfolio">New portfolio</button></div>
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
  document.querySelector("#ci-result").innerHTML = `<div class="panel-body"><span class="badge ${result.status === "pass" ? "pass" : "fail"}">GATE ${result.status.toUpperCase()}</span>${result.checks.map((check) => `<div class="inspector-row"><span>${escapeHtml(check.name)}</span><strong style="color:${check.status === "pass" ? "var(--emerald)" : "var(--coral)"}">${check.actual} / limit ${check.limit}</strong></div>`).join("")}</div>`;
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
        <section class="repo-panel"><div class="panel-head"><h3>Appearance</h3></div><div class="panel-body stack"><button class="button secondary spread" id="settings-theme"><span>Color theme</span><span>${document.documentElement.dataset.theme}</span></button><button class="button secondary spread" id="settings-density"><span>Information density</span><span>${state.density}</span></button></div></section>
        <section class="repo-panel"><div class="panel-head"><h3>Local account</h3></div><div class="panel-body">${account.user ? `<p>Signed in as <strong>${escapeHtml(account.user.email)}</strong>.</p><button class="button danger" id="logout">Sign out</button>` : `<form id="login-form" class="stack"><input class="field" id="login-email" type="email" placeholder="Email" required><input class="field" id="login-password" type="password" placeholder="Password (8+ characters)" minlength="8" required><div class="row"><button class="button primary" type="submit" name="action" value="login">Sign in</button><button class="button secondary" type="submit" name="action" value="register">Create account</button></div></form>`}</div></section>
      </div>
      <section class="repo-panel" style="margin-top:12px"><div class="panel-head"><h3>Privacy boundaries</h3></div><div class="panel-body quiet-note" style="line-height:1.8">GlassNet scans public targets in a fresh isolated browser. It does not access your normal browser profile, export authentication cookies, read passwords, or copy personal sessions. The SQLite database stays inside this project directory.</div></section>
    </section>`;
  document.querySelector("#settings-theme").addEventListener("click", toggleTheme);
  document.querySelector("#settings-density").addEventListener("click", toggleDensity);
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
  localStorage.setItem("glassnet-observatory-theme", next);
  showToast(`${titleCase(next)} theme selected`);
}

function toggleDensity() {
  state.density = state.density === "compact" ? "comfortable" : "compact";
  document.documentElement.dataset.density = state.density;
  localStorage.setItem("glassnet-density", state.density);
  showToast(`${titleCase(state.density)} density selected`);
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

function attachGlobalActions() {
  document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.go)));
  document.querySelectorAll("[data-open-scan]").forEach((row) => {
    row.addEventListener("click", () => navigate(`/investigations/${row.dataset.openScan}/overview`));
    row.addEventListener("keydown", (event) => { if (event.key === "Enter") navigate(`/investigations/${row.dataset.openScan}/overview`); });
  });
}

async function renderRoute() {
  clearInterval(state.replayTimer);
  state.replayTimer = null;
  const parts = location.pathname.split("/").filter(Boolean);
  const root = parts[0] || "";
  try {
    if (!root) renderLanding();
    else if (root === "home") await renderHome();
    else if (root === "scan") renderScan();
    else if (root === "investigations" && parts[1]) await renderInvestigationRoute(parts[1], parts[2] || "overview");
    else if (root === "investigations") await renderInvestigations();
    else if (root === "compare") await renderCompare();
    else if (root === "history") await renderHistory();
    else if (root === "reviews") await renderReviews();
    else if (root === "monitor") await renderMonitor();
    else if (root === "portfolio") await renderPortfolio();
    else if (root === "workspace") await renderWorkspace(parts[1] || "");
    else navigate("/home");
  } catch (error) {
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
document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
setupCommandPalette();
renderRoute();
