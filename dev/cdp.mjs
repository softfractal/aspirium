// dev/cdp.mjs — minimal DevTools-protocol client for the dev scripts. Node ≥ 22, no deps.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function launch({ chrome = CHROME, width = 1280, height = 768, args = [] } = {}) {
  const port = 9300 + Math.floor(Math.random() * 600);
  const profile = mkdtempSync(join(tmpdir(), "signet-cdp-"));
  const proc = spawn(chrome, [
    "--headless=new", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
    `--remote-debugging-port=${port}`, "--remote-allow-origins=*", `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`, ...args, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = ""; proc.stderr.on("data", d => { stderr += d; });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    try { await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); up = true; } catch { await sleep(250); }
  }
  if (!up) { proc.kill(); throw new Error("Chrome did not start\n" + stderr.slice(-600)); }
  const close = async () => {
    try { proc.kill(); } catch { /* gone */ }
    await sleep(500);
    rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  };

  const newPage = async () => {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let seq = 0; const pending = new Map(); const listeners = new Set();
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      else if (m.method) for (const l of listeners) l(m);
    };
    const send = (method, params = {}) => new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, m => m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result));
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const log = [];
    listeners.add(m => {
      if (m.method === "Runtime.consoleAPICalled") log.push(`[${m.params.type}] ` + m.params.args.map(a => a.value ?? a.description ?? "").join(" "));
      if (m.method === "Runtime.exceptionThrown") log.push("[exception] " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
      if (m.method === "Log.entryAdded") log.push(`[${m.params.entry.level}] ${m.params.entry.text} ${m.params.entry.url || ""}`);
    });
    await send("Runtime.enable"); await send("Page.enable"); await send("Log.enable");
    const navigate = async url => {
      const loaded = new Promise(res => { const l = m => { if (m.method === "Page.loadEventFired") { listeners.delete(l); res(); } }; listeners.add(l); });
      await send("Page.navigate", { url });
      await loaded;
    };
    const screenshot = async file => {
      const r = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(file, Buffer.from(r.data, "base64"));
      return file;
    };
    return { send, evaluate, navigate, screenshot, log, close: () => ws.close() };
  };
  return { newPage, close, port };
}
