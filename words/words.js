// The words page: recorded words by video (see src/recorder.js), and the Learning and
// Known lists. Tabs: #videos, #learning, #known.

const $ = (id) => document.getElementById(id);
const CONTEXT_SEP = "␟"; // same key format as the word popup's context cache
const LIST_LABEL = { known: "Known", learning: "Learning" };

let records = {}; // storage key -> record
const jobs = []; // { key, lower }: words put on a list that still need their lookup
let working = false;
const openGroups = new Set();
const groupEls = new Map(); // storage key -> <details>
const listState = {
  learning: { query: "", sort: pref("learning.sort", "recent") },
  known: { query: "", sort: pref("known.sort", "recent") },
};

(async () => {
  await Store.load({ caches: true });
  await Words.refresh();
  records = await Store.loadVideos();

  $("sort").value = pref("words.sort", "order");
  $("sort").addEventListener("change", () => {
    savePref("words.sort", $("sort").value);
    renderGroups();
  });
  for (const list of ["learning", "known"]) buildListView(list);

  // The most recently watched video starts open.
  const newest = sortedKeys()[0];
  if (newest) openGroups.add(newest);

  addEventListener("hashchange", showTab);
  showTab();
  renderAll();

  Store.watch(async (keys) => {
    if (keys.includes("settings")) await Words.refresh();
    if (keys.some((k) => ["settings", "known", "learning"].includes(k))) renderAll();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const keys = Object.keys(changes).filter((k) => k.startsWith(VIDEO_PREFIX));
    if (!keys.length) return;
    for (const k of keys) {
      if (changes[k].newValue) records[k] = changes[k].newValue;
      else delete records[k];
    }
    renderGroups();
    renderCounts();
  });
})();

// --- Tabs ---

function showTab() {
  const tab = ["videos", "learning", "known"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "videos";
  for (const a of document.querySelectorAll("nav a")) a.classList.toggle("on", a.dataset.tab === tab);
  for (const t of ["videos", "learning", "known"]) $(`view-${t}`).hidden = t !== tab;
}

function renderAll() {
  renderGroups();
  renderList("learning");
  renderList("known");
  renderCounts();
}

function renderCounts() {
  $("count-videos").textContent = Object.keys(records).length || "";
  $("count-learning").textContent = Object.keys(Store.learning).length || "";
  $("count-known").textContent = Object.keys(Store.known).length || "";
}

// --- Videos ---

function sortedKeys() {
  return Object.keys(records).sort((a, b) => records[b].last - records[a].last);
}

function renderGroups() {
  const keys = sortedKeys();
  for (const k of [...groupEls.keys()]) if (!records[k]) groupEls.delete(k);
  if (!keys.length) {
    $("groups").replaceChildren(
      el("p", "empty muted", "No videos yet. Watch something with German captions and its words appear here."),
    );
    return;
  }
  $("groups").replaceChildren(...keys.map(renderGroup));
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

  // Common words count as known here: they're handled, just not by you.
  const entries = Object.entries(rec.words).map(([lower, e]) => {
    return { lower, ...e, status: Words.status(e.w) || "new" };
  });
  entries.sort($("sort").value === "frequent" ? (a, b) => b.n - a.n || a.o - b.o : (a, b) => a.o - b.o);
  const fresh = entries.filter((e) => e.status === "new");
  const learning = entries.filter((e) => e.status === "learning");
  const known = entries.filter((e) => e.status === "known" || e.status === "common");

  const summary = el("summary");
  summary.append(el("span", "title", rec.title || rec.id));
  const site = rec.site === "youtube" ? "YouTube" : "Prime Video";
  const when = new Date(rec.last).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const counts = `${fresh.length} new · ${learning.length} learning · ${known.length} known`;
  summary.append(el("span", "meta", `${site} · ${when} · ${counts}`));

  const actions = el("div", "actions");
  actions.append(
    twoClick("Mark the rest as known", `Mark ${fresh.length} as known?`, !fresh.length, () => {
      putOnList(key, fresh.map((e) => e.lower), "known");
    }),
    el("span", "spacer"),
  );
  if (rec.url) {
    const a = el("a", null, "Open video");
    a.href = rec.url;
    a.target = "_blank";
    actions.append(a);
  }
  const n = entries.length;
  actions.append(twoClick("Delete", `Delete ${n} word${n === 1 ? "" : "s"}?`, false, () => chrome.storage.local.remove(key)));

  const list = el("ul", "words");
  for (const e of fresh) list.append(videoRow(key, e));
  if (learning.length) list.append(el("li", "heading", "Learning"));
  for (const e of learning) list.append(videoRow(key, e));
  if (known.length) list.append(el("li", "heading", "Known"));
  for (const e of known) list.append(videoRow(key, e));

  details.replaceChildren(summary, actions, list);
  if (details.open) translateGroup(key);
  return details;
}

function videoRow(key, e) {
  const li = el("li", `row ${e.status}`);
  li.dataset.word = e.lower;
  if (e.status !== "new") li.classList.add("handled");

  const main = el("div", "main");
  const head = el("div");
  head.append(el("span", "word", e.w));
  const lemma = Store.info.peek(e.w)?.lemma;
  if (lemma && lemma.toLowerCase() !== e.lower) head.append(" ", el("span", "lemma", `→ ${lemma}`));
  head.append(" ", el("span", "en", Store.translations.peek(e.w) ?? "…"));
  if (e.n > 1) head.append(" ", el("span", "count", `×${e.n}`));
  if (e.c) head.append(" ", el("span", "clicked", "clicked"));
  main.append(head, context(e.ctx, [e.w]));

  const buttons = el("div", "buttons");
  const info = () => Store.info.peek(e.w) || null;
  if (e.status === "new") {
    buttons.append(
      button("Known", "known", () => putOnList(key, [e.lower], "known")),
      button("Learning", "learning", () => putOnList(key, [e.lower], "learning")),
    );
  } else if (e.status === "common") {
    buttons.append(
      el("span", "note", "common word"),
      button("Learning", "learning", () => putOnList(key, [e.lower], "learning")),
    );
  } else {
    const other = e.status === "known" ? "learning" : "known";
    buttons.append(
      button(LIST_LABEL[other], other, () => {
        const found = Words.find(e.w);
        if (found) Words.move(found.lemma, other);
      }),
      button("Remove", null, () => Words.remove(e.w, info())),
    );
  }
  li.append(main, buttons);
  return li;
}

// The sentence with the first of `words` found in it (as a whole word) highlighted.
function context(ctx = "", words) {
  const div = el("div", "ctx");
  for (const w of words) {
    const m = w && new RegExp(`(?<!\\p{L})${escapeRe(w)}(?!\\p{L})`, "iu").exec(ctx);
    if (!m) continue;
    div.append(ctx.slice(0, m.index), el("mark", null, m[0]), ctx.slice(m.index + m[0].length));
    return div;
  }
  div.textContent = ctx;
  return div;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// --- English for each recorded word ---

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
      const sel = `.row[data-word="${CSS.escape(word.toLowerCase())}"] .en`;
      for (const span of document.querySelectorAll(sel)) span.textContent = en;
    }
  } catch (e) {
    console.warn("[Deutsche Untertitel] translating words failed", e);
    toTranslate.length = 0;
  } finally {
    translating = false;
  }
}

// --- Putting recorded words on a list ---

// Puts the words on the list straight away, with whatever lookup is cached, so their rows
// move at once. Words without a full lookup are then looked up one at a time in the
// background and their entries filled in (lemma, forms, meaning in context).
async function putOnList(key, lowers, list) {
  const rec = records[key];
  if (!rec) return;
  const video = { title: rec.title, url: rec.url };
  const items = [];
  for (const lower of lowers) {
    const e = rec.words[lower];
    if (!e) continue;
    const sentence = e.ctx || e.w;
    const info = Store.info.peek(e.w) || null;
    const meaning = Store.context.peek(e.w + CONTEXT_SEP + sentence);
    items.push({ word: e.w, info, extra: { en: meaning || Store.translations.peek(e.w) || "", ctx: sentence, video } });
    const complete = info?.forms && meaning !== undefined;
    if (!complete && !jobs.some((j) => j.key === key && j.lower === lower)) jobs.push({ key, lower });
  }
  await Words.addAll(list, items);
  runJobs();
}

// One word at a time: up to two Gemini Nano calls each, like the word popup.
async function runJobs() {
  if (working) return;
  working = true;
  while (jobs.length) {
    const { key, lower } = jobs.shift();
    const rec = records[key];
    const e = rec?.words[lower];
    if (e) await completeEntry(e.w, e.ctx || e.w, { title: rec.title, url: rec.url });
  }
  working = false;
}

// Looks the word up and replaces its quick entry with the full one, on whichever list
// it's on by then; nothing if it was taken off meanwhile.
async function completeEntry(word, sentence, video) {
  if (!Words.find(word)) return;
  let info = Store.info.get(word) || null;
  let en = Store.context.get(word + CONTEXT_SEP + sentence);
  try {
    if (!info || en === undefined) {
      const { meaningInContext, ...rest } = await AI.lookup(word, sentence);
      info = { ...rest, forms: info?.forms };
      en = meaningInContext;
      Store.info.set(word, info);
      Store.context.set(word + CONTEXT_SEP + sentence, meaningInContext);
    }
    if (!info.forms) {
      info = { ...info, forms: await AI.forms(info.lemma, info.partOfSpeech) };
      Store.info.set(word, info);
    }
  } catch (e) {
    // Keep what we have: the word as written, plus the lemma if the first call worked.
    console.warn("[Deutsche Untertitel] lookup failed", word, e);
    if (!info) return;
  }
  const found = Words.find(word);
  if (!found) return;
  en ||= Store.translations.peek(word) || "";
  await Words.add(found.list, word, info, { en, ctx: sentence, video });
}

// --- Learning and Known tabs ---

function buildListView(list) {
  const view = $(`view-${list}`);
  const toolbar = el("div", "toolbar");
  const search = el("input");
  search.type = "search";
  search.placeholder = "Search any form";
  search.addEventListener("input", () => {
    listState[list].query = search.value.trim().toLowerCase();
    renderList(list);
  });
  const sort = el("select");
  for (const [v, label] of [["recent", "Recently added"], ["az", "A–Z"]]) {
    const o = el("option", null, label);
    o.value = v;
    sort.append(o);
  }
  sort.value = listState[list].sort;
  sort.addEventListener("change", () => {
    listState[list].sort = sort.value;
    savePref(`${list}.sort`, sort.value);
    renderList(list);
  });
  const count = el("span", "muted");
  count.id = `${list}-count`;
  toolbar.append(search, count, el("span", "spacer"), sort);
  const ul = el("ul", "list");
  ul.id = `${list}-list`;
  view.append(toolbar, ul);
}

function renderList(list) {
  const { query, sort } = listState[list];
  const all = Object.entries(Store[list]).map(([lemma, e]) => ({ lemma, ...e }));
  const shown = all.filter((e) => !query || e.lemma.includes(query) || e.forms.some((f) => f.includes(query)));
  shown.sort(sort === "az" ? (a, b) => a.lemma.localeCompare(b.lemma, "de") : (a, b) => (b.added || 0) - (a.added || 0));
  $(`${list}-count`).textContent =
    shown.length === all.length ? `${all.length} words` : `${shown.length} of ${all.length} words`;

  const ul = $(`${list}-list`);
  if (!shown.length) {
    const text = all.length
      ? "No matches."
      : list === "learning"
        ? "No learning words yet. Use Learning in the word popup or on a video's words."
        : "No known words yet. Use Known in the word popup or on a video's words.";
    ul.replaceChildren(el("li", "empty muted", text));
    return;
  }
  ul.replaceChildren(...shown.map((e) => listRow(list, e)));
}

function listRow(list, e) {
  const li = el("li", `row ${list}`);
  const main = el("div", "main");
  const head = el("div");
  head.append(el("span", "word", e.lemma));
  const en = e.en || Store.translations.peek(e.lemma) || Store.translations.peek(capitalise(e.lemma));
  if (en) head.append(" ", el("span", "en", en));
  if (e.added) {
    const date = new Date(e.added).toLocaleDateString(undefined, { dateStyle: "medium" });
    head.append(" ", el("span", "added", `· added ${date}`));
  }
  main.append(head);
  const forms = e.forms.filter((f) => f !== e.lemma);
  if (forms.length) main.append(el("div", "forms", forms.join(", ")));
  if (e.ctx) main.append(context(e.ctx, [e.lemma, ...forms]));
  if (e.video?.title) {
    const v = el("div", "video");
    if (e.video.url) {
      const a = el("a", null, e.video.title);
      a.href = e.video.url;
      a.target = "_blank";
      v.append(a);
    } else v.textContent = e.video.title;
    main.append(v);
  }

  const other = list === "known" ? "learning" : "known";
  const buttons = el("div", "buttons");
  buttons.append(
    button(`Move to ${LIST_LABEL[other]}`, other, () => Words.move(e.lemma, other)),
    button("Remove", null, () => Words.removeEntry(list, e.lemma)),
  );
  li.append(main, buttons);
  return li;
}

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// --- Helpers ---

function button(label, cls, onClick) {
  const b = el("button", `small ${cls || ""}`.trim(), label);
  b.addEventListener("click", () => {
    b.disabled = true;
    onClick();
  });
  return b;
}

// Two clicks: the first asks, the second acts. Reverts after a few seconds.
function twoClick(label, question, disabled, onConfirm) {
  const b = el("button", null, label);
  b.disabled = disabled;
  let timer = null;
  b.addEventListener("click", () => {
    if (!b.classList.contains("confirm")) {
      b.classList.add("confirm");
      b.textContent = question;
      timer = setTimeout(() => {
        b.classList.remove("confirm");
        b.textContent = label;
      }, 4000);
      return;
    }
    clearTimeout(timer);
    b.disabled = true;
    onConfirm();
  });
  return b;
}

function pref(name, fallback) {
  try {
    return localStorage.getItem(`dtu.${name}`) || fallback;
  } catch {
    return fallback;
  }
}

function savePref(name, value) {
  try {
    localStorage.setItem(`dtu.${name}`, value);
  } catch {}
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
