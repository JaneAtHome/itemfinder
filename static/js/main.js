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
const filterToggle = document.getElementById("filter-toggle");
const filterBody = document.getElementById("filter-body");
const saveBar = document.getElementById("save-bar");
const saveNameInput = document.getElementById("save-name");
const saveBtn = document.getElementById("save-btn");
const savedList = document.getElementById("saved-list");
const savedEmpty = document.getElementById("saved-empty");
const seenToggleBar = document.getElementById("seen-toggle-bar");
const seenToggleBtn = document.getElementById("seen-toggle-btn");
const delayMsg = document.getElementById("delay-msg");
const interpretationMsg = document.getElementById("interpretation-msg");
const paginationEl = document.getElementById("pagination");
const prevPageBtn = document.getElementById("prev-page");
const nextPageBtn = document.getElementById("next-page");
const pageInfoEl = document.getElementById("page-info");

const MAX_MARKETS = 6;
const MAX_CATEGORIES = 5;
const PAGE_SIZE = 20;
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
let currentCategories = [];
let isSavedSearch = false;
let currentSavedSearch = null;
let lastSearchTime = 0;
let filteredResults = [];
let currentPage = 1;
let viewedUrls = new Set();

const SEARCH_DELAY_MS = 10000;

async function waitForDelay(statusEl) {
  const elapsed = Date.now() - lastSearchTime;
  const remaining = SEARCH_DELAY_MS - elapsed;
  if (remaining <= 0) return;
  for (let ms = remaining; ms > 0; ms -= 1000) {
    const secs = Math.ceil(ms / 1000);
    statusEl.textContent = `Waiting ${secs}s to avoid getting rate-limited by Craigslist…`;
    statusEl.hidden = false;
    await new Promise((r) => setTimeout(r, Math.min(1000, ms)));
  }
  statusEl.hidden = true;
  statusEl.textContent = "";
}

// === Market selector ===
const marketSearch = document.getElementById("market-search");
const marketAutocomplete = document.getElementById("market-autocomplete");
const marketChipsEl = document.getElementById("market-chips");
const marketListToggle = document.getElementById("market-list-toggle");

// Build label lookup from rendered checkboxes
const marketLabelMap = {};
Array.from(marketsList.querySelectorAll("input[type=checkbox]")).forEach((cb) => {
  marketLabelMap[cb.value] = cb.closest("label").textContent.trim();
});

function syncMarketUI() {
  const checkboxes = Array.from(marketsList.querySelectorAll("input[type=checkbox]"));
  const checked = checkboxes.filter((cb) => cb.checked);
  marketCountEl.textContent = `${checked.length} / ${MAX_MARKETS} selected`;
  marketCountEl.classList.toggle("at-max", checked.length >= MAX_MARKETS);
  if (checked.length >= MAX_MARKETS) {
    checkboxes.forEach((cb) => { if (!cb.checked) cb.disabled = true; });
  } else {
    checkboxes.forEach((cb) => (cb.disabled = false));
  }
  // Re-render chips
  marketChipsEl.innerHTML = "";
  checked.forEach((cb) => {
    const chip = document.createElement("span");
    chip.className = "market-chip";
    chip.innerHTML = `${escapeHtml(marketLabelMap[cb.value])}<button type="button" data-value="${escapeHtml(cb.value)}" aria-label="Remove ${escapeHtml(marketLabelMap[cb.value])}">×</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      cb.checked = false;
      syncMarketUI();
    });
    marketChipsEl.appendChild(chip);
  });
  // Disable search input when at max
  marketSearch.disabled = checked.length >= MAX_MARKETS;
  marketSearch.placeholder = checked.length >= MAX_MARKETS
    ? "Max markets selected"
    : "Type a city or market name…";
}

function selectMarket(subdomain) {
  const cb = Array.from(marketsList.querySelectorAll("input[type=checkbox]"))
    .find((c) => c.value === subdomain);
  if (!cb || cb.checked || cb.disabled) return;
  cb.checked = true;
  syncMarketUI();
  marketSearch.value = "";
  marketAutocomplete.hidden = true;
  acHighlight = -1;
  marketSearch.focus();
}

let acHighlight = -1;

function updateAutocomplete() {
  const q = marketSearch.value.trim().toLowerCase();
  marketAutocomplete.innerHTML = "";
  acHighlight = -1;
  if (!q) { marketAutocomplete.hidden = true; return; }

  const checkedValues = new Set(
    Array.from(marketsList.querySelectorAll("input[type=checkbox]:checked")).map((cb) => cb.value)
  );
  const matches = Object.entries(marketLabelMap)
    .filter(([sub, label]) =>
      !checkedValues.has(sub) &&
      (label.toLowerCase().includes(q) || sub.toLowerCase().includes(q))
    )
    .slice(0, 8);

  if (!matches.length) { marketAutocomplete.hidden = true; return; }

  matches.forEach(([sub, label]) => {
    const li = document.createElement("li");
    li.textContent = label;
    li.dataset.value = sub;
    li.addEventListener("mousedown", (e) => { e.preventDefault(); selectMarket(sub); });
    marketAutocomplete.appendChild(li);
  });
  marketAutocomplete.hidden = false;
}

marketSearch.addEventListener("input", updateAutocomplete);

marketSearch.addEventListener("keydown", (e) => {
  const items = Array.from(marketAutocomplete.querySelectorAll("li"));
  if (e.key === "ArrowDown") {
    e.preventDefault();
    acHighlight = Math.min(acHighlight + 1, items.length - 1);
    items.forEach((li, i) => li.classList.toggle("ac-highlight", i === acHighlight));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    acHighlight = Math.max(acHighlight - 1, 0);
    items.forEach((li, i) => li.classList.toggle("ac-highlight", i === acHighlight));
  } else if (e.key === "Enter") {
    e.preventDefault();
    const target = acHighlight >= 0 ? items[acHighlight] : items[0];
    if (target) selectMarket(target.dataset.value);
  } else if (e.key === "Escape") {
    marketAutocomplete.hidden = true;
    acHighlight = -1;
  }
});

marketSearch.addEventListener("blur", () => {
  setTimeout(() => { marketAutocomplete.hidden = true; acHighlight = -1; }, 150);
});

marketListToggle.addEventListener("click", () => {
  const isHidden = marketsList.hidden;
  marketsList.hidden = !isHidden;
  marketListToggle.textContent = isHidden ? "Hide list" : "Choose from a list";
});

marketsList.addEventListener("change", syncMarketUI);

// === Category selector ===
const categoriesList = document.getElementById("categories-list");
const categoryCountEl = document.getElementById("category-count");
const categorySearch = document.getElementById("category-search");
const categoryAutocomplete = document.getElementById("category-autocomplete");
const categoryChipsEl = document.getElementById("category-chips");
const categoryListToggle = document.getElementById("category-list-toggle");

const catLabelMap = {};
Array.from(categoriesList.querySelectorAll("input[type=checkbox]")).forEach((cb) => {
  catLabelMap[cb.value] = cb.closest("label").textContent.trim();
});

function syncCategoryUI() {
  const checkboxes = Array.from(categoriesList.querySelectorAll("input[type=checkbox]"));
  const checked = checkboxes.filter((cb) => cb.checked);
  categoryCountEl.textContent = `${checked.length} / ${MAX_CATEGORIES} selected`;
  categoryCountEl.classList.toggle("at-max", checked.length >= MAX_CATEGORIES);
  if (checked.length >= MAX_CATEGORIES) {
    checkboxes.forEach((cb) => { if (!cb.checked) cb.disabled = true; });
  } else {
    checkboxes.forEach((cb) => (cb.disabled = false));
  }
  categoryChipsEl.innerHTML = "";
  checked.forEach((cb) => {
    const chip = document.createElement("span");
    chip.className = "market-chip";
    chip.innerHTML = `${escapeHtml(catLabelMap[cb.value])}<button type="button" data-value="${escapeHtml(cb.value)}" aria-label="Remove ${escapeHtml(catLabelMap[cb.value])}">×</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      cb.checked = false;
      syncCategoryUI();
    });
    categoryChipsEl.appendChild(chip);
  });
  categorySearch.disabled = checked.length >= MAX_CATEGORIES;
  categorySearch.placeholder = checked.length >= MAX_CATEGORIES
    ? "Max categories selected"
    : "Type a category name…";
}

function selectCategory(subdomain) {
  const cb = Array.from(categoriesList.querySelectorAll("input[type=checkbox]"))
    .find((c) => c.value === subdomain);
  if (!cb || cb.checked || cb.disabled) return;
  cb.checked = true;
  syncCategoryUI();
  categorySearch.value = "";
  categoryAutocomplete.hidden = true;
  catAcHighlight = -1;
  categorySearch.focus();
}

let catAcHighlight = -1;

function updateCategoryAutocomplete() {
  const q = categorySearch.value.trim().toLowerCase();
  categoryAutocomplete.innerHTML = "";
  catAcHighlight = -1;
  if (!q) { categoryAutocomplete.hidden = true; return; }

  const checkedValues = new Set(
    Array.from(categoriesList.querySelectorAll("input[type=checkbox]:checked")).map((cb) => cb.value)
  );
  const matches = Object.entries(catLabelMap)
    .filter(([sub, label]) =>
      !checkedValues.has(sub) &&
      (label.toLowerCase().includes(q) || sub.toLowerCase().includes(q))
    )
    .slice(0, 8);

  if (!matches.length) { categoryAutocomplete.hidden = true; return; }

  matches.forEach(([sub, label]) => {
    const li = document.createElement("li");
    li.textContent = label;
    li.dataset.value = sub;
    li.addEventListener("mousedown", (e) => { e.preventDefault(); selectCategory(sub); });
    categoryAutocomplete.appendChild(li);
  });
  categoryAutocomplete.hidden = false;
}

categorySearch.addEventListener("input", updateCategoryAutocomplete);

categorySearch.addEventListener("keydown", (e) => {
  const items = Array.from(categoryAutocomplete.querySelectorAll("li"));
  if (e.key === "ArrowDown") {
    e.preventDefault();
    catAcHighlight = Math.min(catAcHighlight + 1, items.length - 1);
    items.forEach((li, i) => li.classList.toggle("ac-highlight", i === catAcHighlight));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    catAcHighlight = Math.max(catAcHighlight - 1, 0);
    items.forEach((li, i) => li.classList.toggle("ac-highlight", i === catAcHighlight));
  } else if (e.key === "Enter") {
    e.preventDefault();
    const target = catAcHighlight >= 0 ? items[catAcHighlight] : items[0];
    if (target) selectCategory(target.dataset.value);
  } else if (e.key === "Escape") {
    categoryAutocomplete.hidden = true;
    catAcHighlight = -1;
  }
});

categorySearch.addEventListener("blur", () => {
  setTimeout(() => { categoryAutocomplete.hidden = true; catAcHighlight = -1; }, 150);
});

categoryListToggle.addEventListener("click", () => {
  const isHidden = categoriesList.hidden;
  categoriesList.hidden = !isHidden;
  categoryListToggle.textContent = isHidden ? "Hide list" : "Choose from a list";
});

categoriesList.addEventListener("change", syncCategoryUI);

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
  currentCategories = Array.from(categoriesList.querySelectorAll("input[type=checkbox]:checked")).map((cb) => cb.value);
  if (currentCategories.length === 0) currentCategories = ["sss"];
  submitBtn.disabled = true;
  submitBtn.textContent = "Searching…";

  try {
    await waitForDelay(delayMsg);
    const response = await fetch("/search", { method: "POST", body: new FormData(form) });
    lastSearchTime = Date.now();
    const data = await response.json();
    if (!response.ok || data.error) { showError(data.error || "An unexpected error occurred."); return; }
    if (data.results.length === 0) { showError("No listings found. Try a different query or market."); return; }

    allResults = data.results;
    showInterpretation(data.interpretation || null);
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
        categories: currentCategories,
        seen_results: allResults.filter((r) => r.url && viewedUrls.has(r.url)),
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
filterToggle.addEventListener("click", () => {
  const open = filterBody.hidden;
  filterBody.hidden = !open;
  filterToggle.classList.toggle("open", open);
});

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
          <span>${escapeHtml(savedCategoryLabel(s))}</span>
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
    await waitForDelay(delayMsg);
    const response = await fetch(`/searches/${encodeURIComponent(id)}/run`, { method: "POST" });
    lastSearchTime = Date.now();
    const data = await response.json();
    if (!response.ok || data.error) { showError(data.error || "Failed to run saved search."); return; }

    currentSavedSearch = data.search;
    freshResults = data.results;
    seenResults = (data.seen_results || []).map((r) => ({ ...r, _seen: true }));
    showSeen = false;
    allResults = freshResults;
    showInterpretation(data.interpretation || null);
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
  const markets = [...new Set(allResults.map((r) => r.market).filter(Boolean))].sort();
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
        case "location": return dir * (a.location || "").localeCompare(b.location || "");
        case "market": return dir * a.market.localeCompare(b.market);
        default: return 0;
      }
    });
  }

  filteredResults = results;
  currentPage = 1;
  filterSortBar.hidden = allResults.length === 0;
  const visibleMarkets = new Set(results.map((r) => r.market).filter(Boolean));
  marketFilterRow.hidden = visibleMarkets.size <= 1;
  updateSortArrows();
  renderPage();
}

function updateSortArrows() {
  document.querySelectorAll("#results-table th[data-col]").forEach((th) => {
    th.querySelector(".sort-arrow").textContent =
      th.dataset.col === sortCol ? (sortDir === "asc" ? " ▲" : " ▼") : "";
  });
}

function renderPage() {
  const totalAll = allResults.length;
  const totalFiltered = filteredResults.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  currentPage = Math.max(1, Math.min(currentPage, totalPages));
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filteredResults.slice(start, start + PAGE_SIZE);

  // Result count text
  if (isSavedSearch && currentSavedSearch) {
    if (totalAll === 0) {
      resultCount.innerHTML = `No new listings for <strong>${escapeHtml(currentSavedSearch.name)}</strong> since last run.`;
    } else {
      const n = totalFiltered === totalAll ? `${totalAll}` : `${totalFiltered} of ${totalAll}`;
      resultCount.innerHTML = `${n} new listing${totalAll !== 1 ? "s" : ""} for <strong>${escapeHtml(currentSavedSearch.name)}</strong>`;
    }
  } else {
    resultCount.textContent = totalFiltered === totalAll
      ? `${totalAll} listing${totalAll !== 1 ? "s" : ""} found`
      : `${totalFiltered} of ${totalAll} listing${totalAll !== 1 ? "s" : ""} shown`;
  }

  // Render rows for this page
  resultsBody.innerHTML = "";
  pageItems.forEach((item) => {
    const tr = document.createElement("tr");
    if (item._seen) tr.classList.add("row-seen");
    const dateTitle = item.date_ts
      ? new Date(item.date_ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "";
    const thumbHtml = item.thumb
      ? `<img src="${escapeHtml(item.thumb)}" alt="" class="result-thumb" loading="lazy" />`
      : `<div class="result-thumb result-thumb--empty"></div>`;
    tr.innerHTML = `
      <td class="col-thumb">${thumbHtml}</td>
      <td class="col-title"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></td>
      <td class="col-price">${escapeHtml(item.price)}</td>
      <td class="col-date" title="${escapeHtml(dateTitle)}">${escapeHtml(formatAge(item.date_ts)) || "—"}</td>
      <td class="col-location">${escapeHtml(item.location || "")}</td>
      <td class="col-market">${escapeHtml(item.market || "")}</td>
    `;
    resultsBody.appendChild(tr);
  });

  renderPagination(totalFiltered, totalPages);
  markPageViewed(pageItems);
}

function renderPagination(total, totalPages) {
  prevPageBtn.hidden = currentPage <= 1;
  nextPageBtn.hidden = currentPage >= totalPages;
  if (totalPages <= 1) { paginationEl.hidden = true; return; }
  paginationEl.hidden = false;
  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, total);
  pageInfoEl.textContent = `${start}–${end} of ${total}`;
}

function markPageViewed(items) {
  const fresh = items.filter((r) => r.url && !r._seen && !viewedUrls.has(r.url));
  fresh.forEach((r) => viewedUrls.add(r.url));
  if (isSavedSearch && currentSavedSearch && fresh.length > 0) {
    fetch(`/searches/${encodeURIComponent(currentSavedSearch.id)}/seen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ results: fresh }),
    }).catch(() => {});
  }
}

// === Helpers ===
function savedCategoryLabel(s) {
  const cats = s.categories || (s.category ? [s.category] : ["sss"]);
  if (cats.length === 1 && cats[0] === "sss") return "all for sale";
  return cats.map((c) => catLabelMap[c] || c).join(", ");
}

function resetResultsUI() {
  resultsSection.hidden = true;
  errorMsg.hidden = true;
  interpretationMsg.hidden = true;
  interpretationMsg.textContent = "";
  resultsBody.innerHTML = "";
  priceFilter.value = "";
  ageFilter.value = "";
  marketFilterChips.innerHTML = "";
  marketFilterRow.hidden = true;
  filterSortBar.hidden = false;
  filterBody.hidden = true;
  filterToggle.classList.remove("open");
  seenToggleBar.hidden = true;
  paginationEl.hidden = true;
  sortCol = null;
  sortDir = "asc";
  allResults = [];
  freshResults = [];
  seenResults = [];
  filteredResults = [];
  currentPage = 1;
  viewedUrls = new Set();
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

function showInterpretation(message) {
  if (message) {
    interpretationMsg.textContent = message;
    interpretationMsg.hidden = false;
  } else {
    interpretationMsg.hidden = true;
    interpretationMsg.textContent = "";
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// === Pagination ===
prevPageBtn.addEventListener("click", () => {
  if (currentPage > 1) { currentPage--; renderPage(); window.scrollTo({ top: resultsSection.offsetTop - 16, behavior: "smooth" }); }
});
nextPageBtn.addEventListener("click", () => {
  const totalPages = Math.ceil(filteredResults.length / PAGE_SIZE);
  if (currentPage < totalPages) { currentPage++; renderPage(); window.scrollTo({ top: resultsSection.offsetTop - 16, behavior: "smooth" }); }
});

// === Init ===
syncMarketUI();
syncCategoryUI();
loadSavedSearches();
