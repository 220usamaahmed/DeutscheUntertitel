// Finds the player's captions, watches them for changes and drives the overlay.

// Progress is written to <html data-dtu="…">, which is readable from the page and DevTools.
const setState = (s) => (document.documentElement.dataset.dtu = s);

const ADAPTERS = [PrimeAdapter, YouTubeAdapter];

(async () => {
  const site = ADAPTERS.find((a) => a.id === self.DTU_FORCE_SITE || a.matches());
  if (!site) return;
  setState("starting");

  await Store.load({ caches: true });
  await Words.refresh();
  const overlay = new Overlay(site);
  Recorder.init();

  let container = null;
  let observer = null;
  let timer = null;
  let lastText = null;

  function update() {
    const text = site.readText(container);
    if (text === lastText) return overlay.place(); // same line, but it may have moved
    lastText = text;
    try {
      Recorder.caption(site, container, text);
    } catch (e) {
      console.warn("[Deutsche Untertitel] recording words failed", e);
    }
    overlay.render(text);
  }

  // Throttled, not debounced: the observed player also holds the controls, whose clock
  // changes constantly and would keep postponing a debounced update.
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (container) update();
    }, site.stableMs);
  }

  function detach() {
    observer?.disconnect();
    observer = container = lastText = null;
    overlay.detach();
    Recorder.reset();
    site.forgetVideo?.();
  }

  // The player opens and closes without page loads, so look for its captions every second.
  function check() {
    const found = Store.settings.enabled ? site.findCaptions() : null;
    if (found === container) {
      if (found) {
        overlay.ensureMounted();
        Recorder.tick(site, found);
      }
      return;
    }
    detach();
    if (!found) return;
    container = found;
    overlay.attach(found);
    observer = new MutationObserver(schedule);
    // Attributes too: YouTube moves its captions with a class or style change when the
    // controls show or hide, which nothing else in the player may mutate alongside.
    observer.observe(found, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    schedule();
  }

  setInterval(check, 1000);
  check();
  setState(`ready ${chrome.runtime.getManifest().version}`);

  Store.watch(async (keys) => {
    if (keys.includes("settings")) {
      await Words.refresh();
      check();
      overlay.refresh();
    } else if (keys.includes("known") || keys.includes("learning")) {
      Words.refreshPersonal();
      overlay.refreshKnown();
    }
  });

  // Warm up the models, so the first caption and first popup don't wait for them.
  try {
    if (AI.hasTranslator() && (await AI.translatorAvailability()) === "available") {
      await AI.translator();
    }
    if (AI.hasPrompt() && (await AI.promptAvailability()) === "available") {
      await Promise.all([AI.session("lookup"), AI.session("forms")]);
    }
  } catch (e) {
    console.warn("[Deutsche Untertitel] warm-up failed", e);
  }
})().catch((e) => {
  setState(`error: ${e.message}`);
  console.error("[Deutsche Untertitel]", e);
});
