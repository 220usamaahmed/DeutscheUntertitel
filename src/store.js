// Settings, known-word lists and caches, all kept in chrome.storage.local.
// Shared by the content scripts, the toolbar popup and the settings page.

const DEFAULT_SETTINGS = {
  enabled: true,
  mode: "sentence", // "sentence" | "word"
  lists: { articles: true, prepositions: true, pronouns: true, top: true },
  topN: 500, // 100 | 500 | 1000 | 2000
  fontScale: 1,
  pauseOnPopup: true,
};

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
  // Personal known words and exceptions: { lemma: [lemma, ...forms] }, lowercase.
  known: {},
  exceptions: {},

  // Word -> English (Translator API), keyed by the word as written.
  translations: new LruCache("cache.translations", 50000),
  // Word -> { lemma, partOfSpeech, alternatives, forms } (Prompt API).
  info: new LruCache("cache.info", 10000),
  // Word + sentence -> meaning in context (Prompt API).
  context: new LruCache("cache.context", 5000),

  async load({ caches = false } = {}) {
    const r = await chrome.storage.local.get(["settings", "known", "exceptions"]);
    this.settings = mergeSettings(r.settings);
    this.known = r.known || {};
    this.exceptions = r.exceptions || {};
    if (caches) {
      await Promise.all([this.translations.load(), this.info.load(), this.context.load()]);
    }
  },

  saveSettings(patch) {
    this.settings = mergeSettings({ ...this.settings, ...patch });
    return chrome.storage.local.set({ settings: this.settings });
  },

  saveWords() {
    return chrome.storage.local.set({ known: this.known, exceptions: this.exceptions });
  },

  clearCaches() {
    for (const c of [this.translations, this.info, this.context]) c.clearMemory();
    return chrome.storage.local.remove(CACHE_KEYS);
  },

  // Keeps this copy in sync with changes made elsewhere (popup, settings, other tabs).
  // Calls `cb(changedKeys)` after applying them.
  watch(cb) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.settings) this.settings = mergeSettings(changes.settings.newValue);
      if (changes.known) this.known = changes.known.newValue || {};
      if (changes.exceptions) this.exceptions = changes.exceptions.newValue || {};
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

function mergeSettings(s = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    lists: { ...DEFAULT_SETTINGS.lists, ...(s.lists || {}) },
  };
}
