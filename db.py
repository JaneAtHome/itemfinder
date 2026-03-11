"""
Storage layer.
- PostgreSQL when DATABASE_URL env var is set (production on Render).
- JSON flat file otherwise (local development).
"""
import json
import os

SEARCHES_FILE = os.path.join(os.path.dirname(__file__), "searches.json")

_DATABASE_URL = os.environ.get("DATABASE_URL", "")
# Render exposes postgres:// but psycopg2 requires postgresql://
if _DATABASE_URL.startswith("postgres://"):
    _DATABASE_URL = _DATABASE_URL.replace("postgres://", "postgresql://", 1)

_db_ready = False


def _get_conn():
    import psycopg2
    return psycopg2.connect(_DATABASE_URL)


def _ensure_table():
    global _db_ready
    if _db_ready:
        return
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS searches (
                    id          TEXT PRIMARY KEY,
                    name        TEXT NOT NULL,
                    query       TEXT NOT NULL,
                    markets     JSONB NOT NULL DEFAULT '[]',
                    categories  JSONB NOT NULL DEFAULT '["sss"]',
                    seen_results JSONB NOT NULL DEFAULT '[]',
                    created_at  INTEGER NOT NULL,
                    last_run    INTEGER NOT NULL
                )
            """)
        conn.commit()
    _db_ready = True


# ---------------------------------------------------------------------------
# Public API (mirrors the old _load_searches / _save_searches interface)
# ---------------------------------------------------------------------------

def load_searches() -> dict:
    if not _DATABASE_URL:
        return _load_json()
    _ensure_table()
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, query, markets, categories, seen_results, "
                "created_at, last_run FROM searches ORDER BY created_at DESC"
            )
            rows = cur.fetchall()
    result = {}
    for row in rows:
        sid, name, query, markets, categories, seen_results, created_at, last_run = row
        result[sid] = {
            "id": sid,
            "name": name,
            "query": query,
            "markets": markets,
            "categories": categories,
            "seen_results": seen_results,
            "created_at": created_at,
            "last_run": last_run,
        }
    return result


def save_searches(data: dict):
    if not _DATABASE_URL:
        _save_json(data)
        return
    _ensure_table()
    with _get_conn() as conn:
        with conn.cursor() as cur:
            # Remove deleted searches
            cur.execute("SELECT id FROM searches")
            existing = {row[0] for row in cur.fetchall()}
            for removed in existing - set(data.keys()):
                cur.execute("DELETE FROM searches WHERE id = %s", (removed,))
            # Upsert current searches
            for s in data.values():
                cur.execute("""
                    INSERT INTO searches
                        (id, name, query, markets, categories, seen_results, created_at, last_run)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        name         = EXCLUDED.name,
                        query        = EXCLUDED.query,
                        markets      = EXCLUDED.markets,
                        categories   = EXCLUDED.categories,
                        seen_results = EXCLUDED.seen_results,
                        created_at   = EXCLUDED.created_at,
                        last_run     = EXCLUDED.last_run
                """, (
                    s["id"], s["name"], s["query"],
                    json.dumps(s.get("markets", [])),
                    json.dumps(s.get("categories", ["sss"])),
                    json.dumps(s.get("seen_results", [])),
                    s["created_at"], s["last_run"],
                ))
        conn.commit()


# ---------------------------------------------------------------------------
# JSON fallback (local dev)
# ---------------------------------------------------------------------------

def _load_json() -> dict:
    if not os.path.exists(SEARCHES_FILE):
        return {}
    with open(SEARCHES_FILE) as f:
        return json.load(f)


def _save_json(data: dict):
    with open(SEARCHES_FILE, "w") as f:
        json.dump(data, f, indent=2)
