// This bundled function runs in the top-level webpage through the existing
// debugger connection. JSON.stringify below passes data, never executable input.
function showTimezoneToast(timeZone, force) {
  if (typeof document === "undefined" || !document.documentElement) return false;
  if (Intl.DateTimeFormat().resolvedOptions().timeZone !== timeZone) return false;

  const key = Symbol.for("time-zone-convertor.feedback.v1");
  const previous = window[key];
  // Keep the marker after dismissal, so alarms, repeated tab events and service
  // worker restarts cannot keep showing the same notice in this document.
  if (!force && previous?.timeZone === timeZone) return false;
  if (previous?.timer) clearTimeout(previous.timer);
  previous?.host?.remove();

  const host = document.createElement("div");
  host.setAttribute("data-timezone-switcher-toast", "");
  host.style.cssText = "all:initial!important;position:fixed!important;top:24px!important;right:24px!important;z-index:2147483647!important;pointer-events:none!important;max-width:calc(100vw - 48px)!important;";
  const shadow = host.attachShadow({ mode:"open" });
  const notice = document.createElement("div");
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  notice.style.cssText = "box-sizing:border-box;padding:14px 18px;border:1px solid #b5ded5;border-radius:12px;background:#effbf6;color:#154d45;box-shadow:0 8px 32px #133d4526;font:14px/1.6 system-ui,'Microsoft YaHei',sans-serif;overflow-wrap:anywhere;";
  const title = document.createElement("strong");
  title.style.cssText = "display:block;font-size:12px;font-weight:600;color:#48736b;";
  title.textContent = "时区切换器";
  const message = document.createElement("span");
  message.textContent = `已切换至 ${timeZone}`;
  notice.append(title, message);
  shadow.append(notice);
  document.documentElement.append(host);

  const state = { timeZone, host, timer:0 };
  window[key] = state;
  // The timer removes the element even if webpage CSP blocks visual styling.
  state.timer = setTimeout(() => {
    host.remove();
    state.host = null;
    state.timer = 0;
  }, 2500);
  return true;
}

function clearTimezoneToast() {
  const key = Symbol.for("time-zone-convertor.feedback.v1");
  const previous = window[key];
  if (previous?.timer) clearTimeout(previous.timer);
  previous?.host?.remove();
  delete window[key];
}

export const CLEAR_TOAST_EXPRESSION = `(${clearTimezoneToast.toString()})()`;
export function toastExpression(timeZone, force = false) {
  return `(${showTimezoneToast.toString()})(${JSON.stringify(timeZone)},${Boolean(force)})`;
}
