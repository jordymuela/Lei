// Lei's page controller: setup, the conversation, and the voice loop
// (listen -> send -> stream reply -> speak -> listen again).

import { api, chatStream } from "./api.js";
import { Figure } from "./figure.js";
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

/* ---------- State ---------- */

const S = {
  mode: "boot", // boot | waking | chat
  profile: null,
  memories: [],
  transcript: [],
  /** The reply being streamed: { ctl, msg, view, gotText, done, song } */
  live: null,
};

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
  onError: (code) =>
    toast(
      {
        denied: "Microphone access is blocked. Allow it in the browser's site settings to talk.",
        "no-mic": "No microphone found.",
        network: "Speech recognition lost its connection. Tap the mic to try again.",
      }[code] || "Listening stopped. Tap the mic to try again.",
    ),
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
  if (S.mode === "waking") return "thinking";
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
  if (S.mode === "boot") s = "Setup";
  else if (S.mode === "waking") s = "Waking up";
  else if (p === "listening") s = listener.hearing ? "Hearing you" : "Listening";
  else s = { idle: "Here", thinking: "Thinking", speaking: "Speaking", music: music.current ? "Playing “" + music.current.song.title + "”" : "Playing" }[p];
  $("statusText").textContent = s;
  $("status").classList.toggle("busy", p !== "idle");
  $("stage").classList.toggle("can-interrupt", isBusy());

  // Never listen while the companion's voice or music is playing: the mic would hear it.
  const quiet = !speaker.speaking && !music.current;
  clearTimeout(resumeTimer);
  if (!quiet) listener.pause();
  else if (listener.paused) resumeTimer = setTimeout(() => !speaker.speaking && !music.current && listener.resume(), 350);

  micBtn.setAttribute("aria-pressed", String(listener.wanted));
  micBtn.setAttribute("aria-label", listener.wanted ? "Stop listening" : "Start talking");
  micBtn.classList.toggle("paused", listener.wanted && listener.paused);

  const empty = !ta.value.trim(), stop = isBusy() && empty;
  sendBtn.classList.toggle("is-stop", stop);
  sendBtn.classList.toggle("empty", empty && !stop);
  sendBtn.setAttribute("aria-label", stop ? "Stop" : "Send");
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
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  t.classList.remove("show");
  void t.offsetWidth;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4200);
}

/* ---------- Setup ---------- */

const STEPS = [
  { key: "userName", q: "What’s your name?", hint: "Your first name is perfect.", ph: "Your name", max: 40, required: true },
  { key: "about", q: "Describe yourself in a few words.", hint: "Anything goes. “Night owl, nurse, learning guitar.”", ph: "A few words about you", max: 200 },
  { key: "onMind", q: "What’s been on your mind lately?", hint: "Big or small. You can skip this one.", ph: "Lately I keep thinking about…", max: 600, area: true },
  { key: "voice", q: "Choose a voice.", hint: "Tap one to hear it. You can change it later in Settings.", voice: true },
];
let draft = { userName: "", about: "", onMind: "" };
let step = -1;

function enterIntro() {
  S.mode = "boot";
  step = -1;
  app.classList.add("boot");
  setupEl.hidden = false;
  logEl.hidden = true;
  dock.hidden = true;
  $("tools").hidden = true;
  setName("her");
  setupEl.replaceChildren(
    h("p", "eyebrow", "A companion inspired by the film Her"),
    h("h2", "q", "Someone to talk to. Curious about you, honest about what it is, and a little more yours every time you talk."),
    h("p", "qhint", "It picks its own name, talks with you out loud, and keeps notes about what matters to you. You can read and erase those notes anytime."),
  );
  const actions = h("div", "actions");
  const begin = h("button", "pill", "Begin setup");
  begin.type = "button";
  begin.onclick = () => {
    speaker.unlock();
    music.ensure();
    renderStep(0);
  };
  actions.append(begin, h("span", "fine", "Four questions"));
  setupEl.append(actions);
  refresh();
}

function renderStep(i) {
  step = i;
  const st = STEPS[i];
  setupEl.replaceChildren(h("p", "eyebrow", `Setup · ${i + 1} of ${STEPS.length}`), h("h2", "q", st.q), h("p", "qhint", st.hint));
  let input = null;
  if (st.voice) {
    const wrap = h("div", "voices");
    wrap.id = "voicePicker";
    fillVoicePicker(wrap);
    setupEl.append(wrap);
  } else {
    input = h(st.area ? "textarea" : "input", "line-input");
    input.id = "setup-" + st.key;
    input.placeholder = st.ph;
    input.maxLength = st.max;
    input.value = draft[st.key] || "";
    if (st.area) input.rows = 3;
    else {
      input.type = "text";
      input.autocomplete = st.key === "userName" ? "given-name" : "off";
    }
    const lab = h("label", "sr", st.q);
    lab.htmlFor = input.id;
    setupEl.append(lab, input);
  }
  const actions = h("div", "actions");
  const back = h("button", "pill ghost", "Back");
  back.type = "button";
  const next = h("button", "pill", i === STEPS.length - 1 ? "Wake up" : "Continue");
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
    if (i < STEPS.length - 1) renderStep(i + 1);
    else wake();
  };
  back.onclick = () => (i === 0 ? enterIntro() : renderStep(i - 1));
  validate();
}

/** The voice choices: the server's natural voice (if configured), the best browser voices, and text only. */
function voiceChoices(limit) {
  const list = [];
  if (speaker.serverAvailable) list.push({ id: SERVER_VOICE, label: "Natural voice", sub: "ElevenLabs" });
  for (const v of speaker.ranked().slice(0, limit)) {
    list.push({ id: v.name, label: prettyVoice(v.name), sub: v.lang + (/premium|enhanced|natural|neural/i.test(v.name) ? " · high quality" : "") });
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
    txt.append(h("span", "vname", choice ? choice.label : "Text only"), h("span", "vsub", choice ? choice.sub : "No voice. Replies appear as writing."));
    lab.append(r, txt);
    row.append(lab);
    if (choice) {
      const b = h("button", "mini", "Hear");
      b.type = "button";
      b.setAttribute("aria-label", "Hear " + choice.label);
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
  S.mode = "waking";
  refresh();
  setupEl.replaceChildren(h("p", "eyebrow", "Starting up"), h("h2", "q", "Waking up."), h("p", "qhint", "Reading your answers and choosing a name."));
  try {
    const state = await api.setup(draft);
    loadState(state);
    enterChat(true);
    const greeting = S.transcript[S.transcript.length - 1]?.text || "";
    figure.kick(1.2);
    speaker.begin();
    speaker.push(greeting, true);
    $("live").textContent = greeting;
  } catch (err) {
    S.mode = "boot";
    refresh();
    setupEl.replaceChildren(h("p", "eyebrow", "Starting up"), h("h2", "q", "Not awake yet."), h("p", "qhint", explain(err.code, err.message, "Your companion")));
    const actions = h("div", "actions");
    const back = h("button", "pill ghost", "Back");
    back.type = "button";
    back.onclick = () => renderStep(STEPS.length - 1);
    const again = h("button", "pill", "Try again");
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
  speaker.serverAvailable = state.voice === "server";
}

function enterChat(fresh) {
  S.mode = "chat";
  app.classList.remove("boot");
  setupEl.hidden = true;
  logEl.hidden = false;
  dock.hidden = false;
  $("tools").hidden = false;
  setName(S.profile.companionName, fresh);
  ta.placeholder = "Talk to " + S.profile.companionName + "…";
  micBtn.hidden = !listener.supported;
  $("hint").textContent = listener.supported
    ? "Tap the mic and just talk. Tap the figure or press Esc to interrupt."
    : "Voice input needs Chrome, Edge or Safari. You can still type, and replies are still spoken.";
  renderLog();
  refresh();
}

const lastAt = () => (S.transcript.length ? S.transcript[S.transcript.length - 1].at : 0);

function songRow(song) {
  const wrap = h("div", "song-row"), b = h("button", "song");
  b.type = "button";
  b.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.8v10.4L13 8z" fill="currentColor"/></svg>';
  b.append(document.createTextNode("Play “" + song.title + "”"));
  b.onclick = () => {
    speaker.stop();
    music.play(song);
  };
  wrap.append(b);
  return wrap;
}

function addRow(m, prevAt) {
  let stamp = null;
  if (!prevAt || m.at - prevAt > 2 * 3600e3) {
    stamp = h("p", "stamp", stampText(m.at));
    logEl.append(stamp);
  }
  const row = h("div", "m " + (m.role === "user" ? "m-u" : "m-a"));
  const txt = h("span", "txt", m.text);
  row.append(txt);
  if (m.song) row.append(songRow(m.song));
  logEl.append(row);
  return { row, txt, stamp };
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

function explain(code, message, who) {
  switch (code) {
    case "auth": return "Claude rejected the server's credentials. Check ANTHROPIC_API_KEY (or run `ant auth login`), then restart the server.";
    case "config": return "The server has no Claude credentials. Add ANTHROPIC_API_KEY to the .env file (or run `ant auth login`), then restart the server.";
    case "rate_limited": return "Claude is rate limiting this key right now. Give it a minute, then try again.";
    case "network": return "The server couldn't reach Claude. Check the internet connection, then try again.";
    case "offline": return "Can't reach the Lei server. Make sure `npm start` is still running, then try again.";
    case "refused": return who + " won’t answer that one. Try putting it another way.";
    case "setup": return "The reply didn’t come back in a usable form. Try again.";
    default: return "Something went wrong on the way to Claude" + (message ? ": " + message : ".");
  }
}

function notice(text, retry) {
  const box = h("div", "notice");
  box.setAttribute("role", "status");
  box.append(h("p", null, text));
  if (retry) {
    const b = h("button", "pill", "Try again");
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

function finalizeLive(live, keep) {
  if (live.done) return;
  live.done = true;
  if (S.live === live) S.live = null;
  const m = live.msg;
  m.text = m.text.trim();
  if (live.song && keep) m.song = live.song;
  if (keep && (m.text || m.song)) {
    live.view.txt.textContent = m.text;
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
  dots.setAttribute("aria-label", "Thinking");
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
          view.txt.textContent = msg.text.trim();
          speaker.push(msg.text);
          scrollEnd();
          refresh();
        } else if (e.type === "memory") {
          S.memories.push(e.memory);
          if (!$("memSheet").hidden) renderMemories();
          toast("Remembered: " + e.memory.text);
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
    if (!quiet) notice(explain(failure.code, failure.message, S.profile.companionName), !["refused", "auth", "config"].includes(failure.code));
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
  if (S.mode === "chat") openSheet("memSheet");
};

function renderMemories() {
  const list = $("memList"), name = S.profile?.companionName || "Your companion";
  list.replaceChildren();
  $("memNote").textContent = S.memories.length
    ? name + " keeps these between conversations. Remove anything you’d rather not have remembered."
    : "Nothing yet. As you talk, " + name + " saves small notes here, like the names of people in your life or plans you mention. You can remove any of them.";
  for (const m of S.memories.slice().reverse()) {
    const li = h("li", "mem"), body = h("div", "mem-body");
    body.append(h("p", null, m.text), h("span", "mem-date", new Date(m.at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })));
    const b = h("button", "mini", "Forget");
    b.type = "button";
    b.setAttribute("aria-label", "Forget: " + m.text);
    b.onclick = async () => {
      b.disabled = true;
      try {
        S.memories = (await api.forget(m.id)).memories;
        renderMemories();
      } catch (err) {
        b.disabled = false;
        toast(explain(err.code, err.message, name));
      }
    };
    li.append(body, b);
    list.append(li);
  }
}

function fillVoiceSelect() {
  const sel = $("voiceSel");
  const list = voiceChoices(14);
  sel.replaceChildren();
  if (!list.length) sel.append(h("option", null, "No voices available"));
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
  $("micNote").textContent = listener.supported
    ? "Listening pauses while " + S.profile.companionName + " is talking, so the mic doesn't pick up the voice."
    : "This browser has no speech recognition. Use Chrome, Edge or Safari to talk out loud.";
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
    ta.placeholder = "Talk to " + S.profile.companionName + "…";
    toast("Renamed to " + S.profile.companionName);
  } catch (err) {
    toast(explain(err.code, err.message, S.profile.companionName));
  }
};

let confirmKind = "";
function askConfirm(kind) {
  confirmKind = kind;
  const n = S.profile.companionName;
  $("confirmText").textContent =
    kind === "clear"
      ? "This erases your conversation with " + n + ". Name and memories stay."
      : "This erases " + n + "’s name, memories and your whole conversation. You’ll set up a new companion from scratch.";
  $("confirmYes").textContent = kind === "clear" ? "Erase conversation" : "Erase everything";
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
      toast("Conversation cleared");
    } else {
      loadState(await api.reset());
      draft = { userName: "", about: "", onMind: "" };
      closeSheet($("setSheet"));
      enterIntro();
    }
  } catch (err) {
    toast(explain(err.code, err.message, S.profile.companionName));
  }
};

/* ---------- Boot ---------- */

async function start() {
  let state;
  try {
    state = await api.state();
  } catch (err) {
    setupEl.replaceChildren(h("p", "eyebrow", "Offline"), h("h2", "q", "Can’t reach the Lei server."), h("p", "qhint", "Start it with `npm start`, then reload this page."));
    $("statusText").textContent = "Offline";
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
