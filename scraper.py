import requests

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}


def search_craigslist(query: str, market: str) -> list[dict]:
    """
    Search a Craigslist market using the jsonsearch API.
    Returns a list of dicts with 'title', 'price', 'url', and 'date'.
    """
    url = f"https://{market}.craigslist.org/jsonsearch/sss"
    params = {"query": query}

    try:
        response = requests.get(url, params=params, headers=HEADERS, timeout=10)
        response.raise_for_status()
        data = response.json()
    except requests.RequestException as e:
        return [{"error": str(e)}]
    except ValueError:
        return [{"error": "Unexpected response from Craigslist."}]

    # The API returns a list where the first element is the array of listings
    listings = data[0] if data and isinstance(data[0], list) else []

    results = []
    for item in listings:
        title = item.get("PostingTitle", "")
        url = item.get("PostingURL", "")
        if not title or not url:
            continue

        price_raw = item.get("price", "")
        price_num = float(price_raw) if isinstance(price_raw, (int, float)) else None
        price = f"${price_raw}" if isinstance(price_raw, (int, float)) else (price_raw or "N/A")
        date_ts = item.get("PostedDate", None)

        results.append({
            "title": title,
            "price": price,
            "price_num": price_num,
            "url": url,
            "date_ts": date_ts,
        })

    return results
