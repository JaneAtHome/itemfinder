import re
import requests

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}


def _location_from_url(posting_url: str, title: str) -> str:
    """
    Extract city/town from the Craigslist URL slug.
    Slug format: {city-slug}-{title-slug}/{id}.html
    Strategy: walk slug words; stop when we hit a word from the title (>= 4 chars).
    Cap at 2 words to avoid false positives.
    """
    try:
        slug = posting_url.rstrip("/").split("/")[-2]
        slug_words = slug.split("-")
        title_words = {
            w for w in re.sub(r"[^a-z0-9 ]", "", title.lower()).split()
            if len(w) >= 4
        }
        city_words = []
        for word in slug_words[:3]:
            if len(city_words) == 2 or word in title_words:
                break
            city_words.append(word)
        return " ".join(w.capitalize() for w in city_words) if city_words else ""
    except Exception:
        return ""


def search_craigslist(query: str, market: str, category: str = "sss") -> list[dict]:
    """
    Search a Craigslist market using the jsonsearch API.
    Returns a list of dicts with 'title', 'price', 'url', and 'date'.
    """
    url = f"https://{market}.craigslist.org/jsonsearch/{category}"
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

        location = _location_from_url(url, title)

        results.append({
            "title": title,
            "price": price,
            "price_num": price_num,
            "url": url,
            "date_ts": date_ts,
            "thumb": item.get("ImageThumb", ""),
            "location": location,
        })

    return results
