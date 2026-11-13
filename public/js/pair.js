// The page a phone sees before it's paired: it trades the code shown on the
// Mac for its own sign-in (an HttpOnly cookie set by POST /api/pair).

import { makeT, translatePage } from "./i18n.js";

const t = makeT();
translatePage(t);
const $ = (id) => document.getElementById(id);

const ua = navigator.userAgent;
$("deviceName").value = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows PC" : t("pair.device");

$("pairForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("pairBtn").disabled = true;
  $("pairMsg").textContent = "";
  try {
    const res = await fetch("/api/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: $("code").value, name: $("deviceName").value.trim() }),
    });
    if (res.ok) {
      $("pairMsg").textContent = t("pair.done");
      location.replace("/");
      return;
    }
    $("pairMsg").textContent = t(res.status === 429 ? "pair.tooMany" : "pair.wrong");
  } catch {
    $("pairMsg").textContent = t("pair.offline");
  }
  $("pairBtn").disabled = false;
});
