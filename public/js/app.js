// Lei's page controller: setup, the conversation, and the voice loop
// (listen -> send -> stream reply -> speak -> listen again).
// The server decides the mode: "companion" (the Her-style friend) or
// "practice" (a speaking partner that corrects the learner).

import { api, chatStream } from "./api.js";
import { Figure } from "./figure.js";
import { makeT, translatePage } from "./i18n.js";
import { splitAsides } from "./lib/sentences.js";
import { stampText } from "./lib/time.js";
import { Listener } from "./listener.js";
import { Music } from "./music.js";
import { SERVER_VOICE, Speaker, prettyVoice } from "./speaker.js";

const $ = (id) => document.getElementById(id);
const app = $("app"), setupEl = $("setup"), logEl = $("log"), dock = $("dock"), ta = $("say"), sendBtn = $("sendBtn"), micBtn = $("micBtn");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** Interface text; replaced once the server says which language the page speaks. */
let t = makeT(null);

/* ---------- State ---------- */

const S = {
  stage: "boot", // boot | waking | chat
  mode: "companion", // companion | practice (from the server)
  profile: null,
  memories: [],
  transcript: [],
  corrections: [],
  /** The reply being streamed: { ctl, msg, view, gotText, done, song } */
  live: null,
};
const practice = () => S.mode === "practice";

const PREFS_KEY = "lei.prefs";
const prefs = { voiceOn: true, voice: "", rate: 1, autoListen: true };
try {
  Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"));
} catch {}
const savePrefs = () => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
};

const speaker = new Speaker({ onChange: () => refresh(), onWord: (v) => figure.kick(v) });
const music = new Music({ onChange: () => refresh(), onNote: () => figure.kick(0.45) });
const listener = new Listener({
  onHeard: (text) => {
    $("heard").textContent = text;
  },
  onUtterance: (text) => {
    if (!prefs.autoListen) listener.stop();
    send(text);
  },
  onChange: () => refresh(),
  onError: (code) => toast(t({ denied: "mic.denied", "no-mic": "mic.noMic", network: "mic.network" }[code] || "mic.failed")),
});
const figure = new Figure($("figure"), () => ({ phase: phase(), hearing: listener.hearing }));
applyVoicePrefs();
speaker.onVoices = () => {
  const picker = $("voicePicker");
  if (picker) fillVoicePicker(picker);
  if (!$("setSheet").hidden) fillVoiceSelect();
};

function applyVoicePrefs() {
  speaker.enabled = prefs.voiceOn;
  speaker.voice = prefs.voice;
  speaker.rate = prefs.rate;
}

/* ---------- Phase, status, and the half-duplex mic ---------- */

const isBusy = () => !!S.live || speaker.speaking || !!music.current;

function phase() {
  if (S.stage === "waking") return "thinking";
  if (S.live && !S.live.gotText) return "thinking";
  if (speaker.speaking || (S.live && S.live.gotText)) return "speaking";
  if (music.current) return "music";
  if (listener.active) return "listening";
  return "idle";
}

let resumeTimer = 0;
function refresh() {
  const p = phase();
  let s;
  if (S.stage === "boot") s = t("status.setup");
  else if (S.stage === "waking") s = t("status.waking");
  else if (p === "listening") s = t(listener.hearing ? "status.hearing" : "status.listening");
  else if (p === "music") s = music.current ? t("status.playing", { title: music.current.song.title }) : t("status.playingPlain");
  else s = t({ idle: "status.here", thinking: "status.thinking", speaking: "status.speaking" }[p]);
  $("statusText").textContent = s;
  $("status").classList.toggle("busy", p !== "idle");
  $("stage").classList.toggle("can-interrupt", isBusy());

  // Never listen while the voice or music is playing: the mic would hear it.
  const quiet = !speaker.speaking && !music.current;
  clearTimeout(resumeTimer);
  if (!quiet) listener.pause();
  else if (listener.paused) resumeTimer = setTimeout(() => !speaker.speaking && !music.current && listener.resume(), 350);

  micBtn.setAttribute("aria-pressed", String(listener.wanted));
  micBtn.setAttribute("aria-label", t(listener.wanted ? "mic.stop" : "mic.start"));
  micBtn.classList.toggle("paused", listener.wanted && listener.paused);

  const empty = !ta.value.trim(), stop = isBusy() && empty;
  sendBtn.classList.toggle("is-stop", stop);
  sendBtn.classList.toggle("empty", empty && !stop);
  sendBtn.setAttribute("aria-label", t(stop ? "send.stop" : "send.send"));
}

function interrupt() {
  if (S.live) {
    S.live.ctl.abort();
    finalizeLive(S.live, true);
  }
  speaker.stop();
  music.stop(true);
  refresh();
}

function setName(name, animate) {
  const el = $("companionName");
  el.textContent = name;
  if (animate && !reduceMotion) {
    el.classList.remove("arrive");
    void el.offsetWidth;
    el.classList.add("arrive");
  }
}

let toastTimer = 0;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4200);
}

/** Puts a reply's text into `el`, showing [asides] (help in the learner's language) as their own quieter line. */
function renderText(el, text) {
  el.replaceChildren(...splitAsides(text).map((part) => (part.aside ? h("span", "aside", part.text) : document.createTextNode(part.text))));
}

/* ---------- Setup ---------- */

const LEVELS = ["beginner", "intermediate", "advanced"];
function steps() {
  return practice()
    ? [
        { key: "userName", max: 40, required: true },
        { key: "level", choices: LEVELS },
        { key: "goal", max: 300 },
        { key: "voice", voice: true },
      ]
    : [
        { key: "userName", max: 40, required: true },
        { key: "about", max: 200 },
        { key: "onMind", max: 600, area: true },
        { key: "voice", voice: true },
      ];
}
let draft = { userName: "", about: "", onMind: "", level: "intermediate", goal: "" };

function enterIntro() {
  S.stage = "boot";
  app.classList.add("boot");
  setupEl.hidden = false;
  logEl.hidden = true;
  dock.hidden = true;
  $("tools").hidden = true;
  setName(practice() ? "lei" : "her");
  const k = practice() ? "practice.intro." : "intro.";
  setupEl.replaceChildren(h("p", "eyebrow", t(k + "eyebrow")), h("h2", "q", t(k + "title")), h("p", "qhint", t(k + "body")));
  const actions = h("div", "actions");
  const begin = h("button", "pill", t("intro.begin"));
  begin.type = "button";
  begin.onclick = () => {
    speaker.unlock();
    music.ensure();
    renderStep(0);
  };
  actions.append(begin, h("span", "fine", t("intro.fine")));
  setupEl.append(actions);
  refresh();
}

function renderStep(i) {
  const all = steps();
  const st = all[i];
  const vars = { target: "English" };
  setupEl.replaceChildren(
    h("p", "eyebrow", t("setup.step", { n: i + 1, total: all.length })),
    h("h2", "q", t("q." + st.key, vars)),
    h("p", "qhint", t("hint." + st.key, vars)),
  );
  let input = null;
  if (st.voice) {
    const wrap = h("div", "voices");
    wrap.id = "voicePicker";
    fillVoicePicker(wrap);
    setupEl.append(wrap);
  } else if (st.choices) {
    const wrap = h("div", "voices");
    st.choices.forEach((choice, idx) => {
      const row = h("div", "vopt"), lab = h("label"), r = h("input"), txt = h("span", "vtext");
      r.type = "radio";
      r.name = "choice-" + st.key;
      r.id = `choice-${st.key}-${idx}`;
      r.checked = draft[st.key] === choice;
      r.onchange = () => (draft[st.key] = choice);
      lab.htmlFor = r.id;
      txt.append(h("span", "vname", t(`${st.key}.${choice}`)), h("span", "vsub", t(`${st.key}.${choice}Sub`)));
      lab.append(r, txt);
      row.append(lab);
      wrap.append(row);
    });
    setupEl.append(wrap);
  } else {
    input = h(st.area ? "textarea" : "input", "line-input");
    input.id = "setup-" + st.key;
    input.placeholder = t("ph." + st.key);
    input.maxLength = st.max;
    input.value = draft[st.key] || "";
    if (st.area) input.rows = 3;
    else {
      input.type = "text";
      input.autocomplete = st.key === "userName" ? "given-name" : "off";
    }
    const lab = h("label", "sr", t("q." + st.key, vars));
    lab.htmlFor = input.id;
    setupEl.append(lab, input);
  }
  const actions = h("div", "actions");
  const back = h("button", "pill ghost", t("setup.back"));
  back.type = "button";
  const next = h("button", "pill", t(i === all.length - 1 ? "setup.wake" : "setup.continue"));
  next.type = "button";
  actions.append(back, next);
  setupEl.append(actions);
  const validate = () => (next.disabled = !!(st.required && !input?.value.trim()));
  if (input) {
    input.addEventListener("input", () => {
      draft[st.key] = input.value;
      validate();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (!next.disabled) next.click();
      }
    });
    setTimeout(() => input.focus({ preventScroll: true }), 80);
  }
  next.onclick = () => {
    speaker.unlock();
    music.ensure();
    if (input) draft[st.key] = input.value.trim();
    if (i < all.length - 1) renderStep(i + 1);
    else wake();
  };
  back.onclick = () => (i === 0 ? enterIntro() : renderStep(i - 1));
  validate();
}

/** The voice choices: the server's natural voice (if configured), the best browser voices, and text only. */
function voiceChoices(limit) {
  const list = [];
  if (speaker.serverAvailable) list.push({ id: SERVER_VOICE, label: t("voice.natural"), sub: "ElevenLabs" });
  for (const v of speaker.ranked().slice(0, limit)) {
    list.push({ id: v.name, label: prettyVoice(v.name), sub: v.lang + (/premium|enhanced|natural|neural/i.test(v.name) ? " · " + t("voice.highQuality") : "") });
  }
  return list;
}

function fillVoicePicker(wrap) {
  wrap.replaceChildren();
  const list = voiceChoices(5);
  if (!list.length) prefs.voiceOn = false;
  else if (!list.some((c) => c.id === prefs.voice)) prefs.voice = list[0].id;
  applyVoicePrefs();
  const add = (idx, choice) => {
    const row = h("div", "vopt"), lab = h("label"), r = h("input"), txt = h("span", "vtext");
    r.type = "radio";
    r.name = "voicePick";
    r.id = "vp-" + idx;
    r.checked = choice ? prefs.voiceOn && prefs.voice === choice.id : !prefs.voiceOn;
    r.onchange = () => {
      prefs.voiceOn = !!choice;
      if (choice) prefs.voice = choice.id;
      savePrefs();
      applyVoicePrefs();
      if (choice) speaker.preview(choice.id);
      else speaker.stop();
    };
    lab.htmlFor = r.id;
    txt.append(h("span", "vname", choice ? choice.label : t("voice.textOnly")), h("span", "vsub", choice ? choice.sub : t("voice.textOnlySub")));
    lab.append(r, txt);
    row.append(lab);
    if (choice) {
      const b = h("button", "mini", t("voice.hear"));
      b.type = "button";
      b.setAttribute("aria-label", t("voice.hear") + " " + choice.label);
      b.onclick = () => speaker.preview(choice.id);
      row.append(b);
    }
    wrap.append(row);
  };
  list.forEach((c, i) => add(i, c));
  add("none", null);
  savePrefs();
}

async function wake() {
  S.stage = "waking";
  refresh();
  setupEl.replaceChildren(h("p", "eyebrow", t("setup.startingUp")), h("h2", "q", t("setup.waking")), h("p", "qhint", t("setup.wakingHint")));
  try {
    loadState(await api.setup(draft));
    enterChat(true);
    const greeting = S.transcript[S.transcript.length - 1]?.text || "";
    figure.kick(1.2);
    speaker.begin();
    speaker.push(greeting, true);
    $("live").textContent = greeting;
  } catch (err) {
    S.stage = "boot";
    refresh();
    setupEl.replaceChildren(h("p", "eyebrow", t("setup.startingUp")), h("h2", "q", t("setup.failed")), h("p", "qhint", explain(err.code, err.message)));
    const actions = h("div", "actions");
    const back = h("button", "pill ghost", t("setup.back"));
    back.type = "button";
    back.onclick = () => renderStep(steps().length - 1);
    const again = h("button", "pill", t("setup.tryAgain"));
    again.type = "button";
    again.onclick = wake;
    actions.append(back, again);
    setupEl.append(actions);
  }
}

/* ---------- Conversation ---------- */

function loadState(state) {
  S.profile = state.profile;
  S.memories = state.memories || [];
  S.transcript = state.transcript || [];
  S.corrections = state.corrections || [];
  S.mode = state.mode === "practice" ? "practice" : "companion";
  speaker.serverAvailable = state.voice === "server";
  speaker.lang = state.speechLang || "";
  listener.lang = state.speechLang || "";
  t = makeT(state.ui);
  translatePage(t);
}

/** Reminders arrive from the server over server-sent events and are spoken when due. */
let events = null;
function listenForReminders() {
  if (events || !("EventSource" in window)) return;
  events = new EventSource("/api/events");
  events.addEventListener("reminder", (e) => {
    let reminder;
    try {
      reminder = JSON.parse(e.data);
    } catch {
      return;
    }
    const line = t("reminder.say", { text: reminder.text });
    toast(line);
    notice(line, false);
    figure.kick(1);
    if (prefs.voiceOn) speaker.whenDone(() => speaker.say(line));
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      new Notification(S.profile?.companionName || "Lei", { body: reminder.text });
    }
  });
}

function enterChat(fresh) {
  S.stage = "chat";
  app.classList.remove("boot");
  setupEl.hidden = true;
  logEl.hidden = false;
  dock.hidden = false;
  $("tools").hidden = false;
  setName(S.profile.companionName, fresh);
  ta.placeholder = t("chat.placeholder", { name: S.profile.companionName });
  micBtn.hidden = !listener.supported;
  $("hint").textContent = t(listener.supported ? "chat.hint" : "chat.hintNoMic");
  renderLog();
  refresh();
  if (!practice()) listenForReminders();
}

const lastAt = () => (S.transcript.length ? S.transcript[S.transcript.length - 1].at : 0);

function songRow(song) {
  const wrap = h("div", "song-row"), b = h("button", "song");
  b.type = "button";
  b.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.8v10.4L13 8z" fill="currentColor"/></svg>';
  b.append(document.createTextNode(t("chat.play", { title: song.title })));
  b.onclick = () => {
    speaker.stop();
    music.play(song);
  };
  wrap.append(b);
  return wrap;
}

/** A correction card under the learner's message: the better phrasing, then why. */
function fixCard(c) {
  const card = h("div", "fix");
  card.dataset.forAt = String(c.forAt);
  card.append(h("b", null, t("chat.better") + " "), document.createTextNode("“" + c.better + "”"));
  if (c.why) card.append(h("span", "why", c.why));
  return card;
}

function addRow(m, prevAt) {
  let stamp = null;
  if (!prevAt || m.at - prevAt > 2 * 3600e3) {
    stamp = h("p", "stamp", stampText(m.at, new Date(), { today: t("stamp.today"), yesterday: t("stamp.yesterday") }));
    logEl.append(stamp);
  }
  const row = h("div", "m " + (m.role === "user" ? "m-u" : "m-a"));
  const txt = h("span", "txt");
  if (m.role === "user") txt.textContent = m.text;
  else renderText(txt, m.text);
  row.append(txt);
  if (m.song) row.append(songRow(m.song));
  logEl.append(row);
  if (m.role === "user") {
    row.dataset.at = String(m.at);
    for (const c of S.corrections) if (c.forAt === m.at) logEl.append(fixCard(c));
  }
  return { row, txt, stamp };
}

/** Shows a correction that arrived mid-reply under the message it's about. */
function showCorrection(c) {
  const row = logEl.querySelector(`.m-u[data-at="${c.forAt}"]`);
  if (!row) return;
  let after = row;
  while (after.nextElementSibling?.classList.contains("fix")) after = after.nextElementSibling;
  after.after(fixCard(c));
}

function renderLog() {
  logEl.replaceChildren();
  let prev = 0;
  for (const m of S.transcript) {
    addRow(m, prev);
    prev = m.at;
  }
  scrollEnd(true);
}

function scrollEnd(force) {
  const near = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 160;
  if (force || near) logEl.scrollTop = logEl.scrollHeight;
}

function explain(code, message) {
  const name = S.profile?.companionName || "Lei";
  if (["auth", "config", "rate_limited", "network", "offline", "setup"].includes(code)) return t("err." + code);
  if (code === "refused") return t("err.refused", { name });
  return message ? t("err.defaultWith", { message }) : t("err.default");
}

function notice(text, retry) {
  const box = h("div", "notice");
  box.setAttribute("role", "status");
  box.append(h("p", null, text));
  if (retry) {
    const b = h("button", "pill", t("setup.tryAgain"));
    b.type = "button";
    b.onclick = () => {
      box.remove();
      respond({ retry: true });
    };
    const row = h("div", "row-btns");
    row.append(b);
    box.append(row);
  }
  logEl.append(box);
  scrollEnd(true);
}
const clearNotices = () => logEl.querySelectorAll(".notice").forEach((n) => n.remove());

/** One quiet line under the reply saying what Lei is doing ("Reading ~/notes.txt"). */
function showActivity(view, activity) {
  let line = view.row.querySelector(".activity");
  if (!line) {
    line = h("span", "activity");
    view.row.append(line);
  }
  const target = activity.target.length > 60 ? activity.target.slice(0, 57) + "…" : activity.target;
  line.textContent = t("activity." + activity.kind, { target });
}

function finalizeLive(live, keep) {
  if (live.done) return;
  live.done = true;
  live.view.row.querySelector(".activity")?.remove();
  if (S.live === live) S.live = null;
  const m = live.msg;
  m.text = m.text.trim();
  if (live.song && keep) m.song = live.song;
  if (keep && (m.text || m.song)) {
    renderText(live.view.txt, m.text);
    if (m.song && !live.view.row.querySelector(".song-row")) live.view.row.append(songRow(m.song));
    S.transcript.push(m);
  } else {
    live.view.row.remove();
    live.view.stamp?.remove();
  }
}

/** Streams a reply and speaks it as it arrives. `quiet` hides failures (welcome-back greetings). */
async function respond(body, quiet = false) {
  if (S.live) interrupt();
  const ctl = new AbortController();
  const msg = { role: "assistant", text: "", at: Date.now() };
  const view = addRow(msg, lastAt());
  const dots = h("span", "dots");
  dots.innerHTML = "<i></i><i></i><i></i>";
  dots.setAttribute("aria-label", t("status.thinking"));
  view.txt.append(dots);
  const live = { ctl, msg, view, gotText: false, done: false, song: null };
  S.live = live;
  speaker.begin();
  scrollEnd(true);
  refresh();

  let failure = null;
  let finished = false;
  try {
    await chatStream(body, {
      signal: ctl.signal,
      onEvent: (e) => {
        if (live.done) return;
        if (e.type === "text") {
          live.gotText = true;
          msg.text += e.delta;
          renderText(view.txt, msg.text.trim());
          speaker.push(msg.text);
          scrollEnd();
          refresh();
        } else if (e.type === "memory") {
          S.memories.push(e.memory);
          if (!$("memSheet").hidden) renderMemories();
          toast(t("toast.remembered", { text: e.memory.text }));
        } else if (e.type === "activity") {
          showActivity(view, e.activity);
          scrollEnd();
        } else if (e.type === "reminder_set") {
          const time = new Date(e.reminder.due).toLocaleString(t.lang, { weekday: "short", hour: "numeric", minute: "2-digit" });
          toast(t("reminder.set", { time, text: e.reminder.text }));
          if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
        } else if (e.type === "correction") {
          S.corrections.push(e.correction);
          showCorrection(e.correction);
        } else if (e.type === "song") {
          live.song = e.song;
        } else if (e.type === "done") {
          finished = true;
        } else if (e.type === "error") {
          failure = e;
        }
      },
    });
  } catch (err) {
    if (err.name === "AbortError" || live.done) return;
    failure = { code: err.code || "offline", message: err.message };
  }
  if (live.done) return;
  if (!finished && !failure) failure = { code: "offline", message: "" };

  finalizeLive(live, !failure);
  if (!failure) {
    speaker.push(msg.text, true);
    if (msg.song) {
      const song = msg.song;
      speaker.whenDone(() => !S.live && music.play(song));
    }
    if (msg.text) $("live").textContent = msg.text;
  } else {
    speaker.stop();
    if (!quiet) notice(explain(failure.code, failure.message), !["refused", "auth", "config"].includes(failure.code));
  }
  refresh();
  scrollEnd();
}

function send(text) {
  speaker.unlock();
  music.ensure();
  interrupt();
  clearNotices();
  const m = { role: "user", text, at: Date.now() };
  addRow(m, lastAt());
  S.transcript.push(m);
  scrollEnd(true);
  respond({ text });
}

/* ---------- Composer, mic, interrupting ---------- */

function autosize() {
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
}
$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = ta.value.trim();
  if (!v) {
    if (isBusy()) interrupt();
    return;
  }
  ta.value = "";
  autosize();
  send(v);
});
ta.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("composer").requestSubmit();
  }
});
ta.addEventListener("input", () => {
  autosize();
  refresh();
});
micBtn.onclick = () => {
  speaker.unlock();
  music.ensure();
  if (listener.wanted) listener.stop();
  else {
    if (speaker.speaking || music.current) interrupt();
    listener.start();
  }
};
$("stage").onclick = () => isBusy() && interrupt();

/* ---------- Sheets ---------- */

let lastFocus = null;
function openSheet(id) {
  const w = $(id);
  lastFocus = document.activeElement;
  if (id === "memSheet") renderMemories();
  else syncSettings();
  w.hidden = false;
  w.querySelector(".sheet [data-close]")?.focus({ preventScroll: true });
}
function closeSheet(w) {
  w.hidden = true;
  $("confirm").hidden = true;
  lastFocus?.focus?.({ preventScroll: true });
}
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeSheet(b.closest(".sheet-wrap"))));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const open = [...document.querySelectorAll(".sheet-wrap:not([hidden])")];
  if (open.length) open.forEach(closeSheet);
  else if (isBusy()) interrupt();
});
$("memBtn").onclick = () => openSheet("memSheet");
$("setBtn").onclick = () => openSheet("setSheet");
$("toast").onclick = () => {
  $("toast").hidden = true;
  if (S.stage === "chat") openSheet("memSheet");
};

function renderMemories() {
  const list = $("memList"), name = S.profile?.companionName || "Lei";
  list.replaceChildren();
  $("memNote").textContent = t(S.memories.length ? "mem.some" : "mem.none", { name });
  for (const m of S.memories.slice().reverse()) {
    const li = h("li", "mem"), body = h("div", "mem-body");
    body.append(h("p", null, m.text), h("span", "mem-date", new Date(m.at).toLocaleDateString(t.lang, { month: "short", day: "numeric", year: "numeric" })));
    const b = h("button", "mini", t("mem.forget"));
    b.type = "button";
    b.setAttribute("aria-label", t("mem.forget") + ": " + m.text);
    b.onclick = async () => {
      b.disabled = true;
      try {
        S.memories = (await api.forget(m.id)).memories;
        renderMemories();
      } catch (err) {
        b.disabled = false;
        toast(explain(err.code, err.message));
      }
    };
    li.append(body, b);
    list.append(li);
  }
  $("fixGroup").hidden = !practice();
  const fixes = $("fixList");
  fixes.replaceChildren();
  $("fixNote").textContent = S.corrections.length ? "" : t("mem.correctionsNone");
  for (const c of S.corrections.slice().reverse().slice(0, 50)) {
    const li = h("li", "mem"), body = h("div", "mem-body");
    body.append(h("p", null, "“" + c.better + "”"), h("span", "mem-date", c.said + (c.why ? " · " + c.why : "")));
    li.append(body);
    fixes.append(li);
  }
}

function fillVoiceSelect() {
  const sel = $("voiceSel");
  const list = voiceChoices(14);
  sel.replaceChildren();
  if (!list.length) sel.append(h("option", null, t("voice.none")));
  const current = list.some((c) => c.id === prefs.voice) ? prefs.voice : list[0]?.id;
  for (const c of list) {
    const o = h("option", null, c.label + " · " + c.sub);
    o.value = c.id;
    o.selected = c.id === current;
    sel.append(o);
  }
  sel.disabled = !list.length || !prefs.voiceOn;
}

function syncSettings() {
  $("voiceOn").checked = prefs.voiceOn;
  $("voiceOn").disabled = !speaker.available;
  fillVoiceSelect();
  $("rate").value = prefs.rate;
  $("rate").disabled = !prefs.voiceOn;
  $("rateOut").textContent = Number(prefs.rate).toFixed(2).replace(/\.?0+$/, "") + "×";
  $("autoListen").checked = prefs.autoListen;
  $("autoListen").disabled = !listener.supported;
  $("micNote").textContent = listener.supported ? t("set.micNote", { name: S.profile.companionName }) : t("set.micNoteNone");
  $("renameIn").value = S.profile.companionName;
}

$("voiceOn").onchange = (e) => {
  prefs.voiceOn = e.target.checked;
  if (!prefs.voiceOn) speaker.stop();
  savePrefs();
  applyVoicePrefs();
  syncSettings();
};
$("voiceSel").onchange = (e) => {
  prefs.voice = e.target.value;
  savePrefs();
  applyVoicePrefs();
  speaker.preview(prefs.voice);
};
$("rate").oninput = (e) => {
  prefs.rate = Number(e.target.value);
  $("rateOut").textContent = prefs.rate.toFixed(2).replace(/\.?0+$/, "") + "×";
};
$("rate").onchange = () => {
  savePrefs();
  applyVoicePrefs();
  speaker.preview(prefs.voice);
};
$("autoListen").onchange = (e) => {
  prefs.autoListen = e.target.checked;
  savePrefs();
};
$("renameForm").onsubmit = async (e) => {
  e.preventDefault();
  const n = $("renameIn").value.trim();
  if (!n || n === S.profile.companionName) return;
  try {
    loadState(await api.rename(n));
    setName(S.profile.companionName, true);
    ta.placeholder = t("chat.placeholder", { name: S.profile.companionName });
    toast(t("toast.renamed", { name: S.profile.companionName }));
  } catch (err) {
    toast(explain(err.code, err.message));
  }
};

let confirmKind = "";
function askConfirm(kind) {
  confirmKind = kind;
  const name = S.profile.companionName;
  $("confirmText").textContent = t(kind === "clear" ? "confirm.clear" : "confirm.reset", { name });
  $("confirmYes").textContent = t(kind === "clear" ? "confirm.eraseConv" : "confirm.eraseAll");
  $("confirm").hidden = false;
  $("confirmNo").focus({ preventScroll: true });
}
$("clearBtn").onclick = () => askConfirm("clear");
$("resetBtn").onclick = () => askConfirm("reset");
$("confirmNo").onclick = () => ($("confirm").hidden = true);
$("confirmYes").onclick = async () => {
  interrupt();
  listener.stop();
  try {
    if (confirmKind === "clear") {
      loadState(await api.clearTranscript());
      renderLog();
      closeSheet($("setSheet"));
      toast(t("toast.cleared"));
    } else {
      loadState(await api.reset());
      draft = { userName: "", about: "", onMind: "", level: "intermediate", goal: "" };
      closeSheet($("setSheet"));
      enterIntro();
    }
  } catch (err) {
    toast(explain(err.code, err.message));
  }
};

/* ---------- Boot ---------- */

async function start() {
  let state;
  try {
    state = await api.state();
  } catch {
    setupEl.replaceChildren(h("p", "eyebrow", t("status.offline")), h("h2", "q", t("offline.title")), h("p", "qhint", t("offline.hint")));
    $("statusText").textContent = t("status.offline");
    return;
  }
  loadState(state);
  if (!S.profile) return enterIntro();
  enterChat(false);
  const last = S.transcript[S.transcript.length - 1];
  if (last && Date.now() - last.at > 3 * 3600e3) respond({ nudge: "welcome-back" }, true);
}

refresh();
start();
