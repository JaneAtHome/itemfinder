"""
Run this directly to inspect exactly what the scraper fetches and parses.
Usage: python debug_scraper.py <query> [market]
"""
import sys
import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}

query = sys.argv[1] if len(sys.argv) > 1 else "bike"
market = sys.argv[2] if len(sys.argv) > 2 else "sfbay"

url = f"https://{market}.craigslist.org/search/sss"
params = {"query": query, "sort": "rel"}

print(f"\n--- REQUEST ---")
print(f"URL    : {url}")
print(f"Params : {params}")
print(f"Full   : {requests.Request('GET', url, params=params).prepare().url}")

response = requests.get(url, params=params, headers=HEADERS, timeout=10)
print(f"\n--- RESPONSE ---")
print(f"Status : {response.status_code}")
print(f"Final URL (after redirects): {response.url}")
print(f"Content-Type: {response.headers.get('Content-Type')}")
print(f"Body size: {len(response.text)} chars")

soup = BeautifulSoup(response.text, "html.parser")

print(f"\n--- HTML STRUCTURE SAMPLE (first 3000 chars) ---")
print(response.text[:3000])

print(f"\n--- SELECTOR PROBE ---")
selectors = [
    "li.cl-static-search-result",
    "li.result-row",
    ".cl-search-result",
    "[data-pid]",
    ".posting-title",
    "a.titlestring",
]
for sel in selectors:
    found = soup.select(sel)
    print(f"  {sel!r:45s} -> {len(found)} match(es)")

print(f"\n--- PARSED RESULTS ---")
items = soup.select("li.cl-static-search-result")
if not items:
    print("No items matched 'li.cl-static-search-result' — scraper would return empty.")
else:
    for i, item in enumerate(items[:5]):
        title_el = item.select_one(".title")
        price_el = item.select_one(".price")
        link_el  = item.select_one("a")
        date_el  = item.select_one(".date")
        print(f"\n  [{i+1}]")
        print(f"    title : {title_el.get_text(strip=True) if title_el else '(none)'}")
        print(f"    price : {price_el.get_text(strip=True) if price_el else '(none)'}")
        print(f"    url   : {link_el.get('href') if link_el else '(none)'}")
        print(f"    date  : {date_el.get_text(strip=True) if date_el else '(none)'}")
