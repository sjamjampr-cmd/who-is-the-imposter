import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// These two values are the public client configuration, not service secrets.
// Fill them after creating the Supabase project; never put the service-role key here.
const SUPABASE_URL = "https://dxwlncuxyhvuqpphybzj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_vveTMe088gjKdUYwKsm6vw_0Y8_pii5";
const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_ANON_KEY.startsWith("PASTE_");
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

const $ = (selector) => document.querySelector(selector);
const app = $("#app");
const joinPanel = $("#join-panel");
const createPanel = $("#create-panel");
const roomView = $("#room-view");
const toastNode = $("#toast");
let roomCode = null;
let snapshot = null;
let myId = null;
let myRole = null;
let hiddenRole = false;
let selectedVote = null;
let channel = null;
let polling = null;
let currentForm = null;

const icons = ["🦊", "🐸", "🐻", "🐧", "🐱", "🦉", "🐙", "🐝", "🦝", "🐢", "🐼", "🦄"];
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const activePlayers = () => (snapshot?.players || []).filter((p) => p.active !== false);
const me = () => activePlayers().find((p) => p.id === myId);
const isHost = () => snapshot?.hostId === myId;
const playerName = (id) => (snapshot?.players || []).find((p) => p.id === id)?.name || "A player";

function toast(message) {
  toastNode.textContent = message;
  toastNode.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => toastNode.classList.remove("show"), 2600);
}

function showMessage(selector, message) {
  const node = $(selector);
  if (node) node.textContent = message;
}

async function ensureGuest() {
  if (!configured) throw new Error("This game needs its Supabase project settings before rooms can open.");
  let { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    session = data.session;
  }
  myId = session.user.id;
  return myId;
}

async function api(action, payload = {}) {
  await ensureGuest();
  const { data: { session } } = await supabase.auth.getSession();
  const { data, error } = await supabase.functions.invoke("game-api", {
    body: { action, roomCode, ...payload },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) {
    const message = data?.error || error.message || "Could not reach the game server.";
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

function stopSync() {
  if (polling) window.clearInterval(polling);
  polling = null;
  if (channel) supabase?.removeChannel(channel);
  channel = null;
}

async function enterRoom(code) {
  stopSync();
  roomCode = code;
  localStorage.setItem("imposter-room", code);
  hiddenRole = false;
  const data = await api("state");
  snapshot = data.publicState;
  myRole = data.myRole || null;
  joinPanel.classList.add("hidden");
  document.querySelector(".hero")?.classList.add("hidden");
  document.querySelector(".how-strip")?.classList.add("hidden");
  roomView.classList.remove("hidden");
  channel = supabase.channel(`room-${roomCode}`, { config: { private: false } })
    .on("broadcast", { event: "snapshot_changed" }, () => refreshRoom(false)).subscribe();
  polling = window.setInterval(() => refreshRoom(false), 6000);
  renderRoom();
}

function syncFromPublic(next) {
  if (!next || next.revision < (snapshot?.revision || 0)) return;
  const oldPhase = snapshot?.phase;
  snapshot = next;
  if (oldPhase !== snapshot.phase) {
    selectedVote = null;
    api("state").then((data) => { myRole = data.myRole || null; renderRoom(); }).catch(() => renderRoom());
  } else renderRoom();
}

async function refreshRoom(showErrors = true) {
  if (!roomCode) return;
  try {
    const data = await api("state");
    myRole = data.myRole || null;
    syncFromPublic(data.publicState);
  } catch (error) {
    if (showErrors) toast(error.message);
  }
}

async function runAction(action, payload = {}) {
  const result = await api(action, payload);
  if (result.publicState) snapshot = result.publicState;
  if (Object.hasOwn(result, "myRole")) myRole = result.myRole;
  renderRoom();
  if (result.message) toast(result.message);
  return result;
}

function playerCards(players = activePlayers()) {
  return `<div class="player-grid">${players.map((player, index) => `<div class="player-chip ${player.id === myId ? "you" : ""}"><span class="player-dot"></span><span>${icons[index % icons.length]} ${escapeHtml(player.name)}${player.id === myId ? " (you)" : ""}</span></div>`).join("")}</div>`;
}

function roomHeader() {
  const phaseNames = { lobby: "Lobby", role_reveal: "Secret roles", clues: "Clue round", discussion: "Discussion", voting: "Private vote", runoff: "Tie-breaker", guess: "Final guess", reveal: "Round result" };
  return `<div class="room-top"><div><div class="room-code-wrap"><span class="room-code">${escapeHtml(roomCode)}</span><button class="text-button" data-action="copy-code" type="button">Copy invite link</button></div></div><span class="phase-pill">${phaseNames[snapshot.phase] || "In game"}</span></div>`;
}

function hostStartButton() {
  const count = activePlayers().length;
  return isHost()
    ? `<button class="button button-primary" data-action="start" type="button" ${count < 6 ? "disabled" : ""}>Start the game <span aria-hidden="true">→</span></button>`
    : `<span class="room-note">Waiting for ${escapeHtml(playerName(snapshot.hostId))} to start the game.</span>`;
}

function lobbyMarkup() {
  const count = activePlayers().length;
  return `<h2 class="room-title">The crew is gathering</h2><p class="room-subtitle">Share the code above. You need at least 6 players, and there’s room for 12. Everyone joins on their own phone.</p>${playerCards()}<div class="room-actions">${hostStartButton()}<button class="button button-secondary" data-action="leave" type="button">Leave room</button></div><p class="room-note">${count}/12 players · One imposter will be chosen at random. Keep your phone to yourself when your secret appears.</p>`;
}

function roleMarkup() {
  const role = myRole;
  const ready = snapshot.readyIds || [];
  const alreadyReady = ready.includes(myId);
  let card = `<div class="role-card ${role?.role === "imposter" ? "role-imposter" : ""}">${hiddenRole ? `<button class="button button-secondary" data-action="show-role" type="button">Show my role</button>` : role?.role === "imposter" ? `<span class="role-label">YOUR SECRET ROLE</span><div class="secret-word">IMPOSTER</div><div class="secret-hint">No word for you. Listen close and blend in.</div>` : `<span class="role-label">YOUR SECRET WORD</span><div class="secret-word">${escapeHtml(role?.secretWord || "Loading…")}</div><div class="secret-hint">Keep it secret. Your clue should fit, not give it away.</div>`}</div>`;
  if (!role) card = `<div class="phase-card"><h3>Secrets are being dealt</h3><p>Your private role is loading. Keep this screen open for a moment.</p></div>`;
  const missing = activePlayers().length - ready.length;
  return `<h2 class="room-title">Your secret is ready</h2><p class="room-subtitle">Take a quiet look at your own screen, then hide it before passing the phone or talking.</p>${card}<div class="room-actions">${alreadyReady ? `<span class="room-note">You’re ready. ${ready.length}/${activePlayers().length} players have checked their role.</span>` : `<button class="button button-primary" data-action="hide-ready" type="button">Hide role & I’m ready</button>`}</div><p class="room-note">${ready.length}/${activePlayers().length} players ready. The clue round begins when everyone is ready.</p>${isHost() && alreadyReady && missing > 0 ? `<div class="room-actions"><button class="button button-secondary" data-action="force-clues" type="button">Start clues if someone’s away</button></div><p class="room-note">Players who haven’t checked in can still reconnect and see their private role. Their clue turn can be skipped.</p>` : ""}`;
}

function roleReminderMarkup() {
  if (!myRole) return "";
  const content = myRole.role === "imposter"
    ? `<div class="role-card role-imposter"><span class="role-label">YOUR SECRET ROLE</span><div class="secret-word">IMPOSTER</div><div class="secret-hint">No word for you. Listen close and blend in.</div></div>`
    : `<div class="role-card"><span class="role-label">YOUR SECRET WORD</span><div class="secret-word">${escapeHtml(myRole.secretWord || "")}</div><div class="secret-hint">Keep it to yourself.</div></div>`;
  return `<details class="role-reminder"><summary>Need a role reminder?</summary>${content}</details>`;
}

function clueMarkup() {
  const isMyTurn = snapshot.currentCluePlayerId === myId;
  const done = (snapshot.clues || []).some((clue) => clue.playerId === myId);
  const completed = (snapshot.clues || []).length;
  const total = activePlayers().length;
  return `<h2 class="room-title">Clue by clue</h2><p class="room-subtitle">Take turns in the order shown. Give a short clue that fits your word without saying it outright.</p>${roleReminderMarkup()}<div class="phase-card"><h3>${isMyTurn ? "You’re up!" : `${escapeHtml(playerName(snapshot.currentCluePlayerId))} is choosing a clue`}</h3><p>${isMyTurn ? "Type one short clue. Everyone will see it when the round is complete." : "Clues stay hidden until everyone has submitted."}</p><div class="timer-line"><span style="width:${Math.max(0, Math.min(100, (1 - ((snapshot.phaseEndsAt - Date.now()) / 150000)) * 100))}%"></span></div><p>${completed} of ${total} clues submitted</p></div>${done ? `<div class="turn-banner">Clue submitted. Nice and mysterious. Sit tight!</div>` : isMyTurn ? `<form class="action-form" data-form="clue"><div class="form-grid"><label>Your clue<input name="clue" maxlength="44" placeholder="One short clue…" required /></label><button class="button button-primary" type="submit">Submit clue →</button></div></form>` : ""}${isHost() && !done ? `<div class="room-actions"><button class="button button-secondary" data-action="skip-clue" type="button">Skip ${isMyTurn ? "my clue" : "this turn"}</button></div>` : ""}`;
}

function discussionMarkup() {
  const left = Math.max(0, Math.ceil((snapshot.phaseEndsAt - Date.now()) / 1000));
  return `<h2 class="room-title">What’s the word?</h2><p class="room-subtitle">Read every clue. Talk face to face about who sounds like they’re guessing. Then vote privately on your phone.</p>${roleReminderMarkup()}<div class="phase-card"><h3>Clues are in</h3><ul class="clue-list">${(snapshot.clues || []).map((c) => `<li><b>${icons[(activePlayers().findIndex((p) => p.id === c.playerId) + icons.length) % icons.length]} ${escapeHtml(playerName(c.playerId))}</b><span class="clue-word">${escapeHtml(c.text)}</span></li>`).join("")}</ul><div class="timer-line"><span style="width:${Math.max(0, left / 120 * 100)}%"></span></div><p>${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} to discuss</p></div><div class="room-actions">${isHost() ? `<button class="button button-primary" data-action="open-vote" type="button">Start private vote →</button>` : `<span class="room-note">${escapeHtml(playerName(snapshot.hostId))} will open the vote when discussion is done.</span>`}</div>`;
}

function votingMarkup() {
  const candidates = snapshot.phase === "runoff" ? (snapshot.runoffCandidateIds || []) : activePlayers().map((p) => p.id);
  const voted = snapshot.iVoted === true;
  const counts = snapshot.voteTally || {};
  return `<h2 class="room-title">Choose your suspect</h2><p class="room-subtitle">Your vote is private. Pick one person you think is the imposter. Nobody sees who voted for whom.</p>${voted ? `<div class="turn-banner">Vote locked in. Waiting for the others… ${snapshot.votesSubmittedCount || 0}/${activePlayers().length} votes</div>` : `<div class="vote-grid">${candidates.filter((id) => id !== myId).map((id) => `<button class="vote-choice ${selectedVote === id ? "selected" : ""}" data-vote="${escapeHtml(id)}" type="button"><span>${escapeHtml(playerName(id))}</span><span class="count-badge">${snapshot.phase === "runoff" ? "↻" : "?"}</span></button>`).join("")}</div><div class="room-actions"><button class="button button-primary" data-action="submit-vote" type="button" ${selectedVote ? "" : "disabled"}>Lock in vote</button></div>`}${isHost() ? `<div class="room-actions"><button class="button button-secondary" data-action="close-vote" type="button">Close voting now (${snapshot.votesSubmittedCount || 0}/${activePlayers().length})</button></div>` : ""}<p class="room-note">${snapshot.phase === "runoff" ? "Tie-breaker vote: choose only between the tied players." : "Votes stay hidden until everyone has voted."}${snapshot.phase === "runoff" && Object.keys(counts).length ? ` Current tie: ${(snapshot.runoffCandidateIds || []).map(playerName).map(escapeHtml).join(" and ")}.` : ""}</p>`;
}

function guessMarkup() {
  const isImposter = myRole?.role === "imposter";
  return `<h2 class="room-title">One last chance</h2><p class="room-subtitle">The group voted for the wrong person. The imposter gets one chance to name the secret word.</p>${isImposter ? `<div class="phase-card"><h3>Make your guess</h3><p>One guess. A correct answer wins the round for you.</p><form class="action-form" data-form="guess"><div class="form-grid"><label>Your guess<input name="guess" maxlength="40" placeholder="What was the secret word?" required /></label><button class="button button-primary" type="submit">Make my guess →</button></div></form></div>` : `<div class="turn-banner">The imposter is thinking… Keep your face neutral.</div>`}`;
}

function revealMarkup() {
  const won = snapshot.winner === "imposter";
  const imposter = playerName(snapshot.imposterId);
  const phrase = snapshot.guessedCorrect ? `${escapeHtml(imposter)} guessed the word and stole the win!` : `${escapeHtml(imposter)} was the imposter. The crew caught them!`;
  return `<div class="result-card ${won ? "imposter-win" : ""}"><div class="result-emoji">${won ? "🎭" : "🎉"}</div><h3>${won ? "Imposter wins!" : "Crew wins!"}</h3><p>${phrase}</p><div class="result-secret">Secret word: ${escapeHtml(snapshot.secretWord)}</div></div><div class="room-divider"></div><h3 class="room-title" style="font-size:20px">The crew</h3>${playerCards()}<p class="room-note">${escapeHtml(imposter)} was the imposter${snapshot.votedPlayerId ? ` · the group voted for ${escapeHtml(playerName(snapshot.votedPlayerId))}` : ""}.</p><div class="room-actions">${isHost() ? `<button class="button button-primary" data-action="again" type="button">Play another round ↗</button>` : `<span class="room-note">${escapeHtml(playerName(snapshot.hostId))} can start another round.</span>`}</div>`;
}

function renderRoom() {
  if (!snapshot || !roomCode) return;
  let body = "";
  switch (snapshot.phase) {
    case "lobby": body = lobbyMarkup(); break;
    case "role_reveal": body = roleMarkup(); break;
    case "clues": body = clueMarkup(); break;
    case "discussion": body = discussionMarkup(); break;
    case "voting": case "runoff": body = votingMarkup(); break;
    case "guess": body = guessMarkup(); break;
    case "reveal": body = revealMarkup(); break;
    default: body = `<div class="error-state"><h2>Room needs a refresh</h2><p>We couldn’t read the current game phase. Refresh to reconnect.</p><button class="button button-primary" data-action="refresh" type="button">Refresh room</button></div>`;
  }
  roomView.innerHTML = `${roomHeader()}${body}`;
}

async function createRoom(nickname) {
  await ensureGuest();
  const data = await api("create", { nickname });
  roomCode = data.roomCode;
  await enterRoom(roomCode);
  toast("Room created! Send the code to your crew.");
}

async function joinRoom(code, nickname) {
  await ensureGuest();
  const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  roomCode = normalized;
  await api("join", { nickname });
  await enterRoom(normalized);
  toast("You’re in. Keep an eye out for your secret.");
}

function showError(error, target = "#join-message") {
  const message = error?.message || "Something went wrong. Try again.";
  if ($(target)) showMessage(target, message);
  else toast(message);
}

$("#create-room").addEventListener("click", () => { createPanel.classList.remove("hidden"); $("#create-form input[name=nickname]").focus(); });
$("#close-create").addEventListener("click", () => createPanel.classList.add("hidden"));
$("#create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const nickname = String(new FormData(event.currentTarget).get("nickname")).trim();
  showMessage("#create-message", "Making your room…");
  try { await createRoom(nickname); createPanel.classList.add("hidden"); }
  catch (error) { showError(error, "#create-message"); toast(error.message); }
});
$("#show-join").addEventListener("click", () => { joinPanel.classList.remove("hidden"); $("input[name=code]").focus(); });
$("#close-join").addEventListener("click", () => joinPanel.classList.add("hidden"));
$("#join-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try { showMessage("#join-message", "Joining your room…"); await joinRoom(form.get("code"), String(form.get("nickname")).trim()); }
  catch (error) { showError(error); }
});
$("input[name=code]").addEventListener("input", (event) => { event.currentTarget.value = event.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
$("#home-link").addEventListener("click", (event) => { event.preventDefault(); if (roomCode && !confirm("Leave this room and return to the start screen?")) return; leaveRoom(); });

const rulesDialog = $("#rules-dialog");
$("#rules-button").addEventListener("click", () => rulesDialog.showModal());
$("#close-rules").addEventListener("click", () => rulesDialog.close());

roomView.addEventListener("click", async (event) => {
  const vote = event.target.closest("[data-vote]");
  if (vote) { selectedVote = vote.dataset.vote; renderRoom(); return; }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === "copy-code") {
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}?room=${roomCode}`);
      toast("Invite link copied!"); return;
    }
    if (action === "start") await runAction("start");
    else if (action === "hide-ready") { hiddenRole = true; await runAction("ready"); }
    else if (action === "force-clues") await runAction("force-clues");
    else if (action === "show-role") { hiddenRole = false; renderRoom(); }
    else if (action === "skip-clue") await runAction("skip-clue");
    else if (action === "open-vote") await runAction("open-vote");
    else if (action === "submit-vote") { if (selectedVote) await runAction("vote", { targetId: selectedVote }); }
    else if (action === "close-vote") await runAction("close-vote");
    else if (action === "again") { await runAction("again"); myRole = null; }
    else if (action === "refresh") await refreshRoom();
    else if (action === "leave") leaveRoom();
  } catch (error) { toast(error.message); }
});

roomView.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  try {
    if (form.dataset.form === "clue") await runAction("clue", { text: String(data.get("clue")).trim() });
    if (form.dataset.form === "guess") await runAction("guess", { text: String(data.get("guess")).trim() });
  } catch (error) { toast(error.message); }
});

async function leaveRoom() {
  stopSync();
  if (roomCode && configured) api("leave", { roomCode }).catch(() => {});
  localStorage.removeItem("imposter-room");
  roomCode = null; snapshot = null; myRole = null; myId = null; selectedVote = null;
  roomView.classList.add("hidden");
  joinPanel.classList.add("hidden");
  createPanel.classList.add("hidden");
  document.querySelector(".hero")?.classList.remove("hidden");
  document.querySelector(".how-strip")?.classList.remove("hidden");
}

async function boot() {
  const queryCode = new URLSearchParams(location.search).get("room");
  if (queryCode) {
    joinPanel.classList.remove("hidden");
    $("input[name=code]").value = queryCode.toUpperCase();
    $("input[name=nickname]").focus();
  } else {
    const savedRoom = localStorage.getItem("imposter-room");
    if (savedRoom && configured) {
      try { await enterRoom(savedRoom); }
      catch { localStorage.removeItem("imposter-room"); }
    }
  }
  if (!configured) {
    const status = document.createElement("p");
    status.className = "setup-note";
    status.textContent = "Room play will be ready once the Supabase project settings are added by the site owner.";
    $(".microcopy").after(status);
  }
}
boot();
