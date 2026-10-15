import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTimeZone, loadSettings, supportsTab, friendlyError } from "../core.js";

test("valid regions are canonicalized; invalid timezone cannot overwrite saved settings", () => {
  assert.equal(normalizeTimeZone("  asia/shanghai "), "Asia/Shanghai");
  assert.equal(normalizeTimeZone("UTC"), "UTC");
  assert.equal(normalizeTimeZone("America/New_York"), "America/New_York");
  for (const value of ["", "Mars/Base", "+05:00", null, 42]) assert.throws(() => normalizeTimeZone(value));
  assert.deepEqual(loadSettings({ enabled:false, timeZone:"Mars/Base" }), { enabled:false, timeZone:"Asia/Shanghai" });
  assert.deepEqual(loadSettings(null), { enabled:true, timeZone:"Asia/Shanghai" });
});

test("skip internal pages, the Web Store and discarded tabs", () => {
  const tab = url => ({ id:1, url });
  for (const url of ["https://example.com", "http://127.0.0.1:1234"]) assert.equal(supportsTab(tab(url)), true);
  for (const url of ["chrome://settings", "about:blank", "file:///E:/a.html", "chrome-extension://abc/page.html", "https://chromewebstore.google.com/detail/a", "https://chrome.google.com/webstore/detail/a"]) assert.equal(supportsTab(tab(url)), false);
  assert.equal(supportsTab({ ...tab("https://example.com"), discarded:true }), false);
  assert.equal(supportsTab({ id:2, url:"chrome://newtab", pendingUrl:"https://example.com" }), true);
});

test("IANA regions follow winter/summer offset rules", () => {
  const offset = (zone, date) => new Intl.DateTimeFormat("en", { timeZone:zone, timeZoneName:"shortOffset" }).formatToParts(new Date(date)).find(part => part.type === "timeZoneName").value;
  assert.equal(offset("America/New_York", "2026-01-15T12:00:00Z"), "GMT-5");
  assert.equal(offset("America/New_York", "2026-07-15T12:00:00Z"), "GMT-4");
  assert.equal(offset("Asia/Kathmandu", "2026-07-15T12:00:00Z"), "GMT+5:45");
  assert.equal(offset("UTC", "2026-07-15T12:00:00Z"), "GMT");
});

test("debugger conflicts give a useful recovery instruction", () => {
  assert.match(friendlyError(new Error("Another debugger is already attached to the tab")), /开发者工具/);
  assert.match(friendlyError(new Error("Cannot access a chrome:// URL")), /不允许/);
});
