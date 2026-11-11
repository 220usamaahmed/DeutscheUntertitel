// Finds the player's captions, watches them for changes and drives the overlay.

(async () => {
  const site = ADAPTERS.find((a) => a.id === self.DTU_FORCE_SITE || a.matches());
  if (!site) return;

  await Store.load({ caches: true });
  await Words.refresh();
  const overlay = new Overlay(site);

  let container = null;
  let observer = null;
  let timer = null;
  let lastText = null;

  function update() {
    const text = site.readText(container);
    if (text === lastText) return overlay.place(); // same line, but it may have moved
    lastText = text;
    overlay.render(text);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(update, site.stableMs);
  }

  function detach() {
    observer?.disconnect();
    observer = container = lastText = null;
    overlay.detach();
  }

  // The player opens and closes without page loads, so look for its captions every second.
  function check() {
    const found = Store.settings.enabled ? site.findCaptions() : null;
    if (found === container) {
      if (found) overlay.ensureMounted();
      return;
    }
    detach();
    if (!found) return;
    container = found;
    overlay.attach(found);
    observer = new MutationObserver(schedule);
    observer.observe(found, { childList: true, subtree: true, characterData: true });
    schedule();
  }

  setInterval(check, 1000);
  check();

  Store.watch(async (keys) => {
    if (keys.includes("settings")) {
      await Words.refresh();
      check();
      overlay.refresh();
    } else if (keys.includes("known") || keys.includes("exceptions")) {
      Words.refreshPersonal();
      overlay.refreshKnown();
    }
  });

  // Warm up the models, so the first caption and first popup don't wait for them.
  try {
    if (AI.hasTranslator() && (await AI.translatorAvailability()) === "available") {
      await AI.translator();
    }
    if (AI.hasPrompt() && (await AI.promptAvailability()) === "available") await AI.session();
  } catch (e) {
    console.warn("[Deutsche Untertitel] warm-up failed", e);
  }
})();
