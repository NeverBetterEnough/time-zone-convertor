import { timeZones, zoneLabel } from "./zones.js";

const $ = id => document.getElementById(id);
const controls = ["enabled", "timeZone", "save", "reapply", "reload", "diagnostics"];
let zones = timeZones();
let activeTabId = null;
let latest;
let busy = false;
let fetching = false;

async function request(message) {
  const response = await chrome.runtime.sendMessage({ ...message, tabId: activeTabId });
  if (!response?.ok) throw new Error(response?.error || "无法连接插件后台，请在扩展管理页重新加载插件。");
  return response.data;
}

function showError(error) { $("error").textContent = error.message || String(error); $("error").hidden = false; }

function populate(selected) {
  if (selected && !zones.includes(selected)) zones.unshift(selected);
  const query = $("zoneSearch").value.trim().toLocaleLowerCase();
  const matches = zones.filter(zone => zoneLabel(zone).toLocaleLowerCase().includes(query));
  const display = selected && !matches.includes(selected) ? [selected, ...matches] : matches;
  $("timeZone").replaceChildren(...display.map(zone => {
    const option = document.createElement("option");
    option.value = zone; option.textContent = zoneLabel(zone);
    return option;
  }));
  if (selected) $("timeZone").value = selected;
  $("zoneCount").textContent = query ? `${matches.length} 个匹配结果` : `${zones.length} 个地区时区`;
  updatePreview();
}

function updatePreview() {
  const timeZone = $("timeZone").value;
  if (!timeZone) return;
  const now = new Date();
  $("previewDate").textContent = new Intl.DateTimeFormat("zh-CN", { timeZone, year:"numeric", month:"long", day:"numeric", weekday:"short" }).format(now);
  $("previewTime").textContent = new Intl.DateTimeFormat("en-GB", { timeZone, hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false }).format(now);
  $("previewOffset").textContent = new Intl.DateTimeFormat("en", { timeZone, timeZoneName:"shortOffset" }).formatToParts(now).find(part => part.type === "timeZoneName")?.value || "";
}

function updateControls() {
  for (const id of controls) $(id).disabled = busy || !latest;
  if (!latest || busy) return;
  const unsupported = !latest.current || ["unsupported", "pending"].includes(latest.current.status);
  $("reapply").disabled = !latest.settings.enabled || unsupported;
  $("reload").disabled = unsupported;
  $("save").textContent = latest.settings.enabled ? "保存并应用到所有网页" : "保存时区设置";
}

function render(data, resetSelection = false) {
  latest = data;
  $("enabled").checked = data.settings.enabled;
  $("powerLabel").textContent = data.settings.enabled ? "自动切换已开启" : "自动切换已关闭";
  $("powerDescription").textContent = data.settings.enabled ? `当前设置：${data.settings.timeZone}` : "网页将使用系统时区";
  if (resetSelection) { $("zoneSearch").value = ""; populate(data.settings.timeZone); }
  const current = data.current;
  const labels = { active:"已应用", paused:"已暂停", error:"应用失败", unsupported:"不支持", off:"已关闭", pending:"准备中" };
  const good = current?.status === "active" && current.verified === true;
  $("statusBadge").textContent = good ? "✓ 检测通过" : current?.status === "active" ? "待确认" : labels[current?.status] || "无网页";
  $("statusBadge").className = `pill ${good ? "good" : ["active", "paused", "error"].includes(current?.status) ? "warn" : ""}`;
  $("statusDetail").textContent = current?.detail || "请切换到需要修改时区的网页。";
  $("observed").hidden = !current?.observed;
  if (current?.observed) {
    $("observedZone").textContent = current.observed.timeZone;
    $("observedTime").textContent = current.observed.localTime;
  }
  $("childWarning").hidden = !current?.childWarnings?.length;
  $("childWarning").textContent = current?.childWarnings?.length ? "部分 iframe / Worker 未确认生效，详见检测页。" : "";
  $("summary").textContent = `${data.counts.active} 页已应用 · ${data.counts.paused} 页暂停 · ${data.counts.error} 页失败`;
  updateControls();
}

async function act(job, notice) {
  if (busy) return;
  busy = true; updateControls();
  $("error").hidden = true; $("notice").hidden = true;
  try {
    const data = await job();
    if (data?.settings) render(data, true);
    if (notice) { $("notice").textContent = notice; $("notice").hidden = false; }
  } catch (error) {
    showError(error);
    if (latest) $("enabled").checked = latest.settings.enabled;
  } finally { busy = false; updateControls(); }
}

$("zoneSearch").addEventListener("input", () => populate($("timeZone").value));
$("timeZone").addEventListener("change", updatePreview);
$("enabled").addEventListener("change", () => act(() => request({ type:"updateSettings", enabled:$("enabled").checked, timeZone:$("timeZone").value })));
$("save").addEventListener("click", () => act(() => request({ type:"updateSettings", timeZone:$("timeZone").value }), "设置已保存；已打开的网页如缓存了旧时间，可刷新后查看。"));
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
  render(await request({ type:"getStatus" }), true);
} catch (error) { showError(error); }
setInterval(updatePreview, 1000);
setInterval(refresh, 4000);
