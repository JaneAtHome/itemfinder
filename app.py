from concurrent.futures import ThreadPoolExecutor, as_completed
from flask import Flask, render_template, request, jsonify
from scraper import search_craigslist
from markets import MARKETS
import json
import os
import time
import uuid

app = Flask(__name__)

_MARKET_LABELS = {sub: label for sub, label in MARKETS}
SEARCHES_FILE = os.path.join(os.path.dirname(__file__), "searches.json")


def _load_searches():
    if not os.path.exists(SEARCHES_FILE):
        return {}
    with open(SEARCHES_FILE) as f:
        return json.load(f)


def _save_searches(data):
    with open(SEARCHES_FILE, "w") as f:
        json.dump(data, f, indent=2)


def _validate(query, markets):
    if not query:
        return "A search query is required."
    if not markets:
        return "Select at least one market."
    if len(markets) > 3:
        return "Select at most 3 markets."
    if not all(m in _MARKET_LABELS for m in markets):
        return "One or more invalid markets."
    return None


def _run_query(query, markets):
    def fetch(market_sub):
        items = search_craigslist(query, market_sub)
        for item in items:
            item["market"] = _MARKET_LABELS[market_sub]
        return items

    results = []
    with ThreadPoolExecutor(max_workers=3) as ex:
        futures = [ex.submit(fetch, m) for m in markets]
        for future in as_completed(futures):
            results.extend(future.result())
    return results


@app.route("/")
def index():
    return render_template("index.html", markets=MARKETS)


@app.route("/search", methods=["POST"])
def search():
    query = request.form.get("query", "").strip()
    markets = request.form.getlist("markets")
    err = _validate(query, markets)
    if err:
        return jsonify({"error": err}), 400
    return jsonify({"results": _run_query(query, markets)})


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
    seen_results = body.get("seen_results") or []

    if not name:
        return jsonify({"error": "A name is required."}), 400
    err = _validate(query, markets)
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

    all_results = _run_query(saved["query"], saved["markets"])
    fresh_by_url = {r["url"]: r for r in all_results if r.get("url")}

    new_results = [r for r in all_results if r.get("url") and r["url"] not in seen_urls_before]

    # Enrich any URL-only records (migrated from old format) with fresh scrape data
    enriched_prev_seen = [
        fresh_by_url.get(r["url"], r) if r.get("url") and not r.get("title") else r
        for r in prev_seen
    ]

    # Update seen_results: merge enriched previous with new, deduplicated
    seen_by_url = {r["url"]: r for r in enriched_prev_seen if r.get("url")}
    for r in new_results:
        if r.get("url"):
            seen_by_url[r["url"]] = r

    saved.pop("seen_urls", None)  # remove old format if present
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
    })


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
