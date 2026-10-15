import { DEFAULT_SETTINGS, ALARM_NAME, normalizeTimeZone, loadSettings, supportsTab, errorText, isGone, friendlyError, PROBE_EXPRESSION } from "./core.js";

let settings = { ...DEFAULT_SETTINGS };
const owned = new Set();
const paused = new Set();
const expectedDetach = new Set();
const states = new Map();
const children = new Map();
let ready;
let queue = Promise.resolve();

// Serialize settings changes and target operations: a pending enable cannot
// overtake a disable, navigation, or timezone change.
function schedule(job) {
  const next = queue.then(async () => { await ready; return job(); });
  queue = next.catch(error => console.warn("Timezone Switcher:", errorText(error)));
  return next;
}

async function persistSession() {
  await chrome.storage.session.set({
    runtimeState: { owned: [...owned], paused: [...paused], states: [...states] }
  });
}

async function paint(tabId, state) {
  const text = state.status === "active" ? "ON" : ["error", "paused"].includes(state.status) ? "!" : "";
  const color = state.status === "active" ? "#11776b" : "#bd7820";
  await Promise.allSettled([
    chrome.action.setBadgeText({ tabId, text }),
    chrome.action.setBadgeBackgroundColor({ tabId, color }),
    chrome.action.setTitle({ tabId, title: `时区切换器 · ${state.status === "active" ? settings.timeZone : state.detail}` })
  ]);
}

async function setState(tabId, status, detail, extra = {}) {
  const state = { status, detail, updatedAt: Date.now(), ...extra };
  states.set(tabId, state);
  await paint(tabId, state);
}

function command(target, method, params = {}) {
  return chrome.debugger.sendCommand(target, method, params);
}

function childTargets(tabId) {
  return [...(children.get(tabId)?.keys() || [])].map(sessionId => ({ tabId, sessionId }));
}

async function configureAutoAttach(target) {
  await command(target, "Target.setAutoAttach", {
    autoAttach: true,
    // Some service-worker targets cannot answer commands until startup runs.
    // Do not pause website execution while configuring related targets.
    waitForDebuggerOnStart: false,
    flatten: true,
    filter: [
      { type: "iframe", exclude: false },
      { type: "worker", exclude: false },
      { type: "shared_worker", exclude: false },
      { type: "service_worker", exclude: false },
      { exclude: true }
    ]
  });
}

async function probe(target) {
  const result = await command(target, "Runtime.evaluate", {
    expression: PROBE_EXPRESSION, returnByValue: true, timeout: 2000
  });
  if (result.exceptionDetails || !result.result?.value) throw new Error("暂时无法读取页面时区，请等待页面加载完成。");
  return result.result.value;
}

async function applyChildTimeZone(target, record, timeZone) {
  record.warning = null;
  try {
    await command(target, "Emulation.setTimezoneOverride", { timezoneId: timeZone });
  } catch (error) {
    if (isGone(error)) return;
    // Worker agents may not expose Emulation but inherit the renderer timezone.
    // Check inheritance on every reconciliation, not just on first attachment.
    try {
      const observed = await probe(target);
      if (timeZone && normalizeTimeZone(observed.timeZone) !== timeZone) record.warning = "此子目标未继承所选时区。";
    } catch { record.warning = friendlyError(error); }
  }
}

async function releaseTab(tabId) {
  if (!owned.has(tabId)) return;
  // Clear while still attached; also clear child frame overrides before detach.
  for (const target of childTargets(tabId)) {
    try { await command(target, "Emulation.setTimezoneOverride", { timezoneId: "" }); } catch { /* closed or unsupported worker */ }
  }
  let cleared = false;
  try {
    await command({ tabId }, "Emulation.setTimezoneOverride", { timezoneId: "" });
    cleared = true;
  } catch (error) { if (isGone(error)) cleared = true; }
  expectedDetach.add(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch (error) {
    if (!isGone(error)) {
      expectedDetach.delete(tabId);
      await setState(tabId, "error", `${cleared ? "时区已恢复，但调试连接未断开" : "恢复时区失败"}：${friendlyError(error)}`);
      return;
    }
  }
  expectedDetach.delete(tabId);
  owned.delete(tabId);
  children.delete(tabId);
  await setState(tabId, "off", "已恢复系统时区；网页缓存的时间可能需要刷新。");
}

async function applyTab(tab) {
  const tabId = tab?.id;
  if (!Number.isInteger(tabId)) return;
  if (!settings.enabled || !supportsTab(tab)) {
    await releaseTab(tabId);
    if (!owned.has(tabId)) await setState(tabId, settings.enabled ? "unsupported" : "off",
      settings.enabled ? "仅支持普通 HTTP / HTTPS 网页；Chrome 内部页、商店和休眠标签不处理。" : "已关闭，使用系统时区。");
    return;
  }
  if (paused.has(tabId)) {
    await setState(tabId, "paused", "调试连接已被用户或开发者工具断开。点击重新应用以恢复。");
    return;
  }
  try {
    if (owned.has(tabId)) {
      try { await command({ tabId }, "Emulation.setTimezoneOverride", { timezoneId: settings.timeZone }); }
      catch (error) {
        if (!isGone(error)) throw error;
        owned.delete(tabId);
        children.delete(tabId);
      }
    }
    if (!owned.has(tabId)) {
      await chrome.debugger.attach({ tabId }, "1.3");
      owned.add(tabId);
      await command({ tabId }, "Emulation.setTimezoneOverride", { timezoneId: settings.timeZone });
    }
    await configureAutoAttach({ tabId });
    for (const target of childTargets(tabId)) {
      const child = children.get(tabId)?.get(target.sessionId);
      if (child) await applyChildTimeZone(target, child, settings.timeZone);
    }
    await setState(tabId, "active", "已应用时区", { timeZone: settings.timeZone });
  } catch (error) {
    // Do not leave a debugger attached after partial setup failed.
    if (owned.has(tabId)) await releaseTab(tabId);
    await setState(tabId, "error", friendlyError(error));
  }
}

async function reconcile() {
  const tabs = await chrome.tabs.query({});
  const existing = new Set(tabs.map(tab => tab.id));
  for (const tabId of new Set([...owned, ...paused, ...states.keys()])) {
    if (!existing.has(tabId)) {
      owned.delete(tabId); paused.delete(tabId); states.delete(tabId); children.delete(tabId);
    }
  }
  for (const tab of tabs) await applyTab(tab);
  await persistSession();
  await updateAlarm();
}

async function updateAlarm() {
  if (settings.enabled || owned.size) {
    if (!await chrome.alarms.get(ALARM_NAME)) await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  } else await chrome.alarms.clear(ALARM_NAME);
}

async function getStatus(tabId) {
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find(item => item.id === tabId);
  let current = tab ? { ...(states.get(tabId) || { status: "pending", detail: "正在准备应用。" }) } : null;
  if (tab && !supportsTab(tab)) current = { status: "unsupported", detail: "此页面不支持。请切换到普通 HTTP / HTTPS 网页。" };
  if (tab && !settings.enabled && !owned.has(tabId)) current = { status: "off", detail: "已关闭，使用系统时区。" };
  if (tab && owned.has(tabId) && current?.status === "active") {
    try {
      const observed = await probe({ tabId });
      current.observed = observed;
      current.verified = normalizeTimeZone(observed.timeZone) === settings.timeZone;
      if (!current.verified) current.detail = "页面报告的时区与设置不同，请重新应用或关闭其他时区工具。";
    } catch (error) { current.verified = false; current.detail = friendlyError(error); }
    const childWarnings = [...(children.get(tabId)?.values() || [])].filter(value => value.warning);
    current.childWarnings = childWarnings.map(value => `${value.type}: ${value.warning}`);
  }
  const counts = { active: 0, paused: 0, error: 0, supported: 0 };
  for (const item of tabs) {
    if (supportsTab(item)) counts.supported++;
    const status = states.get(item.id)?.status;
    if (Object.hasOwn(counts, status)) counts[status]++;
  }
  return { settings, current, counts, tabId: tab?.id ?? null };
}

async function handleMessage(message) {
  if (!message || typeof message.type !== "string") throw new Error("无效请求。");
  switch (message.type) {
    case "getStatus": return getStatus(message.tabId);
    case "updateSettings": {
      const next = { ...settings };
      if (Object.hasOwn(message, "enabled")) {
        if (typeof message.enabled !== "boolean") throw new Error("无效开关设置。");
        next.enabled = message.enabled;
      }
      if (Object.hasOwn(message, "timeZone")) next.timeZone = normalizeTimeZone(message.timeZone);
      // Commit validation before mutating either storage or active tabs.
      await chrome.storage.local.set({ settings: next });
      settings = next;
      paused.clear();
      await reconcile();
      return getStatus(message.tabId);
    }
    case "reapply": {
      if (!settings.enabled) throw new Error("请先开启时区切换。");
      if (message.all === true) { paused.clear(); await reconcile(); }
      else {
        if (!Number.isInteger(message.tabId)) throw new Error("没有可操作的网页标签。");
        paused.delete(message.tabId);
        await applyTab(await chrome.tabs.get(message.tabId));
        await persistSession();
      }
      return getStatus(message.tabId);
    }
    case "reloadCurrent": {
      if (!Number.isInteger(message.tabId)) throw new Error("没有可刷新的标签页。");
      const tab = await chrome.tabs.get(message.tabId);
      if (!supportsTab(tab)) throw new Error("请在普通 HTTP / HTTPS 网页使用此功能。");
      if (settings.enabled) {
        paused.delete(tab.id);
        await applyTab(tab);
        if (states.get(tab.id)?.status !== "active") throw new Error(states.get(tab.id)?.detail || "应用失败。");
      }
      await persistSession();
      await chrome.tabs.reload(tab.id);
      return getStatus(tab.id);
    }
    case "openDiagnostics": {
      const tab = await chrome.tabs.create({ url: chrome.runtime.getURL("diagnostics.html") });
      return { tabId: tab.id };
    }
    default: throw new Error("不支持的请求。");
  }
}

// Register listeners synchronously, before the first asynchronous initialization.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) return;
  schedule(() => handleMessage(message)).then(
    data => sendResponse({ ok: true, data }),
    error => sendResponse({ ok: false, error: friendlyError(error) })
  );
  return true;
});

chrome.runtime.onInstalled.addListener(() => { void schedule(reconcile); });
chrome.runtime.onStartup.addListener(() => { void schedule(reconcile); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM_NAME) void schedule(reconcile); });
chrome.tabs.onCreated.addListener(tab => { void schedule(async () => { await applyTab(tab); await persistSession(); }); });
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!(change.url || change.status || Object.hasOwn(change, "discarded"))) return;
  void schedule(async () => {
    try { await applyTab(await chrome.tabs.get(tabId)); await persistSession(); }
    catch (error) { if (!isGone(error)) console.warn(errorText(error)); }
  });
});
chrome.tabs.onRemoved.addListener(tabId => {
  void schedule(async () => {
    owned.delete(tabId); paused.delete(tabId); states.delete(tabId); children.delete(tabId);
    await persistSession();
  });
});
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  void schedule(async () => {
    owned.delete(removedTabId); paused.delete(removedTabId); states.delete(removedTabId); children.delete(removedTabId);
    try { await applyTab(await chrome.tabs.get(addedTabId)); } catch (error) { if (!isGone(error)) throw error; }
    await persistSession();
  });
});

chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = source.tabId;
  if (!Number.isInteger(tabId) || expectedDetach.has(tabId)) return;
  if (owned.has(tabId) && reason === "canceled_by_user" && settings.enabled) paused.add(tabId);
  void schedule(async () => {
    // An expected detach event may arrive after detach() has resolved.
    if (!owned.has(tabId)) return;
    owned.delete(tabId); children.delete(tabId);
    if (reason === "canceled_by_user" && settings.enabled) {
      paused.add(tabId);
      await setState(tabId, "paused", "调试连接已断开，自动应用已暂停。点击重新应用以恢复。");
    } else {
      states.delete(tabId);
      await paint(tabId, { status: "off", detail: "连接已关闭" });
    }
    await persistSession();
  });
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (!Number.isInteger(source.tabId)) return;
  if (method === "Target.detachedFromTarget") {
    children.get(source.tabId)?.delete(params.sessionId);
    return;
  }
  if (method !== "Target.attachedToTarget") return;
  const target = { tabId: source.tabId, sessionId: params.sessionId };
  // Do not queue this behind root navigation: a newly created worker can be
  // paused waiting for us to resume it. Always resume, including on errors.
  void (async () => {
    await ready;
    const record = { type: params.targetInfo?.type || "unknown", warning: null };
    if (!children.has(source.tabId)) children.set(source.tabId, new Map());
    children.get(source.tabId).set(params.sessionId, record);
    try {
      await applyChildTimeZone(target, record, settings.enabled ? settings.timeZone : "");
      if (settings.enabled && owned.has(source.tabId)) await configureAutoAttach(target);
    }
    catch { /* target type may not expose Target domain */ }
    finally {
      try { await command(target, "Runtime.runIfWaitingForDebugger"); } catch { /* already closed */ }
    }
  })().catch(error => console.warn("Child target:", errorText(error)));
});

async function initialize() {
  const [local, session] = await Promise.all([
    chrome.storage.local.get("settings"), chrome.storage.session.get("runtimeState")
  ]);
  settings = loadSettings(local.settings);
  await chrome.storage.local.set({ settings });
  const saved = session.runtimeState;
  for (const id of saved?.owned || []) if (Number.isInteger(id)) owned.add(id);
  for (const id of saved?.paused || []) if (Number.isInteger(id)) paused.add(id);
  for (const [id, state] of saved?.states || []) if (Number.isInteger(id)) states.set(id, state);
  await chrome.action.setBadgeText({ text: "" });
}

ready = initialize();
void schedule(reconcile);
