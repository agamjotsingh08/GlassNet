// Get the main parts of the page once, so we can use them later.
const form = document.querySelector("#scan-form");
const results = document.querySelector("#results");
const loading = document.querySelector("#loading");
const message = document.querySelector("#scan-message");
const historyList = document.querySelector("#history-list");
const compareButton = document.querySelector("#compare-button");
const urlInput = document.querySelector("#url-input");
let network;
let chart;
let latestScanId = null;

function setTheme(value) { document.documentElement.dataset.theme = value; localStorage.setItem("glassnet-theme", value); }
function setDensity(value) { document.documentElement.dataset.density = value; localStorage.setItem("glassnet-density", value); }
setTheme(localStorage.getItem("glassnet-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
setDensity(localStorage.getItem("glassnet-density") || "comfortable");
document.querySelector("#theme-toggle").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
document.querySelector("#density-toggle").addEventListener("click", () => setDensity(document.documentElement.dataset.density === "compact" ? "comfortable" : "compact"));
const onboarding = document.querySelector("#onboarding");
if (!localStorage.getItem("glassnet-onboarding-seen")) onboarding.showModal();
document.querySelector("#onboarding-close").addEventListener("click", () => { localStorage.setItem("glassnet-onboarding-seen", "yes"); onboarding.close(); });

// Small navigation buttons scroll to their matching section.
document.querySelectorAll("[data-scroll]").forEach((button) => {
  button.addEventListener("click", () => document.querySelector(`#${button.dataset.scroll}`).scrollIntoView());
});

document.querySelector("#new-scan").addEventListener("click", () => {
  document.querySelector("#analyze").scrollIntoView();
  document.querySelector("#url-input").focus();
});

// Keep an unfinished public URL in this browser only when the network drops.
urlInput.value = localStorage.getItem("glassnet-unsent-url") || "";
urlInput.addEventListener("input", () => localStorage.setItem("glassnet-unsent-url", urlInput.value));
function showConnectionState() {
  const state = document.querySelector("#connection-state");
  state.classList.toggle("hidden", navigator.onLine);
  state.textContent = navigator.onLine ? "" : "You are offline. Your website address is saved, but a scan cannot start until you reconnect.";
}
window.addEventListener("offline", showConnectionState);
window.addEventListener("online", showConnectionState);
showConnectionState();

// Send the public website address to the GlassNet scan API.
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  if (!navigator.onLine) { message.textContent = "You are offline. Reconnect before starting a scan."; return; }
  results.classList.add("hidden");
  loading.classList.remove("hidden");
  cycleLoadingMessages();

  try {
    const response = await fetch("/api/scans", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({url: document.querySelector("#url-input").value}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The scan could not finish.");
    showResult(data);
    latestScanId = data.id || null;
    localStorage.removeItem("glassnet-unsent-url");
    await loadHistory();
  } catch (error) {
    message.textContent = error.message;
    document.querySelector("#analyze").scrollIntoView();
  } finally {
    loading.classList.add("hidden");
  }
});

// Change the loading text every few seconds so the user knows what is happening.
function cycleLoadingMessages() {
  const lines = [
    "Opening the website in a private browser",
    "Watching its network connections",
    "Translating technical services",
    "Calculating observable privacy exposure",
  ];
  let index = 0;
  const timer = setInterval(() => {
    if (loading.classList.contains("hidden")) return clearInterval(timer);
    index = (index + 1) % lines.length;
    document.querySelector("#loading-text").textContent = lines[index];
  }, 3000);
}

// Put the scan information into the result cards on the page.
function showResult(data) {
  results.classList.remove("hidden");
  document.querySelector("#result-name").textContent = data.site_name;
  const urlLink = document.querySelector("#result-url");
  urlLink.textContent = data.url;
  urlLink.href = data.url;
  document.querySelector("#score-number").textContent = data.score;
  document.querySelector("#score-label").textContent = data.score_label;
  document.querySelector("#score-notice").textContent = data.notice;
  document.querySelector(".score-ring").style.setProperty("--score", `${data.score}%`);
  document.querySelector("#request-count").textContent = data.summary.requests;
  document.querySelector("#third-party-count").textContent = data.summary.third_parties;
  document.querySelector("#cookie-count").textContent = data.summary.cookies;
  document.querySelector("#third-cookie-count").textContent = `${data.summary.third_party_cookies} third-party`;
  renderGraph(data.graph);
  renderChart(data.categories);
  renderServiceList(data.services);
  renderGraphText(data);
  results.scrollIntoView();
}

async function showSample() {
  const response = await fetch("/api/sample-report");
  const data = await response.json();
  message.textContent = "Showing sanitized sample data — not a live scan.";
  showResult(data);
}
document.querySelector("#sample-button").addEventListener("click", showSample);

function renderGraphText(data) {
  const text = data.services.length ? data.services.map((item) => `<li>${escapeHtml(data.target_domain)} contacted ${escapeHtml(item.name)} (${escapeHtml(item.category)}), ${item.requests} requests.</li>`).join("") : "<li>No outside services were observed in this report.</li>";
  document.querySelector("#graph-text-list").innerHTML = `<p>This report shows ${data.summary.third_parties} outside services.</p><ul>${text}</ul>`;
}

// Cytoscape.js draws the connection map from nodes and connecting lines.
function renderGraph(graph) {
  if (network) network.destroy();
  network = cytoscape({
    container: document.querySelector("#network"),
    elements: [...graph.nodes, ...graph.edges],
    layout: {name: "cose", animate: false, padding: 45, idealEdgeLength: 115},
    style: [
      {selector: "node", style: {
        "label": "data(label)", "font-family": "DM Sans", "font-size": 11,
        "text-wrap": "wrap", "text-max-width": 90, "text-valign": "bottom",
        "text-margin-y": 10, "background-color": "#f2c94c", "width": 38, "height": 38,
      }},
      {selector: 'node[kind = "person"]', style: {"background-color": "#17211d", "color": "#17211d", "width": 48, "height": 48}},
      {selector: 'node[kind = "website"]', style: {"background-color": "#136f53", "color": "#136f53", "width": 60, "height": 60}},
      {selector: "edge", style: {"width": 1.4, "line-color": "#aeb7b1", "curve-style": "bezier", "target-arrow-shape": "triangle", "target-arrow-color": "#aeb7b1"}},
      {selector: ":selected", style: {"border-width": 4, "border-color": "#e86f3a"}},
    ],
  });
  network.on("tap", "node", (event) => {
    const details = event.target.data("details");
    if (details) showService(details);
  });
}

// Show the explanation for the service the user clicked in the map.
function showService(service) {
  const essential = service.essential === true ? "Likely functional" : service.essential === false ? "Likely optional" : "Unknown";
  document.querySelector("#service-detail").innerHTML = `
    <span class="kicker">SELECTED SERVICE</span>
    <h2 style="margin-top:18px">${escapeHtml(service.name)}</h2>
    <div class="detail-domain">${escapeHtml(service.domain)}</div>
    <span class="tag">${escapeHtml(service.category)}</span>
    <p class="detail-copy">${escapeHtml(service.explanation)}</p>
    <div class="detail-rows">
      <div class="detail-row"><span>Requests observed</span><strong>${service.requests}</strong></div>
      <div class="detail-row"><span>Likely role</span><strong>${essential}</strong></div>
      <div class="detail-row"><span>Resource types</span><strong>${escapeHtml(service.types.join(", "))}</strong></div>
    </div>`;
}

// Chart.js turns category totals into the circle chart.
function renderChart(categories) {
  if (chart) chart.destroy();
  const labels = Object.keys(categories);
  chart = new Chart(document.querySelector("#category-chart"), {
    type: "doughnut",
    data: {labels, datasets: [{data: Object.values(categories), backgroundColor: ["#136f53", "#e86f3a", "#f2c94c", "#87a7a0", "#405e52", "#b88a71"], borderWidth: 0}]},
    options: {maintainAspectRatio: false, cutout: "65%", plugins: {legend: {position: "right", labels: {boxWidth: 10, usePointStyle: true}}}},
  });
}

// Make a plain list so the scan is readable even without the graph.
function renderServiceList(services) {
  const list = document.querySelector("#service-list");
  if (!services.length) {
    list.innerHTML = '<p class="empty" style="padding:22px">No outside services were observed.</p>';
    return;
  }
  list.innerHTML = services.map((service) => `
    <div class="service-item">
      <div><strong>${escapeHtml(service.name)}</strong><span class="tag">${escapeHtml(service.category)}</span></div>
      <p>${escapeHtml(service.explanation)}</p>
    </div>`).join("");
}

// Ask Flask for old scans whenever the page starts or a scan finishes.
async function loadHistory() {
  const response = await fetch("/api/scans");
  const scans = await response.json();
  if (!scans.length) return;
  historyList.innerHTML = scans.map((scan) => `
    <label class="history-card">
      <div class="history-top"><input type="checkbox" value="${scan.id}" class="compare-check"><span class="history-score">${scan.score}</span></div>
      <h3>${escapeHtml(scan.site_name)}</h3>
      <p>${scan.third_parties} outside services · ${scan.cookies} cookies</p>
    </label>`).join("");
  document.querySelectorAll(".compare-check").forEach((checkbox) => checkbox.addEventListener("change", updateCompareSelection));
}

function updateCompareSelection(event) {
  const checked = [...document.querySelectorAll(".compare-check:checked")];
  if (checked.length > 2) event.target.checked = false;
  compareButton.disabled = document.querySelectorAll(".compare-check:checked").length !== 2;
}

// Compare the two history cards that the user selected.
compareButton.addEventListener("click", async () => {
  const ids = [...document.querySelectorAll(".compare-check:checked")].map((item) => item.value);
  const response = await fetch(`/api/compare?id=${ids[0]}&id=${ids[1]}`);
  const data = await response.json();
  const [left, right] = data;
  const yesNo = (item, category) => Object.keys(item.categories).some((name) => name.toLowerCase().includes(category)) ? "Yes" : "Not observed";
  const comparison = document.querySelector("#comparison");
  comparison.classList.remove("hidden");
  comparison.innerHTML = `<table>
    <thead><tr><th>Signal</th><th>${escapeHtml(left.target_domain)}</th><th>${escapeHtml(right.target_domain)}</th></tr></thead>
    <tbody>
      <tr><td>Privacy score</td><td>${left.score}/100</td><td>${right.score}/100</td></tr>
      <tr><td>Outside services</td><td>${left.summary.third_parties}</td><td>${right.summary.third_parties}</td></tr>
      <tr><td>Cookies</td><td>${left.summary.cookies}</td><td>${right.summary.cookies}</td></tr>
      <tr><td>Advertising</td><td>${yesNo(left, "advertis")}</td><td>${yesNo(right, "advertis")}</td></tr>
      <tr><td>Analytics</td><td>${yesNo(left, "analytic")}</td><td>${yesNo(right, "analytic")}</td></tr>
    </tbody></table>`;
  comparison.scrollIntoView({behavior: "smooth"});
});

// Change special characters to safe text before adding them into HTML.
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[character]));
}

loadHistory();

// Feedback is a confirmed server action; the page waits for the API response.
document.querySelector("#feedback-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const feedbackMessage = document.querySelector("#feedback-message");
  try {
    const response = await fetch("/api/feedback", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ kind: document.querySelector("#feedback-kind").value, rating: document.querySelector("#feedback-rating").value || undefined, details: document.querySelector("#feedback-details").value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    feedbackMessage.textContent = data.message;
    document.querySelector("#feedback-details").value = "";
  } catch (error) { feedbackMessage.textContent = error.message; }
});
