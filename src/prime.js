// Prime Video adapter: where the player puts its captions.
// When Prime changes its page, this should be the only file that needs updating.

const PrimeAdapter = {
  id: "prime",
  // Prime doesn't roll captions in word by word, so a short wait only merges mutations.
  stableMs: 60,

  matches() {
    return /(^|\.)primevideo\.com$|(^|\.)amazon\.(de|com|co\.uk)$/.test(location.hostname);
  },

  // Hides the native captions while our overlay is showing (html.dtu-active).
  hideCss: "html.dtu-active .atvwebplayersdk-captions-overlay { opacity: 0 !important; }",

  findCaptions() {
    return document.querySelector(".atvwebplayersdk-captions-overlay");
  },

  // Caption lines, one per element; <br> inside an element also splits lines.
  readText(container) {
    return [...container.querySelectorAll(".atvwebplayersdk-captions-text")]
      .flatMap((el) => el.innerText.split("\n"))
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  },

  // The element our overlay is mounted in. It must be inside the fullscreen element.
  mountPoint(container) {
    return container.parentElement;
  },

  // Bounding box and font size of the native captions, used to place ours.
  captionBox(container) {
    const el = container.querySelector(".atvwebplayersdk-captions-text");
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.height) return null;
    return { rect, fontSize: parseFloat(getComputedStyle(el).fontSize) };
  },

  video(container) {
    const player = container.closest(".webPlayerSDKContainer, #dv-web-player") || document;
    return player.querySelector("video");
  },
};

const ADAPTERS = [PrimeAdapter];
