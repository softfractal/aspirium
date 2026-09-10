// viewer-embed.js — the hero-band viewer, live.
//
// Mounts the pipeline's current bundle (three-viewer/demo/bundle.js, reached as
// viewer/bundle.js through the shell viewer/index.html) inside an iframe sized to the band.
// The bundle is the full-window reference renderer, so the frame IS its container —
// HANDOFF_web.md §6 item 1 without touching the renderer — and a small reporter script in
// the shell translates its verification hooks into the contract below over postMessage
// (so it works served and from disk, where frames are cross-origin). Rendering, calibration
// and timing are byte-identical to the reference build. When the pipeline ships a native
// embed (§6 item 3) it replaces this one file.
//
// Classic script: defines window.SignetViewer = { mount }. Loaded by js/main.js on demand;
// a load failure lands the page on the poster.
//
// CONTRACT (the page is written against it; keep the signature):
//   const viewer = await SignetViewer.mount(el, {
//     variant,          "desktop" | "phone" — selects the asset set once the phone project exists (R4)
//     intro,            "play" | "skip" — skip = end pose, screen lit, callbacks fire at once (reduced motion, return visits)
//     dprCap,           page-supplied DPR ceiling (2 desktop, 1.5 phone) → ?dpr= on the bundle
//     label,            accessible name for the frame
//     onReady(),        decode + shader pre-warm done; the page keeps the band black until this
//     onIntroProgress(f), 0…1 through the 15 s intro, ~every 150 ms — the page paces the lockup on it
//     onIntroEnd(),     intro landed on its last frame — rotation unlocks in the bundle itself
//     onWordmarkLit(),  wordmark appears (0.5 s into power_on) — the page's warm accent moves with it
//     onDragged(),      the first pointer to land on the canvas after rotation unlocks — retires the drag hint
//     onError(err),     unrecoverable — the page falls back to the poster
//   });
//   viewer.play(); viewer.pause(); viewer.restart(); viewer.setInteractive(bool); viewer.destroy();
//
// What the bridge cannot do (native-embed items for the pipeline): separate, hashed, WebP/KTX2
// assets (the bundle is one 13.5 MB file with base64 assets — §6 item 5); restart(); the debug
// keys still answer while the frame has focus (§6 item 2). pause() throttles the render loop to
// 1 Hz and freezes the intro; play() restores free-running.
(() => {
  const here = (document.currentScript && document.currentScript.src) || location.href;
  const VIEWER_URL = new URL("../viewer/index.html", here);

  async function mount(el, opts = {}) {
    const frame = document.createElement("iframe");
    frame.title = opts.label || "Signet ring, lit from within";
    frame.setAttribute("aria-label", frame.title);
    const q = new URLSearchParams({ dpr: String(opts.dprCap ?? 2) });
    if (opts.intro === "skip") q.set("intro", "skip");
    frame.src = `${VIEWER_URL}?${q}`;
    frame.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;display:block";

    let dead = false, ready = false, ended = false, lit = false;
    const fail = err => { if (dead) return; destroy(); opts.onError?.(err); };
    const onMessage = e => {
      if (dead || e.source !== frame.contentWindow || !e.data || e.data.signet !== "viewer") return;
      switch (e.data.event) {
        case "ready": if (!ready) { ready = true; opts.onReady?.(); } break;
        case "introProgress": opts.onIntroProgress?.(e.data.detail); break;
        case "introEnd": if (!ended) { ended = true; opts.onIntroEnd?.(); } break;
        case "wordmarkLit": if (!lit) { lit = true; opts.onWordmarkLit?.(); } break;
        case "dragged": opts.onDragged?.(); break;
        case "error": fail(new Error(e.data.detail || "viewer error")); break;
      }
    };
    const post = (cmd, arg) => { try { frame.contentWindow?.postMessage({ signet: "page", cmd, arg }, "*"); } catch { /* frame gone */ } };
    const destroy = () => { dead = true; removeEventListener("message", onMessage); frame.remove(); };
    addEventListener("message", onMessage);
    frame.addEventListener("error", () => fail(new Error("viewer frame failed to load")));
    el.appendChild(frame);

    return {
      play() { post("play"); },
      pause() { post("pause"); },
      restart() { console.info("[signet] restart is not available through the bridge"); },
      setInteractive() { /* the bundle unlocks rotation itself when the intro lands (HANDOFF §4) */ },
      destroy,
    };
  }

  window.SignetViewer = { kind: "embed", mount };
})();
