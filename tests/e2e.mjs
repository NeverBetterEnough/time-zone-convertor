import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const results = path.join(root, "test-results");
await mkdir(results, { recursive:true });
const profile = await mkdtemp(path.join(results, "profile-"));
const workerSource = `const report=()=>({zone:Intl.DateTimeFormat().resolvedOptions().timeZone,jan:new Date('2026-01-15T12:00:00Z').getTimezoneOffset(),jul:new Date('2026-07-15T12:00:00Z').getTimezoneOffset()});onmessage=()=>postMessage(report());`;
const sharedSource = `onconnect=e=>{const p=e.ports[0];p.onmessage=()=>p.postMessage({zone:Intl.DateTimeFormat().resolvedOptions().timeZone});p.start()};`;
const serviceSource = `self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('message',e=>e.ports[0].postMessage({zone:Intl.DateTimeFormat().resolvedOptions().timeZone}));`;
let port;
const server = createServer((req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/worker.js") { res.setHeader("Content-Type", "text/javascript"); res.end(workerSource); }
  else if (req.url === "/shared.js") { res.setHeader("Content-Type", "text/javascript"); res.end(sharedSource); }
  else if (req.url === "/service.js") { res.setHeader("Content-Type", "text/javascript"); res.end(serviceSource); }
  else if (req.url === "/nested.js") { res.setHeader("Content-Type", "text/javascript"); res.end(`const nested=new Worker('/worker.js');onmessage=()=>{nested.onmessage=e=>postMessage(e.data);nested.postMessage('probe')}`); }
  else {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    const frame = req.url === "/frame";
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${frame ? "跨域子页面" : "时区测试网页"}</title></head><body><h1>${frame ? "Cross-origin iframe" : "Timezone test fixture"}</h1><script>window.initialZone=Intl.DateTimeFormat().resolvedOptions().timeZone;</script>${frame ? "" : `<iframe src="http://localhost:${port}/frame"></iframe>`}</body></html>`);
  }
});
await new Promise(resolve => server.listen(0, resolve));
port = server.address().port;
const url = `http://127.0.0.1:${port}/`;
const evidence = { date:new Date().toISOString(), checks:[] };
let context;
const check = (name, details) => { evidence.checks.push({ name, result:"passed", ...details }); console.log(`PASS ${name}`); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(job, expected, timeout = 12000) {
  const until = Date.now() + timeout;
  let actual;
  do {
    try { actual = await job(); if (JSON.stringify(actual) === JSON.stringify(expected)) return actual; } catch (error) { actual = error.message; }
    await delay(150);
  } while (Date.now() < until);
  assert.deepEqual(actual, expected);
}

try {
  const options = {
    channel:"chromium", headless:true, viewport:{ width:1120, height:900 },
    args:[`--disable-extensions-except=${root}`, `--load-extension=${root}`, "--site-per-process", "--no-first-run"]
  };
  if (process.env.CHROMIUM_PATH) options.executablePath = process.env.CHROMIUM_PATH;
  context = await chromium.launchPersistentContext(profile, options);
  context.setDefaultTimeout(15000);
  evidence.browser = context.browser()?.version();
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/diagnostics.html`);
  const baseline = await control.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const send = message => control.evaluate(async message => {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "no response");
    return response.data;
  }, message);
  const page = await context.newPage();
  await page.goto(url);
  const zone = () => page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  await eventually(zone, "Asia/Shanghai");
  const tabs = await control.evaluate(() => chrome.tabs.query({}));
  const tabId = tabs.find(tab => tab.url === url).id;
  check("default enable applies Shanghai to a newly opened page");

  await send({ type:"updateSettings", timeZone:"America/New_York", tabId });
  await eventually(zone, "America/New_York");
  const observed = await page.evaluate(() => ({ jan:new Date("2026-01-15T12:00:00Z").getTimezoneOffset(), jul:new Date("2026-07-15T12:00:00Z").getTimezoneOffset(), now:Date.now() }));
  assert.equal(observed.jan, 300); assert.equal(observed.jul, 240); assert.ok(Math.abs(observed.now - Date.now()) < 2500);
  check("New York uses native winter/summer offsets; timestamp is unchanged");
  const frame = page.frames().find(frame => frame.url().includes("localhost:"));
  await eventually(() => frame.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), "America/New_York");
  check("cross-origin out-of-process iframe inherits selected timezone");

  await page.evaluate(() => {
    window.testWorker = new Worker("/worker.js");
    window.nestedWorker = new Worker("/nested.js");
    window.sharedWorker = new SharedWorker("/shared.js");
    window.sharedWorker.port.start();
  });
  const probeWorker = name => page.evaluate(name => new Promise((resolve, reject) => {
    const worker = name === "sharedWorker" ? window[name].port : window[name];
    const timeout = setTimeout(() => reject(new Error(`${name} timed out`)), 8000);
    worker.onmessage = event => { clearTimeout(timeout); resolve(event.data); };
    worker.postMessage("probe");
  }), name);
  for (const name of ["testWorker", "nestedWorker", "sharedWorker"]) {
    assert.equal((await probeWorker(name)).zone, "America/New_York");
    check(`${name} observes New York and is not left paused`);
  }
  console.log("Checking Service Worker registration...");
  await page.evaluate(async () => {
    await Promise.race([
      (async () => { await navigator.serviceWorker.register("/service.js"); await navigator.serviceWorker.ready; })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Service Worker registration timeout")), 12000))
    ]);
  });
  const serviceZone = () => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => reject(new Error("service worker timed out")), 8000);
      channel.port1.onmessage = event => { clearTimeout(timeout); resolve(event.data.zone); };
      registration.active.postMessage("probe", [channel.port2]);
    });
  });
  assert.equal(await serviceZone(), "America/New_York");
  check("associated Service Worker observes New York");

  const page2 = await context.newPage();
  console.log("Checking second same-origin tab...");
  try { await page2.goto(`${url}?second`); }
  catch (error) {
    console.log("Second tab snapshot:", await page2.evaluate(() => ({ readyState:document.readyState, zone:Intl.DateTimeFormat().resolvedOptions().timeZone, html:document.documentElement.outerHTML.slice(0,2000) })));
    console.log("Frames:", page2.frames().map(frame => frame.url()));
    console.log("Extension status:", await send({ type:"getStatus", tabId }));
    throw error;
  }
  await eventually(() => page2.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), "America/New_York");
  await send({ type:"updateSettings", timeZone:"Asia/Kathmandu", tabId });
  await eventually(zone, "Asia/Katmandu");
  await eventually(() => page2.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), "Asia/Katmandu");
  assert.equal(await page.evaluate(() => new Date().getTimezoneOffset()), -345);
  for (const name of ["testWorker", "nestedWorker", "sharedWorker"]) assert.equal((await probeWorker(name)).zone, "Asia/Katmandu");
  check("timezone changes reach existing tabs and live workers; 45-minute offset works");

  const invalid = await control.evaluate(tabId => chrome.runtime.sendMessage({ type:"updateSettings", timeZone:"Mars/Base", enabled:false, tabId }), tabId);
  assert.equal(invalid.ok, false);
  let status = await send({ type:"getStatus", tabId });
  assert.equal(status.settings.enabled, true); assert.equal(status.settings.timeZone, "Asia/Katmandu");
  assert.equal(status.current.verified, true);
  check("invalid settings are rejected atomically and native status is verified");

  await page.goto(`${url}?navigation`);
  await eventually(zone, "Asia/Katmandu");
  check("navigation retains configured timezone");
  await send({ type:"updateSettings", enabled:false, tabId });
  await eventually(zone, baseline);
  await eventually(() => page2.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), baseline);
  status = await send({ type:"getStatus", tabId });
  assert.equal(status.current.status, "off");
  check("disable clears overrides on all attached tabs and restores system timezone", { baseline });

  await send({ type:"updateSettings", enabled:true, timeZone:"America/New_York", tabId });
  await eventually(zone, "America/New_York");
  await send({ type:"reloadCurrent", tabId });
  await page.waitForLoadState();
  await eventually(zone, "America/New_York");
  check("reenable and apply-and-reload work");

  // Open the real popup document in an inactive tab, keeping the tested web tab
  // active, so its tabs.query sees the same target as a toolbar popup.
  await page.bringToFront();
  const popupEvent = context.waitForEvent("page");
  await worker.evaluate(() => chrome.tabs.create({ url:chrome.runtime.getURL("popup.html"), active:false }));
  const popup = await popupEvent;
  await popup.waitForLoadState();
  await popup.waitForFunction(() => document.querySelector("#statusBadge").textContent.includes("检测通过"));
  await popup.waitForFunction(() => document.querySelector("#enabled").checked === true);
  await popup.setViewportSize({ width:400, height:600 });
  await popup.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
  const popupHeight = await popup.evaluate(() => document.querySelector("main").getBoundingClientRect().height);
  assert.ok(popupHeight <= 600, `Popup exceeds Chrome's 600px limit: ${popupHeight}`);
  await popup.screenshot({ path:path.join(results,"popup.png"), fullPage:true });
  await popup.locator("#zoneSearch").fill("东京");
  await popup.locator("#timeZone").selectOption("Asia/Tokyo");
  await popup.locator("#save").click();
  await eventually(zone, "Asia/Tokyo");
  check("Chinese search, popup save and actual webpage changes work");
  await control.bringToFront();
  await control.locator("#refreshTabs").click();
  await control.locator("#tabSelect").selectOption(String(tabId));
  await control.locator("#probe").click();
  await control.waitForFunction(() => document.querySelector("#actualZone").textContent === "Asia/Tokyo");
  await control.screenshot({ path:path.join(results,"diagnostics.png"), fullPage:true });
  check("diagnostic UI reads the webpage rather than the extension's own timezone");

  await context.close(); context = null;
  context = await chromium.launchPersistentContext(profile, options);
  let restartedWorker = context.serviceWorkers()[0];
  if (!restartedWorker) restartedWorker = await context.waitForEvent("serviceworker");
  const restartedPage = await context.newPage();
  await restartedPage.goto(url);
  await eventually(() => restartedPage.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), "Asia/Tokyo");
  check("browser restart restores saved enabled state and timezone");
  evidence.result = "passed";
} catch (error) {
  evidence.result = "failed"; evidence.error = error.stack;
  throw error;
} finally {
  if (context) await context.close();
  await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(results,"e2e-results.json"), JSON.stringify(evidence, null, 2));
  // Only remove the temporary profile created directly inside test-results.
  if (path.dirname(path.resolve(profile)) === path.resolve(results) && path.basename(profile).startsWith("profile-")) await rm(profile, { recursive:true, force:true });
}
