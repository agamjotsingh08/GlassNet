# GlassNet backend
# This file receives scan requests, opens the website with Playwright,
# saves results in SQLite, and sends the results back to the page.

import os
import json
import socket
import ipaddress
from datetime import datetime, timezone
from urllib.parse import urlparse

from flask import Flask, jsonify, render_template, request
from flask_sqlalchemy import SQLAlchemy
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup
import tldextract

# Load values from .env before starting the app.
load_dotenv()

# Make the Flask app and connect it to a small SQLite database file.
app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "development-key")
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///glassnet.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db = SQLAlchemy(app)


# Each completed scan becomes one row in the database.
class Scan(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    url = db.Column(db.String(500), nullable=False)
    site_name = db.Column(db.String(200), nullable=False)
    score = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    result_json = db.Column(db.Text, nullable=False)

    # The history section only needs a few pieces of each saved scan.
    def short_result(self):
        saved_data = json.loads(self.result_json)
        return {
            "id": self.id,
            "url": self.url,
            "site_name": self.site_name,
            "score": self.score,
            "created_at": self.created_at.isoformat(),
            "third_parties": saved_data["summary"]["third_parties"],
            "cookies": saved_data["summary"]["cookies"],
        }


# This is a small starter list of popular web services.
# Format: domains, friendly name, category, explanation, essential, score points.
service_list = [
    (["google-analytics.com", "googletagmanager.com"], "Google Analytics", "Analytics", "Measures how visitors use the website so its owner can understand usage patterns.", False, 8),
    (["doubleclick.net", "googlesyndication.com", "googleadservices.com"], "Google Advertising", "Advertising", "Helps deliver or measure advertising and may be used across websites.", False, 12),
    (["facebook.com", "facebook.net", "connect.facebook.net"], "Meta Pixel", "Advertising", "May measure visits and advertising results for Meta services.", False, 12),
    (["stripe.com", "stripe.network"], "Stripe", "Payment", "Provides payment and fraud-prevention services.", True, 2),
    (["cloudflare.com", "cloudflare.net"], "Cloudflare", "Content delivery", "Helps deliver the website quickly and protect it from malicious traffic.", True, 1),
    (["akamai.net", "akamaized.net", "akamaihd.net"], "Akamai", "Content delivery", "Delivers website files through nearby servers for speed and reliability.", True, 1),
    (["fonts.googleapis.com", "fonts.gstatic.com"], "Google Fonts", "Website feature", "Downloads fonts used by the website's design.", True, 1),
    (["adobe.com", "adobedtm.com", "omtrdc.net"], "Adobe Experience Cloud", "Analytics", "May help the site understand audiences and personalize digital experiences.", False, 8),
    (["hotjar.com", "hotjar.io"], "Hotjar", "Behavior analytics", "May record interaction patterns such as clicks, scrolling, and page movement.", False, 10),
    (["sentry.io"], "Sentry", "Error monitoring", "Collects technical error information so developers can fix problems.", True, 2),
]


def get_main_domain(host_name):
    """Turn www.example.co.uk into example.co.uk."""
    part = tldextract.extract(host_name)
    if part.suffix:
        return part.domain + "." + part.suffix
    return part.domain


def get_service(domain_name):
    """Return a friendly description for a known domain."""
    for rule in service_list:
        domain_options, friendly_name, category, explanation, is_essential, points = rule
        for option in domain_options:
            if domain_name == option or domain_name.endswith("." + option):
                return {
                    "domain": domain_name,
                    "name": friendly_name,
                    "category": category,
                    "explanation": explanation,
                    "essential": is_essential,
                    "weight": points,
                }

    # We still show services that are not in our starter list.
    return {
        "domain": domain_name,
        "name": domain_name,
        "category": "Other third party",
        "explanation": "This outside service supplies content or functionality to the website.",
        "essential": None,
        "weight": 3,
    }


def clean_website_address(website):
    """Add https when needed and stop private-network addresses."""
    website = website.strip()
    if not website.startswith("http://") and not website.startswith("https://"):
        website = "https://" + website

    url_parts = urlparse(website)
    if url_parts.scheme not in ["http", "https"] or not url_parts.hostname:
        raise ValueError("Enter a valid public website address.")
    if url_parts.username or url_parts.password:
        raise ValueError("Website addresses containing credentials are not allowed.")
    if url_parts.port and url_parts.port not in [80, 443]:
        raise ValueError("Only standard website ports are allowed.")

    # Look up the address, then make sure it is a public internet address.
    try:
        found_addresses = socket.getaddrinfo(url_parts.hostname, url_parts.port or 443)
    except socket.gaierror as error:
        raise ValueError("That website could not be found.") from error

    for found_address in found_addresses:
        ip_address = ipaddress.ip_address(found_address[4][0])
        if not ip_address.is_global:
            raise ValueError("Only public internet websites can be scanned.")
    return website


def get_score_label(score):
    # These labels make the number easier to understand.
    if score >= 85:
        return "Low exposure"
    if score >= 65:
        return "Moderate exposure"
    if score >= 40:
        return "High exposure"
    return "Very high exposure"


def make_category_list(services):
    """Count how many services are in every category."""
    category_counts = {}
    for service in services:
        category = service["category"]
        if category not in category_counts:
            category_counts[category] = 0
        category_counts[category] += 1
    return category_counts


def make_graph(site_domain, services):
    """Create simple node and edge lists for Cytoscape.js."""
    nodes = []
    nodes.append({"data": {"id": "you", "label": "You", "kind": "person"}})
    nodes.append({"data": {"id": site_domain, "label": site_domain, "kind": "website"}})
    edges = [{"data": {"source": "you", "target": site_domain}}]

    for service in services:
        nodes.append({"data": {
            "id": service["domain"],
            "label": service["name"],
            "kind": service["category"],
            "details": service,
        }})
        edges.append({"data": {"source": site_domain, "target": service["domain"]}})
    return {"nodes": nodes, "edges": edges}


def scan_website(website):
    """Open one page and collect its observable connections and cookies."""
    site_domain = get_main_domain(urlparse(website).hostname)
    domains_found = {}
    all_cookies = []
    page_title = site_domain
    request_limit = int(os.getenv("MAX_REQUESTS", "500"))
    time_limit = int(os.getenv("SCAN_TIMEOUT_MS", "30000"))

    # Playwright opens a fresh Chromium browser. It does not log in or fill forms.
    with sync_playwright() as play:
        browser = play.chromium.launch(headless=True)
        browser_context = browser.new_context(
            user_agent="GlassNet Privacy Research Scanner/1.0",
            viewport={"width": 1280, "height": 720},
        )
        web_page = browser_context.new_page()

        # This runs every time the loaded page receives a response.
        def save_response(response):
            if len(domains_found) >= request_limit:
                return
            host_name = urlparse(response.url).hostname
            if not host_name:
                return
            domain_name = get_main_domain(host_name)
            if not domain_name:
                return
            if domain_name not in domains_found:
                domains_found[domain_name] = {"domain": domain_name, "requests": 0, "types": set()}
            domains_found[domain_name]["requests"] += 1
            domains_found[domain_name]["types"].add(response.request.resource_type)

        web_page.on("response", save_response)
        try:
            web_page.goto(website, wait_until="domcontentloaded", timeout=time_limit)
            web_page.wait_for_timeout(3500)  # Let normal page requests finish.
            page_html = web_page.content()
            page_soup = BeautifulSoup(page_html, "html.parser")
            if page_soup.title and page_soup.title.string:
                page_title = page_soup.title.string.strip()[:200]
            all_cookies = browser_context.cookies()
        finally:
            browser.close()

    first_party = []
    outside_services = []
    for domain_name in sorted(domains_found):
        saved_domain = domains_found[domain_name]
        connection = {
            "domain": domain_name,
            "requests": saved_domain["requests"],
            "types": sorted(saved_domain["types"]),
        }
        if domain_name == site_domain:
            first_party.append(connection)
        else:
            service = get_service(domain_name)
            service.update(connection)
            outside_services.append(service)

    # Cookies from a different main domain count as third-party cookies.
    outside_cookie_count = 0
    for cookie in all_cookies:
        cookie_domain = cookie.get("domain", "").lstrip(".")
        if get_main_domain(cookie_domain) != site_domain:
            outside_cookie_count += 1

    # Start from 100 and subtract small, visible reasons for exposure.
    score_penalty = 0
    for service in outside_services:
        score_penalty += service["weight"]
    score_penalty += min(len(all_cookies), 20)
    score_penalty += min(outside_cookie_count * 2, 20)
    privacy_score = max(0, 100 - min(score_penalty, 100))

    total_requests = 0
    for item in domains_found.values():
        total_requests += item["requests"]

    return {
        "url": website,
        "site_name": page_title,
        "target_domain": site_domain,
        "score": privacy_score,
        "score_label": get_score_label(privacy_score),
        "notice": "This score describes observable privacy exposure. It does not declare a site safe or unsafe.",
        "summary": {
            "requests": total_requests,
            "third_parties": len(outside_services),
            "cookies": len(all_cookies),
            "third_party_cookies": outside_cookie_count,
        },
        "categories": make_category_list(outside_services),
        "services": outside_services,
        "first_party": first_party,
        "graph": make_graph(site_domain, outside_services),
    }


# Show the main page.
@app.route("/")
def home():
    return render_template("index.html")


# Receive a website address, run the scan, then save its full result.
@app.post("/api/scans")
def create_scan():
    data_from_page = request.get_json(silent=True) or {}
    try:
        website = clean_website_address(data_from_page.get("url", ""))
        scan_result = scan_website(website)
        new_scan = Scan(
            url=website,
            site_name=scan_result["site_name"],
            score=scan_result["score"],
            result_json=json.dumps(scan_result),
        )
        db.session.add(new_scan)
        db.session.commit()
        scan_result["id"] = new_scan.id
        scan_result["created_at"] = new_scan.created_at.isoformat()
        return jsonify(scan_result), 201
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except Exception as error:
        app.logger.exception("Scan failed")
        problem = "The scan could not finish. The website may block automated browsers or be temporarily unavailable."
        details = str(error) if app.debug else None
        return jsonify({"error": problem, "detail": details}), 502


# Send the newest 30 scans to the history section.
@app.get("/api/scans")
def list_scans():
    saved_scans = Scan.query.order_by(Scan.created_at.desc()).limit(30).all()
    short_scans = []
    for saved_scan in saved_scans:
        short_scans.append(saved_scan.short_result())
    return jsonify(short_scans)


# Send one full saved scan when it is needed later.
@app.get("/api/scans/<int:scan_id>")
def get_scan(scan_id):
    saved_scan = db.get_or_404(Scan, scan_id)
    scan_result = json.loads(saved_scan.result_json)
    scan_result["id"] = saved_scan.id
    scan_result["created_at"] = saved_scan.created_at.isoformat()
    return jsonify(scan_result)


# Compare exactly two old scans from the history section.
@app.get("/api/compare")
def compare_scans():
    chosen_ids = request.args.getlist("id", type=int)
    if len(chosen_ids) != 2:
        return jsonify({"error": "Choose exactly two scans to compare."}), 400

    first_scan = db.session.get(Scan, chosen_ids[0])
    second_scan = db.session.get(Scan, chosen_ids[1])
    if not first_scan or not second_scan:
        return jsonify({"error": "One of those scans was not found."}), 404

    first_data = json.loads(first_scan.result_json)
    first_data["id"] = first_scan.id
    second_data = json.loads(second_scan.result_json)
    second_data["id"] = second_scan.id
    return jsonify([first_data, second_data])


# Create the database table automatically the first time the app starts.
with app.app_context():
    db.create_all()


if __name__ == "__main__":
    app.run(debug=True)
