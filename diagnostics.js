const $ = id => document.getElementById(id);
let lastStatus;
let busy = false;

async function request(message) {
  const tabId = Number($("tabSelect").value);
  const response = await chrome.runtime.sendMessage({ ...message, tabId });
  if (!response?.ok) throw new Error(response?.error || "无法连接插件后台。");
  return response.data;
}

function offsetLabel(minutes) {
  if (!Number.isFinite(minutes)) return "—";
  const absolute = Math.abs(minutes);
  return `UTC${minutes <= 0 ? "+" : "−"}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function clock() {
  if (!lastStatus) return;
  $("targetClock").textContent = new Intl.DateTimeFormat("en-GB", { timeZone:lastStatus.settings.timeZone, hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false }).format(new Date());
}

function render(data) {
  lastStatus = data;
  $("targetZone").textContent = data.settings.timeZone;
  $("globalStatus").textContent = data.settings.enabled ? "自动切换已开启" : "已关闭 · 系统时区";
  const current = data.current;
  const observed = current?.observed;
  $("detail").textContent = current?.verified ? "✓ 当前网页的原生时区检测通过。" : current?.detail || "暂无可检测的普通网页。";
  $("detail").className = current?.verified ? "good" : "";
  $("actualZone").textContent = observed?.timeZone || "—";
  $("actualTime").textContent = observed?.localTime || "—";
  $("actualOffset").textContent = offsetLabel(observed?.offset);
  $("dateString").textContent = observed?.dateString || "—";
  $("seasonOffsets").textContent = observed ? `${offsetLabel(observed.januaryOffset)} / ${offsetLabel(observed.julyOffset)}` : "—";
  $("warnings").hidden = !current?.childWarnings?.length;
  $("warnings").textContent = current?.childWarnings?.join("\n") || "";
  $("raw").textContent = JSON.stringify(data, null, 2);
  clock();
}

async function refreshTabs() {
  const selected = $("tabSelect").value;
  const tabs = (await chrome.tabs.query({})).filter(tab => /^https?:/.test(tab.url || ""));
  $("tabSelect").replaceChildren(...tabs.map(tab => {
    const option = document.createElement("option"); option.value = String(tab.id); option.textContent = tab.title || tab.url;
    return option;
  }));
  if (tabs.some(tab => String(tab.id) === selected)) $("tabSelect").value = selected;
  await inspect();
}

async function inspect() { render(await request({ type:"getStatus" })); }

async function act(job) {
  if (busy) return;
  busy = true;
  $("error").hidden = true;
  document.querySelectorAll("button").forEach(button => button.disabled = true);
  try { await job(); }
  catch (error) { $("error").textContent = error.message; $("error").hidden = false; }
  finally { busy = false; document.querySelectorAll("button").forEach(button => button.disabled = false); }
}

$("tabSelect").addEventListener("change", () => act(inspect));
$("refreshTabs").addEventListener("click", () => act(refreshTabs));
$("probe").addEventListener("click", () => act(inspect));
$("retry").addEventListener("click", () => act(async () => render(await request({ type:"reapply" }))));
$("retryAll").addEventListener("click", () => act(async () => render(await request({ type:"reapply", all:true }))));
$("reload").addEventListener("click", () => act(async () => { await request({ type:"reloadCurrent" }); await inspect(); }));
await act(refreshTabs);
setInterval(clock, 1000);
