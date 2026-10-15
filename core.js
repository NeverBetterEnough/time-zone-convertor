export const DEFAULT_SETTINGS = Object.freeze({ enabled: true, timeZone: "Asia/Shanghai" });
export const ALARM_NAME = "timezone-reconcile";

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
  let timeZone = DEFAULT_SETTINGS.timeZone;
  try { timeZone = normalizeTimeZone(value?.timeZone ?? timeZone); } catch { /* repair invalid storage */ }
  return { enabled: typeof value?.enabled === "boolean" ? value.enabled : DEFAULT_SETTINGS.enabled, timeZone };
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
  if (/Timezone override is already in effect/i.test(message)) return "页面所在进程已有其他时区覆盖，请关闭其他时区工具后重试。";
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
