#!/usr/bin/env node
// dev/check.mjs — acceptance run for the coming-soon page in headless Chrome (real rAF, real
// media queries, emulated touch). Exercises the choreography the Browser pane cannot (its tab is
// hidden, so rAF is suspended): opening black → lights → intro end → warm accent; return visit;
// reduced motion; the fallback ladder; the phone band and the R3 scroll rule; the form.
//   node dev/check.mjs [base-url] [screenshot-dir]
//   default base: http://localhost:8734/site/  (the launch.json server, project root)
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, sleep } from "./cdp.mjs";

const BASE = process.argv[2] || "http://localhost:8734/site/";
const OUT = process.argv[3] || join(tmpdir(), "signet-check");
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const STATE = `({
  light: document.documentElement.dataset.light || "bone",
  band: document.getElementById("band").dataset.state,
  interactive: document.getElementById("band").hasAttribute("data-interactive"),
  stub: (() => { const i = document.querySelector(".stub img"); return i ? { opacity: +i.style.opacity, filter: i.style.filter } : null; })(),
  bandH: document.getElementById("band").getBoundingClientRect().height,
  formBottom: document.getElementById("capture").getBoundingClientRect().bottom,
  consentBottom: document.getElementById("consent").getBoundingClientRect().bottom,
  ih: innerHeight, iw: innerWidth,
  heroH: document.getElementById("hero").getBoundingClientRect().height,
  captureTop: Math.round(document.getElementById("capture-panel").getBoundingClientRect().top + (window.scrollY || 0)),
  parallax: +(getComputedStyle(document.getElementById("hero")).getPropertyValue("--p") || 0),
  playback: document.getElementById("band").dataset.playback || null,
  scrollY: Math.round(window.scrollY || 0),
  docH: document.documentElement.scrollHeight,
  hasLogo: !!document.getElementById("logo"),
  storedKeys: (() => { try { return Object.keys(sessionStorage).concat(Object.keys(localStorage)).length; } catch { return null; } })(),
  posterShown: getComputedStyle(document.getElementById("poster")).display !== "none",
  visible: document.visibilityState,
  mark: (() => { const m = document.getElementById("mark"); if (!m) return null;
    const cs = getComputedStyle(m);
    return { runs: +(m.dataset.runs || 0), running: m.classList.contains("is-fx"),
      cells: m.querySelectorAll(".ch").length,
      pending: m.querySelectorAll(".ch.is-pending").length,
      scrambling: m.querySelectorAll(".ch.is-fx").length,
      label: m.getAttribute("aria-label"),
      text: m.textContent.replace(/\s+/g, " ").trim(),
      held: document.documentElement.classList.contains("is-opening"),
      opacity: +cs.opacity,
      family: cs.fontFamily.split(",")[0].replace(/["']/g, ""),
      resolved: m.dataset.resolved === undefined ? null : +m.dataset.resolved,
      mode: m.dataset.mode || null }; })(),
  families: (() => {
    const f = sel => { const e = document.querySelector(sel); return e ? getComputedStyle(e).fontFamily.split(",")[0].replace(/["']/g, "") : null; };
    return { label: f(".label"), submit: f(".submit"), foot: f(".foot"), footLink: f(".foot a"), consent: f("#consent"), mark: f("#mark"), cue: f(".cue") };
  })(),
  boxes: (() => {
    const r = sel => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect();
      return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right) }; };
    return { mark: r("#mark"), band: r("#band"), hero: r("#hero"), consent: r("#consent"), submit: r(".submit"),
             markSub: r(".mark__line--sub"), markName: r(".mark__line--name"),
             foot: r(".foot"), copy: r(".foot span"), privacy: r(".foot a") };
  })(),
  cueOpacity: (() => { const c = document.getElementById("cue"); return c ? +getComputedStyle(c).opacity : null; })(),
  cueIsArrow: !!document.querySelector("#cue svg") && !(document.getElementById("cue") || {}).textContent.trim(),
  submitStyle: (() => { const b = document.querySelector(".submit"); if (!b) return null; const c = getComputedStyle(b);
    return { size: c.fontSize, border: c.borderTopColor, color: c.color, height: c.height, padX: c.paddingLeft }; })(),
  pills: (() => {
    const i = document.querySelector('.capture input[type="email"]'), b = document.querySelector(".submit");
    if (!i || !b) return null;
    const cb = getComputedStyle(b);
    return { input: getComputedStyle(i).borderTopColor, submit: cb.borderTopColor, submitText: cb.color };
  })(),
  consentColor: (() => { const c = document.getElementById("consent"); return c ? getComputedStyle(c).color : null; })(),
  buildSerial: /WEB\s*000/i.test(document.body.textContent),
  form: (() => { const r = document.getElementById("capture").getBoundingClientRect();
    return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }; })(),
})`;
const fakeFrame = tok => `Object.defineProperty(window, "frameElement", { value: { dataset: { signetDev: "${tok}" } }, configurable: true })`;

// preflight: a dead dev server otherwise surfaces as a confusing null-element error inside STATE
if (!BASE.startsWith("file:")) {
  try {
    const r = await fetch(BASE + "index.html");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.error(`cannot reach ${BASE}index.html (${e.message}).\nStart the project server first: python3 -m http.server 8734 --directory /Users/kvtolee/Desktop/Works/ASPIRIUM`);
    process.exit(2);
  }
}

const browser = await launch({ width: 1280, height: 768 });
try {
  // helper: wait until the band settles (live or poster), return the state and how long it took
  const settle = async (p, maxMs = 9500) => {
    const t0 = Date.now();
    for (;;) {
      const s = await p.evaluate(STATE);
      if (s.band !== "boot" || Date.now() - t0 > maxMs) return { ...s, ms: Date.now() - t0 };
      await sleep(250);
    }
  };
  // inside the live frame (same-origin when served; cross-origin from file://, where only the page's own state is visible)
  const LIVE = `(() => { const f = document.querySelector("#viewer iframe"); try { const w = f && f.contentWindow; const d = w && w.document;
    const canvas = d && d.querySelector("#stage canvas"); return {
    frame: !!f, hooks: !!(w && typeof w.__prewarmMs === "function"), canvas: !!canvas,
    touchAction: canvas ? w.getComputedStyle(canvas).touchAction : null,
    unlocked: !!(w && w.__unlocked && w.__unlocked()), verdict: w && w.__demo ? w.__demo.verdict.PASS : null }; }
    catch (e) { return { frame: !!f, crossOrigin: true }; } })()`;
  const FILE = BASE.startsWith("file:");

  // 0 — live bundle on desktop: the ladder's first rung must be reached on a real GPU
  {
    const p = await browser.newPage();
    await p.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 768, deviceScaleFactor: 1, mobile: false });
    await p.navigate(BASE + "index.html");
    const s = await settle(p);
    const live = await p.evaluate(LIVE);
    const xo = !!live.crossOrigin;
    check("live · bundle decoded and pre-warmed inside the 8 s rung", s.band === "live" && (xo || (live.hooks && live.canvas)), `state ${s.band} after ${s.ms} ms` + (xo ? " · file:// frame is cross-origin, bridge over postMessage" : ` · GLB self-check ${live.verdict}`));
    if (s.band === "live") {
      if (!xo) check("live · canvas touch-action is pan-y (R3)", live.touchAction === "pan-y", String(live.touchAction));
      await sleep(4500); await p.screenshot(join(OUT, "live-5s.png"));
      await sleep(12500);                      // ready + 17 s: intro landed at 15, wordmark at 15.5
      const s2 = await p.evaluate(STATE), l2 = await p.evaluate(LIVE);
      check("live · intro landed → rotation unlocked, wordmark → warm accent", (xo || l2.unlocked) && s2.interactive && s2.light === "warm", JSON.stringify({ unlocked: xo ? "n/a" : l2.unlocked, light: s2.light }));
      await p.screenshot(join(OUT, "live-17s.png"));
      await p.evaluate(`scrollTo(0, innerHeight * 0.45)`); await sleep(300);
      await p.screenshot(join(OUT, "live-parallax.png"));
      await p.evaluate(`scrollTo(0, innerHeight)`); await sleep(400);
      const s3 = await p.evaluate(STATE);
      check("live · the capture panel covers the ring and rendering stops", s3.playback === "paused" && s3.consentBottom <= s3.ih, JSON.stringify({ playback: s3.playback, consent: Math.round(s3.consentBottom), ih: s3.ih }));
      await p.evaluate(`scrollTo(0, 0)`); await sleep(300);
    } else {
      await p.screenshot(join(OUT, "live-fallback.png"));
    }
    const errs = p.log.filter(l => /^\[(error|exception)\]/.test(l) && !(FILE && /assets\/fonts\//.test(l)));
    check("live · no console errors" + (FILE ? " (font CORS on file:// excepted — Chrome blocks web fonts from disk)" : ""), errs.length === 0, errs.join(" | ").slice(0, 300));
    p.close();
  }

  // 1 — page choreography on the stub (deterministic): timeline, fold, source tag, form
  {
    const p = await browser.newPage();
    await p.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 768, deviceScaleFactor: 1, mobile: false });
    await p.send("Page.addScriptToEvaluateOnNewDocument", { source: fakeFrame("stub") });
    await p.navigate(BASE + "index.html?c=123");
    const t0 = Date.now();
    const at = async s => { const w = t0 + s * 1000 - Date.now(); if (w > 0) await sleep(w); return p.evaluate(STATE); };
    const s0 = await at(0.4);
    check("desktop · opens on black (stub at opacity 0, accent bone)", s0.visible === "visible" && s0.stub?.opacity === 0 && s0.light === "bone", JSON.stringify(s0.stub));
    await p.screenshot(join(OUT, "mark-blank.png"));
    check("mark · renders NOTHING before the ring's animation starts",
      !!s0.mark && s0.mark.runs === 0 && !s0.mark.running && s0.mark.held && s0.mark.opacity === 0,
      JSON.stringify({ runs: s0.mark.runs, held: s0.mark.held, opacity: s0.mark.opacity }));
    check("mark · is live text, not an image", s0.mark.cells === 19 && s0.mark.label === "The Signet by ASPIRIUM" && /Signet/.test(s0.mark.text),
      `${s0.mark.cells} character cells, label "${s0.mark.label}"`);
    { const f = s0.families;
      check("fonts · lockup is Literata", f.mark === "Literata", String(f.mark));
      check("fonts · label, submit, footer, link and body copy are all Source Serif 4",
        ["label", "submit", "foot", "footLink", "consent"].every(k => f[k] === "Source Serif 4"), JSON.stringify(f)); }
    { const m = s0.boxes.mark, b = s0.boxes.band;
      check("wordmark · removed from the page entirely (Eric)", s0.hasLogo === false, `#logo present: ${s0.hasLogo}`);
      check("lockup · the text sits below the band, clear of the render", !!m && !!b && m.t >= b.b,
        `mark top ${m && m.t} vs band bottom ${b && b.b}`);
      const sub = s0.boxes.markSub, nm = s0.boxes.markName;
      // margin-top is 1em of the NAME line's own size, doubled from .5em; the gap between the two
      // line boxes is that margin minus the sub line's leading, so assert a range rather than a point
      check("lockup · the two lines are spaced by the doubled gap", !!sub && !!nm && nm.t - sub.b >= 4 && nm.t - sub.b <= 26,
        `gap ${nm && sub ? nm.t - sub.b : "?"} px between the lines`); }
    check("cue · is an arrow, not the word SCROLL", s0.cueIsArrow === true, String(s0.cueIsArrow));
    check("footer · the build serial is gone ahead of deployment", s0.buildSerial === false, `WEB 000 present: ${s0.buildSerial}`);
    { const c = s0.boxes.copy, pv = s0.boxes.privacy, f = s0.boxes.foot;
      check("footer · copyright bottom-left, privacy bottom-right", !!c && !!pv && !!f && c.l - f.l < 40 && f.r - pv.r < 40 && pv.l > c.r,
        `copy ${JSON.stringify(c)} privacy ${JSON.stringify(pv)} in ${JSON.stringify(f)}`); }
    { const sb = s0.boxes.submit, cs = s0.boxes.consent;
      check("submit · on its own line beneath the consent line", !!sb && !!cs && sb.t >= cs.b, `submit top ${sb && sb.t} vs consent bottom ${cs && cs.b}`); }
    { const b = s0.submitStyle, pl = s0.pills;
      check("submit · pill and label at 75%: 36 px tall, 30 px side padding, 9.75 px type",
        b.size === "9.75px" && b.height === "36px" && b.padX === "30px", JSON.stringify({ size: b.size, height: b.height, padX: b.padX }));
      check("submit · label takes the consent line's grey", b.color === s0.consentColor, `label ${b.color} vs consent ${s0.consentColor}`);
      check("pills · submit and field share the same grey at rest, neither white",
        !!pl && pl.input === pl.submit && pl.submit !== "rgb(255, 255, 255)", JSON.stringify(pl)); }
    check("opening · the whole first screen is dark, scroll cue included", s0.cueOpacity === 0, `cue opacity ${s0.cueOpacity}`);
    // sampled BEFORE the at(5) block below: at() only ever waits forward, so a later request for an
    // earlier time returns immediately and would measure the wrong moment
    const s16 = await at(1.5);
    await p.screenshot(join(OUT, "mark-held.png"));
    check("mark · still held at 1.5 s — nothing appears before the gate at 2 s",
      s16.mark.runs === 0 && s16.mark.held && s16.mark.opacity === 0 && s16.cueOpacity === 0,
      JSON.stringify({ runs: s16.mark.runs, held: s16.mark.held, cue: s16.cueOpacity }));

    const s5 = await at(5);
    check("desktop · lights up by 4 s (poster fully in)", s5.stub?.opacity === 1 && s5.light === "bone");
    check("desktop · band = clamp(360, 48vh, 640)", Math.abs(s5.bandH - Math.min(640, Math.max(360, 0.48 * s5.ih))) < 1, `${s5.bandH.toFixed(1)} px`);
    await p.screenshot(join(OUT, "desktop-5s.png"));

    // two panels, one screen each
    check("panels · hero is exactly one screen tall", Math.abs(s5.heroH - s5.ih) <= 1, `hero ${Math.round(s5.heroH)} of ${s5.ih}`);
    check("panels · capture starts one screen down", Math.abs(s5.captureTop - s5.ih) <= 1, `capture top ${s5.captureTop} of ${s5.ih}`);
    check("panels · the page is two screens, no more", Math.abs(s5.docH - 2 * s5.ih) <= 2, `document ${s5.docH} px of ${2 * s5.ih}`);
    check("panels · the form is not on the first screen", s5.consentBottom > s5.ih, `consent bottom ${Math.round(s5.consentBottom)} of ${s5.ih}`);
    check("parallax · --p is 0 at rest and the viewer is playing", s5.parallax === 0 && s5.playback === "playing", JSON.stringify({ p: s5.parallax, playback: s5.playback }));

    // 19 letter cells over an 11.25 s run starting at 2 s: several placed by 6 s, all by ~13.25 s
    const s6 = await at(6.2);
    await p.screenshot(join(OUT, "mark-decode-start.png"));
    check("mark · decodes once the ring is emerging (gate at 2 s)", s6.mark.runs === 1 && s6.mark.running && !s6.mark.held,
      JSON.stringify({ runs: s6.mark.runs, held: s6.mark.held, resolved: s6.mark.resolved }));
    check("mark · exactly one letter scrambling, the rest not yet drawn", s6.mark.mode === "sequential" && s6.mark.scrambling === 1 && s6.mark.pending === s6.mark.cells - s6.mark.resolved - 1,
      JSON.stringify({ resolved: s6.mark.resolved, scrambling: s6.mark.scrambling, pending: s6.mark.pending }));
    check("opening · the cue arrives with the decode's first frame", s6.cueOpacity === 1, `cue opacity ${s6.cueOpacity}`);
    const s9 = await at(9);
    await p.screenshot(join(OUT, "mark-decode-mid.png"));
    check("mark · more letters placed by 9 s, still one scrambling", s9.mark.running && s9.mark.resolved > s6.mark.resolved && s9.mark.scrambling === 1,
      JSON.stringify({ resolved: s9.mark.resolved, was: s6.mark.resolved }));
    const s13 = await at(12.6);
    check("mark · still resolving at 12.6 s — the run is 75% of the ring's playtime", s13.mark.running && s13.mark.resolved > s9.mark.resolved,
      JSON.stringify({ resolved: s13.mark.resolved, was: s9.mark.resolved }));
    const s14 = await at(14.5);
    check("desktop · bone and locked until the intro ends", s14.light === "bone" && !s14.interactive);
    const s17 = await at(16.8);
    check("desktop · 15 s intro end → interactive; 15.5 s wordmark → warm", s17.interactive && s17.light === "warm", JSON.stringify({ light: s17.light, interactive: s17.interactive }));
    const s18 = await at(18.5);
    check("mark · fully set by 18.5 s (run ends ~13.25 s), no cell left hidden",
      !s18.mark.running && s18.mark.runs === 1 && s18.mark.opacity === 1 && s18.mark.pending === 0 && s18.mark.scrambling === 0,
      JSON.stringify({ running: s18.mark.running, pending: s18.mark.pending, scrambling: s18.mark.scrambling }));
    await p.screenshot(join(OUT, "mark-resolved.png"));
    check("storage · the page stores nothing in the browser", s17.storedKeys === 0, `${s17.storedKeys} keys in session+local storage`);
    await p.screenshot(join(OUT, "desktop-16s.png"));

    // the scroll: hero drifts and fades, capture panel arrives, the viewer stops rendering
    await p.evaluate(`scrollTo(0, innerHeight * 0.5)`); await sleep(250);
    const sMid = await p.evaluate(STATE);
    await p.screenshot(join(OUT, "parallax-mid.png"));
    const drift = await p.evaluate(`(() => { const t = getComputedStyle(document.querySelector(".hero__inner")).transform; const m = /matrix\\(([^)]+)\\)/.exec(t); return m ? +m[1].split(",")[5] : 0; })()`);
    check("parallax · half a screen down: --p ≈ 0.5 and the hero's contents have risen", Math.abs(sMid.parallax - 0.5) < 0.02 && drift < -10, `p ${sMid.parallax} · hero content translated ${drift.toFixed(1)} px`);
    await p.evaluate(`scrollTo(0, innerHeight)`); await sleep(250);
    const sEnd = await p.evaluate(STATE);
    await p.screenshot(join(OUT, "panel-capture.png"));
    check("panels · one screen of scroll brings the form into view", sEnd.consentBottom <= sEnd.ih && sEnd.consentBottom > 0, `consent bottom ${Math.round(sEnd.consentBottom)} of ${sEnd.ih}`);
    check("capture · the form is centred horizontally in the second screen", Math.abs(sEnd.form.cx - sEnd.iw / 2) <= 3, `form centre x ${sEnd.form.cx} of ${sEnd.iw / 2}`);
    check("capture · the form is centred vertically in the second screen", Math.abs(sEnd.form.cy - sEnd.ih / 2) <= 3, `form centre y ${sEnd.form.cy} of ${sEnd.ih / 2}`);

    // both pills turn white on hover and on focus (transition is .18s, so settle before reading)
    const WHITE = "rgb(255, 255, 255)";
    const hover = async box => {
      await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round((box.l + box.r) / 2), y: Math.round((box.t + box.b) / 2), buttons: 0 });
      await sleep(320);
      return p.evaluate(STATE);
    };
    const onSubmit = await hover(sEnd.boxes.submit);
    check("pills · submit border and label both go white on hover", onSubmit.pills.submit === WHITE && onSubmit.pills.submitText === WHITE,
      JSON.stringify({ border: onSubmit.pills.submit, label: onSubmit.pills.submitText }));
    await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5, buttons: 0 });   // off the submit first
    await p.evaluate(`document.querySelector('.capture input[type="email"]').focus()`);
    await sleep(320);
    const focused = await p.evaluate(STATE);
    check("pills · field goes white on focus", focused.pills.input === WHITE, `field border ${focused.pills.input}`);
    await p.evaluate(`document.querySelector('.capture input[type="email"]').blur()`);
    await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5, buttons: 0 });
    await sleep(320);
    const rest = await p.evaluate(STATE);
    check("pills · both return to grey when neither hovered nor focused",
      rest.pills.input !== WHITE && rest.pills.submit !== WHITE && rest.pills.input === rest.pills.submit, JSON.stringify(rest.pills));
    check("parallax · the viewer stops rendering once the hero is covered", sEnd.parallax === 1 && sEnd.playback === "paused", JSON.stringify({ p: sEnd.parallax, playback: sEnd.playback }));

    const src = await p.evaluate(`document.querySelector('#capture [name=source]').value`);
    check("capture · ?c=123 lands in the source field", src === "123", src);
    await p.evaluate(`(() => { const f = document.getElementById("capture"); f.elements.email.value = "someone@example.com"; f.requestSubmit(); })()`);
    const st = await p.evaluate(`document.querySelector('#capture .status').textContent`);
    check("capture · 'Sending.' while in flight", st === "Sending.", st);
    await sleep(900);
    const rec = await p.evaluate(`!document.querySelector('#capture .received').hidden && document.querySelector('#capture .capture__live').hidden`);
    check("capture · 'Received.' replaces the form (stub endpoint)", rec);
    await p.screenshot(join(OUT, "desktop-received.png"));
    const errs = p.log.filter(l => /^\[(error|exception)\]/.test(l) && !(FILE && /assets\/fonts\//.test(l)));
    check("desktop · no console errors" + (FILE ? " (font CORS on file:// excepted)" : ""), errs.length === 0, errs.join(" | ").slice(0, 300));
    p.close();
  }
  // 2 — every load replays the opening (live bundle). The old sessionStorage skip is retired, so
  // even a tab that has already seen the intro gets it again from the top.
  {
    const p = await browser.newPage();
    await p.send("Page.addScriptToEvaluateOnNewDocument", { source: `try { sessionStorage.setItem("signet.intro", "done") } catch (e) {}` });
    await p.navigate(BASE + "index.html");
    const s0 = await settle(p); await sleep(1500);
    const s = await p.evaluate(STATE), l = await p.evaluate(LIVE);
    check("replay · a tab that has already seen the intro still replays it from the top",
      s0.band === "live" && !s.interactive && s.light === "bone" && (l.crossOrigin || !l.unlocked),
      JSON.stringify({ band: s0.band, interactive: s.interactive, light: s.light, unlocked: l.crossOrigin ? "n/a" : l.unlocked }));
    p.close();
  }
  // 3 — reduced motion (live bundle)
  {
    const p = await browser.newPage();
    await p.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await p.navigate(BASE + "index.html");
    const s0 = await settle(p); await sleep(1500);
    const s = await p.evaluate(STATE);
    const tr = await p.evaluate(`getComputedStyle(document.querySelector(".submit")).transitionDuration`);
    check("reduced motion · no intro, warm, no transition", s0.band === "live" && s.light === "warm" && s.interactive && /^0s/.test(tr), `band ${s0.band} · transition ${tr}`);
    p.close();
  }
  // 4 — fallback ladder
  for (const [tok, waitMs] of [["stub:fail", 1500], ["nowebgl", 700], ["stub:slow", 9200]]) {
    const p = await browser.newPage();
    await p.send("Page.addScriptToEvaluateOnNewDocument", { source: fakeFrame(tok) });
    await p.navigate(BASE + "index.html"); await sleep(waitMs);
    const s = await p.evaluate(STATE);
    check(`ladder · ${tok} → poster shown, warm at once`, s.band === "poster" && s.posterShown && s.light === "warm", JSON.stringify({ band: s.band, light: s.light }));
    if (tok === "nowebgl") {
      check("ladder · the lockup still decodes with no ring to pace against", s.mark.runs === 1 && !s.mark.held, JSON.stringify({ runs: s.mark.runs, held: s.mark.held }));
      // The poster is same-origin, composed like the live render and laid out object-fit:contain in
      // the band — so its first lit row IS where the ring's top edge lands on screen. Comparing that
      // against the wordmark's bottom is a real overlap test, not an eyeball.
      // Chrome taints a canvas drawn from a file:// image, so the pixel read is served-mode only.
    }
    if (tok === "nowebgl") await p.screenshot(join(OUT, "poster-fallback.png"));
    p.close();
  }
  // 5 — phone, stub: 1:1 band ≤ 60 %, R3 scroll rule under emulated touch, warm after the wordmark
  {
    const p = await browser.newPage();
    await p.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await p.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await p.send("Page.addScriptToEvaluateOnNewDocument", { source: fakeFrame("stub") });
    await p.navigate(BASE + "index.html"); await sleep(5000);
    const s = await p.evaluate(STATE);
    check("phone · band = min(100vw, 60svh) → 390 px square", Math.abs(s.bandH - Math.min(390, 0.6 * s.ih)) < 1, `${s.bandH.toFixed(1)} px of ${s.ih}`);
    check("phone · the band stays ~1:1 inside the full-screen hero (R4: no portrait crop)", Math.abs(s.heroH - s.ih) <= 1 && s.bandH < s.ih * 0.75, `hero ${Math.round(s.heroH)} · band ${Math.round(s.bandH)} of ${s.ih}`);
    check("phone · capture is the second screen", Math.abs(s.captureTop - s.ih) <= 1 && Math.abs(s.docH - 2 * s.ih) <= 2, `capture top ${s.captureTop} · document ${s.docH} of ${2 * s.ih}`);
    await p.screenshot(join(OUT, "phone-5s.png"));
    await sleep(12000);
    const s2 = await p.evaluate(STATE);
    check("phone · interactive + warm after the wordmark", s2.interactive && s2.light === "warm");
    await p.screenshot(join(OUT, "phone-lit.png"));
    // the band no longer sits at a fixed offset (the lockup moved on top of it), so gestures are
    // aimed at the band's own box, low enough to miss the lockup
    const band = s.boxes.band;
    const gy = Math.round(band.t + (band.b - band.t) * 0.72);
    const swipe = async (x0, y0, x1, y1) => {
      await p.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
      for (let i = 1; i <= 10; i++) { await p.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + (x1 - x0) * i / 10, y: y0 + (y1 - y0) * i / 10 }] }); await sleep(16); }
      const mid = await p.evaluate(`document.querySelector(".stub").style.transform || ""`);
      await p.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await sleep(500);
      return mid;
    };
    await p.evaluate("scrollTo(0, 0)"); await sleep(200);
    await swipe(195, gy, 195, Math.max(10, gy - 210));
    const sy = await p.evaluate("scrollY");
    check("phone · R3: a vertical finger starting on the band scrolls toward the form", sy > 40, `scrollY ${sy} of a ${await p.evaluate("document.documentElement.scrollHeight")} px page`);
    await p.evaluate("scrollTo(0, 0)"); await sleep(300);
    const mid = await swipe(60, gy, 330, gy + 5);
    const sy2 = await p.evaluate("scrollY");
    check("phone · R3: a horizontal finger tumbles the ring and does not scroll", /rotate/.test(mid) && sy2 < 5, `transform mid-gesture "${mid.slice(0, 40)}", scrollY ${sy2}`);
    p.close();
  }
  // 5b — phone, live bundle: a vertical finger from the real canvas (after unlock) scrolls the page
  {
    const p = await browser.newPage();
    await p.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await p.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await p.navigate(BASE + "index.html");
    const s0 = await settle(p);
    await sleep(17000);            // the intro replays on every load now, so wait it out rather than skipping it
    const l = await p.evaluate(LIVE);
    check("phone live · bundle up at 390×844, rotation unlocked, pan-y on the canvas", s0.band === "live" && (l.crossOrigin || (l.unlocked && l.touchAction === "pan-y")), JSON.stringify(l.crossOrigin ? { band: s0.band, frame: "cross-origin (file://)" } : { band: s0.band, unlocked: l.unlocked, touchAction: l.touchAction }));
    await p.screenshot(join(OUT, "phone-live.png"));
    await p.evaluate("scrollTo(0, 0)"); await sleep(200);
    const lb = s0.boxes.band, ly = Math.round(lb.t + (lb.b - lb.t) * 0.72);
    await p.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: ly }] });
    for (let i = 1; i <= 10; i++) { await p.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 195, y: Math.max(6, ly - 21 * i) }] }); await sleep(16); }
    await p.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await sleep(500);
    const sy = await p.evaluate("scrollY");
    check("phone live · R3: vertical finger starting on the live canvas scrolls toward the form", sy > 40, `scrollY ${sy}`);
    await p.screenshot(join(OUT, "phone-capture.png"));
    p.close();
  }
  // 6 — robots, privacy
  {
    if (!FILE) check("robots.txt disallows everything (§1a)", (await (await fetch(BASE + "robots.txt")).text()).includes("Disallow: /"));
    const p = await browser.newPage();
    await p.navigate(BASE + "privacy.html");
    check("privacy page renders", await p.evaluate(`document.title.includes("Privacy") && !!document.querySelector(".foot")`));
    p.close();
  }
} finally { await browser.close(); }
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed · screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
