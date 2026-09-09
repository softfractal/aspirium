#!/usr/bin/env node
// dev/capture-poster.mjs — renders the fallback poster (end pose, screen lit, wordmark
// visible) from the pipeline's reference build in headless Chrome, driven over the
// DevTools protocol with the build's own verification hooks (__setSize/__setTime/
// __advance/__step — they render without requestAnimationFrame, which headless
// suspends). No dependencies: Node ≥ 22 (global fetch + WebSocket).
//
//   node dev/capture-poster.mjs --w 2000 --h 1000 --out assets/poster/signet-end-pose-2x1.png
//   node dev/capture-poster.mjs --w 1200 --h 1200 --out assets/poster/signet-end-pose-1x1.png
//   options: --hold 3 (seconds of power_on to run; wordmark is full by ~2.5 s) · --chrome PATH · --keep (leave Chrome running)
//
// Re-run after every rebake (build.sh in three-viewer/demo) so the poster and the live
// render never drift apart. The poster is interim: a Cycles frame from the pipeline
// replaces it when one exists (brief §5).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const W = +opt("w", 2000), H = +opt("h", 1000), HOLD = +opt("hold", 3);
const here = dirname(fileURLToPath(import.meta.url));
const REF = resolve(here, "../../three-viewer/demo/aspirium_glb_check.html");
const out = resolve(opt("out", `poster_${W}x${H}.png`));
const chrome = opt("chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const port = 9300 + Math.floor(Math.random() * 600);
const profile = mkdtempSync(join(tmpdir(), "signet-poster-"));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const proc = spawn(chrome, [
  "--headless=new", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
  `--remote-debugging-port=${port}`, "--remote-allow-origins=*", `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, "--force-device-scale-factor=1", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let stderr = ""; proc.stderr.on("data", d => { stderr += d; });
const cleanup = () => { if (!argv.includes("--keep")) { try { proc.kill(); } catch {} } rmSync(profile, { recursive: true, force: true }); };
process.on("exit", cleanup);

try {
  let version = null;
  for (let i = 0; i < 60 && !version; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(250); }
  }
  if (!version) throw new Error("Chrome did not open a debugging port\n" + stderr.slice(-800));
  const url = pathToFileURL(REF).href + "?dpr=1";
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, m => m.error ? rej(new Error(m.error.message)) : res(m.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await send("Runtime.enable");

  const t0 = Date.now();
  let status = "";
  for (;;) {
    status = await evaluate(`typeof window.__prewarmMs === "function" ? "READY" : ((document.getElementById("status") || {}).textContent || "")`);
    if (status === "READY") break;
    if (/LOAD ERROR/.test(status)) throw new Error("viewer: " + status);
    if (Date.now() - t0 > 120000) throw new Error("timeout waiting for the viewer: " + status);
    await sleep(500);
  }
  console.log(`viewer ready in ${((Date.now() - t0) / 1000).toFixed(1)} s · ` + await evaluate(`JSON.stringify(window.__demo && window.__demo.verdict)`));

  const dataUrl = await evaluate(`(() => {
    const dur = parseFloat(document.getElementById("scrub").max);
    __freeze(false);
    __setSize(${W}, ${H});
    __setTime(dur - 0.02);
    __advance(0.05);                                   // lands the intro: unlock + auto power_on
    for (let i = 0; i < ${Math.round(HOLD * 20)}; i++) __advance(0.05);
    __step();                                          // render the held frame synchronously
    return document.querySelector("#stage canvas").toDataURL("image/png");
  })()`);
  const png = Buffer.from(dataUrl.split(",")[1], "base64");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);
  console.log(`wrote ${out} (${(png.length / 1024).toFixed(0)} KB, ${W}×${H}) · ` + await evaluate(`__dbg()`));
  ws.close();
} catch (err) {
  console.error("capture failed:", err.message);
  process.exitCode = 1;
}
try { proc.kill(); } catch { /* already gone */ }
process.exit(process.exitCode ?? 0);
