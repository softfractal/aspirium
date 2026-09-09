#!/usr/bin/env node
// dev/measure-wordmark.mjs — measures a wordmark PNG for the decode effect (js/mark.js):
// per-letter boxes from column alpha coverage, the ink colour, the ink bounds, and a preview on
// black. Pass a URL under the project server so the canvas read is same-origin, e.g.
//   node dev/measure-wordmark.mjs http://localhost:8734/Vectors/Web/Intro.png --out preview.png
// Prints a JSON block to paste into js/config.js (wordmark.letters, normalised 0..1 of the image width).
import { writeFileSync } from "node:fs";
import { launch } from "./cdp.mjs";

import { readFileSync } from "node:fs";
let url = process.argv[2];
if (!url) { console.error("usage: node dev/measure-wordmark.mjs <image-url-or-path> [--out preview.png] [--merge 0.08]"); process.exit(1); }
// a local path is inlined as a data URL: no server needed, and data: images never taint the canvas
if (!/^https?:/.test(url)) url = "data:image/png;base64," + readFileSync(url).toString("base64");
const opt = (k, d) => { const i = process.argv.indexOf("--" + k); return i >= 0 ? process.argv[i + 1] : d; };
const MERGE = +opt("merge", 0.08);   // gaps narrower than this × ink height belong to the same letter
const out = opt("out", null);

const browser = await launch({ width: 1600, height: 420 });
try {
  const p = await browser.newPage();
  await p.navigate("about:blank");
  const m = await p.evaluate(`(async () => {
    document.body.style.cssText = "margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh";
    const img = new Image(); img.src = ${JSON.stringify(url)};
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("image failed to load")); });
    img.style.width = "1500px"; document.body.appendChild(img);
    const w = img.naturalWidth, h = img.naturalHeight;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, w, h).data;
    const col = new Float32Array(w), row = new Float32Array(h);
    let r = 0, gg = 0, b = 0, n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, a = d[i + 3];
      if (a > 16) { col[x] += a / 255; row[y] += a / 255; if (a > 250) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; } }
    }
    // row bands: runs of rows carrying ink (a lockup has one band per line)
    const bands = []; let inBand = false, y0 = 0;
    for (let y = 0; y <= h; y++) { const ink = y < h && row[y] > 0.5; if (ink && !inBand) { inBand = true; y0 = y; } if (!ink && inBand) { inBand = false; bands.push([y0, y]); } }
    // merge bands separated by less than 4 % of the image height (dots, hairline cuts)
    const rows = []; for (const b of bands) { const last = rows[rows.length - 1]; if (last && b[0] - last[1] < 0.04 * h) last[1] = b[1]; else rows.push([...b]); }
    // column runs per band, measured along sheared columns: an italic's letters overlap in straight
    // columns, so try slants 0…0.6 (tan) and keep the one that separates the most letters.
    // u = x − (yb − y)·tan: constant down a letter's slanted edge, equal to x at the band's bottom.
    const runsAt = (ya, yb, tan) => {
      const c = new Float32Array(w + Math.ceil((yb - ya) * tan) + 2);
      for (let y = ya; y < yb; y++) { const sh = (yb - y) * tan; for (let x = 0; x < w; x++) { const a = d[(y * w + x) * 4 + 3]; if (a > 16) { const u = Math.round(x - sh) + 1; if (u >= 0) c[u] += a / 255; } } }
      const segs = []; let run = false, start = 0;
      for (let u = 0; u <= c.length; u++) { const ink = u < c.length && c[u] > 0.5; if (ink && !run) { run = true; start = u - 1; } if (!ink && run) { run = false; segs.push([start, u - 1]); } }
      return segs;
    };
    const merge = (segs, bandH, k) => { const L = []; for (const s of segs) { const last = L[L.length - 1]; if (last && s[0] - last[1] < k * bandH) last[1] = s[1]; else L.push([...s]); } return L; };
    const out = rows.map(([ya, yb]) => {
      let best = null;
      for (let t = 0; t <= 0.6001; t += 0.02) {
        const segs = merge(runsAt(ya, yb, t), yb - ya, ${MERGE});
        if (!best || segs.length > best.segs.length) best = { tan: +t.toFixed(2), segs };
      }
      return { y: [ya, yb], slant: best.tan, segs: best.segs };
    });
    return { w, h, color: n ? [Math.round(r / n), Math.round(gg / n), Math.round(b / n)] : null, rows: out };
  })()`);
  const hex = m.color ? "#" + m.color.map(v => v.toString(16).padStart(2, "0")).join("") : null;
  console.log(`image ${m.w}×${m.h} · ink colour ${hex} · ${m.rows.length} row band(s)`);
  const rowsOut = m.rows.map(rw => {
    const bandH = rw.y[1] - rw.y[0];
    console.log(`  rows ${rw.y[0]}–${rw.y[1]} (height ${bandH}) · slant tan ${rw.slant} → letters ${rw.segs.length}: ${JSON.stringify(rw.segs)}`);
    // letters: [u0, u1] at the band's bottom edge, normalised to the image width; slant = tan of the lean
    return { ink: [+(rw.y[0] / m.h).toFixed(4), +(rw.y[1] / m.h).toFixed(4)], slant: rw.slant, letters: rw.segs.map(([a, b]) => [+(a / m.w).toFixed(4), +(b / m.w).toFixed(4)]) };
  });
  console.log("\n// paste into js/config.js → wordmark.rows / wordmark.color:");
  console.log(JSON.stringify({ rows: rowsOut, color: hex }));
  if (out) { await p.screenshot(out); console.log("preview:", out); }
  p.close();
} finally { await browser.close(); }
