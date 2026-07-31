// GlassNet has a small client-side router so navigation feels quick without
// adding a large frontend framework.
const main = document.querySelector("#main-content");
const toast = document.querySelector("#toast");
let activeEventSource;
let currentReport;
let requestController;
let requestTimer;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function titleCase(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function scoreClass(score) {
  if (score >= 80) return "good";
  if (score >= 55) return "warn";
  return "bad";
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error || "The request could not be completed.");
  return data;
}

function navigate(path) {
  if (window.location.pathname !== path) history.pushState({}, "", path);
  renderRoute();
}

function setActiveNavigation(name) {
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.classList.toggle("active", link.dataset.nav === name);
  });
}

function pageHeading(label, title, text, action = "") {
  return `
    <div class="section-head">
      <div>
        <p class="eyebrow">${escapeHtml(label)}</p>
        <h2>${escapeHtml(title)}</h2>
        ${text ? `<p>${escapeHtml(text)}</p>` : ""}
      </div>
      ${action}
    </div>
  `;
}

function reportRow(report) {
  return `
    <article class="report-row">
      <div>
        <h3>${escapeHtml(report.site_name || report.target_domain)}</h3>
        <p>${escapeHtml(report.target_domain)} · ${escapeHtml(formatDate(report.created_at))}</p>
      </div>
      <span class="metric"><strong>${Number(report.requests || 0)}</strong>requests</span>
      <span class="metric"><strong>${Number(report.third_parties || 0)}</strong>third parties</span>
      <span class="metric"><strong>${Number(report.cookies || 0)}</strong>cookies</span>
      <a class="button small secondary" href="/cases/${Number(report.id)}" data-link>Open</a>
    </article>
  `;
}

async function renderHome() {
  setActiveNavigation("home");
  const scans = await api("/api/scans?limit=4").catch(() => ({ items: [] }));

  main.innerHTML = `
    <section class="page">
      <div class="hero">
        <p class="eyebrow">Website privacy scanner</p>
        <h1>See who a website talks to.</h1>
        <p>GlassNet visits one public page in a fresh browser, records its external connections, and explains the privacy signals in plain language.</p>
        <div class="actions">
          <a class="button primary" href="/scan" data-link>Scan a website</a>
          <button class="button secondary" id="sample-report">View sample report</button>
        </div>
      </div>

      <div class="grid">
        <article class="panel stat"><strong>1</strong><span>public page load observed per scan</span></article>
        <article class="panel stat"><strong>0</strong><span>passwords or cookie values collected</span></article>
        <article class="panel stat"><strong>Local</strong><span>reports stay in your SQLite database</span></article>
      </div>

      ${pageHeading("Recent activity", "Latest reports", "Open a previous scan or start a fresh one.",
        `<a class="button small secondary" href="/cases" data-link>View all reports</a>`)}

      <div class="report-list">
        ${scans.items.length
          ? scans.items.map(reportRow).join("")
          : `<div class="empty"><h3>No reports yet</h3><p>Your completed scans will appear here.</p><a class="button primary" href="/scan" data-link>Run the first scan</a></div>`}
      </div>
    </section>
  `;

  document.querySelector("#sample-report").addEventListener("click", async () => {
    try {
      currentReport = await api("/api/sample-report");
      window.history.pushState({}, "", "/sample");
      renderReport(currentReport);
    } catch (error) {
      showToast(error.message);
    }
  });
}

function renderScan() {
  setActiveNavigation("scan");
  main.innerHTML = `
    <section class="page">
      <div class="hero">
        <p class="eyebrow">New scan</p>
        <h1>Inspect a public website.</h1>
        <p>Choose a quick overview or a fuller scan that also reads script URLs and storage-key names.</p>
      </div>

      <form class="scan-form" id="scan-form">
        <label for="website-url"><strong>Website address</strong></label>
        <div class="url-row" style="margin-top:9px">
          <input class="field mono" id="website-url" name="url" type="url" placeholder="https://example.com" required>
          <button class="button primary" type="submit">Start scan</button>
        </div>

        <div class="mode-grid">
          <label class="mode-option">
            <input type="radio" name="mode" value="quick" checked>
            <span class="mode-card">
              <strong>Quick scan</strong>
              <small>A shorter visit that counts requests, services, and cookie metadata.</small>
            </span>
          </label>
          <label class="mode-option">
            <input type="radio" name="mode" value="full">
            <span class="mode-card">
              <strong>Full scan</strong>
              <small>Adds script URLs, storage-key names, and selected security headers.</small>
            </span>
          </label>
        </div>

        <p class="privacy-note">Public websites only. Private addresses, login sessions, passwords, cookie values, and form contents are never collected.</p>
      </form>

      <div id="scan-progress"></div>
    </section>
  `;

  document.querySelector("#scan-form").addEventListener("submit", startScan);
}

async function startScan(event) {
  event.preventDefault();
  if (activeEventSource) activeEventSource.close();

  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const progressBox = document.querySelector("#scan-progress");
  const formData = new FormData(form);
  button.disabled = true;

  try {
    const created = await api("/api/scans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: formData.get("url"), mode: formData.get("mode") }),
    });

    progressBox.innerHTML = `
      <section class="panel" style="margin-top:18px">
        <div class="panel-body">
          <h3 id="progress-title">Scan queued</h3>
          <p id="progress-text">Waiting for an available browser.</p>
          <div class="progress"><span id="progress-bar"></span></div>
          <div class="progress-meta"><span id="progress-stage">Queued</span><span id="progress-count">0 requests</span></div>
        </div>
      </section>
    `;

    watchScan(created.jobId);
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
}

function watchScan(jobId) {
  const stages = {
    queued: 8,
    opening_browser: 20,
    mapping_network: 48,
    reading_storage: 70,
    classifying_services: 88,
    completed: 100,
  };

  activeEventSource = new EventSource(`/api/jobs/${jobId}/events`);
  activeEventSource.onmessage = (event) => {
    const job = JSON.parse(event.data);
    const stage = job.progress?.stage || job.progress_stage || "queued";
    const requests = Number(job.progress?.requests || 0);
    document.querySelector("#progress-title").textContent = stage === "queued" ? "Scan queued" : "Scanning website";
    document.querySelector("#progress-text").textContent = "GlassNet is collecting public browser metadata.";
    document.querySelector("#progress-stage").textContent = titleCase(stage);
    document.querySelector("#progress-count").textContent = `${requests} requests`;
    document.querySelector("#progress-bar").style.width = `${stages[stage] || 35}%`;
  };

  activeEventSource.addEventListener("complete", (event) => {
    const result = JSON.parse(event.data);
    activeEventSource.close();
    activeEventSource = undefined;

    if (result.status === "completed") navigate(`/cases/${result.scan_id}`);
    else {
      document.querySelector("#progress-title").textContent = "Scan could not finish";
      document.querySelector("#progress-text").textContent = result.error_code || "The website may have blocked automated access.";
      document.querySelector("#scan-form button[type=submit]").disabled = false;
    }
  });

  activeEventSource.onerror = () => {
    if (!activeEventSource) return;
    showToast("The progress connection was interrupted.");
  };
}

async function renderCases() {
  setActiveNavigation("cases");
  const scans = await api("/api/scans?limit=50");

  main.innerHTML = `
    <section class="page">
      ${pageHeading("Saved locally", "Reports", "Completed scans stored on this computer.",
        `<a class="button small primary" href="/scan" data-link>New scan</a>`)}
      <div class="report-list">
        ${scans.items.length
          ? scans.items.map(reportRow).join("")
          : `<div class="empty"><h3>No saved reports</h3><p>Run a scan to create your first report.</p><a class="button primary" href="/scan" data-link>Start scanning</a></div>`}
      </div>
    </section>
  `;
}

async function renderReportRoute(id) {
  setActiveNavigation("cases");
  currentReport = await api(`/api/scans/${id}`);
  renderReport(currentReport);
}

function renderReport(report, selectedTab = "summary") {
  setActiveNavigation("cases");
  const sampleBadge = report.is_sample ? `<span class="badge">Sample data</span>` : "";

  main.innerHTML = `
    <section class="page">
      <div class="section-head">
        <div>
          <p class="eyebrow">${report.is_sample ? "Demonstration report" : `Report #${Number(report.id)}`}</p>
          <h2>${escapeHtml(report.site_name || report.target_domain)}</h2>
          <p>${escapeHtml(report.url)} · ${escapeHtml(formatDate(report.created_at))}</p>
        </div>
        <div class="row">${sampleBadge}<span class="badge ${scoreClass(report.score)}">${Number(report.score)}/100 · ${escapeHtml(report.score_label)}</span></div>
      </div>

      <div class="grid">
        <article class="panel stat"><strong>${Number(report.summary.requests)}</strong><span>network requests</span></article>
        <article class="panel stat"><strong>${Number(report.summary.third_parties)}</strong><span>third-party domains</span></article>
        <article class="panel stat"><strong>${Number(report.summary.cookies)}</strong><span>cookies observed</span></article>
      </div>

      <div class="tabs" role="tablist">
        ${["summary", "requests", "cookies", "security", "map"].map((tab) => `
          <button class="${selectedTab === tab ? "active" : ""}" data-report-tab="${tab}" type="button">${titleCase(tab)}</button>
        `).join("")}
      </div>
      <div id="report-content"></div>
    </section>
  `;

  document.querySelectorAll("[data-report-tab]").forEach((button) => {
    button.addEventListener("click", () => renderReport(report, button.dataset.reportTab));
  });

  if (selectedTab === "map") renderMap(report);
  else if (selectedTab === "requests") renderRequests(report);
  else if (selectedTab === "cookies") renderCookies(report);
  else if (selectedTab === "security") renderSecurity(report);
  else renderSummary(report);
}

function renderSummary(report) {
  const content = document.querySelector("#report-content");
  const risk = report.risk || { level: "Unable to determine", summary: "This older report does not contain enough evidence for the new risk rules.", reasons: [], concern_count: 0, limitations: report.limitations || [] };
  const findings = report.findings || [];
  content.innerHTML = `
    <section class="risk-summary ${risk.level === "Low observed risk" ? "risk-low" : risk.level === "High observed risk" ? "risk-high" : risk.level === "Some concerns found" ? "risk-some" : "risk-unknown"}">
      <div>
        <p class="eyebrow">Observed risk</p>
        <h2>${escapeHtml(risk.level)}</h2>
        <p>${escapeHtml(risk.summary)}</p>
        ${risk.reasons?.length ? `<ul class="risk-reasons">${risk.reasons.slice(0, 4).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>` : ""}
        <a class="evidence-link" href="#findings">View supporting evidence</a>
      </div>
      <div class="risk-count"><strong>${Number(risk.concern_count)}</strong><span>observed concerns</span></div>
    </section>

    <section class="panel" id="findings">
      <div class="panel-head">
        <div><h3>Main concerns</h3><p>Every conclusion below is connected to scan evidence.</p></div>
        <span class="badge">Rules ${escapeHtml(risk.ruleset_version || "legacy")}</span>
      </div>
      <div class="finding-list">
        ${findings.length ? findings.map((finding) => `
          <article class="finding-item">
            <div class="finding-top"><strong>${escapeHtml(finding.title)}</strong><span class="badge ${finding.severity === "serious" || finding.severity === "high" ? "bad" : "warn"}">${escapeHtml(finding.severity)} · ${escapeHtml(finding.confidence)} confidence</span></div>
            <p>${escapeHtml(finding.explanation)}</p>
            <p class="evidence-line"><b>Evidence:</b> ${escapeHtml(finding.evidence)}</p>
            <div class="meaning"><b>What does this mean?</b><span>${escapeHtml(finding.beginner_explanation)}</span></div>
          </article>
        `).join("") : `<div class="panel-body"><p>No evidence-based risk rule matched this scan.</p><div class="meaning"><b>What does this mean?</b><span>No major concern was observed during this short visit, but that does not guarantee the website is completely safe.</span></div></div>`}
      </div>
    </section>

    <section class="panel" style="margin-top:14px">
      <div class="panel-head"><h3>Scan coverage</h3><span class="badge">One page load</span></div>
      <div class="coverage-row">
        <span><b>${report.coverage?.page_loaded ? "Yes" : "No"}</b>Page loaded</span>
        <span><b>${Math.round(Number(report.coverage?.duration_ms || 0) / 100) / 10}s</b>Duration</span>
        <span><b>${Number(report.summary.requests)}</b>Requests</span>
        <span><b>${Number(report.summary.cookies)}</b>Cookies</span>
        <span><b>${Number(report.coverage?.redirects_followed || 0)}</b>Redirects</span>
        <span><b>${Number(report.coverage?.checks_completed || 0)}</b>Checks completed</span>
      </div>
      <div class="panel-body"><p class="muted">${(risk.limitations || report.limitations || []).map(escapeHtml).join(" ")}</p></div>
    </section>

    <section class="panel" style="margin-top:14px">
      <div class="panel-head">
        <div><h3>External services</h3><p>Classification is based on known domains and observable request types.</p></div>
        <span class="badge">${report.services.length} found</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Service</th><th>Category</th><th>Requests</th><th>Confidence</th></tr></thead>
          <tbody>
            ${report.services.length ? report.services.map((service) => `
              <tr>
                <td><strong>${escapeHtml(service.name)}</strong><br><span class="mono">${escapeHtml(service.domain)}</span></td>
                <td>${escapeHtml(service.category)}</td>
                <td>${Number(service.requests)}</td>
                <td>${escapeHtml(service.confidence)}</td>
              </tr>
            `).join("") : `<tr><td colspan="4">No third-party service was observed.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderRequests(report) {
  const content = document.querySelector("#report-content");
  content.innerHTML = `
    <section class="panel">
      <div class="panel-head"><div><h3>Request explorer</h3><p>URLs are redacted before storage. Query values, headers, and bodies are never shown.</p></div><span class="badge" id="request-total">Loading</span></div>
      <form class="filter-bar" id="request-filters">
        <input class="field" name="search" placeholder="Search domain or safe URL">
        <select class="field" name="party"><option value="">Any party</option><option>First party</option><option>Third party</option></select>
        <select class="field" name="type"><option value="">Any type</option><option value="document">Document</option><option value="script">Script</option><option value="image">Image</option><option value="stylesheet">Style</option><option value="font">Font</option><option value="fetch">Fetch</option><option value="xhr">XHR</option><option value="websocket">WebSocket</option></select>
        <select class="field" name="category"><option value="">Any category</option>${["Documents","Scripts","Images","Styles","Fonts","APIs","Analytics","Advertising","Authentication","Payments","Social media","Embeds","WebSockets","Other","Unknown"].map((item) => `<option>${item}</option>`).join("")}</select>
        <select class="field" name="known"><option value="">Known or unknown</option><option value="known">Known</option><option value="unknown">Unknown</option></select>
        <input class="field" name="status" type="number" min="0" max="599" placeholder="Status code" aria-label="Response status code">
        <select class="field" name="consent"><option value="">Any consent state</option><option>Not tested</option></select>
        <input class="field" name="min_bytes" type="number" min="0" value="0" aria-label="Minimum transferred bytes">
        <select class="field" name="sort"><option value="timestamp_ms">Sort by time</option><option value="domain">Sort by domain</option><option value="status">Sort by status</option><option value="transferred_bytes">Sort by size</option></select>
      </form>
      <div id="request-results"><div class="panel-body"><p>Loading captured requests…</p></div></div>
      <div class="pager" id="request-pager"></div>
    </section>
  `;
  const form = document.querySelector("#request-filters");
  form.addEventListener("input", () => {
    clearTimeout(requestTimer);
    requestTimer = setTimeout(() => loadRequests(report, 1), 250);
  });
  loadRequests(report, 1);
}

async function loadRequests(report, page) {
  const form = document.querySelector("#request-filters");
  if (!form) return;
  if (requestController) requestController.abort();
  requestController = new AbortController();
  const params = new URLSearchParams(new FormData(form));
  params.set("page", String(page));
  params.set("page_size", "25");
  try {
    let data;
    if (report.is_sample) {
      const items = report.requests || [];
      data = { items, total: items.length, page: 1, pages: 1 };
    } else {
      data = await api(`/api/scans/${report.id}/requests?${params}`, { signal: requestController.signal });
    }
    document.querySelector("#request-total").textContent = `${data.total} requests`;
    document.querySelector("#request-results").innerHTML = data.items.length ? `
      <div class="table-wrap"><table><thead><tr><th>Destination</th><th>Type</th><th>Status</th><th>Size</th><th>Time</th></tr></thead><tbody>
        ${data.items.map((item) => `<tr class="request-row" tabindex="0" data-request-id="${item.id}"><td><strong>${escapeHtml(item.domain)}</strong><br><span class="mono">${escapeHtml(item.url)}</span></td><td>${escapeHtml(item.category)}<br><span class="muted">${escapeHtml(item.party)}</span></td><td>${item.status || "Failed"}</td><td>${item.transferred_bytes ? `${item.transferred_bytes.toLocaleString()} B` : "Unknown"}</td><td>+${Number(item.timestamp_ms)}ms</td></tr><tr class="request-detail hidden" data-detail-for="${item.id}"><td colspan="5"><div class="detail-list"><div class="detail-row"><span>Method</span><strong>${escapeHtml(item.method)}</strong></div><div class="detail-row"><span>Initiator</span><strong class="mono">${escapeHtml(item.initiator)}</strong></div><div class="detail-row"><span>Redirected from</span><strong class="mono">${escapeHtml(item.redirect_from || "No observed request redirect")}</strong></div><div class="detail-row"><span>Classification</span><strong>${escapeHtml(item.category)} · ${escapeHtml(item.confidence)} · ${escapeHtml(item.classification_method)}</strong></div><div class="detail-row"><span>Associated cookie names</span><strong>${escapeHtml((report.cookies || []).filter((cookie) => cookie.domain === item.domain).map((cookie) => cookie.name).join(", ") || "None observed")}</strong></div><div class="detail-row"><span>Related finding</span><strong>${escapeHtml((report.findings || []).filter((finding) => finding.category === "Third parties" && item.resource_type === "script").map((finding) => finding.title).join(", ") || "No direct finding")}</strong></div><div class="detail-row"><span>Consent state</span><strong>${escapeHtml(item.consent_state)}</strong></div><div class="meaning"><b>What does this mean?</b><span>The page contacted ${escapeHtml(item.domain)} for a ${escapeHtml(item.resource_type)} resource. The URL is redacted and transferred size may rely on the server's declared content length.</span></div></div></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="panel-body"><p>No requests match these filters.</p></div>`;
    document.querySelectorAll(".request-row").forEach((row) => {
      const toggle = () => document.querySelector(`[data-detail-for="${row.dataset.requestId}"]`)?.classList.toggle("hidden");
      row.addEventListener("click", toggle);
      row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") toggle(); });
    });
    document.querySelector("#request-pager").innerHTML = `<button class="button small secondary" ${data.page <= 1 ? "disabled" : ""} data-request-page="${data.page - 1}">Previous</button><span>Page ${data.page} of ${data.pages}</span><button class="button small secondary" ${data.page >= data.pages ? "disabled" : ""} data-request-page="${data.page + 1}">Next</button>`;
    document.querySelectorAll("[data-request-page]").forEach((button) => button.addEventListener("click", () => loadRequests(report, Number(button.dataset.requestPage))));
  } catch (error) {
    if (error.name !== "AbortError") document.querySelector("#request-results").innerHTML = `<div class="panel-body"><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function renderCookies(report) {
  const content = document.querySelector("#report-content");
  content.innerHTML = `
    <section class="panel">
      <div class="panel-head"><div><h3>Cookie names and purposes</h3><p>Names and attributes are shown; cookie values are never collected.</p></div><span class="badge">${report.cookies.length} cookies</span></div>
      <form class="filter-bar cookie-filters" id="cookie-filters">
        <input class="field" name="search" placeholder="Search name or domain">
        <select class="field" name="purpose"><option value="">Any purpose confidence</option><option>Known</option><option>Likely</option><option>Unknown</option></select>
        <select class="field" name="party"><option value="">Any party</option><option value="first">First party</option><option value="third">Third party</option></select>
        <select class="field" name="security"><option value="">Any security state</option><option value="concern">Has concern</option><option value="clear">No contextual concern</option></select>
        <select class="field" name="consent"><option value="">Any consent state</option><option>Not tested</option></select>
        <select class="field" name="sort"><option value="name">Sort by name</option><option value="domain">Sort by domain</option><option value="purpose">Sort by purpose</option></select>
      </form>
      <div id="cookie-results"></div>
    </section>
  `;
  const form = document.querySelector("#cookie-filters");
  const update = () => {
    const values = Object.fromEntries(new FormData(form));
    const search = String(values.search || "").toLowerCase();
    const rows = [...report.cookies].filter((cookie) => {
      if (search && !`${cookie.name} ${cookie.domain}`.toLowerCase().includes(search)) return false;
      if (values.purpose && cookie.purpose_confidence !== values.purpose) return false;
      if (values.party === "first" && !cookie.firstParty) return false;
      if (values.party === "third" && cookie.firstParty) return false;
      if (values.security === "concern" && !cookie.security_notes.length) return false;
      if (values.security === "clear" && cookie.security_notes.length) return false;
      if (values.consent && cookie.consent_state !== values.consent) return false;
      return true;
    }).sort((a, b) => String(values.sort === "domain" ? a.domain : values.sort === "purpose" ? a.purpose_category : a.name).localeCompare(String(values.sort === "domain" ? b.domain : values.sort === "purpose" ? b.purpose_category : b.name)));
    document.querySelector("#cookie-results").innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Cookie</th><th>Purpose</th><th>Party</th><th>Security</th><th>Lifetime</th></tr></thead><tbody>${rows.map((cookie) => `<tr><td><strong class="mono">${escapeHtml(cookie.name)}</strong><br>${escapeHtml(cookie.domain)}<br><span class="muted">Path ${escapeHtml(cookie.path)}</span></td><td><span class="badge">${escapeHtml(cookie.purpose_confidence)}</span><br>${escapeHtml(cookie.purpose)}<details><summary>Classification details</summary><p>${escapeHtml(cookie.classification_source)}</p><p>Category: ${escapeHtml(cookie.purpose_category)}</p><p><b>What does this mean?</b> ${escapeHtml(cookie.purpose)}</p></details></td><td>${cookie.firstParty ? "First" : "Third"}</td><td>${cookie.secure ? "Secure" : "Not Secure"}<br>${cookie.httpOnly ? "HttpOnly" : "Readable by scripts"}<br>SameSite ${escapeHtml(cookie.sameSite)}${cookie.security_notes.length ? `<p class="cookie-warning">${cookie.security_notes.map(escapeHtml).join(" ")}</p>` : ""}</td><td>${cookie.session ? "Session" : escapeHtml(formatDate(cookie.expires_at))}<br><span class="muted">${cookie.session ? "No fixed expiry" : `Expires ${escapeHtml(cookie.expires_at)}`}<br>Consent: ${escapeHtml(cookie.consent_state)}</span></td></tr>`).join("")}</tbody></table></div>` : `<div class="panel-body"><p>No cookies match these filters.</p></div>`;
  };
  form.addEventListener("input", update);
  update();
}

function renderSecurity(report) {
  const content = document.querySelector("#report-content");
  const checks = report.security_checks || [];
  content.innerHTML = `
    <div class="check-list">
      ${checks.map((item) => `<article class="panel check-item"><div class="panel-head"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.observation)}</p></div><span class="badge ${item.status === "Passed" ? "good" : item.status === "Concern" ? "bad" : item.status === "Needs review" ? "warn" : ""}">${escapeHtml(item.status)}</span></div><div class="panel-body"><div class="detail-row"><span>Why it matters</span><strong>${escapeHtml(item.why_it_matters)}</strong></div><div class="detail-row"><span>Evidence</span><strong class="mono">${escapeHtml(item.evidence)}</strong></div><div class="detail-row"><span>Confidence</span><strong>${escapeHtml(item.confidence)}</strong></div><div class="meaning"><b>What does this mean?</b><span>${escapeHtml(item.beginner_explanation)}</span></div><p class="limitation"><b>Limitation:</b> ${escapeHtml(item.limitation)}</p></div></article>`).join("") || `<div class="empty"><h3>Checklist unavailable</h3><p>This older report does not contain the observations needed for the checklist.</p></div>`}
    </div>
    <div class="grid two" style="margin-top:14px">
      <section class="panel"><div class="panel-head"><h3>Observed forms</h3><span class="badge">${(report.forms || []).length}</span></div><div class="panel-body detail-list">${(report.forms || []).length ? report.forms.map((form) => `<div class="detail-row"><span>${escapeHtml(form.method)} · ${form.third_party ? "Third party" : "First party"}${form.action_missing ? " · action omitted" : ""}<br><small>Sensitive types: ${escapeHtml(form.sensitive_fields.join(", ") || "none")} · autocomplete: ${escapeHtml(form.autocomplete.join(", ") || "not declared")}</small></span><strong class="mono">${escapeHtml(form.action)}</strong></div>`).join("") : `<p>No forms were observed.</p>`}</div></section>
      <section class="panel"><div class="panel-head"><h3>Frames and permissions</h3><span class="badge">${(report.iframes || []).length} frames</span></div><div class="panel-body detail-list">${(report.iframes || []).map((frame) => `<div class="detail-row"><span>${frame.hidden ? "Hidden" : "Visible"} · ${frame.third_party ? "Third party" : "First party"}<br><small>Sandbox: ${escapeHtml(frame.sandbox || "not declared")}</small></span><strong class="mono">${escapeHtml(frame.url)}</strong></div>`).join("") || `<p>No frames were observed.</p>`}${(report.permissions || []).filter((item) => item.requested || item.policy_declared).map((item) => `<div class="detail-row"><span>${escapeHtml(item.name)}</span><strong>${item.requested ? "Requested; not granted" : "Mentioned by policy only"}</strong></div>`).join("")}</div></section>
    </div>
  `;
}

async function renderMap(report) {
  const content = document.querySelector("#report-content");
  content.innerHTML = `
    <div class="grid two">
      <section class="panel">
        <div class="panel-head"><h3>Connection map</h3><span class="badge">${report.graph.nodes.length} nodes</span></div>
        <div class="graph" id="case-graph"></div>
        <div class="graph-note">Select a node to read its details.</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h3>Selected connection</h3></div>
        <div class="panel-body" id="graph-details"><p>Select the website or a service in the map.</p></div>
      </section>
    </div>
  `;

  try {
    const { createCaseGraph } = await import("/js/graph.js?v=1");
    await createCaseGraph({
      report,
      container: document.querySelector("#case-graph"),
      onSelect: (node) => {
        document.querySelector("#graph-details").innerHTML = `
          <div class="detail-list">
            <div class="detail-row"><span>Name</span><strong>${escapeHtml(node.label)}</strong></div>
            <div class="detail-row"><span>Type</span><strong>${escapeHtml(node.kind)}</strong></div>
            ${node.details ? `
              <div class="detail-row"><span>Domain</span><strong class="mono">${escapeHtml(node.details.domain)}</strong></div>
              <div class="detail-row"><span>Requests</span><strong>${Number(node.details.requests)}</strong></div>
              <div class="detail-row"><span>Explanation</span><strong>${escapeHtml(node.details.explanation)}</strong></div>
            ` : ""}
          </div>
        `;
      },
    });
  } catch (error) {
    document.querySelector("#case-graph").innerHTML = `<div class="empty"><h3>Map unavailable</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
}

async function renderCompare() {
  setActiveNavigation("compare");
  const scans = await api("/api/scans?limit=50");
  const options = scans.items.map((report) => `
    <option value="${Number(report.id)}">${escapeHtml(report.target_domain)} — ${escapeHtml(formatDate(report.created_at))}</option>
  `).join("");

  main.innerHTML = `
    <section class="page">
      ${pageHeading("Change over time", "Compare two reports", "Choose two completed scans and review the measured differences.")}
      ${scans.items.length < 2 ? `
        <div class="empty"><h3>Two reports are needed</h3><p>Run the same website twice, or compare two different public sites.</p><a class="button primary" href="/scan" data-link>Run a scan</a></div>
      ` : `
        <form class="panel panel-body compare-selects" id="compare-form">
          <label>First report<select class="field" name="first">${options}</select></label>
          <label>Second report<select class="field" name="second">${options}</select></label>
          <button class="button primary" type="submit">Compare</button>
        </form>
        <div id="compare-result"></div>
      `}
    </section>
  `;

  const form = document.querySelector("#compare-form");
  if (!form) return;
  form.elements.second.selectedIndex = 1;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(form);
    if (values.get("first") === values.get("second")) return showToast("Choose two different reports.");
    try {
      const reports = await api(`/api/compare?id=${values.get("first")},${values.get("second")}`);
      showComparison(reports[0], reports[1]);
    } catch (error) {
      showToast(error.message);
    }
  });
}

function showComparison(first, second) {
  const metrics = [
    ["Privacy score", first.score, second.score, true],
    ["Network requests", first.summary.requests, second.summary.requests, false],
    ["Third-party domains", first.summary.third_parties, second.summary.third_parties, false],
    ["Cookies", first.summary.cookies, second.summary.cookies, false],
    ["Storage keys", first.summary.storage_keys, second.summary.storage_keys, false],
    ["Scripts", first.summary.scripts, second.summary.scripts, false],
  ];

  document.querySelector("#compare-result").innerHTML = `
    <section class="panel" style="margin-top:18px">
      <div class="panel-head"><div><h3>Measured differences</h3><p>${escapeHtml(first.target_domain)} compared with ${escapeHtml(second.target_domain)}</p></div></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Metric</th><th>First</th><th>Second</th><th>Change</th></tr></thead>
          <tbody>
            ${metrics.map(([label, before, after, higherIsBetter]) => {
              const change = Number(after) - Number(before);
              const favorable = higherIsBetter ? change > 0 : change < 0;
              return `<tr><td><strong>${label}</strong></td><td>${Number(before)}</td><td>${Number(after)}</td><td class="${change === 0 ? "" : favorable ? "change-down" : "change-up"}">${change > 0 ? "+" : ""}${change}</td></tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </section>
    <p class="notice">A difference can be caused by time, location, consent state, experiments, or temporary website behavior. Review the evidence before drawing conclusions.</p>
  `;
}

function renderAbout() {
  setActiveNavigation("about");
  main.innerHTML = `
    <section class="page">
      <div class="hero">
        <p class="eyebrow">About the project</p>
        <h1>A focused privacy-learning tool.</h1>
        <p>GlassNet was built to make the network activity behind public websites easier to understand.</p>
      </div>

      <div class="grid two">
        <section class="panel">
          <div class="panel-head"><h3>What GlassNet does</h3></div>
          <div class="panel-body"><p>It opens one public page in an isolated browser, records safe metadata, groups external domains into understandable service categories, and saves the report locally.</p></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h3>What GlassNet does not do</h3></div>
          <div class="panel-body"><p>It does not access a normal browser profile, copy login sessions, store cookie values, read passwords, submit forms, or declare whether a website is legally compliant.</p></div>
        </section>
      </div>

      ${pageHeading("How it works", "Simple scan flow", "")}
      <div class="grid">
        <article class="panel stat"><strong>1</strong><span>validate a public URL</span></article>
        <article class="panel stat"><strong>2</strong><span>observe one isolated page load</span></article>
        <article class="panel stat"><strong>3</strong><span>classify and save the report</span></article>
      </div>
    </section>
  `;
}

function renderNotFound() {
  setActiveNavigation("");
  main.innerHTML = `
    <section class="page">
      <div class="empty">
        <h2>Page not found</h2>
        <p>The page you requested is not part of GlassNet.</p>
        <a class="button primary" href="/home" data-link>Return home</a>
      </div>
    </section>
  `;
}

async function renderRoute() {
  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = undefined;
  }

  const parts = window.location.pathname.split("/").filter(Boolean);
  const root = parts[0] || "home";

  try {
    if (root === "home") await renderHome();
    else if (root === "scan") renderScan();
    else if (root === "cases" && parts[1]) await renderReportRoute(Number(parts[1]));
    else if (root === "cases") await renderCases();
    else if (root === "compare") await renderCompare();
    else if (root === "about") renderAbout();
    else if (root === "sample") {
      currentReport = currentReport || await api("/api/sample-report");
      renderReport(currentReport);
    } else renderNotFound();
  } catch (error) {
    main.innerHTML = `
      <section class="page">
        <div class="empty">
          <h2>This page could not load</h2>
          <p>${escapeHtml(error.message)}</p>
          <a class="button primary" href="/home" data-link>Return home</a>
        </div>
      </section>
    `;
  }

  main.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "instant" });
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-link]");
  if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(link.getAttribute("href"));
});

window.addEventListener("popstate", renderRoute);
renderRoute();
