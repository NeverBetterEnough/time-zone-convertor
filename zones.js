export const CITY_NAMES = {
  "UTC":"协调世界时", "Asia/Shanghai":"上海 / 北京", "Asia/Hong_Kong":"香港", "Asia/Taipei":"台北",
  "Asia/Tokyo":"东京", "Asia/Seoul":"首尔", "Asia/Singapore":"新加坡", "Asia/Dubai":"迪拜",
  "Asia/Kolkata":"印度 / 加尔各答", "Asia/Calcutta":"印度 / 加尔各答", "Asia/Bangkok":"曼谷",
  "Asia/Jakarta":"雅加达", "Asia/Ho_Chi_Minh":"胡志明市", "Asia/Saigon":"胡志明市", "Asia/Manila":"马尼拉",
  "America/New_York":"纽约 / 美东", "America/Chicago":"芝加哥 / 美中", "America/Denver":"丹佛 / 山地",
  "America/Los_Angeles":"洛杉矶 / 美西", "America/Phoenix":"凤凰城", "America/Anchorage":"安克雷奇",
  "Pacific/Honolulu":"檀香山 / 夏威夷", "America/Toronto":"多伦多", "America/Vancouver":"温哥华",
  "America/Sao_Paulo":"圣保罗", "America/Mexico_City":"墨西哥城", "America/Argentina/Buenos_Aires":"布宜诺斯艾利斯",
  "Europe/London":"伦敦", "Europe/Paris":"巴黎", "Europe/Berlin":"柏林", "Europe/Rome":"罗马",
  "Europe/Madrid":"马德里", "Europe/Moscow":"莫斯科", "Europe/Zurich":"苏黎世", "Europe/Istanbul":"伊斯坦布尔",
  "Australia/Sydney":"悉尼", "Australia/Melbourne":"墨尔本", "Australia/Perth":"珀斯",
  "Australia/Adelaide":"阿德莱德", "Pacific/Auckland":"奥克兰", "Africa/Cairo":"开罗", "Africa/Johannesburg":"约翰内斯堡"
};

export function timeZones() {
  const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : Object.keys(CITY_NAMES);
  return [...new Set(["UTC", ...supported])];
}

export function zoneLabel(zone) { return CITY_NAMES[zone] ? `${CITY_NAMES[zone]} · ${zone}` : zone.replaceAll("_", " "); }
