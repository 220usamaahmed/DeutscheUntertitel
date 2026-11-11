// Tokenising subtitle lines and deciding which words count as known.

const LIST_FILES = {
  articles: "lists/articles.json",
  prepositions: "lists/prepositions.json",
  pronouns: "lists/pronouns.json",
  top: "lists/top2000.json",
};

const Words = {
  segmenter: new Intl.Segmenter("de", { granularity: "word" }),
  builtIn: new Set(),
  personal: new Set(),
  excluded: new Set(),
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
    this.personal = new Set(Object.values(Store.known).flat());
    this.excluded = new Set(Object.values(Store.exceptions).flat());
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

  isKnown(word) {
    const w = word.toLowerCase();
    const lemma = Store.info.peek(word)?.lemma?.toLowerCase();
    if (this.excluded.has(w) || (lemma && this.excluded.has(lemma))) return false;
    if (this.personal.has(w) || (lemma && this.personal.has(lemma))) return true;
    return this.builtIn.has(w);
  },

  // `info` is the Prompt API lookup, or null if it failed.
  async markKnown(word, info) {
    const { lemma, forms } = entryFor(word, info);
    for (const [key, list] of Object.entries(Store.exceptions)) {
      if (key === lemma || list.includes(word.toLowerCase())) delete Store.exceptions[key];
    }
    Store.known[lemma] = forms;
    await this._save();
  },

  async markUnknown(word, info) {
    const { lemma, forms } = entryFor(word, info);
    const w = word.toLowerCase();
    for (const [key, list] of Object.entries(Store.known)) {
      if (key === lemma || list.includes(w)) delete Store.known[key];
    }
    this.refreshPersonal();
    // Still known through a built-in list: store an exception so it shows again.
    if (this.isKnown(word)) Store.exceptions[lemma] = forms;
    await this._save();
  },

  async _save() {
    this.refreshPersonal();
    await Store.saveWords();
  },
};

function entryFor(word, info) {
  const w = word.toLowerCase();
  const lemma = (info?.lemma || word).toLowerCase();
  const forms = [...new Set([lemma, w, ...(info?.forms || []).map((f) => f.toLowerCase())])];
  return { lemma, forms };
}
