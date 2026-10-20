// Human phrasing for time gaps, shared by the server's prompts and the browser's timestamps.

/**
 * "a moment", "12 minutes", "an hour", "3 days".
 * @param {number} ms
 * @returns {string}
 */
export function ago(ms) {
  const m = Math.round(ms / 60000);
  if (m < 2) return "a moment";
  if (m < 60) return m + " minutes";
  const h = Math.round(m / 60);
  if (h < 36) return h === 1 ? "an hour" : h + " hours";
  const d = Math.round(h / 24);
  return d === 1 ? "a day" : d + " days";
}

/**
 * Label for a divider in the conversation: "Today · 1:40 AM", "Yesterday · …", "Tuesday, Oct 14 · …".
 * @param {number} at
 * @param {Date} [now]
 * @param {{ today: string, yesterday: string }} [words] translated "Today" / "Yesterday"
 * @param {string} [locale] for the date and time formats; defaults to the browser's
 * @returns {string}
 */
export function stampText(at, now = new Date(), words = { today: "Today", yesterday: "Yesterday" }, locale) {
  const d = new Date(at);
  const time = d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (at >= day0) return words.today + " · " + time;
  if (at >= day0 - 864e5) return words.yesterday + " · " + time;
  return d.toLocaleDateString(locale, { weekday: "long", month: "short", day: "numeric" }) + " · " + time;
}
