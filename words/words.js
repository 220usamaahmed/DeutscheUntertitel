// The words page: recorded words grouped by video (see src/recorder.js).

const $ = (id) => document.getElementById(id);
const CONTEXT_SEP = "␟"; // same key format as the word popup's context cache
const SORT_KEY = "dtu.words.sort";

let records = {}; // storage key -> record
const selected = new Map(); // storage key -> Set of lowercase words
const saving = new Set(); // "key\0word" being marked known
const jobs = []; // words waiting to be marked known: { key, lower }
let working = false;
const openGroups = new Set();
const groupEls = new Map(); // storage key -> <details>

(async () => {
  await Store.load({ caches: true });
  await Words.refresh();
  records = await Store.loadVideos();

  let sort = "order";
  try {
    sort = localStorage.getItem(SORT_KEY) || sort;
  } catch {}
  $("sort").value = sort;
  $("sort").addEventListener("change", () => {
    try {
      localStorage.setItem(SORT_KEY, $("sort").value);
    } catch {}
    renderAll();
  });

  // The most recently watched video starts open.
  const newest = sortedKeys()[0];
  if (newest) openGroups.add(newest);
  renderAll();

  Store.watch(async (keys) => {
    if (keys.includes("settings")) await Words.refresh();
    if (keys.some((k) => ["settings", "known", "exceptions"].includes(k))) renderAll();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const keys = Object.keys(changes).filter((k) => k.startsWith(VIDEO_PREFIX));
    if (!keys.length) return;
    for (const k of keys) {
      if (changes[k].newValue) records[k] = changes[k].newValue;
      else {
        delete records[k];
        selected.delete(k);
      }
    }
    renderAll();
  });
})();

function sortedKeys() {
  return Object.keys(records).sort((a, b) => records[b].last - records[a].last);
}

function renderAll() {
  const keys = sortedKeys();
  const main = $("groups");
  if (!keys.length) {
    groupEls.clear();
    const p = el("p", "empty muted", "No videos yet. Watch something with German captions and its words appear here.");
    main.replaceChildren(p);
    return;
  }
  for (const k of [...groupEls.keys()]) if (!records[k]) groupEls.delete(k);
  main.replaceChildren(...keys.map(renderGroup));
}

function renderGroup(key) {
  const rec = records[key];
  const details = groupEls.get(key) || el("details", "group");
  groupEls.set(key, details);
  details.open = openGroups.has(key);
  details.ontoggle = () => {
    if (details.open) openGroups.add(key);
    else openGroups.delete(key);
    if (details.open) translateGroup(key);
  };

  const entries = Object.entries(rec.words).map(([lower, e]) => ({ lower, ...e, known: Words.isKnown(e.w) }));
  const byOrder = (a, b) => a.o - b.o;
  const byCount = (a, b) => b.n - a.n || a.o - b.o;
  entries.sort($("sort").value === "frequent" ? byCount : byOrder);
  const fresh = entries.filter((e) => !e.known);
  const known = entries.filter((e) => e.known);
  const sel = selected.get(key) || new Set();
  selected.set(key, sel);
  for (const lower of sel) if (!fresh.some((e) => e.lower === lower)) sel.delete(lower);

  // Header
  const summary = el("summary");
  summary.append(el("span", "title", rec.title || rec.id));
  const site = rec.site === "youtube" ? "YouTube" : "Prime Video";
  const when = new Date(rec.last).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  summary.append(el("span", "meta", `${site} · ${when} · ${fresh.length} new · ${known.length} known`));

  // Actions
  const actions = el("div", "actions");
  const all = el("input");
  all.type = "checkbox";
  const selectable = fresh.filter((e) => !saving.has(job(key, e.lower)));
  all.checked = selectable.length > 0 && selectable.every((e) => sel.has(e.lower));
  all.disabled = !selectable.length;
  all.addEventListener("change", () => {
    for (const e of selectable) all.checked ? sel.add(e.lower) : sel.delete(e.lower);
    renderGroup(key);
  });
  const allLabel = el("label");
  allLabel.append(all, " Select all new");
  const add = el("button", "primary", sel.size ? `Add ${sel.size} to known` : "Add selected to known");
  add.disabled = !sel.size;
  add.addEventListener("click", () => addSelected(key));
  actions.append(allLabel, add, el("span", "spacer"));
  if (rec.url) {
    const a = el("a", null, "Open video");
    a.href = rec.url;
    a.target = "_blank";
    actions.append(a);
  }
  actions.append(deleteButton(key, entries.length));

  // Words
  const list = el("ul", "words");
  for (const e of fresh) list.append(renderRow(key, e, sel));
  if (known.length) {
    list.append(el("li", "known-head", "Known"));
    for (const e of known) list.append(renderRow(key, e, sel));
  }

  details.replaceChildren(summary, actions, list);
  if (details.open) translateGroup(key);
  return details;
}

function renderRow(key, e, sel) {
  const li = el("li", "row");
  li.dataset.word = e.lower;
  const isSaving = saving.has(job(key, e.lower));
  li.classList.toggle("known", e.known && !isSaving);
  li.classList.toggle("saving", isSaving);

  if (!e.known || isSaving) {
    const box = el("input");
    box.type = "checkbox";
    box.checked = sel.has(e.lower) || isSaving;
    box.disabled = isSaving;
    box.addEventListener("change", () => {
      box.checked ? sel.add(e.lower) : sel.delete(e.lower);
      renderGroup(key);
    });
    li.append(box);
  }

  const main = el("div", "main");
  const head = el("div");
  head.append(el("span", "word", e.w));
  const lemma = Store.info.peek(e.w)?.lemma;
  if (lemma && lemma.toLowerCase() !== e.lower) head.append(" ", el("span", "lemma", `→ ${lemma}`));
  const en = Store.translations.peek(e.w);
  head.append(" ", el("span", "en", en ?? "…"));
  if (e.n > 1) head.append(" ", el("span", "count", `×${e.n}`));
  if (e.c) head.append(" ", el("span", "clicked", "clicked"));
  head.append(" ", el("span", "status"));
  main.append(head, context(e.ctx, e.w));
  li.append(main);

  if (e.known && !isSaving) {
    const unmark = el("button", null, "Unmark");
    unmark.addEventListener("click", async () => {
      unmark.disabled = true;
      await Words.markUnknown(e.w, Store.info.peek(e.w) || null);
    });
    li.append(unmark);
  }
  return li;
}

// The sentence with the word highlighted.
function context(ctx = "", word) {
  const div = el("div", "ctx");
  const at = ctx.toLowerCase().indexOf(word.toLowerCase());
  if (at < 0) {
    div.textContent = ctx;
    return div;
  }
  div.append(ctx.slice(0, at), el("mark", null, ctx.slice(at, at + word.length)), ctx.slice(at + word.length));
  return div;
}

// Two clicks: the first asks, the second deletes. Reverts after a few seconds.
function deleteButton(key, count) {
  const b = el("button", null, "Delete");
  let timer = null;
  b.addEventListener("click", () => {
    if (!b.classList.contains("confirm")) {
      b.classList.add("confirm");
      b.textContent = `Delete ${count} word${count === 1 ? "" : "s"}?`;
      timer = setTimeout(() => {
        b.classList.remove("confirm");
        b.textContent = "Delete";
      }, 4000);
      return;
    }
    clearTimeout(timer);
    b.disabled = true;
    chrome.storage.local.remove(key);
  });
  return b;
}

// --- English for each word ---

let translating = false;
const toTranslate = [];

function translateGroup(key) {
  const rec = records[key];
  if (!rec || !AI.hasTranslator()) return;
  for (const e of Object.values(rec.words)) {
    if (Store.translations.peek(e.w) === undefined && !toTranslate.includes(e.w)) toTranslate.push(e.w);
  }
  runTranslations();
}

async function runTranslations() {
  if (translating) return;
  translating = true;
  try {
    while (toTranslate.length) {
      const word = toTranslate[0];
      const en = await AI.translate(word);
      toTranslate.shift();
      Store.translations.set(word, en);
      const lower = CSS.escape(word.toLowerCase());
      for (const span of document.querySelectorAll(`.row[data-word="${lower}"] .en`)) span.textContent = en;
    }
  } catch (e) {
    console.warn("[Deutsche Untertitel] translating words failed", e);
    toTranslate.length = 0;
  } finally {
    translating = false;
  }
}

// --- Marking words known ---

const job = (key, lower) => `${key}\0${lower}`;

function addSelected(key) {
  const sel = selected.get(key);
  for (const lower of sel) {
    jobs.push({ key, lower });
    saving.add(job(key, lower));
  }
  sel.clear();
  renderGroup(key);
  runJobs();
}

// One word at a time: two Gemini Nano calls each, like the word popup.
async function runJobs() {
  if (working) return;
  working = true;
  while (jobs.length) {
    const { key, lower } = jobs.shift();
    const e = records[key]?.words[lower];
    if (e) await markKnown(e.w, e.ctx || e.w);
    saving.delete(job(key, lower));
    if (records[key]) renderGroup(key);
  }
  working = false;
}

async function markKnown(word, sentence) {
  let info = Store.info.get(word) || null;
  try {
    if (!info) {
      const { meaningInContext, ...rest } = await AI.lookup(word, sentence);
      info = rest;
      Store.info.set(word, info);
      Store.context.set(word + CONTEXT_SEP + sentence, meaningInContext);
    }
    if (!info.forms) {
      info = { ...info, forms: await AI.forms(info.lemma, info.partOfSpeech) };
      Store.info.set(word, info);
    }
  } catch (e) {
    // Saved with what we have: the word as written, plus the lemma if the first call worked.
    console.warn("[Deutsche Untertitel] lookup failed", word, e);
  }
  await Words.markKnown(word, info);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
