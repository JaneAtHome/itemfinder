// === DOM refs ===
const form = document.getElementById("search-form");
const submitBtn = document.getElementById("submit-btn");
const resultsSection = document.getElementById("results-section");
const resultsBody = document.getElementById("results-body");
const resultCount = document.getElementById("result-count");
const errorMsg = document.getElementById("error-msg");
const marketsList = document.getElementById("markets-list");
const marketCountEl = document.getElementById("market-count");
const priceFilter = document.getElementById("price-filter");
const ageFilter = document.getElementById("age-filter");
const marketFilterChips = document.getElementById("market-filter-chips");
const marketFilterRow = document.getElementById("market-filter-row");
const filterSortBar = document.getElementById("filter-sort-bar");
const saveBar = document.getElementById("save-bar");
const saveNameInput = document.getElementById("save-name");
const saveBtn = document.getElementById("save-btn");
const savedList = document.getElementById("saved-list");
const savedEmpty = document.getElementById("saved-empty");
const seenToggleBar = document.getElementById("seen-toggle-bar");
const seenToggleBtn = document.getElementById("seen-toggle-btn");

const MAX_MARKETS = 3;
const PRICE_MAX = [0, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const AGE_MAX_DAYS = [1, 2, 3, 7, 14, 30, 60, 90, 180, 365];

let allResults = [];    // what's currently being filtered/sorted/rendered
let freshResults = [];  // new results from last saved-search run
let seenResults = [];   // previously seen results from last saved-search run
let showSeen = false;
let sortCol = null;
let sortDir = "asc";
let currentQuery = "";
let currentMarkets = [];
let isSavedSearch = false;
let currentSavedSearch = null;

// === Market selector ===
marketsList.addEventListener("change", () => {
  const checkboxes = Array.from(marketsList.querySelectorAll("input[type=checkbox]"));
  const checked = checkboxes.filter((cb) => cb.checked);
  marketCountEl.textContent = `${checked.length} / ${MAX_MARKETS} selected`;
  marketCountEl.classList.toggle("at-max", checked.length === MAX_MARKETS);
  if (checked.length >= MAX_MARKETS) {
    checkboxes.forEach((cb) => { if (!cb.checked) cb.disabled = true; });
  } else {
    checkboxes.forEach((cb) => (cb.disabled = false));
  }
});

// === New search ===
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const checked = marketsList.querySelectorAll("input[type=checkbox]:checked");
  if (checked.length === 0) {
    showError("Select at least one market.");
    return;
  }

  resetResultsUI();
  isSavedSearch = false;
  currentSavedSearch = null;
  currentQuery = document.getElementById("query").value.trim();
  currentMarkets = Array.from(checked).map((cb) => cb.value);
  submitBtn.disabled = true;
  submitBtn.textContent = "Searching…";

  try {
    const response = await fetch("/search", { method: "POST", body: new FormData(form) });
    const data = await response.json();
    if (!response.ok || data.error) { showError(data.error || "An unexpected error occurred."); return; }
    if (data.results.length === 0) { showError("No listings found. Try a different query or market."); return; }

    allResults = data.results;
    buildMarketFilter();
    applyFilters();
    resultsSection.hidden = false;
    saveBar.hidden = false;
    saveNameInput.value = "";
    saveNameInput.disabled = false;
    saveBtn.textContent = "Save";
    saveBtn.disabled = false;
  } catch {
    showError("Failed to reach the server. Please try again.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Search";
  }
});

// === Save search ===
saveBtn.addEventListener("click", async () => {
  const name = saveNameInput.value.trim();
  if (!name) { saveNameInput.focus(); return; }
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  try {
    const response = await fetch("/searches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        query: currentQuery,
        markets: currentMarkets,
        seen_results: allResults.filter((r) => r.url),
      }),
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      showError(data.error || "Failed to save search.");
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
      return;
    }
    saveBtn.textContent = "Saved ✓";
    saveNameInput.disabled = true;
    loadSavedSearches();
  } catch {
    showError("Failed to save search.");
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
  }
});

// === Previously seen toggle ===
seenToggleBtn.addEventListener("click", () => {
  showSeen = !showSeen;
  allResults = showSeen ? [...freshResults, ...seenResults] : freshResults;
  buildMarketFilter();
  applyFilters();
  updateSeenToggle();
});

function updateSeenToggle() {
  if (!isSavedSearch || seenResults.length === 0) {
    seenToggleBar.hidden = true;
    return;
  }
  seenToggleBar.hidden = false;
  seenToggleBtn.textContent = showSeen
    ? "Hide previously seen"
    : `Show ${seenResults.length} previously seen`;
}

// === Filters & sort ===
[priceFilter, ageFilter].forEach((el) => el.addEventListener("change", applyFilters));

document.querySelectorAll("#results-table th[data-col]").forEach((th) => {
  th.addEventListener("click", () => {
    const col = th.dataset.col;
    if (sortCol === col) {
      sortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
      sortCol = col;
      sortDir = col === "date" ? "desc" : "asc";
    }
    applyFilters();
  });
});

// === Saved searches ===
async function loadSavedSearches() {
  try {
    const response = await fetch("/searches");
    renderSavedSearches(await response.json());
  } catch { /* silently ignore */ }
}

function renderSavedSearches(searches) {
  savedList.innerHTML = "";
  if (searches.length === 0) {
    savedList.appendChild(savedEmpty);
    savedEmpty.hidden = false;
    return;
  }
  savedEmpty.hidden = true;
  searches.forEach((s) => {
    const lastRunText = s.last_run
      ? new Date(s.last_run * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "Never";
    const card = document.createElement("div");
    card.className = "saved-card";
    card.dataset.id = s.id;
    card.innerHTML = `
      <div class="saved-card-body">
        <div class="saved-card-name">${escapeHtml(s.name)}</div>
        <div class="saved-card-meta">
          <span>"${escapeHtml(s.query)}"</span>
          <span class="sep">·</span>
          <span>${escapeHtml(s.markets.join(", "))}</span>
          <span class="sep">·</span>
          <span>Last run ${escapeHtml(lastRunText)}</span>
        </div>
      </div>
      <div class="saved-card-actions">
        <button class="saved-run-btn" data-id="${escapeHtml(s.id)}">Run</button>
        <button class="saved-delete-btn" data-id="${escapeHtml(s.id)}" title="Delete">×</button>
      </div>
    `;
    savedList.appendChild(card);
  });
  savedList.querySelectorAll(".saved-run-btn").forEach((btn) =>
    btn.addEventListener("click", () => runSavedSearch(btn.dataset.id))
  );
  savedList.querySelectorAll(".saved-delete-btn").forEach((btn) =>
    btn.addEventListener("click", () => deleteSavedSearch(btn.dataset.id))
  );
}

async function runSavedSearch(id) {
  const card = savedList.querySelector(`.saved-card[data-id="${id}"]`);
  const runBtn = card?.querySelector(".saved-run-btn");
  if (runBtn) { runBtn.disabled = true; runBtn.textContent = "Running…"; }

  resetResultsUI();
  isSavedSearch = true;
  currentSavedSearch = null;

  try {
    const response = await fetch(`/searches/${encodeURIComponent(id)}/run`, { method: "POST" });
    const data = await response.json();
    if (!response.ok || data.error) { showError(data.error || "Failed to run saved search."); return; }

    currentSavedSearch = data.search;
    freshResults = data.results;
    seenResults = (data.seen_results || []).map((r) => ({ ...r, _seen: true }));
    showSeen = false;
    allResults = freshResults;
    buildMarketFilter();
    applyFilters();
    updateSeenToggle();
    resultsSection.hidden = false;
    saveBar.hidden = true;
  } catch {
    showError("Failed to reach the server. Please try again.");
  } finally {
    if (runBtn) { runBtn.disabled = false; runBtn.textContent = "Run"; }
    loadSavedSearches();
  }
}

async function deleteSavedSearch(id) {
  try {
    const response = await fetch(`/searches/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json();
      showError(data.error || "Failed to delete.");
      return;
    }
    loadSavedSearches();
  } catch {
    showError("Failed to delete saved search.");
  }
}

// === Core filter/sort/render ===
function buildMarketFilter() {
  marketFilterChips.innerHTML = "";
  const markets = [...new Set(allResults.map((r) => r.market))].sort();
  if (markets.length <= 1) { marketFilterRow.hidden = true; return; }
  markets.forEach((market) => {
    const label = document.createElement("label");
    label.className = "filter-chip";
    label.innerHTML = `<input type="checkbox" checked value="${escapeHtml(market)}" /> ${escapeHtml(market)}`;
    label.querySelector("input").addEventListener("change", applyFilters);
    marketFilterChips.appendChild(label);
  });
  marketFilterRow.hidden = false;
}

function applyFilters() {
  const priceBucketIdx = priceFilter.value !== "" ? parseInt(priceFilter.value) : null;
  const ageBucketIdx = ageFilter.value !== "" ? parseInt(ageFilter.value) : null;
  const marketChips = marketFilterChips.querySelectorAll("input[type=checkbox]");
  const selectedMarkets = marketChips.length === 0
    ? null
    : new Set(Array.from(marketChips).filter((cb) => cb.checked).map((cb) => cb.value));

  let results = allResults.filter((item) => {
    if (selectedMarkets && !selectedMarkets.has(item.market)) return false;
    if (priceBucketIdx !== null) {
      if (item.price_num == null || item.price_num > PRICE_MAX[priceBucketIdx]) return false;
    }
    if (ageBucketIdx !== null) {
      if (!item.date_ts) return false;
      if ((Date.now() / 1000 - item.date_ts) / 86400 > AGE_MAX_DAYS[ageBucketIdx]) return false;
    }
    return true;
  });

  if (sortCol) {
    const dir = sortDir === "asc" ? 1 : -1;
    results = [...results].sort((a, b) => {
      switch (sortCol) {
        case "title":  return dir * a.title.toLowerCase().localeCompare(b.title.toLowerCase());
        case "price":
          if (a.price_num == null && b.price_num == null) return 0;
          if (a.price_num == null) return 1;
          if (b.price_num == null) return -1;
          return dir * (a.price_num - b.price_num);
        case "date":
          if (!a.date_ts && !b.date_ts) return 0;
          if (!a.date_ts) return 1;
          if (!b.date_ts) return -1;
          return dir * (a.date_ts - b.date_ts);
        case "market": return dir * a.market.localeCompare(b.market);
        default: return 0;
      }
    });
  }

  filterSortBar.hidden = allResults.length === 0;
  updateSortArrows();
  renderResults(results);
}

function updateSortArrows() {
  document.querySelectorAll("#results-table th[data-col]").forEach((th) => {
    th.querySelector(".sort-arrow").textContent =
      th.dataset.col === sortCol ? (sortDir === "asc" ? " ▲" : " ▼") : "";
  });
}

function renderResults(results) {
  const total = allResults.length;
  const shown = results.length;

  if (isSavedSearch && currentSavedSearch) {
    if (total === 0) {
      resultCount.innerHTML = `No new listings for <strong>${escapeHtml(currentSavedSearch.name)}</strong> since last run.`;
    } else {
      const n = shown === total ? `${total}` : `${shown} of ${total}`;
      resultCount.innerHTML = `${n} new listing${total !== 1 ? "s" : ""} for <strong>${escapeHtml(currentSavedSearch.name)}</strong>`;
    }
  } else {
    resultCount.textContent = shown === total
      ? `${total} listing${total !== 1 ? "s" : ""} found`
      : `${shown} of ${total} listing${total !== 1 ? "s" : ""} shown`;
  }

  resultsBody.innerHTML = "";
  results.forEach((item) => {
    const tr = document.createElement("tr");
    if (item._seen) tr.classList.add("row-seen");
    const dateTitle = item.date_ts
      ? new Date(item.date_ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "";
    tr.innerHTML = `
      <td class="col-title"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></td>
      <td class="col-price">${escapeHtml(item.price)}</td>
      <td class="col-date" title="${escapeHtml(dateTitle)}">${escapeHtml(formatAge(item.date_ts)) || "—"}</td>
      <td class="col-market">${escapeHtml(item.market)}</td>
    `;
    resultsBody.appendChild(tr);
  });
}

// === Helpers ===
function resetResultsUI() {
  resultsSection.hidden = true;
  errorMsg.hidden = true;
  resultsBody.innerHTML = "";
  priceFilter.value = "";
  ageFilter.value = "";
  marketFilterChips.innerHTML = "";
  marketFilterRow.hidden = true;
  filterSortBar.hidden = false;
  seenToggleBar.hidden = true;
  sortCol = null;
  sortDir = "asc";
  allResults = [];
  freshResults = [];
  seenResults = [];
  showSeen = false;
  updateSortArrows();
}

function formatAge(date_ts) {
  if (!date_ts) return "";
  const daysAgo = (Date.now() / 1000 - date_ts) / 86400;
  if (daysAgo < 1) return "today";
  if (daysAgo < 2) return "yesterday";
  const days = Math.floor(daysAgo);
  if (daysAgo < 8) return `${days} days ago`;
  const weeks = Math.floor(daysAgo / 7);
  if (daysAgo < 30) return `${weeks} week${weeks !== 1 ? "s" : ""} ago`;
  const months = Math.floor(daysAgo / 30);
  if (daysAgo < 365) return `${months} month${months !== 1 ? "s" : ""} ago`;
  const years = Math.floor(daysAgo / 365);
  return `${years} year${years !== 1 ? "s" : ""} ago`;
}

function showError(message) {
  errorMsg.textContent = message;
  errorMsg.hidden = false;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// === Init ===
loadSavedSearches();
