// Tokenising subtitle lines and deciding which list a word is on.

const LIST_FILES = {
  articles: "lists/articles.json",
  prepositions: "lists/prepositions.json",
  pronouns: "lists/pronouns.json",
  top: "lists/top2000.json",
};

// Practice weights (see Words.rate): a Learning word without one counts as `start`.
const WEIGHT = { start: 4, min: 1, max: 16 };

const Words = {
  segmenter: new Intl.Segmenter("de", { granularity: "word" }),
  builtIn: new Set(), // common words: the enabled built-in lists
  knownForms: new Set(),
  learningForms: new Set(),
  _files: {},

  // Rebuild the built-in set from the enabled lists and the personal sets from Store.
  async refresh() {
    const { lists, topN } = Store.settings;
    const builtIn = new Set();
    for (const [name, path] of Object.entries(LIST_FILES)) {
      if (!lists[name]) continue;
      let words = await this._loadList(path);
      if (name === "top") words = words.slice(0, topN);
      for (const w of words) builtIn.add(w.toLowerCase());
    }
    this.builtIn = builtIn;
    this.refreshPersonal();
  },

  refreshPersonal() {
    const forms = (list) => new Set(Object.values(list).flatMap((e) => e.forms));
    this.knownForms = forms(Store.known);
    this.learningForms = forms(Store.learning);
  },

  async _loadList(path) {
    if (!this._files[path]) {
      this._files[path] = fetch(chrome.runtime.getURL(path))
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []);
    }
    return this._files[path];
  },

  // [{ text, isWord }] for one line. Numbers and punctuation are not words.
  tokenize(line) {
    return [...this.segmenter.segment(line)].map((s) => ({
      text: s.segment,
      isWord: Boolean(s.isWordLike) && /\p{L}/u.test(s.segment),
    }));
  },

  // "learning" | "known" | "common" | null. Matches the word as written, or its lemma
  // if a popup lookup cached one. Learning wins, then Known, then the built-in lists.
  status(word) {
    const w = word.toLowerCase();
    // A common word (die, zu) isn't matched through its lemma: the lookup sometimes gives
    // the lemma of the noun after it ("die Beschädigung"), which would colour every "die".
    const lemma = this.builtIn.has(w) ? undefined : Store.info.peek(word)?.lemma?.toLowerCase();
    const has = (set) => set.has(w) || Boolean(lemma && set.has(lemma));
    if (has(this.learningForms)) return "learning";
    if (has(this.knownForms)) return "known";
    if (this.builtIn.has(w)) return "common";
    return null;
  },

  // The list entry the word belongs to: { list, lemma }, or null.
  find(word) {
    const w = word.toLowerCase();
    const lemma = Store.info.peek(word)?.lemma?.toLowerCase();
    for (const list of ["learning", "known"]) {
      for (const [key, e] of Object.entries(Store[list])) {
        if (key === w || key === lemma || e.forms.includes(w)) return { list, lemma: key };
      }
    }
    return null;
  },

  // Whether single-word mode hides the word's translation until hover.
  hides(word) {
    const s = this.status(word);
    return s === "known" || s === "common";
  },

  // Puts the word on "known" or "learning", taking it off the other list.
  // `info` is the Prompt API lookup (lemma, forms), or null if it failed.
  // `extra`: { en, ctx, video: { title, url } }; ctx and video are kept for Learning.
  async add(list, word, info, extra = {}) {
    await this.addAll(list, [{ word, info, extra }]);
  },

  // Several add()s with one save: [{ word, info, extra }].
  async addAll(list, items) {
    for (const { word, info, extra = {} } of items) {
      const { lemma, forms } = entryFor(word, info);
      const dropped = this._drop(word, lemma);
      const entry = { forms, en: extra.en || "", added: Date.now() };
      if (list === "learning") {
        if (extra.ctx) entry.ctx = extra.ctx;
        if (extra.video?.title) entry.video = { title: extra.video.title, url: extra.video.url || "" };
        // A lookup filling in a Learning word's entry keeps its practice weight.
        const weight = dropped.find((d) => d.list === "learning")?.entry.w;
        if (weight) entry.w = weight;
      }
      Store[list][lemma] = entry;
    }
    await this._save();
  },

  // Takes the word off both lists.
  async remove(word, info) {
    this._drop(word, entryFor(word, info).lemma);
    await this._save();
  },

  // Moves an entry to the other list as it is, without a new lookup. Its practice
  // weight is dropped, so a word coming back to Learning starts out new.
  async move(lemma, to) {
    const from = to === "known" ? "learning" : "known";
    if (!Store[from][lemma]) return;
    const { w, ...entry } = Store[from][lemma];
    delete Store[from][lemma];
    Store[to][lemma] = { ...entry, added: Date.now() };
    await this._save();
  },

  async removeEntry(list, lemma) {
    delete Store[list][lemma];
    await this._save();
  },

  // Practice: how likely a Learning word is to be drawn next is its weight `w`
  // (absent = new). Hard doubles it, Easy halves it, within WEIGHT.min..max.
  async rate(lemma, rating) {
    const entry = Store.learning[lemma];
    if (!entry) return;
    const w = entry.w ?? WEIGHT.start;
    entry.w = Math.min(WEIGHT.max, Math.max(WEIGHT.min, rating === "hard" ? w * 2 : w / 2));
    await this._save();
  },

  // The next Learning lemma to practise: random, weighted by each entry's weight, and
  // never `previous` (the card just shown) unless it's the only word left. Null if the
  // list is empty.
  pick(previous) {
    const keys = Object.keys(Store.learning);
    const pool = keys.length > 1 ? keys.filter((k) => k !== previous) : keys;
    if (!pool.length) return null;
    const weight = (k) => Store.learning[k].w ?? WEIGHT.start;
    let r = Math.random() * pool.reduce((sum, k) => sum + weight(k), 0);
    for (const k of pool) {
      r -= weight(k);
      if (r < 0) return k;
    }
    return pool.at(-1);
  },

  // The entries that were taken off, as [{ list, entry }].
  _drop(word, lemma) {
    const w = word.toLowerCase();
    const dropped = [];
    for (const [name, list] of [["known", Store.known], ["learning", Store.learning]]) {
      for (const [key, e] of Object.entries(list)) {
        if (key === lemma || e.forms.includes(w)) {
          delete list[key];
          dropped.push({ list: name, entry: e });
        }
      }
    }
    return dropped;
  },

  async _save() {
    this.refreshPersonal();
    await Store.saveWords();
  },
};

function entryFor(word, info) {
  const w = word.toLowerCase();
  const lemma = (info?.lemma || word).toLowerCase();
  const listed = (info?.forms || []).map((f) => f.toLowerCase());
  // The clicked word joins the forms, except a common word the lemma's forms don't include:
  // the lookup can return the noun's lemma for the "die" or "zu" before it.
  const stray = info?.forms && w !== lemma && !listed.includes(w) && Words.builtIn.has(w);
  const forms = [...new Set([lemma, ...(stray ? [] : [w]), ...listed])];
  return { lemma, forms };
}
