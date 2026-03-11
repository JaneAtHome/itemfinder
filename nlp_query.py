"""
Natural-language query processor.

Uses spaCy (en_core_web_sm) to extract the core item noun phrase from a
free-text query, and regex to detect dimensional/measurement constraints
(e.g. "at least 65 inches", "under 30 lbs").

Returns a list of 1–2 Craigslist-optimised search strings plus a short
human-readable interpretation string.
"""

import re

# ---------------------------------------------------------------------------
# spaCy — lazy-loaded so the model doesn't block app startup
# ---------------------------------------------------------------------------

_nlp = None


def _get_nlp():
    global _nlp
    if _nlp is None:
        import spacy
        try:
            _nlp = spacy.load("en_core_web_sm")
        except OSError:
            from spacy.cli import download as _dl
            _dl("en_core_web_sm")
            _nlp = spacy.load("en_core_web_sm")
    return _nlp


# ---------------------------------------------------------------------------
# Measurement patterns
# ---------------------------------------------------------------------------

_UNIT_PAT = (
    r"(?:inches?|feet|foot|ft|cm|centimeters?|meters?|pounds?|lbs?|kg|kilograms?|ounces?|oz)"
)

# (regex for comparison phrase, display symbol, step direction)
_COMPARISONS = [
    # Multi-word phrases first (more specific)
    (r"at\s+least",        "≥", +1),
    (r"no\s+less\s+than",  "≥", +1),
    (r"minimum\s+of",      "≥", +1),
    (r"more\s+than",       ">", +1),
    (r"taller\s+than",     ">", +1),
    (r"bigger\s+than",     ">", +1),
    (r"longer\s+than",     ">", +1),
    (r"heavier\s+than",    ">", +1),
    (r"at\s+most",         "≤", -1),
    (r"no\s+more\s+than",  "≤", -1),
    (r"maximum\s+of",      "≤", -1),
    (r"less\s+than",       "<", -1),
    (r"shorter\s+than",    "<", -1),
    (r"smaller\s+than",    "<", -1),
    (r"lighter\s+than",    "<", -1),
    # Standalone comparatives (used after a value, e.g. "30 lbs or lighter")
    (r"\bheavier\b",       "≥", +1),
    (r"\btaller\b",        "≥", +1),
    (r"\bbigger\b",        "≥", +1),
    (r"\blonger\b",        "≥", +1),
    (r"\blarger\b",        "≥", +1),
    (r"\blighter\b",       "≤", -1),
    (r"\bshorter\b",       "≤", -1),
    (r"\bsmaller\b",       "≤", -1),
    # Single-word phrases
    (r"\bminimum\b",       "≥", +1),
    (r"\bmaximum\b",       "≤", -1),
    (r"\bover\b",          ">", +1),
    (r"\bunder\b",         "<", -1),
]

_UNIT_NORM = {
    "inch": "inch", "inches": "inch",
    "feet": "ft", "foot": "ft", "ft": "ft",
    "cm": "cm", "centimeter": "cm", "centimeters": "cm",
    "meter": "m", "meters": "m",
    "pound": "lb", "pounds": "lb", "lb": "lb", "lbs": "lb",
    "kg": "kg", "kilogram": "kg", "kilograms": "kg",
    "ounce": "oz", "ounces": "oz", "oz": "oz",
}

_UNIT_DISP = {
    "inch": "in", "ft": "ft", "cm": "cm", "m": "m",
    "lb": "lb", "kg": "kg", "oz": "oz",
}

# How far to step for the secondary query
_STEP = {
    "inch": 5, "ft": 1, "cm": 15, "m": 1,
    "lb": 10, "kg": 5, "oz": 8,
}

# Adjectives that describe size/condition — strip from the item phrase
_STRIP_WORDS = {
    "tall", "taller", "wide", "wider", "long", "longer", "short", "shorter",
    "high", "higher", "deep", "deeper", "large", "larger", "small", "smaller",
    "big", "bigger", "heavy", "heavier", "light", "lighter", "thick", "thicker",
    "thin", "thinner", "good", "great", "nice", "clean", "working", "functional",
    "used", "new", "old", "gently", "or",
}

# Basic English stop words for the no-spaCy fallback
_STOP_WORDS = {
    "a", "an", "the", "that", "this", "which", "is", "are", "was", "were",
    "be", "been", "being", "for", "of", "to", "in", "on", "at", "by", "with",
    "and", "or", "i", "me", "my", "want", "need", "looking", "find", "search",
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def process_query(raw: str) -> dict:
    """
    Parse a natural-language search query.

    Returns:
        {
            "queries":  [str, ...],   # 1–2 Craigslist search strings
            "display":  str | None,   # human-readable interpretation, or None
        }
    """
    text = raw.strip()
    dim = _find_dimension(text)

    if dim is None:
        return {"queries": [text], "display": None}

    value, unit_norm, unit_disp, op_sym, direction, span_start, span_end = dim

    # Remove the matched span from the original text
    clean = (text[:span_start] + " " + text[span_end:]).strip()
    clean = re.sub(r"\s+", " ", clean).strip()

    item = _extract_item(clean)
    if not item or len(item) < 2:
        return {"queries": [text], "display": None}

    val_int = int(value)
    queries = [f"{item} {val_int} {unit_disp}"]

    if direction != 0:
        step = _STEP.get(unit_norm, 5)
        alt = max(1, val_int + direction * step)
        queries.append(f"{item} {alt} {unit_disp}")

    if op_sym == "=":
        display = f"Interpreted as: {item} ({val_int} {unit_disp})"
    else:
        display = f"Interpreted as: {item} ({op_sym}{val_int} {unit_disp})"

    return {"queries": queries, "display": display}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _find_dimension(text: str):
    """
    Scan for a measurement constraint.
    Returns (value, unit_norm, unit_disp, op_sym, direction, start, end) or None.
    """
    lower = text.lower()

    # Pattern A: [comparison] [number] [unit]
    for cmp_pat, op_sym, direction in _COMPARISONS:
        m = re.search(
            rf"(?:{cmp_pat})\s+(\d+(?:\.\d+)?)\s*({_UNIT_PAT})",
            lower,
        )
        if m:
            value = float(m.group(1))
            unit = m.group(2)
            norm = _UNIT_NORM.get(unit, unit)
            return (value, norm, _UNIT_DISP.get(norm, unit),
                    op_sym, direction, m.start(), m.end())

    # Pattern B: [number] [unit] [comparison]  e.g. "65 inches or taller"
    for cmp_pat, op_sym, direction in _COMPARISONS:
        m = re.search(
            rf"(\d+(?:\.\d+)?)\s*({_UNIT_PAT})\s+(?:or\s+)?(?:{cmp_pat})",
            lower,
        )
        if m:
            value = float(m.group(1))
            unit = m.group(2)
            norm = _UNIT_NORM.get(unit, unit)
            return (value, norm, _UNIT_DISP.get(norm, unit),
                    op_sym, direction, m.start(), m.end())

    # Pattern C: bare [number] [unit] — no explicit comparison
    m = re.search(rf"(\d+(?:\.\d+)?)\s*({_UNIT_PAT})", lower)
    if m:
        value = float(m.group(1))
        unit = m.group(2)
        norm = _UNIT_NORM.get(unit, unit)
        return (value, norm, _UNIT_DISP.get(norm, unit),
                "=", 0, m.start(), m.end())

    return None


def _extract_item(text: str) -> str:
    """
    Return the core item phrase from text, stripping size/condition adjectives.
    Falls back to simple stop-word removal if spaCy is unavailable.
    """
    try:
        return _extract_item_spacy(text)
    except Exception:
        return _extract_item_simple(text)


def _extract_item_spacy(text: str) -> str:
    doc = _get_nlp()(text)
    for chunk in doc.noun_chunks:
        words = chunk.text.split()
        while words and words[-1].lower() in _STRIP_WORDS:
            words.pop()
        while words and words[0].lower() in _STRIP_WORDS:
            words.pop(0)
        phrase = " ".join(words).strip()
        if phrase:
            return phrase
    # Fallback within spaCy: non-stop, non-punct tokens
    tokens = [
        t.text for t in doc
        if not t.is_stop and not t.is_punct and t.text.lower() not in _STRIP_WORDS
    ]
    return " ".join(tokens) if tokens else text.strip()


def _extract_item_simple(text: str) -> str:
    words = [
        w for w in text.lower().split()
        if w not in _STOP_WORDS and w not in _STRIP_WORDS
    ]
    return " ".join(words)
