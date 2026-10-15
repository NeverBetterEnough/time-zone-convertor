import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTimeZone, normalizePattern, normalizeRules, findRule, hostnameFromUrl, loadSettings, supportsTab, friendlyError } from "../core.js";

test("valid regions are canonicalized; invalid timezone cannot overwrite saved settings", () => {
  assert.equal(normalizeTimeZone("  asia/shanghai "), "Asia/Shanghai");
  assert.equal(normalizeTimeZone("UTC"), "UTC");
  assert.equal(normalizeTimeZone("America/New_York"), "America/New_York");
  for (const value of ["", "Mars/Base", "+05:00", null, 42]) assert.throws(() => normalizeTimeZone(value));
  assert.deepEqual(loadSettings({ enabled:false, timeZone:"Mars/Base" }), { enabled:false, rules:[] });
  assert.deepEqual(loadSettings(null), { enabled:true, rules:[] });
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

const rule = (type, pattern, extra = {}) => normalizeRules([{ id:"r1", enabled:true, type, pattern, timeZone:"America/New_York", ...extra }])[0];
test("matching only examines hostname, never credentials, port, path or query", () => {
  const rules = [rule("contains", "amazon")];
  assert.ok(findRule("https://WWW.AMAZON.COM:8443/", rules));
  assert.equal(findRule("https://example.com/amazon?next=amazon.com", rules), null);
  assert.equal(findRule("https://amazon@example.com/", rules), null);
  assert.equal(findRule("chrome://amazon/", rules), null);
  assert.equal(hostnameFromUrl("https://EXAMPLE.com.:8000/path"), "example.com");
});
test("domain matches enforce a dot boundary; exact does not include subdomains", () => {
  const rules = [rule("domain", "Example.com.")];
  for (const host of ["example.com", "shop.example.com", "a.b.example.com"]) assert.ok(findRule(`https://${host}/`, rules));
  for (const host of ["badexample.com", "example.com.evil.test"]) assert.equal(findRule(`https://${host}/`, rules), null);
  assert.equal(findRule("https://shop.example.com", [rule("exact", "example.com")]), null);
  assert.equal(normalizePattern("中文.cn", "domain"), new URL("https://中文.cn").hostname);
});
test("first enabled matching rule wins and no fallback exists", () => {
  const first = rule("contains", "example", { id:"first", enabled:false });
  const second = rule("domain", "example.com", { id:"second", timeZone:"Asia/Tokyo" });
  assert.equal(findRule("https://example.com", [first, second]).id, "second");
  first.enabled = true;
  assert.equal(findRule("https://example.com", [first, second]).id, "first");
  assert.equal(findRule("https://example.com", []), null);
  assert.deepEqual(loadSettings({ enabled:true, timeZone:"America/New_York" }), { enabled:true, rules:[] });
});
test("invalid rules are rejected rather than broadening scope", () => {
  for (const pattern of ["", "*", "https://example.com", "example.com/path", "example.com:443", "a..com"]) assert.throws(() => rule("domain", pattern));
  for (const pattern of ["*", "a/b", "a?b", "."]) assert.throws(() => rule("contains", pattern));
  assert.throws(() => normalizeRules([rule("exact", "a.test"), rule("exact", "b.test")]));
  assert.throws(() => normalizeRules(Array.from({length:201}, (_,i)=>({id:`r${i}`, type:"exact", pattern:"a.test", timeZone:"UTC"}))));
  assert.deepEqual(loadSettings({ enabled:true, rules:[{type:"contains", pattern:"*", timeZone:"UTC"}] }), {enabled:true, rules:[]});
});
