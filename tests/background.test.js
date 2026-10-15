import test from "node:test";
import assert from "node:assert/strict";

class Event {
  listeners = [];
  addListener(listener) { this.listeners.push(listener); }
  fire(...args) { return this.listeners.map(listener => listener(...args)); }
}
const rulesFor = (timeZone = "Asia/Shanghai") => [{ id:"example", enabled:true, type:"contains", pattern:"example", name:"测试规则", timeZone }];

function fakeChrome(seed = {}) {
  const log = [];
  const tabs = new Map([
    [1, { id:1, url:"https://example.com", active:true }],
    [2, { id:2, url:"https://other.example" }],
    [3, { id:3, url:"chrome://settings" }]
  ]);
  const attached = new Set(seed.attached || []);
  const zones = new Map();
  const data = { local:structuredClone(seed.local || {settings:{enabled:true, rules:rulesFor()}}), session:structuredClone(seed.session || {}) };
  const storage = area => ({
    async get(key) { return structuredClone({ [key]:data[area][key] }); },
    async set(value) { Object.assign(data[area], structuredClone(value)); }
  });
  const alarms = new Map();
  const faults = { attach:null, detach:null };
  const api = {
    storage: { local:storage("local"), session:storage("session") },
    runtime: { id:"test-id", getURL:p => `chrome-extension://test-id/${p}`, onMessage:new Event(), onInstalled:new Event(), onStartup:new Event() },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {}, async setTitle() {} },
    alarms: { onAlarm:new Event(), async get(name) { return alarms.get(name); }, async create(name, value) { alarms.set(name, value); }, async clear(name) { return alarms.delete(name); } },
    tabs: {
      onCreated:new Event(), onUpdated:new Event(), onRemoved:new Event(), onReplaced:new Event(),
      async query() { return [...tabs.values()]; },
      async get(id) { if (!tabs.has(id)) throw new Error("No tab with given id"); return tabs.get(id); },
      async reload(id) { log.push(["reload", id]); },
      async create() { return { id:4 }; }
    },
    debugger: {
      onDetach:new Event(), onEvent:new Event(),
      async attach({ tabId }) {
        log.push(["attach", tabId]);
        if (faults.attach === tabId) throw new Error("Another debugger is already attached to the tab");
        if (attached.has(tabId)) throw new Error("Already attached");
        attached.add(tabId);
      },
      async detach({ tabId }) {
        log.push(["detach", tabId]);
        if (faults.detach === tabId) throw new Error("Temporary detach error");
        if (!attached.has(tabId)) throw new Error("Debugger is not attached");
        attached.delete(tabId); zones.delete(tabId);
        api.debugger.onDetach.fire({ tabId }, "canceled_by_user");
      },
      async sendCommand(target, method, params) {
        log.push([method, target.tabId, params]);
        if (!attached.has(target.tabId)) throw new Error("Debugger is not attached");
        if (method === "Emulation.setTimezoneOverride") zones.set(target.tabId, params.timezoneId || "UTC");
        if (method === "Runtime.evaluate") return { result:{ value:{ timeZone:zones.get(target.tabId) || "UTC", offset:0 } } };
        return {};
      }
    }
  };
  const send = message => new Promise(resolve => api.runtime.onMessage.fire(message,
    { id:api.runtime.id, url:api.runtime.getURL("popup.html") }, resolve));
  return { api, send, log, data, tabs, attached, zones, faults, alarms };
}

let instance = 0;
async function start(seed) {
  const mock = fakeChrome(seed);
  globalThis.chrome = mock.api;
  await import(`../background.js?testInstance=${++instance}`);
  const status = await mock.send({ type:"getStatus", tabId:1 });
  assert.equal(status.ok, true);
  return mock;
}

test("startup connects supported pages; explicit disable clears before detach", async () => {
  const mock = await start();
  assert.deepEqual([...mock.attached], [1, 2]);
  const result = await mock.send({ type:"updateSettings", enabled:false, tabId:1 });
  assert.equal(result.data.current.status, "off");
  assert.equal(mock.attached.size, 0);
  assert.equal(mock.alarms.size, 0);
  for (const id of [1, 2]) {
    const clearIndex = mock.log.findIndex(entry => entry[0] === "Emulation.setTimezoneOverride" && entry[1] === id && entry[2].timezoneId === "");
    const detachIndex = mock.log.findIndex(entry => entry[0] === "detach" && entry[1] === id);
    assert.ok(clearIndex >= 0 && clearIndex < detachIndex);
  }
});

test("cancelled debugging stays paused across navigation and periodic checks", async () => {
  const mock = await start();
  mock.attached.delete(1);
  mock.api.debugger.onDetach.fire({ tabId:1 }, "canceled_by_user");
  let result = await mock.send({ type:"getStatus", tabId:1 });
  assert.equal(result.data.current.status, "paused");
  const attempts = mock.log.filter(entry => entry[0] === "attach").length;
  mock.api.tabs.onUpdated.fire(1, { status:"loading" });
  mock.api.alarms.onAlarm.fire({ name:"timezone-reconcile" });
  result = await mock.send({ type:"getStatus", tabId:1 });
  assert.equal(result.data.current.status, "paused");
  assert.equal(mock.log.filter(entry => entry[0] === "attach").length, attempts);
  result = await mock.send({ type:"reapply", tabId:1 });
  assert.equal(result.data.current.verified, true);
  assert.equal(mock.attached.has(1), true);
});

test("rapid changes are serialized and invalid input commits nothing", async () => {
  const mock = await start();
  await Promise.all([
    mock.send({ type:"updateSettings", rules:rulesFor("America/New_York"), tabId:1 }),
    mock.send({ type:"updateSettings", enabled:false, tabId:1 })
  ]);
  assert.equal(mock.data.local.settings.enabled, false);
  assert.equal(mock.data.local.settings.rules[0].timeZone, "America/New_York");
  assert.equal(mock.attached.size, 0);
  const invalid = await mock.send({ type:"updateSettings", enabled:true, rules:rulesFor("Mars/Base"), tabId:1 });
  assert.equal(invalid.ok, false);
  assert.equal(mock.data.local.settings.enabled, false);
});

test("failed cleanup stays visible and periodic reconciliation retries it", async () => {
  const mock = await start();
  mock.faults.detach = 1;
  const failed = await mock.send({ type:"updateSettings", enabled:false, tabId:1 });
  assert.equal(failed.data.current.status, "error");
  assert.equal(mock.attached.has(1), true);
  assert.equal(mock.alarms.has("timezone-reconcile"), true);
  mock.faults.detach = null;
  mock.api.alarms.onAlarm.fire({ name:"timezone-reconcile" });
  const recovered = await mock.send({ type:"getStatus", tabId:1 });
  assert.equal(recovered.data.current.status, "off");
  assert.equal(mock.attached.size, 0);
});

test("saved disabled state survives startup and debugger conflicts are reported", async () => {
  const mock = await start({ local:{ settings:{ enabled:false, rules:rulesFor("Europe/London") } } });
  assert.equal(mock.attached.size, 0);
  mock.faults.attach = 2;
  await mock.send({ type:"updateSettings", enabled:true, tabId:1 });
  const failed = await mock.send({ type:"getStatus", tabId:2 });
  assert.equal(failed.data.current.status, "error");
  assert.match(failed.data.current.detail, /开发者工具/);
  assert.equal(mock.log.some(entry => entry[0] === "detach" && entry[1] === 2), false);
});

test("service-worker reinitialization reuses session ownership and paused tabs", async () => {
  const previous = await start();
  previous.attached.delete(1);
  previous.api.debugger.onDetach.fire({ tabId:1 }, "canceled_by_user");
  await previous.send({ type:"getStatus", tabId:1 });
  const resumed = await start({ local:previous.data.local, session:previous.data.session, attached:[...previous.attached] });
  const state = await resumed.send({ type:"getStatus", tabId:1 });
  assert.equal(state.data.current.status, "paused");
  assert.equal(resumed.attached.has(2), true);
  assert.equal(resumed.log.some(entry => entry[0] === "attach"), false);
});

test("unsupported worker command uses inherited timezone without false warnings", async () => {
  const mock = await start();
  const original = mock.api.debugger.sendCommand;
  let inherited = "Asia/Shanghai";
  mock.api.debugger.sendCommand = async (target, method, params) => {
    if (target.sessionId === "worker-session") {
      if (method === "Emulation.setTimezoneOverride") throw new Error("Method not found");
      if (method === "Runtime.evaluate") return { result:{ value:{ timeZone:inherited } } };
    }
    return original(target, method, params);
  };
  mock.api.debugger.onEvent.fire({ tabId:1 }, "Target.attachedToTarget", { sessionId:"worker-session", targetInfo:{ type:"service_worker" }, waitingForDebugger:true });
  await new Promise(resolve => setTimeout(resolve, 20));
  mock.api.alarms.onAlarm.fire({ name:"timezone-reconcile" });
  let status = await mock.send({ type:"getStatus", tabId:1 });
  assert.deepEqual(status.data.current.childWarnings, []);
  assert.ok(mock.log.some(entry => entry[0] === "Runtime.runIfWaitingForDebugger"));
  const autoAttach = mock.log.find(entry => entry[0] === "Target.setAutoAttach");
  assert.equal(autoAttach[2].waitForDebuggerOnStart, false);
  inherited = "UTC";
  mock.api.alarms.onAlarm.fire({ name:"timezone-reconcile" });
  status = await mock.send({ type:"getStatus", tabId:1 });
  assert.match(status.data.current.childWarnings[0], /未继承/);
});

test("empty or migrated global settings never attach unmatched pages", async () => {
  const mock = await start({ local:{settings:{enabled:true,timeZone:"America/New_York"}} });
  assert.equal(mock.attached.size, 0);
  assert.equal(mock.alarms.size, 0);
  let status = await mock.send({type:"getStatus",tabId:1});
  assert.equal(status.data.current.status, "unmatched");
  assert.equal(status.data.current.attached, false);
  await mock.send({type:"reapply",tabId:1});
  await mock.send({type:"reloadCurrent",tabId:1});
  assert.equal(mock.attached.size, 0);
  assert.ok(mock.log.some(item => item[0] === "reload"));
  status = await mock.send({type:"updateSettings",timeZone:"UTC",tabId:1});
  assert.equal(status.ok, false);
});

test("deleting or disabling rules clears previous overrides before reporting unmatched", async () => {
  const mock = await start();
  const result = await mock.send({type:"updateSettings",rules:[],tabId:1});
  assert.equal(result.data.current.status, "unmatched");
  assert.equal(result.data.current.attached, false);
  assert.equal(mock.attached.size, 0);
  assert.equal(mock.alarms.size, 0);
  assert.ok(mock.log.some(item => item[0] === "Emulation.setTimezoneOverride" && item[2].timezoneId === ""));
});

test("navigation to an unmatched host restores and path keywords do not match", async () => {
  const mock = await start();
  mock.tabs.set(1,{id:1,url:"https://outside.invalid/example?next=example.com"});
  mock.api.tabs.onUpdated.fire(1,{url:"https://outside.invalid/example"});
  const status = await mock.send({type:"getStatus",tabId:1});
  assert.equal(status.data.current.status, "unmatched");
  assert.equal(mock.attached.has(1), false);
  assert.equal(mock.attached.has(2), true);
});

test("each matched root and its children use their own rule timezone", async () => {
  const mock = await start();
  await mock.send({type:"updateSettings",rules:[
    {id:"ny",enabled:true,type:"exact",pattern:"example.com",timeZone:"America/New_York"},
    {id:"tokyo",enabled:true,type:"exact",pattern:"other.example",timeZone:"Asia/Tokyo"}
  ]});
  assert.equal(mock.zones.get(1),"America/New_York");
  assert.equal(mock.zones.get(2),"Asia/Tokyo");
  mock.api.debugger.onEvent.fire({tabId:1},"Target.attachedToTarget",{sessionId:"child",targetInfo:{type:"iframe"}});
  await new Promise(resolve => setTimeout(resolve,20));
  const status = await mock.send({type:"getStatus",tabId:1});
  assert.equal(status.data.current.rule.id,"ny");
  assert.equal(status.data.current.verified,true);
  assert.equal(mock.zones.get(1),"America/New_York");
});

test("priority, rule disable and stale editor protection apply atomically", async () => {
  const mock = await start();
  const signature = JSON.stringify(mock.data.local.settings.rules);
  const rules = [{...rulesFor("America/New_York")[0],id:"first"},{...rulesFor("Asia/Tokyo")[0],id:"second"}];
  await mock.send({type:"updateSettings",rules,baseRules:signature});
  assert.equal(mock.zones.get(1),"America/New_York");
  const stale = await mock.send({type:"updateSettings",rules:[],baseRules:signature});
  assert.equal(stale.ok,false);
  assert.equal(mock.data.local.settings.rules.length,2);
  rules[0].enabled = false;
  await mock.send({type:"updateSettings",rules});
  assert.equal(mock.zones.get(1),"Asia/Tokyo");
});

test("repeat tab updates do not reset auto-attach or resume another debugger's target", async () => {
  const mock = await start();
  const initial = mock.log.filter(item => item[0] === "Target.setAutoAttach").length;
  mock.api.tabs.onUpdated.fire(1,{status:"complete"});
  await mock.send({type:"getStatus",tabId:1});
  assert.equal(mock.log.filter(item => item[0] === "Target.setAutoAttach").length,initial);
  mock.api.debugger.onEvent.fire({tabId:1},"Target.attachedToTarget",{sessionId:"not-paused",targetInfo:{type:"worker"},waitingForDebugger:false});
  await new Promise(resolve => setTimeout(resolve,20));
  assert.equal(mock.log.some(item => item[0] === "Runtime.runIfWaitingForDebugger"),false);
});

test("migrating a live v1.0 session clears its old global override", async () => {
  const mock = await start({local:{settings:{enabled:true,timeZone:"America/New_York"}},session:{runtimeState:{owned:[1],paused:[],states:[]}},attached:[1]});
  assert.equal(mock.attached.size,0);
  assert.ok(mock.log.some(item => item[0] === "Emulation.setTimezoneOverride" && item[1] === 1 && item[2].timezoneId === ""));
  const status = await mock.send({type:"getStatus",tabId:1});
  assert.equal(status.data.current.status,"unmatched");
});

test("user cancellation stays paused after leaving and returning to a matching domain", async () => {
  const mock = await start();
  mock.attached.delete(1);
  mock.api.debugger.onDetach.fire({tabId:1},"canceled_by_user");
  await mock.send({type:"getStatus",tabId:1});
  mock.tabs.set(1,{id:1,url:"https://outside.invalid/"});
  mock.api.tabs.onUpdated.fire(1,{url:"https://outside.invalid/"});
  let result = await mock.send({type:"getStatus",tabId:1});
  assert.equal(result.data.current.status,"unmatched");
  mock.tabs.set(1,{id:1,url:"https://example.com/"});
  mock.api.tabs.onUpdated.fire(1,{url:"https://example.com/"});
  result = await mock.send({type:"getStatus",tabId:1});
  assert.equal(result.data.current.status,"paused");
  assert.equal(mock.attached.has(1),false);
});
