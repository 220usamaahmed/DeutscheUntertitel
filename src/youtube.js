// YouTube adapter: where the player puts its captions.
// Auto-generated captions roll: a window of two or three lines that grows a word at a
// time while the top line scrolls away. Manually made captions replace whole lines.

const YouTubeAdapter = {
  id: "youtube",
  stableMs: 60,
  // Captions are a moving window over continuous speech, not separate lines.
  rolling: true,

  matches() {
    return /(^|\.)youtube\.com$/.test(location.hostname);
  },

  // Only German captions are hidden and replaced; others stay as YouTube shows them.
  hideCss: 'html.dtu-active .caption-window[lang^="de"] { opacity: 0 !important; }',

  // The main player: stable across videos (YouTube doesn't reload the page) and the
  // fullscreen element. Inline previews on the home page use other players.
  findCaptions() {
    return document.querySelector("#movie_player");
  },

  // One element per visual line, inside the caption window.
  readText(container) {
    return [...container.querySelectorAll('.caption-window[lang^="de"] .caption-visual-line')]
      .map((line) => line.innerText.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  },

  mountPoint(container) {
    return container;
  },

  captionBox(container) {
    const text = container.querySelector('.caption-window[lang^="de"] .captions-text');
    const seg = text?.querySelector(".ytp-caption-segment");
    if (!seg) return null;
    const rect = text.getBoundingClientRect();
    if (!rect.height) return null;
    return { rect, fontSize: parseFloat(getComputedStyle(seg).fontSize) };
  },

  video(container) {
    return container.querySelector("video");
  },

  // Groups recorded words by video. The URL changes as soon as a new video opens; the
  // page title can lag behind, so the recorder refreshes it on every save.
  videoInfo() {
    const url = new URL(location.href);
    const id =
      (url.pathname === "/watch" && url.searchParams.get("v")) ||
      url.pathname.match(/^\/(?:shorts|live)\/([\w-]+)/)?.[1];
    if (!id) return null;
    const title = document.title.replace(/^\(\d+\)\s*/, "").replace(/\s+-\s+YouTube$/, "").trim();
    return { id, title: title || "YouTube video", url: `https://www.youtube.com/watch?v=${id}` };
  },
};
