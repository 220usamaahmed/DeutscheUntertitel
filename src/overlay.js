// Caption overlay and word popup, drawn in a Shadow DOM inside the player.

// Stopped at our host so clicks on captions never reach the player (play/pause, fullscreen).
const STOP_EVENTS = [
  "click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend",
];
const CONTEXT_SEP = "␟";

class Overlay {
  constructor(site) {
    this.site = site;
    this.container = null;
    this.text = "";
    this.renderId = 0;
    this.sentences = new Map(); // German line -> English, for this page session only
    this.popupWord = null; // the word element the open popup belongs to
    this.pausedVideo = null; // the video we paused when opening the popup

    this.host = document.createElement("div");
    this.host.id = "dtu-host";
    this.host.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:2147483000;";
    const root = this.host.attachShadow({ mode: "open" });
    const css = el("link");
    css.rel = "stylesheet";
    css.href = chrome.runtime.getURL("src/overlay.css");
    this.box = el("div", "box");
    this.popup = el("div", "popup");
    this.notice = el("button", "notice");
    this.box.hidden = this.popup.hidden = this.notice.hidden = true;
    root.append(css, this.box, this.popup, this.notice);

    for (const type of STOP_EVENTS) this.host.addEventListener(type, (e) => e.stopPropagation());
    this.box.addEventListener("click", (e) => {
      const w = e.target.closest(".w");
      if (w) this.togglePopup(w);
    });
    document.addEventListener("pointerdown", (e) => this.onPointerDown(e), true);
    document.addEventListener("keydown", (e) => e.key === "Escape" && this.closePopup(), true);
    new ResizeObserver(() => this.place()).observe(this.host);

    const style = el("style");
    style.textContent = site.hideCss;
    (document.head || document.documentElement).append(style);
  }

  attach(container) {
    this.container = container;
    this.ensureMounted();
  }

  ensureMounted() {
    const parent = this.container && this.site.mountPoint(this.container);
    if (parent && this.host.parentElement !== parent) parent.append(this.host);
  }

  detach() {
    this.closePopup();
    this.host.remove();
    this.container = null;
    this.text = "";
    this.box.hidden = true;
    setActive(false);
  }

  refresh() {
    if (this.container) this.render(this.text);
  }

  render(text) {
    this.text = text;
    const id = ++this.renderId;
    this.closePopup();
    this.ensureMounted();
    if (!AI.hasTranslator()) {
      // No translator at all: leave the native captions visible (fail open).
      this.box.hidden = true;
      setActive(false);
      return;
    }
    if (!text) {
      // Stay active between lines, so the next native line doesn't flash before ours.
      this.box.hidden = true;
      return;
    }

    const { mode } = Store.settings;
    const glosses = [];
    this.box.className = `box ${mode}`;
    this.box.replaceChildren();
    for (const line of text.split("\n")) {
      const lineEl = el("div", "line de");
      for (const tok of Words.tokenize(line)) {
        if (!tok.isWord) {
          lineEl.append(tok.text);
          continue;
        }
        const w = el("ruby", "w");
        w.dataset.word = tok.text;
        w.append(el("span", null, tok.text));
        if (mode === "word") {
          const rt = el("rt", null, " ");
          w.append(rt);
          w.classList.toggle("known", Words.isKnown(tok.text));
          glosses.push([rt, tok.text]);
        }
        lineEl.append(w);
      }
      this.box.append(lineEl);
    }

    if (mode === "sentence") {
      const en = el("div", "line en", " ");
      this.box.append(en);
      this.fill(en, id, () => this.translateSentence(text.replace(/\n/g, " ")));
    } else {
      for (const [rt, word] of glosses) this.fill(rt, id, () => this.translateWord(word));
    }
    this.box.hidden = false;
    this.place();
    setActive(true);
  }

  async fill(target, id, fn) {
    try {
      const result = await fn();
      if (id === this.renderId) target.textContent = result;
    } catch (e) {
      this.onAIError(e, "translations");
    }
  }

  async translateSentence(line) {
    if (!this.sentences.has(line)) this.sentences.set(line, await AI.translate(line));
    return this.sentences.get(line);
  }

  async translateWord(word) {
    let t = Store.translations.get(word);
    if (t === undefined) {
      t = await AI.translate(word);
      Store.translations.set(word, t);
    }
    return t;
  }

  // Shows or hides each word's translation after the known lists change.
  refreshKnown() {
    for (const w of this.box.querySelectorAll(".w")) {
      w.classList.toggle("known", Words.isKnown(w.dataset.word));
    }
    if (this.popupWord && this.popupButton) this.updateToggle();
  }

  // Matches the native captions' position and size.
  place() {
    if (!this.container || this.box.hidden) return;
    const cap = this.site.captionBox(this.container);
    const hostRect = this.host.getBoundingClientRect();
    const scale = Store.settings.fontScale;
    if (cap) {
      this.box.style.bottom = `${Math.max(0, hostRect.bottom - cap.rect.bottom)}px`;
      this.box.style.fontSize = `${cap.fontSize * scale}px`;
    } else {
      this.box.style.bottom = "10%";
      this.box.style.fontSize = `${Math.max(16, hostRect.height / 22) * scale}px`;
    }
  }

  // --- Word popup ---

  togglePopup(w) {
    if (this.popupWord === w) return this.closePopup();
    this.closePopup();
    this.openPopup(w);
  }

  openPopup(w) {
    const word = w.dataset.word;
    const sentence = this.text.replace(/\n/g, " ");
    this.popupWord = w;
    this.popupInfo = null;
    w.classList.add("active");

    const video = this.site.video(this.container);
    if (Store.settings.pauseOnPopup && video && !video.paused) {
      video.pause();
      this.pausedVideo = video;
    }

    this.popupHead = el("div", "head");
    this.popupBody = el("div", "body", "Looking up…");
    this.popupButton = el("button", "toggle");
    this.popupButton.disabled = true;
    this.popupButton.addEventListener("click", () => this.toggleKnown(word));
    this.popupHead.append(el("b", null, word));
    this.updateToggle();
    this.popup.replaceChildren(this.popupHead, this.popupBody, this.popupButton);
    this.popup.hidden = false;
    this.placePopup();

    // Called synchronously from the click, so a first model download is allowed to start.
    this.lookup(word, sentence).then(
      (info) => this.showInfo(w, word, info),
      (e) => this.showLookupError(w, e),
    );
  }

  lookup(word, sentence) {
    const ctxKey = word + CONTEXT_SEP + sentence;
    const info = Store.info.get(word);
    const meaning = Store.context.get(ctxKey);
    if (info && meaning !== undefined) return Promise.resolve({ ...info, meaningInContext: meaning });
    if (!AI.hasPrompt()) return Promise.reject(new Error("The Prompt API isn't available."));
    return AI.lookup(word, sentence).then((r) => {
      const { meaningInContext, ...rest } = r;
      Store.info.set(word, rest);
      Store.context.set(ctxKey, meaningInContext);
      return r;
    });
  }

  showInfo(w, word, info) {
    if (this.popupWord !== w) return;
    this.popupInfo = info;
    const head = [el("b", null, word)];
    if (info.lemma && info.lemma.toLowerCase() !== word.toLowerCase()) {
      head.push(el("span", "lemma", ` → ${info.lemma}`));
    }
    head.push(el("span", "pos", ` · ${info.partOfSpeech}`));
    this.popupHead.replaceChildren(...head);

    const body = [el("div", "ctx", info.meaningInContext)];
    if (info.alternatives?.length) {
      body.push(el("div", "alts", `Also: ${info.alternatives.join(", ")}`));
    }
    this.popupBody.replaceChildren(...body);
    // The cached lemma can change whether this word counts as known.
    w.classList.toggle("known", Words.isKnown(word));
    this.popupButton.disabled = false;
    this.updateToggle();
    this.placePopup();
  }

  showLookupError(w, e) {
    if (this.popupWord !== w) return;
    console.warn("[Deutsche Untertitel] lookup failed", e);
    this.popupBody.textContent =
      e.name === "NotAllowedError"
        ? "Gemini Nano isn't downloaded yet. Use Prepare models on the settings page."
        : `Couldn't look this word up (${e.message}).`;
    this.popupButton.disabled = false; // marking still works with the word as written
    this.updateToggle();
    this.placePopup();
  }

  updateToggle() {
    const word = this.popupWord?.dataset.word;
    if (word) this.popupButton.textContent = Words.isKnown(word) ? "Mark as unknown" : "Mark as known";
  }

  async toggleKnown(word) {
    this.popupButton.disabled = true;
    if (Words.isKnown(word)) await Words.markUnknown(word, this.popupInfo);
    else await Words.markKnown(word, this.popupInfo);
    this.refreshKnown();
    this.popupButton.disabled = false;
  }

  placePopup() {
    if (!this.popupWord) return;
    const hr = this.host.getBoundingClientRect();
    const wr = this.popupWord.getBoundingClientRect();
    this.popup.style.bottom = `${hr.bottom - wr.top + 8}px`;
    const pw = this.popup.offsetWidth;
    const left = wr.left + wr.width / 2 - hr.left - pw / 2;
    this.popup.style.left = `${Math.max(8, Math.min(left, hr.width - pw - 8))}px`;
  }

  closePopup() {
    if (!this.popupWord) return;
    this.popupWord.classList.remove("active");
    this.popupWord = this.popupInfo = this.popupButton = null;
    this.popup.hidden = true;
    if (this.pausedVideo) {
      this.pausedVideo.play().catch(() => {});
      this.pausedVideo = null;
    }
  }

  // Closes the popup on a click outside it. Clicks on words are handled by togglePopup.
  onPointerDown(e) {
    if (!this.popupWord) return;
    const path = e.composedPath();
    if (path.includes(this.popup) || path.some((n) => n.classList?.contains("w"))) return;
    this.closePopup();
  }

  // --- Errors ---

  onAIError(e, what) {
    if (e.name === "NotAllowedError") {
      // The translation model needs a download, which needs a click.
      this.showNotice(`Click to enable ${what}`, () => AI.translator().then(() => this.refresh()));
    } else {
      console.warn("[Deutsche Untertitel]", e);
    }
  }

  showNotice(text, onClick) {
    this.notice.textContent = text;
    this.notice.hidden = false;
    this.notice.onclick = () => {
      this.notice.hidden = true;
      onClick().catch((e) => console.warn("[Deutsche Untertitel]", e));
    };
  }
}

function setActive(on) {
  document.documentElement.classList.toggle("dtu-active", on);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
