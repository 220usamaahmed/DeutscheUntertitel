// Records the words shown with a translation, per video, for the words page.
// Each video is one storage key ("video:<site>:<id>"), written a few seconds after a change.
//
// A record: { site, id, title, url, first, last, next, words: { <lowercase word>: entry } }
// with entry = { w: as first written, n: times it came up, o: order of first appearance,
//                ctx: the sentence it first appeared in, c: 1 if clicked }

const Recorder = {
  key: null, // storage key of the video being watched
  rec: null, // its record; null while loading
  queue: [], // changes made while the record was loading
  dirty: false,
  timer: null,
  // Rolling captions: the previous caption's word tokens, and the stream position of
  // its first token, so only words that are new in the stream are counted.
  prev: [],
  base: 0,
  // First appearances whose sentence may still be growing: { lower, pos }.
  open: [],

  init() {
    chrome.storage.onChanged.addListener((changes, area) => {
      // The record was deleted on the words page: start again from nothing.
      if (area === "local" && this.key && changes[this.key] && !changes[this.key].newValue) {
        clearTimeout(this.timer);
        this.dirty = false;
        if (this.rec) this.rec = newRecord(this.rec);
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.flush();
    });
    addEventListener("pagehide", () => this.flush());
  },

  // Called with each new caption text (German only; "" between lines).
  caption(site, container, text) {
    if (!Store.settings.recordWords) return;
    const info = this.video(site, container);
    if (!info) return;
    const flat = text.replace(/\n/g, " ");
    const tokens = tokenize(flat);

    // Which tokens are new: all of them for whole-line captions; for rolling ones, those
    // after the part of the previous window that's still on screen.
    let seen = 0;
    if (site.rolling) {
      const d = overlap(this.prev, tokens);
      this.base += d;
      seen = this.prev.length - d;
    } else {
      this.base += this.prev.length;
    }
    this.prev = tokens;
    const sentences = sentenceSpans(flat);

    // Grow the context of words whose sentence was still being spoken.
    const growing = [];
    for (const o of this.open) {
      const t = tokens[o.pos - this.base];
      if (!t || t.lower !== o.lower) continue;
      const s = sentenceAt(sentences, t.start);
      this.change((rec) => {
        if (rec.words[o.lower]) rec.words[o.lower].ctx = flat.slice(s.start, s.end).trim();
      });
      if (s.last) growing.push(o);
    }
    this.open = growing;

    tokens.slice(seen).forEach((t, i) => {
      if (t.bracketed || Words.isKnown(t.text)) return;
      const s = sentenceAt(sentences, t.start);
      const pos = this.base + seen + i;
      this.change((rec) => {
        let e = rec.words[t.lower];
        if (!e) {
          e = rec.words[t.lower] = { w: t.text, n: 0, o: rec.next++, ctx: flat.slice(s.start, s.end).trim() };
          if (site.rolling && s.last) this.open.push({ lower: t.lower, pos });
        }
        e.n++;
      });
    });
  },

  // The word popup was opened on this word.
  clicked(word, sentence) {
    if (!Store.settings.recordWords || !this.key) return;
    const lower = word.toLowerCase();
    this.change((rec) => {
      const e = (rec.words[lower] ||= { w: word, n: 1, o: rec.next++, ctx: sentence });
      e.c = 1;
    });
  },

  // The player closed or moved on; keep counting from scratch next time.
  reset() {
    this.prev = [];
    this.open = [];
    this.flush();
  },

  // Switches to the video now playing, loading its record if needed.
  video(site, container) {
    const info = site.videoInfo(container);
    if (!info) return null;
    const key = `${VIDEO_PREFIX}${site.id}:${info.id}`;
    if (key !== this.key) {
      // The real title of a provisional group showed up: move its words over.
      const from = this.provisional && !info.provisional ? this.key : null;
      const carried = from ? { rec: this.rec, queue: this.queue } : null;
      if (from) {
        clearTimeout(this.timer);
        this.dirty = false;
        chrome.storage.local.remove(from);
      } else {
        this.flush();
        this.prev = [];
        this.open = [];
      }
      this.key = key;
      this.rec = null;
      this.queue = carried ? carried.queue : [];
      chrome.storage.local.get(key).then((r) => {
        if (this.key !== key) return;
        this.rec = r[key] || newRecord({ site: site.id, id: info.id });
        if (carried?.rec) this.change((rec) => mergeWords(rec, carried.rec));
        const queued = this.queue;
        this.queue = [];
        queued.forEach((fn) => this.change(fn));
      });
    }
    this.provisional = Boolean(info.provisional);
    this.info = info;
    return info;
  },

  change(fn) {
    if (!this.rec) return this.queue.push(fn);
    fn(this.rec);
    Object.assign(this.rec, { title: this.info.title, url: this.info.url, last: Date.now() });
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 3000);
  },

  flush() {
    clearTimeout(this.timer);
    if (!this.dirty || !this.rec || !this.key) return;
    this.dirty = false;
    // Nothing to keep yet (only known words so far): don't create an empty group.
    if (!Object.keys(this.rec.words).length) return;
    chrome.storage.local.set({ [this.key]: this.rec }).catch((e) => {
      console.warn("[Deutsche Untertitel] saving words failed", e);
    });
  },
};

// Adds the words of record `from` to `rec`, after the ones it already has.
function mergeWords(rec, from) {
  const entries = Object.entries(from.words).sort((a, b) => a[1].o - b[1].o);
  for (const [lower, e] of entries) {
    const t = rec.words[lower];
    if (!t) rec.words[lower] = { ...e, o: rec.next++ };
    else {
      t.n += e.n;
      if (e.c) t.c = 1;
    }
  }
  rec.first = Math.min(rec.first, from.first);
}

function newRecord({ site, id, title = "", url = "" }) {
  const now = Date.now();
  return { site, id, title, url, first: now, last: now, next: 0, words: {} };
}

// Word tokens with their offsets; words inside [...] or (...) are marked as bracketed
// (sound descriptions such as "[Musik]" or "(Tür knallt)").
function tokenize(text) {
  const out = [];
  let offset = 0;
  for (const t of Words.tokenize(text)) {
    const start = offset;
    offset += t.text.length;
    if (!t.isWord) continue;
    out.push({ text: t.text, lower: t.text.toLowerCase(), start, bracketed: bracketDepth(text, start) > 0 });
  }
  return out;
}

function bracketDepth(text, end) {
  let depth = 0;
  for (let i = 0; i < end; i++) {
    if (text[i] === "[" || text[i] === "(") depth++;
    else if ((text[i] === "]" || text[i] === ")") && depth > 0) depth--;
  }
  return depth;
}

// The smallest number of leading tokens to drop from `prev` so the rest starts `cur`.
// That's how far the rolling window moved; the tokens of `cur` after it are new.
function overlap(prev, cur) {
  for (let d = 0; d < prev.length; d++) {
    const n = prev.length - d;
    if (n > cur.length) continue;
    let same = true;
    for (let k = 0; k < n && same; k++) same = prev[d + k].lower === cur[k].lower;
    if (same) return d;
  }
  return prev.length;
}

function sentenceSpans(text) {
  const spans = [...SENTENCE_SEGMENTER.segment(text)].map((s) => ({
    start: s.index,
    end: s.index + s.segment.length,
  }));
  if (spans.length) spans.at(-1).last = true;
  return spans;
}

function sentenceAt(spans, offset) {
  return spans.find((s) => offset >= s.start && offset < s.end) || { start: 0, end: Infinity, last: true };
}

const SENTENCE_SEGMENTER = new Intl.Segmenter("de", { granularity: "sentence" });
