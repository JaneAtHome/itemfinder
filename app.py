from concurrent.futures import ThreadPoolExecutor, as_completed
from flask import Flask, render_template, request, jsonify
from scraper import search_craigslist
from markets import MARKETS
from nlp_query import process_query
from db import load_searches as _load_searches, save_searches as _save_searches

CATEGORIES = [
    ("sss", "All for sale"),
    ("atq", "Antiques"),
    ("app", "Appliances"),
    ("art", "Arts & crafts"),
    ("bab", "Baby & kids"),
    ("bik", "Bicycles"),
    ("boo", "Books"),
    ("bfs", "Business"),
    ("cta", "Cars & trucks"),
    ("mob", "Cell phones"),
    ("clo", "Clothing"),
    ("clt", "Collectibles"),
    ("sys", "Computers"),
    ("ele", "Electronics"),
    ("zip", "Free"),
    ("fua", "Furniture"),
    ("for", "General"),
    ("hsh", "Household"),
    ("jwl", "Jewelry"),
    ("mca", "Motorcycles"),
    ("msg", "Musical instruments"),
    ("pho", "Photo & video"),
    ("spo", "Sporting goods"),
    ("tls", "Tools"),
    ("tag", "Toys & games"),
    ("vgm", "Video gaming"),
]

_CATEGORY_KEYS = {sub for sub, _ in CATEGORIES}
_CATEGORY_LABELS = {sub: label for sub, label in CATEGORIES}
import os
import time
import uuid

app = Flask(__name__)

_MARKET_LABELS = {sub: label for sub, label in MARKETS}


def _validate(query, markets, categories=None):
    if not query:
        return "A search query is required."
    if not markets:
        return "Select at least one market."
    if len(markets) > 6:
        return "Select at most 6 markets."
    if not all(m in _MARKET_LABELS for m in markets):
        return "One or more invalid markets."
    if categories:
        if len(categories) > 5:
            return "Select at most 5 categories."
        if not all(c in _CATEGORY_KEYS for c in categories):
            return "One or more invalid categories."
    return None


def _run_query(queries, markets, categories=None):
    """queries may be a single string or a list of strings."""
    if isinstance(queries, str):
        queries = [queries]
    queries = list(dict.fromkeys(q.strip() for q in queries if q.strip()))
    if not categories:
        categories = ["sss"]
    if isinstance(categories, str):
        categories = [categories]

    def fetch(market_sub, query, category):
        items = search_craigslist(query, market_sub, category)
        for item in items:
            item["market"] = _MARKET_LABELS[market_sub]
        return items

    seen_urls = set()
    results = []
    with ThreadPoolExecutor(max_workers=max(3, len(markets) * len(queries) * len(categories))) as ex:
        futures = [ex.submit(fetch, m, q, cat) for m in markets for q in queries for cat in categories]
        for future in as_completed(futures):
            for item in future.result():
                url = item.get("url")
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    results.append(item)
                elif not url:
                    results.append(item)
    return results


@app.route("/")
def index():
    return render_template("index.html", markets=MARKETS, categories=CATEGORIES)


@app.route("/search", methods=["POST"])
def search():
    query = request.form.get("query", "").strip()
    markets = request.form.getlist("markets")
    categories = request.form.getlist("categories") or ["sss"]
    err = _validate(query, markets, categories)
    if err:
        return jsonify({"error": err}), 400
    parsed = process_query(query)
    results = _run_query(parsed["queries"], markets, categories)
    return jsonify({"results": results, "interpretation": parsed.get("display")})


@app.route("/searches", methods=["GET"])
def list_searches():
    data = _load_searches()
    # Don't send seen_urls to the frontend — they can be large
    return jsonify([{k: v for k, v in s.items() if k != "seen_urls"} for s in data.values()])


@app.route("/searches", methods=["POST"])
def save_search():
    body = request.get_json()
    name = (body.get("name") or "").strip()
    query = (body.get("query") or "").strip()
    markets = body.get("markets") or []
    categories = body.get("categories") or ["sss"]
    if isinstance(categories, str):
        categories = [categories]
    seen_results = body.get("seen_results") or []

    if not name:
        return jsonify({"error": "A name is required."}), 400
    err = _validate(query, markets, categories)
    if err:
        return jsonify({"error": err}), 400

    # Deduplicate by URL, preserving full result objects
    seen_by_url = {r["url"]: r for r in seen_results if r.get("url")}

    data = _load_searches()
    search_id = str(uuid.uuid4())
    now = int(time.time())
    data[search_id] = {
        "id": search_id,
        "name": name,
        "query": query,
        "markets": markets,
        "categories": categories,
        "seen_results": list(seen_by_url.values()),
        "created_at": now,
        "last_run": now,
    }
    _save_searches(data)
    return jsonify({k: v for k, v in data[search_id].items() if k != "seen_results"}), 201


@app.route("/searches/<search_id>/run", methods=["POST"])
def run_search(search_id):
    data = _load_searches()
    if search_id not in data:
        return jsonify({"error": "Saved search not found."}), 404

    saved = data[search_id]

    # Support old format (seen_urls) and new format (seen_results)
    prev_seen = saved.get("seen_results") or []
    if not prev_seen and saved.get("seen_urls"):
        # Migrate: old format had only URLs, no full data
        prev_seen = [{"url": u} for u in saved["seen_urls"]]
    seen_urls_before = {r["url"] for r in prev_seen if r.get("url")}

    # Support old format (category string) and new format (categories list)
    categories = saved.get("categories") or saved.get("category") or ["sss"]
    if isinstance(categories, str):
        categories = [categories]

    parsed = process_query(saved["query"])
    all_results = _run_query(parsed["queries"], saved["markets"], categories)
    fresh_by_url = {r["url"]: r for r in all_results if r.get("url")}

    new_results = [r for r in all_results if r.get("url") and r["url"] not in seen_urls_before]

    # Enrich any URL-only records (migrated from old format) with fresh scrape data
    enriched_prev_seen = [
        fresh_by_url.get(r["url"], r) if r.get("url") and not r.get("title") else r
        for r in prev_seen
    ]

    # Persist only the enriched previous-seen list; new results are added
    # incrementally via POST /searches/<id>/seen as the user pages through them.
    seen_by_url = {r["url"]: r for r in enriched_prev_seen if r.get("url")}

    saved.pop("seen_urls", None)  # remove old format if present
    saved.pop("category", None)   # migrate old single-category field
    saved["categories"] = categories
    saved["seen_results"] = list(seen_by_url.values())
    saved["last_run"] = int(time.time())
    data[search_id] = saved
    _save_searches(data)

    # Only return previously seen items that have displayable data
    displayable_prev_seen = [r for r in enriched_prev_seen if r.get("title")]

    return jsonify({
        "results": new_results,
        "seen_results": displayable_prev_seen,
        "total_found": len(all_results),
        "search": {k: v for k, v in saved.items() if k != "seen_results"},
        "interpretation": parsed.get("display"),
    })


@app.route("/searches/<search_id>/seen", methods=["POST"])
def mark_seen(search_id):
    """Mark a subset of results as seen for a saved search."""
    data = _load_searches()
    if search_id not in data:
        return jsonify({"error": "Saved search not found."}), 404
    body = request.get_json()
    new_seen = body.get("results") or []
    saved = data[search_id]
    existing = saved.get("seen_results") or []
    seen_by_url = {r["url"]: r for r in existing if r.get("url")}
    for r in new_seen:
        if r.get("url"):
            seen_by_url[r["url"]] = r
    saved["seen_results"] = list(seen_by_url.values())
    data[search_id] = saved
    _save_searches(data)
    return jsonify({"ok": True})


@app.route("/searches/<search_id>", methods=["DELETE"])
def delete_search(search_id):
    data = _load_searches()
    if search_id not in data:
        return jsonify({"error": "Saved search not found."}), 404
    del data[search_id]
    _save_searches(data)
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(debug=True)
