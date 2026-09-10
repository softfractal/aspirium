// viewer-stub.js — STAND-IN viewer for the hero band. Dev and test only.
//
// Reached through dev/tune.html ("stub" switches) and dev/check.mjs. Implements the same
// contract as js/viewer-embed.js (the live bundle) and runs the HANDOFF §3 timeline against
// the poster, so the page choreography (black → lights → intro end → wordmark → warm accent),
// the fallback ladder and the R3 touch rule can be exercised deterministically without WebGL.
//
// Classic script: defines window.SignetViewer = { mount }. CONTRACT — see js/viewer-embed.js.
// Extra option here: devScenario "slow" (ready after 12 s, past the page's 8 s ladder) |
// "fail" (onError after 0.8 s).
(() => {
  const DEFAULT_T = { black: 1.2, lightsFull: 4.0, introEnd: 15.0, wordmark: 15.5 };

  async function mount(el, opts = {}) {
    const T = { ...DEFAULT_T, ...(opts.timeline || {}) };
    const root = document.createElement("div");
    root.className = "stub";
    root.setAttribute("role", "img");
    root.setAttribute("aria-label", opts.label || "Signet ring, lit from within");
    root.style.touchAction = "pan-y"; // R3
    const img = new Image();
    img.decoding = "async";
    img.alt = "";
    img.draggable = false;
    if (opts.poster) img.src = opts.poster;
    root.appendChild(img);
    el.appendChild(root);

    let destroyed = false, playing = true, interactive = false;
    let t = 0, last = 0, raf = 0, firedEnd = false, firedLit = false;

    const handle = {
      play() { playing = true; },
      pause() { playing = false; },
      restart() { t = 0; firedEnd = firedLit = false; render(); },
      setInteractive(on) { interactive = !!on; root.style.cursor = on ? "grab" : ""; },
      destroy() { destroyed = true; cancelAnimationFrame(raf); root.remove(); },
      get time() { return t; },
    };

    // dev scenarios, only reachable through dev/tune.html (same-origin frame dataset)
    if (opts.devScenario === "fail") {
      setTimeout(() => { if (!destroyed) opts.onError?.(new Error("stub: simulated load error")); }, 800);
      return handle;
    }
    const readyDelay = opts.devScenario === "slow" ? 12000 : 0;

    if (img.src) { try { await img.decode(); } catch { /* poster missing: the stub stays black, still "ready" */ } }
    if (readyDelay) await new Promise(r => setTimeout(r, readyDelay));
    if (destroyed) return handle;

    const render = () => {
      const a = t < T.black ? 0 : Math.min(1, (t - T.black) / (T.lightsFull - T.black));
      img.style.opacity = a.toFixed(3);
      // the screen is dark until power-on; the poster is the lit end pose, so hold it back a little
      img.style.filter = t >= T.wordmark ? "" : "saturate(.55) brightness(.82)";
    };

    if (opts.intro === "skip") {
      t = T.wordmark + 1; firedEnd = firedLit = true; render();
      queueMicrotask(() => { if (destroyed) return; opts.onReady?.(); opts.onIntroEnd?.(); opts.onWordmarkLit?.(); });
    } else {
      render();
      queueMicrotask(() => { if (!destroyed) opts.onReady?.(); });
    }

    const tick = now => {
      if (destroyed) return;
      if (last && playing) t += Math.min(0.1, (now - last) / 1000); // hidden tab: rAF stops, the clock stops
      last = now;
      render();
      if (!firedEnd) opts.onIntroProgress?.(Math.min(1, t / T.introEnd));
      if (!firedEnd && t >= T.introEnd) { firedEnd = true; opts.onIntroEnd?.(); }
      if (!firedLit && t >= T.wordmark) { firedLit = true; opts.onWordmarkLit?.(); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // drag-to-tumble stand-in: horizontal gesture rotates, vertical is left to the page (pan-y)
    let drag = null;
    const spring = () => { root.style.transition = "transform .55s cubic-bezier(.2,.8,.2,1)"; root.style.transform = ""; };
    root.addEventListener("pointerdown", e => {
      if (!interactive || drag) return;
      opts.onDragged?.();                              // retires the page's drag hint
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      root.setPointerCapture(e.pointerId);
      root.style.transition = "none";
      root.style.cursor = "grabbing";
    });
    root.addEventListener("pointermove", e => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = Math.max(-220, Math.min(220, e.clientX - drag.x));
      const dy = Math.max(-220, Math.min(220, e.clientY - drag.y));
      root.style.transform = `perspective(1400px) rotateY(${(dx * 0.08).toFixed(2)}deg) rotateX(${(-dy * 0.08).toFixed(2)}deg)`;
    });
    const end = e => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null; root.style.cursor = interactive ? "grab" : ""; spring();
    };
    root.addEventListener("pointerup", end);
    root.addEventListener("pointercancel", end); // the browser took the gesture for scrolling: spring back, no stuck state
    root.addEventListener("lostpointercapture", end);

    return handle;
  }

  window.SignetViewer = { kind: "stub", mount };
})();
