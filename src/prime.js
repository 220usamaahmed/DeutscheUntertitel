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

  // The player closed: the next video starts without a title.
  forgetVideo() {
    this._seen = this._provisional = null;
  },

  // Groups recorded words by video: the title, plus the episode line for series
  // ("S1 E1 Pilot"). Prime only renders them while its controls show, so the last
  // reading is kept until the video's length changes (a new episode). Before the first
  // reading, the group is provisional, named after the page title ("The Rookie -
  // Season 1"); the recorder moves its words over once the real title shows up.
  videoInfo(container) {
    const text = (sel) => document.querySelector(sel)?.textContent.replace(/\s+/g, " ").trim() || "";
    const duration = Math.round(this.video(container)?.duration || 0);
    // The length is 0 until the video's metadata loads; only a change between two
    // real lengths means a new video.
    const changed = (v) => v?.duration && duration && Math.abs(v.duration - duration) > 1;
    if (changed(this._seen)) this._seen = null;
    if (changed(this._provisional)) this._provisional = null;

    const title = text(".atvwebplayersdk-title-text");
    const url = location.origin + location.pathname;
    if (title) {
      const episode = text(".atvwebplayersdk-episode-info, .atvwebplayersdk-subtitle-text");
      this._seen = { title, episode, duration };
    }
    if (this._seen) {
      this._seen.duration ||= duration;
      const { title, episode } = this._seen;
      return { id: episode ? `${title} | ${episode}` : title, title: episode ? `${title} · ${episode}` : title, url };
    }
    // Unique per viewing, so a provisional group never mixes two sessions.
    this._provisional ||= {
      id: `${Date.now()}`,
      title: document.title.replace(/^Prime Video:\s*/, "").trim() || "Prime Video",
      duration,
    };
    this._provisional.duration ||= duration;
    return { id: `untitled:${this._provisional.id}`, title: this._provisional.title, url, provisional: true };
  },
};
