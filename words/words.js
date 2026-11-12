// The words page: recorded words by video (see src/recorder.js), the Learning and Known
// lists, and practice cards for the Learning list. Tabs: #videos, #learning, #known.

const $ = (id) => document.getElementById(id);
const CONTEXT_SEP = "␟"; // same key format as the word popup's context cache
const LIST_LABEL = { known: "Known", learning: "Learning" };

let records = {}; // storage key -> record
const jobs = []; // { key, lower }: words put on a list that still need their lookup
let working = false;
const openGroups = new Set();
// The lists re-render on every storage change, including each background lookup finishing.
// A rebuilt element loses its hover, restarts its animations and undoes a collapse in
// progress, so rows and group headers are kept and reused while what they show is the same.
const groupState = new Map(); // storage key -> { details, body, list, summary, actions, headSig, rows, headings }
const listRows = { learning: new Map(), known: new Map() }; // lemma -> { li, sig }
let selected = null; // the video row the 1/2/3 keys act on: { key, lower }
let practice = null; // while practising: { current: lemma | null, flipped, answered, busy }
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
    if (keys.some((k) => ["settings", "known", "learning"].includes(k))) {
      renderAll();
      syncPractice();
    }
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
  $("practice-start").disabled = !Object.keys(Store.learning).length;
}

// --- Videos ---

function sortedKeys() {
  return Object.keys(records).sort((a, b) => records[b].last - records[a].last);
}

const noVideos = el("p", "empty muted", "No videos yet. Watch something with German captions and its words appear here.");

function renderGroups() {
  const keys = sortedKeys();
  for (const k of [...groupState.keys()]) if (!records[k]) groupState.delete(k);
  reconcile($("groups"), keys.length ? keys.map(renderGroup) : [noVideos]);
}

// A video's words in the chosen order, each with its status. Common words count as known
// here: they're handled, just not by you.
function groupEntries(key) {
  const entries = Object.entries(records[key].words).map(([lower, e]) => {
    return { lower, ...e, status: Words.status(e.w) || "new" };
  });
  entries.sort($("sort").value === "frequent" ? (a, b) => b.n - a.n || a.o - b.o : (a, b) => a.o - b.o);
  return entries;
}

function renderGroup(key) {
  const rec = records[key];
  let g = groupState.get(key);
  if (!g) {
    g = { details: el("details", "group"), body: el("div", "body"), list: el("ul", "words"), rows: new Map(), headings: new Map() };
    groupState.set(key, g);
  }
  const { details } = g;
  details.open = openGroups.has(key);
  details.ontoggle = () => {
    if (details.open) openGroups.add(key);
    else openGroups.delete(key);
    if (details.open) translateGroup(key);
  };

  const entries = groupEntries(key);
  const fresh = entries.filter((e) => e.status === "new");
  const learning = entries.filter((e) => e.status === "learning");
  const known = entries.filter((e) => e.status === "known" || e.status === "common");

  // The header and actions are rebuilt only when what they show changes, so a button
  // being hovered or waiting for its second click isn't replaced under the pointer.
  const headSig = [rec.title, rec.id, rec.site, rec.url, rec.last, fresh.length, learning.length, known.length].join("|");
  if (g.headSig !== headSig) {
    g.headSig = headSig;
    g.summary = groupSummary(rec, fresh.length, learning.length, known.length);
    g.actions = groupActions(key, rec, fresh.length, entries.length);
  }

  const items = fresh.map((e) => videoRow(g, key, e));
  if (learning.length) items.push(groupHeading(g, "Learning", learning.length));
  items.push(...learning.map((e) => videoRow(g, key, e)));
  if (known.length) items.push(groupHeading(g, "Known", known.length));
  items.push(...known.map((e) => videoRow(g, key, e)));
  if (!entries.length) items.push(el("li", "empty muted", "No words in this video."));
  for (const lower of [...g.rows.keys()]) if (!(lower in rec.words)) g.rows.delete(lower);

  reconcile(g.list, items);
  reconcile(g.body, [g.actions, g.list]);
  reconcile(details, [g.summary, g.body]);
  if (details.open) translateGroup(key);
  return details;
}

function groupSummary(rec, nFresh, nLearning, nKnown) {
  const summary = el("summary");
  const head = el("div", "head");
  head.append(el("div", "title", rec.title || rec.id));
  const site = rec.site === "youtube" ? "YouTube" : "Prime Video";
  const when = new Date(rec.last).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const meta = el("div", "meta");
  meta.append(
    `${site} · ${when}`,
    el("span", "dot", "·"),
    el("span", "badge", `${nFresh} new`),
    el("span", "badge learning", `${nLearning} learning`),
    el("span", "badge known", `${nKnown} known`),
  );
  head.append(meta);
  summary.append(icon("chevron"), head);
  return summary;
}

function groupActions(key, rec, nFresh, n) {
  const actions = el("div", "actions");
  actions.append(
    twoClick("Mark the rest as known", `Mark ${nFresh} as known?`, !nFresh, () => {
      // The words still new when it's clicked, not when the button was built.
      putOnList(key, groupEntries(key).filter((e) => e.status === "new").map((e) => e.lower), "known");
    }),
    el("span", "spacer"),
  );
  if (rec.url) {
    const a = el("a", "btn sm", "Open video");
    a.style.height = "28px";
    a.style.padding = "0 10px";
    a.style.fontSize = "12px";
    a.append(icon("external"));
    a.href = rec.url;
    a.target = "_blank";
    actions.append(a);
  }
  const del = twoClick("Delete video", `Delete ${n} word${n === 1 ? "" : "s"}?`, false, () => chrome.storage.local.remove(key));
  del.classList.add("ghost", "danger");
  actions.append(del);
  return actions;
}

// A section heading ("Learning", "Known"), kept so only its count changes.
function groupHeading(g, label, n) {
  let li = g.headings.get(label);
  if (!li) {
    li = heading(label, n);
    g.headings.set(label, li);
  }
  setText(li.lastChild, String(n));
  return li;
}

// The row for a recorded word, reused unless what it's built from changed. Its lemma and
// English arrive as lookups finish, so those are filled in place.
function videoRow(g, key, e) {
  const sig = [e.status, e.w, e.n, e.c, e.ctx].join("|");
  let cached = g.rows.get(e.lower);
  if (cached?.sig !== sig) {
    cached = { li: buildVideoRow(key, e), sig };
    g.rows.set(e.lower, cached);
  }
  cached.li.classList.toggle("selected", selected?.key === key && selected.lower === e.lower);
  const lemma = Store.info.peek(e.w)?.lemma;
  const label = lemma && lemma.toLowerCase() !== e.lower ? `→ ${lemma}` : "";
  const lemmaEl = cached.li.querySelector(".lemma");
  lemmaEl.hidden = !label;
  setText(lemmaEl, label);
  setText(cached.li.querySelector(".en"), Store.translations.peek(e.w) ?? "…");
  return cached.li;
}

function buildVideoRow(key, e) {
  const li = el("li", `row ${e.status}`);
  li.dataset.word = e.lower;
  li.dataset.key = key;
  flashWhenArrived(li, e.lower);
  if (e.status !== "new") li.classList.add("handled");

  const main = el("div", "main");
  const head = el("div", "head");
  head.append(el("span", "word", e.w), el("span", "lemma"), el("span", "en"));
  const badges = el("span", "badges");
  if (e.n > 1) badges.append(el("span", "badge", `×${e.n}`));
  if (e.c) badges.append(el("span", "badge outline", "clicked"));
  if (badges.children.length) head.append(badges);
  main.append(head, context(e.ctx, [e.w]));

  const buttons = el("div", "buttons");
  const known = () => button("Known", "known", () => assign(key, e.lower, "known"), "known", "check");
  const learning = () => button("Learning", "learning", () => assign(key, e.lower, "learning"), "learning", "book");
  if (e.status === "new") {
    buttons.append(known(), learning());
  } else if (e.status === "common") {
    buttons.append(el("span", "note", "common word"), learning());
  } else {
    const other = e.status === "known" ? "learning" : "known";
    buttons.append(
      button(LIST_LABEL[other], other, () => {
        const found = Words.find(e.w);
        if (found) arriveThen([e.lower, found.lemma.toLowerCase()], () => Words.move(found.lemma, other));
      }, other, other === "known" ? "check" : "book"),
    );
  }
  // Takes the word out of this video's list only; a word already on a list stays there.
  buttons.append(iconButton("Remove from this video", () => assign(key, e.lower, "remove"), "remove"));
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
  toolbar.append(search, count, el("span", "spacer"));
  if (list === "learning") {
    const start = plainButton("Practice", "", startPractice, "play");
    start.id = "practice-start";
    toolbar.append(start);
  }
  toolbar.append(sort);
  const ul = el("ul", "list");
  ul.id = `${list}-list`;
  view.append(toolbar, ul);
  if (list === "learning") view.append($("practice")); // after the list, in the page's order
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
  const rows = listRows[list];
  for (const lemma of [...rows.keys()]) if (!(lemma in Store[list])) rows.delete(lemma);
  reconcile(ul, shown.map((e) => cachedListRow(list, e)));
}

// The row for a list entry, reused unless what it shows changed (its practice weight isn't shown).
function cachedListRow(list, e) {
  const sig = JSON.stringify([e.forms, meaningOf(e.lemma, e), e.added, e.ctx, e.video]);
  const cached = listRows[list].get(e.lemma);
  if (cached?.sig === sig) return cached.li;
  const li = listRow(list, e);
  listRows[list].set(e.lemma, { li, sig });
  return li;
}

function listRow(list, e) {
  const li = el("li", `row ${list}`);
  flashWhenArrived(li, e.lemma.toLowerCase());
  const main = el("div", "main");
  const head = el("div", "head");
  head.append(el("span", "word", e.lemma));
  const en = meaningOf(e.lemma, e);
  if (en) head.append(el("span", "en", en));
  if (e.added) {
    const date = new Date(e.added).toLocaleDateString(undefined, { dateStyle: "medium" });
    head.append(el("span", "added", `Added ${date}`));
  }
  main.append(head);
  const forms = e.forms.filter((f) => f !== e.lemma);
  if (forms.length) main.append(el("div", "forms", forms.join(", ")));
  if (e.ctx) main.append(context(e.ctx, [e.lemma, ...forms]));
  if (e.video?.title) main.append(videoLine(e.video));

  const other = list === "known" ? "learning" : "known";
  const buttons = el("div", "buttons");
  buttons.append(
    button(
      `Move to ${LIST_LABEL[other]}`,
      other,
      () => arriveThen([e.lemma.toLowerCase()], () => Words.move(e.lemma, other)),
      other,
      other === "known" ? "check" : "book",
    ),
    iconButton("Remove from the list", () => Words.removeEntry(list, e.lemma), "remove"),
  );
  li.append(main, buttons);
  return li;
}

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// The English saved with a list entry, else a cached translation of its lemma.
function meaningOf(lemma, e) {
  return e.en || Store.translations.peek(lemma) || Store.translations.peek(capitalise(lemma)) || "";
}

// The video a word came from, linked when it has a URL.
function videoLine(video) {
  const v = el("div", "video");
  if (video.url) {
    const a = el("a", null, video.title);
    a.href = video.url;
    a.target = "_blank";
    v.append(a);
  } else v.textContent = video.title;
  return v;
}

// --- Practice ---

// One card at a time from the Learning list, drawn at random and weighted by how hard
// each word was rated (Words.pick, Words.rate). Hard and Easy change the word's weight;
// Known moves it to the Known list, so it never comes back. There's no end until the
// list is empty.

function startPractice() {
  if (!Object.keys(Store.learning).length) return;
  practice = { current: null, flipped: false, answered: 0, busy: false };
  showPractice(true);
  nextCard();
}

function stopPractice() {
  practice = null;
  showPractice(false);
}

function showPractice(on) {
  $("view-learning").querySelector(".toolbar").hidden = on;
  $("learning-list").hidden = on;
  $("practice").hidden = !on;
}

function nextCard() {
  practice.current = Words.pick(practice.current);
  practice.flipped = false;
  practice.busy = false;
  renderPractice(true);
}

// The card turns in two halves: the front spins edge-on, then the back turns in from the
// other side. FLIP_MS is one half and matches the .flip-out and .flip-in animations. The
// page ignores input while it turns.
const FLIP_MS = 160;

function flip() {
  const p = practice;
  if (!p?.current || p.flipped || p.busy) return;
  const card = $("practice").querySelector(".card.front");
  if (!card || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    p.flipped = true;
    renderPractice();
    return;
  }
  p.busy = true;
  card.classList.add("flip-out");
  setTimeout(() => {
    if (practice !== p) return;
    p.flipped = true;
    p.busy = false;
    // The word may have left Learning meanwhile (another tab): move on instead.
    if (Store.learning[p.current]) renderPractice(false, true);
    else nextCard();
  }, FLIP_MS);
}

async function answer(rating) {
  const p = practice;
  if (!p?.flipped || p.busy) return;
  p.busy = true;
  p.answered++;
  try {
    if (rating === "known") await Words.move(p.current, "known");
    else await Words.rate(p.current, rating);
  } catch (e) {
    console.warn("[Deutsche Untertitel] saving the answer failed", e);
  }
  if (practice === p) nextCard();
}

// The lists changed (this page's own save, or another tab): refresh the counter, and
// move on if the card's word is no longer on Learning.
function syncPractice() {
  if (!practice || practice.busy) return;
  const gone = practice.current && !Store.learning[practice.current];
  const revived = !practice.current && Object.keys(Store.learning).length;
  if (gone || revived) nextCard();
  else setText($("practice").querySelector(".bar .muted"), practiceCounter()); // not the card: its buttons may be hovered
}

function practiceCounter() {
  const n = Object.keys(Store.learning).length;
  return `${practice.answered} answered this sitting · ${n} word${n === 1 ? "" : "s"} in Learning`;
}

// `fresh`: a new card (fades in). `turned`: the back of a card that was just flipped.
function renderPractice(fresh = false, turned = false) {
  const bar = el("div", "bar");
  bar.append(
    plainButton("Back to list", "sm ghost", stopPractice, "back"),
    el("span", "spacer"),
    el("span", "muted", practiceCounter()),
  );

  const lemma = practice.current;
  const e = lemma && Store.learning[lemma];
  const parts = [bar];
  if (!e) {
    const done = el("div", `card done${fresh ? " fresh" : ""}`);
    done.append(el("strong", null, "All done"), el("span", "hint", "No words are left in Learning."));
    parts.push(done);
  } else {
    const shown = cardWord(lemma, e);
    const card = el("div", "card");
    card.classList.toggle("front", !practice.flipped);
    card.classList.toggle("fresh", fresh);
    card.classList.toggle("flip-in", turned);
    card.append(el("div", "word", shown));
    const answers = el("div", "answers");
    if (practice.flipped) {
      card.append(cardBack(lemma, e, shown));
      answers.append(
        plainButton("Hard", "lg hard", () => answer("hard"), null, "1"),
        plainButton("Easy", "lg", () => answer("easy"), null, "2"),
        plainButton("Known", "lg known", () => answer("known"), null, "3"),
      );
    } else {
      card.append(el("div", "hint", "Click the card or press Space to see the answer"));
      card.addEventListener("click", flip);
      answers.append(plainButton("Show answer", "lg", flip, null, "Space"));
    }
    parts.push(card, answers);
  }
  $("practice").replaceChildren(...parts);
}

// The back of a card: English, forms, the sentence the word came from, and its video.
function cardBack(lemma, e, shown) {
  const back = el("div", "back");
  const meaning = meaningOf(lemma, e);
  const canTranslate = AI.hasTranslator();
  const en = el("div", "en", meaning || (canTranslate ? "…" : "No meaning saved"));
  back.append(en);
  if (!meaning && canTranslate) translateCard(lemma, shown, en);
  const forms = e.forms.filter((f) => f !== lemma);
  if (forms.length) back.append(el("div", "forms", forms.join(", ")));
  if (e.ctx) back.append(context(e.ctx, [lemma, ...forms]));
  if (e.video?.title) back.append(videoLine(e.video));
  return back;
}

// For a word saved without its English: translate it now, and cache the result.
async function translateCard(lemma, shown, span) {
  let en = "";
  try {
    en = await AI.translate(shown);
    Store.translations.set(shown, en);
  } catch (err) {
    console.warn("[Deutsche Untertitel] translating the card failed", err);
  }
  if (practice?.current === lemma && span.isConnected) span.textContent = en || "No meaning saved";
}

// Lemmas are stored in lowercase, but German nouns are capitalised: capitalise it if a
// cached lookup of any of its forms says noun, or its saved sentence has it capitalised
// somewhere other than the start of a sentence.
function cardWord(lemma, e) {
  const isNoun = [lemma, ...e.forms].some((f) =>
    [f, capitalise(f)].some((k) => Store.info.peek(k)?.partOfSpeech === "noun"),
  );
  return isNoun || capitalisedMidSentence(lemma, e.ctx) ? capitalise(lemma) : lemma;
}

function capitalisedMidSentence(lemma, ctx = "") {
  const m = new RegExp(`(?<!\\p{L})${escapeRe(lemma)}(?!\\p{L})`, "iu").exec(ctx);
  if (!m || !/^\p{Lu}/u.test(m[0])) return false;
  const before = ctx.slice(0, m.index).trimEnd();
  return Boolean(before) && !/[.!?…:]["“”„»«']*$/.test(before);
}

// Space or Enter flips the card; 1/2/3 or H/E/K answer Hard/Easy/Known.
addEventListener("keydown", (ev) => {
  if (!practice?.current || practice.busy || $("view-learning").hidden) return;
  if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.target.closest?.("input, select, textarea")) return;
  const key = ev.key.toLowerCase();
  if (key === " " || key === "enter") {
    if (ev.target.closest?.("button, a, summary")) return; // the focused control acts on its own
    ev.preventDefault();
    flip();
    return;
  }
  const rating = { 1: "hard", h: "hard", 2: "easy", e: "easy", 3: "known", k: "known" }[key];
  if (rating && practice.flipped) {
    ev.preventDefault();
    answer(rating);
  }
});

// --- Quick assign: click a video row to select it, then 1 Known, 2 Learning, 3 Remove ---

const selectedRow = (s) => groupState.get(s.key)?.rows.get(s.lower)?.li;

function select(key, lower, scroll = true) {
  const prev = selected;
  selected = key ? { key, lower } : null;
  if (prev) selectedRow(prev)?.classList.remove("selected");
  const li = selected && selectedRow(selected);
  if (!li) return;
  li.classList.add("selected");
  if (scroll) li.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// The row after this one; a row still new only moves on to other new rows.
function nextRow(row) {
  const fresh = !row.classList.contains("handled");
  for (let n = row.nextElementSibling; n; n = n.nextElementSibling) {
    if (n.matches(".row:not(.leaving)") && !(fresh && n.classList.contains("handled"))) return n;
  }
  return null;
}

// Known, Learning or Remove (from this video's list) for a recorded word. If its row is
// the selected one, selection moves to the next row straight away, so keys can be pressed
// in quick succession.
async function assign(key, lower, kind) {
  const rec = records[key];
  const e = rec?.words[lower];
  if (!e) return;
  const row = selectedRow({ key, lower });
  const status = Words.status(e.w);
  const already = (kind === "known" && (status === "known" || status === "common")) || kind === status;
  if (selected?.key === key && selected.lower === lower) {
    const next = row && nextRow(row);
    if (next) select(next.dataset.key, next.dataset.word, false);
    else select(null);
  }
  if (already) return;
  if (row) await leaveRow(row, kind);
  if (selected) selectedRow(selected)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (kind === "remove") {
    delete rec.words[lower];
    await chrome.storage.local.set({ [key]: rec });
  } else {
    arriveThen([lower], () => putOnList(key, [lower], kind));
  }
}

$("groups").addEventListener("click", (ev) => {
  const row = ev.target.closest(".row");
  if (!row?.dataset.key || ev.target.closest("button, a, summary")) return;
  select(row.dataset.key, row.dataset.word);
});

addEventListener("keydown", (ev) => {
  if (!selected || $("view-videos").hidden) return;
  if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.target.closest?.("input, select, textarea")) return;
  const kind = { 1: "known", 2: "learning", 3: "remove" }[ev.key];
  if (!kind) return;
  ev.preventDefault();
  assign(selected.key, selected.lower, kind);
});

function plainButton(label, cls, onClick, iconName, key) {
  const b = el("button", cls);
  if (iconName) b.append(icon(iconName));
  b.append(label);
  if (key) b.append(el("kbd", null, key));
  b.addEventListener("click", onClick);
  return b;
}

// --- Helpers ---

// A row action. The row animates out first (`leave` is where it's heading: known,
// learning or remove), then the action runs and the lists re-render.
function button(label, cls, onClick, leave, iconName) {
  const b = el("button", `sm ${cls || ""}`.trim());
  if (iconName) b.append(icon(iconName));
  b.append(label);
  b.addEventListener("click", async () => {
    b.disabled = true;
    const row = b.closest(".row");
    if (row) await leaveRow(row, leave);
    onClick();
  });
  return b;
}

// A cross-style row action with no text.
function iconButton(title, onClick, leave, iconName = "x") {
  const b = button("", "ghost danger icon", onClick, leave, iconName);
  b.title = title;
  b.setAttribute("aria-label", title);
  return b;
}

// Words (lowercase) whose rows should flash when they next render in their new place.
const arrived = new Set();
function arriveThen(lowers, fn) {
  for (const l of lowers) arrived.add(l);
  setTimeout(() => arrived.clear(), 2500);
  return fn();
}

// A row built while its word is in `arrived` flashes once, then drops the class.
function flashWhenArrived(li, lower) {
  if (!arrived.has(lower)) return;
  li.classList.add("arrived");
  li.addEventListener("animationend", () => li.classList.remove("arrived"), { once: true });
}

// Makes `parent`'s children exactly `nodes`, in order, moving or adding only what's out of
// place. replaceChildren would pull every node out and put it back, which drops hover and
// restarts animations on rows that didn't change.
function reconcile(parent, nodes) {
  const keep = new Set(nodes);
  for (const child of [...parent.children]) if (!keep.has(child)) child.remove();
  let next = parent.firstElementChild;
  for (const node of nodes) {
    if (node === next) next = next.nextElementSibling;
    else parent.insertBefore(node, next);
  }
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function leaveRow(row, to) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
  row.style.height = `${row.offsetHeight}px`;
  row.offsetHeight; // commit the explicit height so it can transition to 0
  row.classList.add("leaving", `to-${to}`);
  return new Promise((resolve) => {
    row.addEventListener("transitionend", (ev) => ev.propertyName === "height" && resolve(), { once: false });
    setTimeout(resolve, 350);
  });
}

function heading(label, n) {
  const li = el("li", "heading", label);
  li.append(el("span", "badge", String(n)));
  return li;
}

const ICONS = {
  chevron: "m9 18 6-6-6-6",
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18M6 6l12 12",
  external: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  play: "M6 3l14 9-14 9z",
  back: "m12 19-7-7 7-7M19 12H5",
  book: "M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z",
};
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", `icon ${name === "chevron" ? "chev" : ""}`.trim());
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}

// Two clicks: the first asks, the second acts. Reverts after a few seconds.
function twoClick(label, question, disabled, onConfirm) {
  const b = el("button", "sm", label);
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
