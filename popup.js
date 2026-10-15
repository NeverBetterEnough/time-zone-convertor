import { ruleLabel } from "./core.js";
const $ = id => document.getElementById(id);
const controls = ["enabled", "manageRules", "addCurrent", "reapply", "reload", "diagnostics"];
let activeTabId = null;
let latest;
let busy = false;
let fetching = false;

async function request(message) {
  const response = await chrome.runtime.sendMessage({ ...message, tabId:activeTabId });
  if (!response?.ok) throw new Error(response?.error || "无法连接插件后台，请重新加载扩展。");
  return response.data;
}
function showError(error) { $("error").textContent = error.message || String(error); $("error").hidden = false; }
function updatePreview() {
  const timeZone = latest?.current?.rule?.timeZone;
  $("preview").hidden = !timeZone;
  if (!timeZone) return;
  const now = new Date();
  $("previewDate").textContent = new Intl.DateTimeFormat("zh-CN", { timeZone, year:"numeric", month:"long", day:"numeric" }).format(now) + " · 地区时间预览";
  $("previewTime").textContent = new Intl.DateTimeFormat("en-GB", { timeZone, hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false }).format(now);
  $("previewOffset").textContent = new Intl.DateTimeFormat("en", { timeZone, timeZoneName:"shortOffset" }).formatToParts(now).find(part => part.type === "timeZoneName")?.value || "";
}
function updateControls() {
  for (const id of controls) $(id).disabled = busy || !latest;
  if (!latest || busy) return;
  const unsupported = !latest.current || ["unsupported", "pending"].includes(latest.current.status);
  $("reapply").disabled = !latest.settings.enabled || unsupported || !latest.current.rule;
  $("reload").disabled = unsupported;
  $("addCurrent").disabled = unsupported || !latest.current.hostname;
  $("reload").textContent = latest.current?.rule ? "应用并刷新此页" : "刷新此页";
}
function render(data) {
  latest = data;
  $("enabled").checked = data.settings.enabled;
  $("powerLabel").textContent = data.settings.enabled ? "域名规则已开启" : "域名规则已关闭";
  $("powerDescription").textContent = `${data.settings.rules.filter(rule => rule.enabled).length} 条启用规则 · ${data.settings.rules.length} 条规则`;
  const current = data.current;
  $("host").textContent = current?.hostname || "普通网页中查看";
  $("ruleName").textContent = ruleLabel(current?.rule);
  $("targetZone").textContent = current?.rule?.timeZone || "不设置时区";
  const labels = { active:"已应用", paused:"已暂停", error:"应用失败", unsupported:"不支持", off:"已关闭", pending:"准备中", unmatched:"未命中" };
  const good = current?.status === "active" && current.verified === true;
  $("statusBadge").textContent = good ? "✓ 检测通过" : current?.status === "active" ? "待确认" : labels[current?.status] || "无网页";
  $("statusBadge").className = `pill ${good ? "good" : ["active", "paused", "error"].includes(current?.status) ? "warn" : ""}`;
  $("statusDetail").textContent = current?.detail || "请切换到普通网页查看规则命中情况。";
  $("observed").hidden = !current?.observed;
  if (current?.observed) { $("observedZone").textContent = current.observed.timeZone; $("observedTime").textContent = current.observed.localTime; }
  $("childWarning").hidden = !current?.childWarnings?.length;
  $("childWarning").textContent = current?.childWarnings?.length ? "部分 iframe / Worker 未确认生效，详见检测页。" : "";
  $("summary").textContent = `${data.counts.active} 页已应用 · ${data.counts.unmatched} 页未命中 · ${data.counts.error} 页失败`;
  updatePreview(); updateControls();
}
async function act(job) {
  if (busy) return;
  busy = true; updateControls(); $("error").hidden = true;
  try { const data = await job(); if (data?.settings) render(data); }
  catch (error) { showError(error); if (latest) $("enabled").checked = latest.settings.enabled; }
  finally { busy = false; updateControls(); }
}
$("enabled").addEventListener("change", () => act(() => request({ type:"updateSettings", enabled:$("enabled").checked })));
$("manageRules").addEventListener("click", () => act(() => request({ type:"openRules" })));
$("addCurrent").addEventListener("click", () => act(() => request({ type:"openRules", prefill:true })));
$("reapply").addEventListener("click", () => act(() => request({ type:"reapply" })));
$("reload").addEventListener("click", () => act(() => request({ type:"reloadCurrent" })));
$("diagnostics").addEventListener("click", () => act(() => request({ type:"openDiagnostics" })));
async function refresh() {
  if (busy || fetching) return;
  fetching = true;
  try { render(await request({ type:"getStatus" })); } catch (error) { showError(error); }
  finally { fetching = false; }
}
try {
  const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
  activeTabId = tab?.id ?? null;
  render(await request({ type:"getStatus" }));
} catch (error) { showError(error); }
setInterval(updatePreview, 1000);
setInterval(refresh, 4000);
