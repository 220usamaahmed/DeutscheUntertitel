// Prime Video adapter: where the player puts its captions.
// When Prime changes its page, this should be the only file that needs updating.
// Prime's class names are mostly hashed; only the `atvwebplayersdk-*` ones are stable.

const PrimeAdapter = {
  id: "prime",
  // Prime doesn't roll captions in word by word, so a short wait only merges mutations.
  stableMs: 60,

  matches() {
    return /(^|\.)primevideo\.com$|(^|\.)amazon\.(de|com|co\.uk)$/.test(location.hostname);
  },

  // Hides the native captions (the span carries the background) while our overlay shows.
  hideCss: "html.dtu-active .atvwebplayersdk-captions-text { opacity: 0 !important; }",

  // The player container: stable while the player is open, and the fullscreen element.
  findCaptions() {
    return document.querySelector(".atvwebplayersdk-player-container");
  },

  // One element per caption; <br> inside it splits lines.
  readText(container) {
    return [...container.querySelectorAll(".atvwebplayersdk-captions-text")]
      .flatMap((el) => el.innerText.split("\n"))
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  },

  mountPoint(container) {
    return container;
  },

  // Bounding box and font size of the native captions, used to place ours.
  captionBox(container) {
    const el = container.querySelector(".atvwebplayersdk-captions-text");
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.height) return null;
    return { rect, fontSize: parseFloat(getComputedStyle(el).fontSize) };
  },

  // The movie's <video> is inside #dv-web-player but outside the player container.
  // The title page's trailer is another <video> outside #dv-web-player; never use it.
  video(container) {
    return (container.closest("#dv-web-player") || document).querySelector("video");
  },
};
