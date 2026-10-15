export const DEFAULT_TIME_ZONE = "Asia/Shanghai";
export const DEFAULT_SETTINGS = Object.freeze({ enabled: true, rules: Object.freeze([]) });
export const ALARM_NAME = "timezone-reconcile";
export const RULE_TYPES = Object.freeze({ exact: "精确域名", domain: "域名及子域", contains: "包含字段" });

export function normalizeTimeZone(value) {
  if (typeof value !== "string" || value.length > 100 || !value.trim()) {
    throw new Error("请输入有效的地区时区，例如 Asia/Shanghai。");
  }
  const input = value.trim();
  // Use region identifiers, including UTC; fixed offsets have no DST rules.
  if (/^[+-]/.test(input)) throw new Error("请选择地区时区，而不是固定的 UTC 偏移。");
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: input }).resolvedOptions().timeZone;
  } catch {
    throw new Error(`无法识别时区：${input}`);
  }
}

export function loadSettings(value) {
  const rules = [];
  const ids = new Set();
  for (const input of Array.isArray(value?.rules) ? value.rules.slice(0, 200) : []) {
    try {
      const [rule] = normalizeRules([input]);
      if (!ids.has(rule.id)) { rules.push(rule); ids.add(rule.id); }
    } catch { /* Invalid stored rules must not broaden scope or enable fallback. */ }
  }
  // v1.0's global timezone intentionally does not become a match-all rule.
  return { enabled: typeof value?.enabled === "boolean" ? value.enabled : DEFAULT_SETTINGS.enabled, rules };
}

export function hostnameFromUrl(value) {
  try {
    const url = new URL(typeof value === "string" ? value : value?.pendingUrl || value?.url || "");
    return ["http:", "https:"].includes(url.protocol) ? url.hostname.toLowerCase().replace(/\.$/, "") : "";
  } catch { return ""; }
}

export function normalizePattern(value, type) {
  if (typeof value !== "string" || !value.trim() || value.length > 253) throw new Error("请填写有效的域名或匹配字段。");
  const pattern = value.trim().toLowerCase();
  if (type === "contains") {
    if (!/^[a-z0-9._-]+$/.test(pattern) || !/[a-z0-9]/.test(pattern)) throw new Error("包含字段只接受英文字母、数字、点、短横线或下划线；不要填写协议、路径或通配符。");
    return pattern;
  }
  if (!Object.hasOwn(RULE_TYPES, type)) throw new Error("无效的匹配方式。");
  if (/[\s/:@?#*\\]/.test(pattern)) throw new Error("请只填写域名，不要带协议、端口、路径或通配符。");
  let host;
  try { host = new URL(`http://${pattern}`).hostname.toLowerCase().replace(/\.$/, ""); }
  catch { throw new Error("无法识别此域名。"); }
  if (host.length > 253 || !host.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error("域名格式无效。");
  return host;
}

export function normalizeRules(value) {
  if (!Array.isArray(value) || value.length > 200) throw new Error("规则必须是列表，最多 200 条。");
  const ids = new Set();
  return value.map((input, index) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`第 ${index+1} 条规则无效。`);
    const id = input.id ?? `rule-${index+1}`;
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || ids.has(id)) throw new Error("规则标识无效或重复。");
    ids.add(id);
    if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new Error("规则开关必须为布尔值。");
    if (input.name !== undefined && (typeof input.name !== "string" || input.name.length > 80)) throw new Error("规则名称最多 80 个字符。");
    if (!Object.hasOwn(RULE_TYPES, input.type)) throw new Error(`第 ${index+1} 条规则的匹配方式无效。`);
    return { id, name:(input.name || "").trim(), enabled:input.enabled ?? true, type:input.type,
      pattern:normalizePattern(input.pattern, input.type), timeZone:normalizeTimeZone(input.timeZone) };
  });
}

export function findRule(value, rules) {
  const host = hostnameFromUrl(value);
  if (!host) return null;
  return rules.find(rule => rule.enabled && (
    rule.type === "exact" ? host === rule.pattern :
    rule.type === "domain" ? host === rule.pattern || host.endsWith(`.${rule.pattern}`) :
    rule.type === "contains" ? host.includes(rule.pattern) : false
  )) || null;
}

export function ruleLabel(rule) {
  return rule ? `${rule.name || RULE_TYPES[rule.type]} · ${rule.pattern}` : "未命中规则";
}

export function supportsTab(tab) {
  if (!tab || !Number.isInteger(tab.id) || tab.discarded) return false;
  try {
    const url = new URL(tab.pendingUrl || tab.url || "");
    if (!["http:", "https:"].includes(url.protocol)) return false;
    return !(url.hostname === "chromewebstore.google.com" ||
      (url.hostname === "chrome.google.com" && url.pathname.startsWith("/webstore")));
  } catch { return false; }
}

export function errorText(error) {
  return String(error?.message || error || "未知错误").slice(0, 500);
}

export function isGone(error) {
  return /not attached|No tab with|No target with|Target closed|Session with given id not found|No session with|target.*closed/i.test(errorText(error));
}

export function friendlyError(error) {
  const message = errorText(error);
  if (/another debugger|already attached/i.test(message)) return "此标签页正被开发者工具或其他插件调试。关闭后，点击重新应用。";
  if (/Cannot access|restricted|not allowed/i.test(message)) return "Chrome 不允许在此页面启用调试，或浏览器策略限制了访问。";
  if (isGone(error)) return "页面或调试连接已关闭。可点击重新应用。";
  if (/Timezone override is already in effect/i.test(message)) return "共享渲染进程已有时区覆盖，可能与另一条规则或其他时区工具冲突。请核对规则后重试。";
  return message;
}

// Deliberately static: no page text or user input is evaluated as code.
export const PROBE_EXPRESSION = `(() => {
  const now = new Date();
  return {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    localTime: now.toLocaleString('zh-CN', { hour12: false }),
    dateString: now.toString(),
    offset: now.getTimezoneOffset(),
    januaryOffset: new Date('2026-01-15T12:00:00Z').getTimezoneOffset(),
    julyOffset: new Date('2026-07-15T12:00:00Z').getTimezoneOffset(),
    timestamp: now.getTime()
  };
})()`;
