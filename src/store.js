// Settings, known-word lists and caches, all kept in chrome.storage.local.
// Shared by the content scripts, the toolbar popup.

const DEFAULT_SETTINGS = {
  enabled: true,
  mode: "sentence", // "sentence" | "word"
  lists: { articles: true, prepositions: true, pronouns: true, top: true },
  topN: 500, // 100 | 500 | 1000 | 2000
  fontScale: 1,
  pauseOnPopup: true,
  recordWords: true,
};

// Storage keys of the per-video word records start with this (see recorder.js).
const VIDEO_PREFIX = "video:";

// Map-backed cache that drops the least recently used entries past `cap`.
// Writes to storage are debounced; reads only reorder in memory.
class LruCache {
  constructor(key, cap) {
    this.key = key;
    this.cap = cap;
    this.map = new Map();
    this.timer = null;
  }

  async load() {
    const stored = await chrome.storage.local.get(this.key);
    this.map = new Map(Object.entries(stored[this.key] || {}));
  }

  get(k) {
    if (!this.map.has(k)) return undefined;
    const v = this.map.get(k);
    this.map.delete(k);
    this.map.set(k, v);
    return v;
  }

  peek(k) {
    return this.map.get(k);
  }

  set(k, v) {
    this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.cap) this.map.delete(this.map.keys().next().value);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), 2000);
  }

  save() {
    return chrome.storage.local.set({ [this.key]: Object.fromEntries(this.map) });
  }

  clearMemory() {
    clearTimeout(this.timer);
    this.map.clear();
  }
}

const CACHE_KEYS = ["cache.translations", "cache.info", "cache.context"];

const Store = {
  settings: structuredClone(DEFAULT_SETTINGS),
  // Personal lists, keyed by lowercase lemma:
  // { forms: [lemma, ...forms], en, added, ctx?, video?: { title, url } }.
  // Learning wins over Known and the common-word lists (see Words.status).
  known: {},
  learning: {},

  // Word -> English (Translator API), keyed by the word as written.
  translations: new LruCache("cache.translations", 50000),
  // Word -> { lemma, partOfSpeech, alternatives, forms } (Prompt API).
  info: new LruCache("cache.info", 10000),
  // Word + sentence -> meaning in context (Prompt API).
  context: new LruCache("cache.context", 5000),

  async load({ caches = false } = {}) {
    const r = await chrome.storage.local.get(["settings", "known", "learning", "exceptions"]);
    this.settings = mergeSettings(r.settings);
    const { known, learning, changed } = migrateLists(r);
    this.known = known;
    this.learning = learning;
    if (changed) {
      await chrome.storage.local.set({ known, learning });
      await chrome.storage.local.remove("exceptions");
    }
    if (caches) {
      await Promise.all([this.translations.load(), this.info.load(), this.context.load()]);
    }
  },

  saveSettings(patch) {
    this.settings = mergeSettings({ ...this.settings, ...patch });
    return chrome.storage.local.set({ settings: this.settings });
  },

  saveWords() {
    return chrome.storage.local.set({ known: this.known, learning: this.learning });
  },

  clearCaches() {
    for (const c of [this.translations, this.info, this.context]) c.clearMemory();
    return chrome.storage.local.remove(CACHE_KEYS);
  },

  // { storageKey: record } for every video with recorded words.
  async loadVideos() {
    const keys = (await chrome.storage.local.getKeys()).filter((k) => k.startsWith(VIDEO_PREFIX));
    return keys.length ? chrome.storage.local.get(keys) : {};
  },

  async deleteAllVideos() {
    const keys = (await chrome.storage.local.getKeys()).filter((k) => k.startsWith(VIDEO_PREFIX));
    return chrome.storage.local.remove(keys);
  },

  // Keeps this copy in sync with changes made elsewhere (popup, settings, other tabs).
  // Calls `cb(changedKeys)` after applying them.
  watch(cb) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.settings) this.settings = mergeSettings(changes.settings.newValue);
      if (changes.known) this.known = changes.known.newValue || {};
      if (changes.learning) this.learning = changes.learning.newValue || {};
      if (changes["cache.translations"] && !changes["cache.translations"].newValue) {
        this.translations.clearMemory();
      }
      if (changes["cache.info"] && !changes["cache.info"].newValue) this.info.clearMemory();
      if (changes["cache.context"] && !changes["cache.context"].newValue) {
        this.context.clearMemory();
      }
      cb(Object.keys(changes));
    });
  },
};

// Before 0.4.0 an entry was just its forms, and words marked unknown despite a
// built-in list were "exceptions". Exceptions become Learning words.
function migrateLists(r) {
  let changed = Boolean(r.exceptions);
  const now = Date.now();
  const entry = (forms) => ({ forms, en: "", added: now });
  const upgrade = (list = {}) =>
    Object.fromEntries(
      Object.entries(list).map(([lemma, v]) => {
        if (!Array.isArray(v)) return [lemma, v];
        changed = true;
        return [lemma, entry(v)];
      }),
    );
  const known = upgrade(r.known);
  const learning = upgrade(r.learning);
  for (const [lemma, forms] of Object.entries(r.exceptions || {})) {
    delete known[lemma];
    learning[lemma] ||= entry(forms);
  }
  return { known, learning, changed };
}

function mergeSettings(s = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    lists: { ...DEFAULT_SETTINGS.lists, ...(s.lists || {}) },
  };
}
