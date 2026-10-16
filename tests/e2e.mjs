import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { toastExpression } from "../toast.js";

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
    if (req.url === "/strict") res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'none'; script-src 'none'");
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
const mainRules = timeZone => [{id:"main", name:"测试网页", enabled:true, type:"exact", pattern:"127.0.0.1", timeZone}];
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
    args:[`--disable-extensions-except=${root}`, `--load-extension=${root}`, "--silent-debugger-extension-api", "--site-per-process", "--no-first-run", "--host-resolver-rules=MAP *.test 127.0.0.1", "--no-proxy-server"]
  };
  if (process.env.CHROMIUM_PATH) options.executablePath = process.env.CHROMIUM_PATH;
  context = await chromium.launchPersistentContext(profile, options);
  context.setDefaultTimeout(15000);
  evidence.browser = context.browser()?.version();
  const versionPage = await context.newPage();
  await versionPage.goto("chrome://version");
  assert.match(await versionPage.locator("#command_line").textContent(),/--silent-debugger-extension-api/);
  await versionPage.close();
  check("isolated browser starts with the optional quiet debugger argument");
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
  const tabs = await control.evaluate(() => chrome.tabs.query({}));
  const tabId = tabs.find(tab => tab.url === url).id;
  await eventually(zone, baseline);
  let status = await send({type:"getStatus",tabId});
  assert.equal(status.current.status,"unmatched"); assert.equal(status.current.attached,false);
  const toast = page.locator("[data-timezone-switcher-toast]");
  assert.equal(await toast.count(),0);
  assert.equal(await page.evaluate(toastExpression("Asia/Tokyo")),false);
  assert.equal(await toast.count(),0);
  check("empty initial rules do not attach or change a webpage timezone");
  await send({ type:"updateSettings", rules:mainRules("Asia/Shanghai"), tabId });
  await eventually(zone, "Asia/Shanghai");
  check("only a matching hostname activates native timezone emulation");
  await toast.waitFor({state:"visible"});
  assert.match(await toast.getByRole("status").textContent(),/已切换至 Asia\/Shanghai/);
  await page.screenshot({path:path.join(results,"toast.png")});
  await toast.waitFor({state:"detached",timeout:4500});
  assert.equal(await zone(),"Asia/Shanghai");
  status = await send({type:"getStatus",tabId});
  assert.equal(status.current.attached,true);
  assert.equal(status.current.verified,true);
  check("success notice dismisses after 2.5 seconds while native timezone stays active");
  await page.evaluate(() => {
    window.noticeCount = 0;
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType === 1 && node.hasAttribute("data-timezone-switcher-toast")) window.noticeCount++;
      }
    }).observe(document.documentElement,{childList:true});
  });
  await send({type:"reapply",tabId});
  await send({type:"updateSettings",rules:mainRules("Asia/Shanghai"),tabId});
  assert.equal(await toast.count(),0);
  assert.equal(await page.evaluate(() => window.noticeCount),0);
  check("reapplying unchanged settings does not repeat or extend the notice");

  await page.goto(`${url}strict`);
  await toast.waitFor({state:"visible"});
  assert.match(await toast.getByRole("status").textContent(),/Asia\/Shanghai/);
  await toast.waitFor({state:"detached",timeout:4500});
  assert.equal(await zone(),"Asia/Shanghai");
  check("a new document receives one short notice even under restrictive page CSP");
  await page.goto(url);

  await send({ type:"updateSettings", rules:mainRules("America/New_York"), tabId });
  await eventually(zone, "America/New_York");
  await toast.waitFor({state:"visible"});
  assert.match(await toast.getByRole("status").textContent(),/America\/New_York/);
  assert.equal(await toast.count(),1);
  check("changing timezone replaces the notice with the new verified timezone");
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
  const outside = await context.newPage();
  await outside.goto(`http://outside.test:${port}/amazon?next=127.0.0.1`);
  await eventually(() => outside.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),baseline);
  const outsideId = await control.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id,outside.url());
  const outsideStatus = await send({type:"getStatus",tabId:outsideId});
  assert.equal(outsideStatus.current.status,"unmatched"); assert.equal(outsideStatus.current.attached,false);
  check("unmatched independent site keeps its timezone and path/query do not activate a rule");
  const other = await context.newPage();
  await other.goto(`http://tokyo.test:${port}/`);
  const tokyoRule = {id:"tokyo",enabled:true,type:"domain",pattern:"tokyo.test",timeZone:"Asia/Tokyo"};
  await send({type:"updateSettings",rules:[...mainRules("America/New_York"),tokyoRule],tabId});
  await eventually(zone,"America/New_York");
  await eventually(() => other.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),"Asia/Tokyo");
  check("different independently rendered domains can use different rule timezones simultaneously");
  await send({ type:"updateSettings", rules:[...mainRules("Asia/Kathmandu"),tokyoRule], tabId });
  await eventually(zone, "Asia/Katmandu");
  await eventually(() => page2.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), "Asia/Katmandu");
  assert.equal(await page.evaluate(() => new Date().getTimezoneOffset()), -345);
  for (const name of ["testWorker", "nestedWorker", "sharedWorker"]) assert.equal((await probeWorker(name)).zone, "Asia/Katmandu");
  check("timezone changes reach existing tabs and live workers; 45-minute offset works");

  const invalid = await control.evaluate(tabId => chrome.runtime.sendMessage({ type:"updateSettings", rules:[{id:"bad",type:"contains",pattern:"127",timeZone:"Mars/Base"}], enabled:false, tabId }), tabId);
  assert.equal(invalid.ok, false);
  status = await send({ type:"getStatus", tabId });
  assert.equal(status.settings.enabled, true); assert.equal(status.settings.rules[0].timeZone, "Asia/Katmandu");
  assert.equal(status.current.verified, true);
  check("invalid settings are rejected atomically and native status is verified");

  await page.goto(`${url}?navigation`);
  await eventually(zone, "Asia/Katmandu");
  check("navigation retains configured timezone");
  await page.goto(`http://outside.test:${port}/?from-matched`);
  await eventually(zone,baseline);
  status = await send({type:"getStatus",tabId});
  assert.equal(status.current.status,"unmatched"); assert.equal(status.current.attached,false);
  assert.equal(await toast.count(),0);
  check("navigating from matched to unmatched clears the plugin override and detaches");
  await page.goto(`${url}?back-to-matched`);
  await eventually(zone,"Asia/Katmandu");
  await send({ type:"updateSettings", enabled:false, tabId });
  assert.equal(await toast.count(),0);
  await eventually(zone, baseline);
  await eventually(() => page2.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), baseline);
  status = await send({ type:"getStatus", tabId });
  assert.equal(status.current.status, "off");
  check("disable clears overrides on all attached tabs and restores system timezone", { baseline });

  await send({ type:"updateSettings", enabled:true, rules:mainRules("America/New_York"), tabId });
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
  const editorEvent = context.waitForEvent("page");
  await popup.locator("#manageRules").click();
  const editor = await editorEvent;
  await editor.waitForLoadState();
  await editor.waitForFunction(() => document.querySelector("#saveState").textContent === "已保存");
  await editor.locator(".rule .fields input").nth(1).fill("Asia/Tokyo");
  await editor.locator("#save").click();
  await eventually(zone, "Asia/Tokyo");
  await editor.waitForFunction(() => document.querySelector("#saveState").textContent === "已保存");
  await editor.locator("#testHost").fill("http://127.0.0.1:12345/path");
  await editor.locator("#testRule").click();
  assert.match(await editor.locator("#testResult").textContent(),/Asia\/Tokyo/);
  check("popup opens rule editor; saving a rule and testing hostname with ignored port work");
  await control.bringToFront();
  await control.locator("#refreshTabs").click();
  await control.locator("#tabSelect").selectOption(String(tabId));
  await control.locator("#probe").click();
  await control.waitForFunction(() => document.querySelector("#actualZone").textContent === "Asia/Tokyo");
  await control.screenshot({ path:path.join(results,"diagnostics.png"), fullPage:true });
  check("diagnostic UI reads the webpage rather than the extension's own timezone");

  await editor.bringToFront();
  await editor.locator("#addRule").click();
  let last = editor.locator(".rule").last();
  await last.locator(".fields select").selectOption("contains");
  await last.locator(".fields input").nth(0).fill("amazon");
  await last.locator(".fields input").nth(1).fill("UTC");
  await last.locator(".rule-top input[type=text]").fill("域名包含字段");
  await editor.locator("#save").click();
  await editor.waitForFunction(() => document.querySelector("#saveState").textContent === "已保存");
  const amazon = await context.newPage();
  await amazon.goto(`http://shop.amazon.test:${port}/`);
  await eventually(() => amazon.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),"UTC");
  await eventually(() => outside.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),baseline);
  check("contains rule activates matching domains while a path-only keyword remains unmatched");
  await editor.screenshot({path:path.join(results,"rules.png"),fullPage:true});

  await editor.locator("#addRule").click();
  last = editor.locator(".rule").last();
  await last.locator(".fields select").selectOption("contains");
  await last.locator(".fields input").nth(0).fill("127");
  await last.locator(".fields input").nth(1).fill("America/New_York");
  await editor.locator("#save").click();
  await editor.waitForFunction(() => document.querySelector("#saveState").textContent === "已保存");
  await eventually(zone,"Asia/Tokyo");
  await editor.locator(".rule").last().getByRole("button",{name:"上移",exact:true}).click();
  await editor.locator(".rule").nth(1).getByRole("button",{name:"上移",exact:true}).click();
  await editor.locator("#save").click();
  await eventually(zone,"America/New_York");
  await editor.waitForFunction(() => document.querySelector("#saveState").textContent === "已保存");
  await editor.locator(".rule").first().getByRole("checkbox").uncheck();
  await editor.locator("#save").click();
  await eventually(zone,"Asia/Tokyo");
  await editor.waitForFunction(() => document.querySelector("#saveState").textContent === "已保存");
  check("rule ordering and disabling change the first matching timezone through the UI");
  while (await editor.locator(".rule").count()) await editor.locator(".rule").first().getByRole("button",{name:"删除",exact:true}).click();
  await editor.locator("#save").click();
  await eventually(zone,baseline);
  await eventually(() => amazon.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),baseline);
  status = await send({type:"getStatus",tabId});
  assert.equal(status.current.status,"unmatched"); assert.equal(status.current.attached,false);
  check("deleting all rules through the UI restores formerly matched pages");
  await editor.waitForFunction(() => document.querySelector("#saveState").textContent === "已保存");
  await editor.locator("#addRule").click();
  last = editor.locator(".rule").last();
  await last.locator(".fields input").nth(0).fill("127.0.0.1");
  await last.locator(".fields input").nth(1).fill("Asia/Tokyo");
  await editor.locator("#save").click();
  await eventually(zone,"Asia/Tokyo");
  await editor.waitForFunction(() => document.querySelector("#saveState").textContent === "已保存");

  await context.close(); context = null;
  context = await chromium.launchPersistentContext(profile, options);
  let restartedWorker = context.serviceWorkers()[0];
  if (!restartedWorker) restartedWorker = await context.waitForEvent("serviceworker");
  const restartedPage = await context.newPage();
  await restartedPage.goto(url);
  await eventually(() => restartedPage.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), "Asia/Tokyo");
  const unmatchedAfterRestart = await context.newPage();
  await unmatchedAfterRestart.goto(`http://outside.test:${port}/?after-restart`);
  await eventually(() => unmatchedAfterRestart.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),baseline);
  check("browser restart restores saved rules and keeps unmatched independent sites unchanged");
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
