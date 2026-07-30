// GlassNet has a small client-side router so navigation feels quick without
// adding a large frontend framework.
const main = document.querySelector("#main-content");
const toast = document.querySelector("#toast");
let activeEventSource;
let currentReport;

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

      <div class="notice">${escapeHtml(report.notice)}</div>

      <div class="tabs" role="tablist">
        ${["summary", "map", "evidence"].map((tab) => `
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
  else if (selectedTab === "evidence") renderEvidence(report);
  else renderSummary(report);
}

function renderSummary(report) {
  const content = document.querySelector("#report-content");
  content.innerHTML = `
    <section class="panel">
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

    <div class="grid two" style="margin-top:14px">
      <section class="panel">
        <div class="panel-head"><h3>What the score means</h3></div>
        <div class="panel-body"><p>${escapeHtml(report.notice)}</p><p>The score is a transparent estimate based on observed services and cookie metadata. It is not a legal or security verdict.</p></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h3>Limits of this report</h3></div>
        <div class="panel-body"><ul class="muted">${report.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
      </section>
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

function renderEvidence(report) {
  const content = document.querySelector("#report-content");
  const headerRows = Object.entries(report.security_headers || {});

  content.innerHTML = `
    <div class="grid two">
      <section class="panel">
        <div class="panel-head"><h3>Cookie metadata</h3><span class="badge">${report.cookies.length}</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Domain</th><th>Secure</th><th>HttpOnly</th><th>Party</th></tr></thead>
            <tbody>
              ${report.cookies.length ? report.cookies.map((cookie) => `
                <tr><td class="mono">${escapeHtml(cookie.domain)}</td><td>${cookie.secure ? "Yes" : "No"}</td><td>${cookie.httpOnly ? "Yes" : "No"}</td><td>${cookie.firstParty ? "First" : "Third"}</td></tr>
              `).join("") : `<tr><td colspan="4">No cookie metadata was observed.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h3>Security headers</h3><span class="badge">${headerRows.length}</span></div>
        <div class="panel-body detail-list">
          ${headerRows.length ? headerRows.map(([name, value]) => `
            <div class="detail-row"><span class="mono">${escapeHtml(name)}</span><strong>${escapeHtml(value)}</strong></div>
          `).join("") : `<p>No selected security header was captured.</p>`}
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h3>Storage keys</h3><span class="badge">${report.storage.length}</span></div>
        <div class="panel-body detail-list">
          ${report.storage.length ? report.storage.map((item) => `
            <div class="detail-row"><span>${escapeHtml(item.type)}</span><strong class="mono">${escapeHtml(item.key)}</strong></div>
          `).join("") : `<p>No storage-key names were observed.</p>`}
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h3>External scripts</h3><span class="badge">${report.scripts.length}</span></div>
        <div class="panel-body detail-list">
          ${report.scripts.length ? report.scripts.map((script) => `
            <div class="detail-row"><span class="mono">${escapeHtml(script)}</span></div>
          `).join("") : `<p>No external script URLs were recorded.</p>`}
        </div>
      </section>
    </div>
  `;
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
