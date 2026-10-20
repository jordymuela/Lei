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
 * @returns {string}
 */
export function stampText(at, now = new Date()) {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (at >= day0) return "Today · " + time;
  if (at >= day0 - 864e5) return "Yesterday · " + time;
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }) + " · " + time;
}
