import { DEFAULT_TIME_ZONE, RULE_TYPES, normalizeRules, normalizePattern, hostnameFromUrl, findRule, ruleLabel } from "./core.js";
import { timeZones, zoneLabel } from "./zones.js";
const $ = id => document.getElementById(id);
let draft = [];
let savedSignature = "[]";
let loaded = false;
let busy = false;

function node(tag, text, props = {}) { const item = document.createElement(tag); if (text) item.textContent = text; Object.assign(item, props); return item; }
async function request(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "无法连接插件后台。");
  return response.data;
}
function updateDirty() {
  const dirty = JSON.stringify(draft) !== savedSignature;
  $("saveState").textContent = dirty ? "未保存" : "已保存";
  $("save").disabled = !loaded || busy || !dirty;
  $("addRule").disabled = !loaded || busy;
  $("ruleCount").textContent = `${draft.length} 条规则 · ${draft.filter(rule => rule.enabled).length} 条启用 · 第一条匹配优先`;
}
function field(labelText, input) { const label = node("label", labelText); label.append(input); return label; }
function inputFor(rule, key, props = {}) {
  const input = node("input", "", { type:"text", value:rule[key], ...props });
  input.addEventListener("input", () => { rule[key] = input.value; $("notice").hidden = true; updateDirty(); });
  return input;
}
function renderRules() {
  $("rules").replaceChildren();
  if (!draft.length) $("rules").append(node("p", "暂无规则。添加并保存后，只有命中的网页才会主动切换时区。", { className:"empty" }));
  draft.forEach((rule, index) => {
    const card = node("article", "", { className:`rule ${rule.enabled ? "" : "disabled"}` });
    const top = node("div", "", { className:"rule-top" });
    top.append(node("span", `#${index+1}`, { className:"rule-index" }));
    const enabled = node("input", "", { type:"checkbox", checked:rule.enabled });
    enabled.setAttribute("aria-label", `启用规则 ${index+1}`);
    enabled.addEventListener("change", () => { rule.enabled = enabled.checked; card.classList.toggle("disabled", !rule.enabled); updateDirty(); });
    const enableLabel = node("label", "", { className:"enabled-label" }); enableLabel.append(enabled, document.createTextNode("启用")); top.append(enableLabel);
    top.append(inputFor(rule, "name", { placeholder:"名称（可选）", maxLength:80, ariaLabel:`规则 ${index+1} 名称` }));
    const actions = node("div", "", { className:"rule-actions" });
    for (const [label, shift] of [["上移", -1], ["下移", 1]]) {
      const button = node("button", label, { type:"button", disabled:index+shift<0 || index+shift>=draft.length });
      button.addEventListener("click", () => { [draft[index], draft[index+shift]] = [draft[index+shift], draft[index]]; renderRules(); }); actions.append(button);
    }
    const remove = node("button", "删除", { type:"button", className:"delete" });
    remove.addEventListener("click", () => { draft.splice(index, 1); renderRules(); }); actions.append(remove); top.append(actions);
    const fields = node("div", "", { className:"fields" });
    const type = node("select");
    for (const [value, label] of Object.entries(RULE_TYPES)) type.append(node("option", label, { value }));
    type.value = rule.type;
    type.addEventListener("change", () => { rule.type = type.value; updateDirty(); });
    fields.append(field("匹配方式", type));
    fields.append(field("域名 / 字段", inputFor(rule, "pattern", { placeholder:"例如 example.com 或 amazon", maxLength:253, spellcheck:false })));
    const timeZone = inputFor(rule, "timeZone", { placeholder:"选择时区，如 America/New_York", spellcheck:false });
    timeZone.setAttribute("list", "timeZones");
    fields.append(field("对应时区（可搜索中文城市）", timeZone));
    card.append(top, fields); $("rules").append(card);
  });
  updateDirty();
}
function addRule(pattern = "") {
  if (draft.length >= 200) { $("error").textContent = "最多 200 条规则。"; $("error").hidden = false; return; }
  draft.push({ id:crypto.randomUUID(), name:"", enabled:true, type:"domain", pattern, timeZone:DEFAULT_TIME_ZONE });
  renderRules();
  $("rules").lastElementChild?.querySelector(".fields input")?.focus();
}
$("addRule").addEventListener("click", () => addRule());
$("save").addEventListener("click", async () => {
  if (busy) return;
  busy = true; $("error").hidden = true; $("notice").hidden = true;
  document.querySelectorAll("button,input,select").forEach(control => control.disabled = true);
  try {
    const rules = normalizeRules(draft);
    const result = await request({ type:"updateSettings", rules, baseRules:savedSignature });
    draft = structuredClone(result.settings.rules); savedSignature = JSON.stringify(draft);
    $("notice").textContent = "规则已保存并应用。未命中的网页不会主动设置；已缓存的时间可能需要刷新。"; $("notice").hidden = false;
  } catch (error) { $("error").textContent = error.message; $("error").hidden = false; }
  finally {
    busy = false; document.querySelectorAll("button,input,select").forEach(control => control.disabled = false); renderRules();
  }
});
$("testRule").addEventListener("click", () => {
  try {
    const input = $("testHost").value.trim();
    const host = input.includes("://") ? hostnameFromUrl(input) : normalizePattern(input, "exact");
    if (!host) throw new Error("请输入普通 HTTP / HTTPS 网址或域名。");
    const rule = findRule(`https://${host}/`, normalizeRules(draft));
    $("testResult").textContent = rule ? `${host} → ${ruleLabel(rule)} → ${rule.timeZone}` : `${host}：未命中，不主动设置时区。`;
  } catch (error) { $("testResult").textContent = error.message; }
});
for (const zone of timeZones()) $("timeZones").append(node("option", zoneLabel(zone), { value:zone }));
try {
  const result = await request({ type:"getStatus" });
  draft = structuredClone(result.settings.rules); savedSignature = JSON.stringify(draft); loaded = true;
  renderRules();
  const host = new URLSearchParams(location.hash.slice(1)).get("host");
  if (host) addRule(normalizePattern(host, "exact"));
} catch (error) { $("error").textContent = error.message; $("error").hidden = false; }
window.addEventListener("beforeunload", event => { if (JSON.stringify(draft) !== savedSignature) { event.preventDefault(); event.returnValue = ""; } });
