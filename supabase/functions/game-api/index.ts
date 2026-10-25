import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const WORDS = [
  "Pancake", "Volcano", "Telescope", "Penguin", "Popcorn", "Waterfall", "Skateboard", "Moonlight",
  "Carousel", "Pineapple", "Snowman", "Backpack", "Jellyfish", "Campfire", "Rainbow", "Sunglasses",
  "Lighthouse", "Cupcake", "Rollercoaster", "Cactus", "Fireworks", "Octopus", "Bubblegum", "Submarine",
  "Hammock", "Dinosaur", "Marshmallow", "Umbrella", "Robot", "Beachball", "Dragon", "Pillowfort",
  "Ice cream", "Kangaroo", "Treasure map", "Saxophone", "Hot air balloon", "Spiderweb", "Puppet", "Meteor",
];
const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];
const cleanName = (v: unknown) => String(v ?? "").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, 18);
const cleanText = (v: unknown, max = 44) => String(v ?? "").replace(/[<>\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const norm = (v: string) => v.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

type Player = { id: string; name: string; active: boolean };
type State = {
  roomCode: string; ownerId: string; players: Player[]; phase: string; roundNo: number;
  secretWord?: string; imposterId?: string; roles: Record<string, { role: "crew" | "imposter"; secretWord?: string }>;
  readyIds: string[]; clueOrder: string[]; clueIndex: number; hiddenClues: Record<string, string>;
  clues: Array<{ playerId: string; text: string }>; votes: Record<string, string>; voteTally?: Record<string, number>;
  runoffCandidateIds?: string[]; votedPlayerId?: string; winner?: "crew" | "imposter"; guessedCorrect?: boolean;
  phaseEndsAt?: number; revision: number;
};

function publicSnapshot(s: State, userId: string) {
  const out: Record<string, unknown> = {
    roomCode: s.roomCode, hostId: s.ownerId, players: s.players, phase: s.phase,
    roundNo: s.roundNo, revision: s.revision, readyIds: s.readyIds,
    currentCluePlayerId: s.phase === "clues" ? (s.clueOrder[s.clueIndex] || null) : null,
    phaseEndsAt: s.phaseEndsAt || null,
    clues: ["discussion", "voting", "runoff", "guess", "reveal"].includes(s.phase) ? s.clues : [],
    iVoted: Boolean(s.votes[userId]), votesSubmittedCount: Object.keys(s.votes).length,
  };
  if (s.phase === "runoff") {
    out.runoffCandidateIds = s.runoffCandidateIds || [];
    out.voteTally = s.voteTally || {};
  }
  if (s.phase === "reveal") Object.assign(out, {
    secretWord: s.secretWord, imposterId: s.imposterId, winner: s.winner,
    guessedCorrect: s.guessedCorrect, votedPlayerId: s.votedPlayerId, voteTally: s.voteTally || {},
  });
  return out;
}

async function sendBroadcast(code: string) {
  try {
    const ch = admin.channel(`room-${code}`, { config: { private: false } });
    await ch.send({ type: "broadcast", event: "snapshot_changed", payload: { changed: true } });
    await admin.removeChannel(ch);
  } catch { /* Clients also use a short polling fallback. */ }
}

async function readRoom(code: string) {
  const { data, error } = await admin.from("game_private").select("version,game_state,expires_at").eq("room_code", code).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("We couldn't find that room. Check the code and try again.");
  if (new Date(data.expires_at).getTime() < Date.now()) {
    await admin.from("game_private").delete().eq("room_code", code);
    throw new Error("This room expired. Create a new room to play again.");
  }
  return { version: Number(data.version), state: data.game_state as State };
}

async function saveState(code: string, version: number, state: State) {
  state.revision = version + 1;
  const { data, error } = await admin.from("game_private").update({ version: version + 1, owner_id: state.ownerId, game_state: state, updated_at: new Date().toISOString(), expires_at: new Date(Date.now() + 12 * 3600_000).toISOString() })
    .eq("room_code", code).eq("version", version).select("version").maybeSingle();
  if (error) throw error;
  if (!data) return false;
  const publicState = publicSnapshot(state, "");
  const { error: pubError } = await admin.from("room_public").upsert({ room_code: code, snapshot: publicState, updated_at: new Date().toISOString() });
  if (pubError) console.error("Public snapshot update failed", pubError.message);
  await sendBroadcast(code);
  return true;
}

async function mutate(code: string, userId: string, action: string, payload: Record<string, unknown>) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { version, state } = await readRoom(code);
    const message = applyAction(state, userId, action, payload);
    if (await saveState(code, version, state)) return { publicState: publicSnapshot(state, userId), myRole: state.roles[userId] || null, message };
  }
  throw new Error("The room changed at the same time. Please try once more.");
}

function member(s: State, userId: string) {
  const player = s.players.find((p) => p.id === userId);
  if (!player || player.active === false) throw new Error("You're no longer in this room.");
  return player;
}
function host(s: State, userId: string) {
  member(s, userId);
  if (s.ownerId !== userId) throw new Error("Only the room host can do that.");
}
function nextPhaseAfterClue(s: State) {
  if (s.clueIndex >= s.clueOrder.length) {
    s.clues = s.clueOrder.map((id) => ({ playerId: id, text: s.hiddenClues[id] || "Passed" }));
    s.phase = "discussion";
    s.phaseEndsAt = Date.now() + 120_000;
  }
}
function beginClues(s: State) {
  s.phase = "clues";
  s.clueOrder = s.players.filter((x) => x.active).map((x) => x.id).sort(() => Math.random() - 0.5);
  s.clueIndex = 0;
  s.phaseEndsAt = Date.now() + 150_000;
}
function finishVote(s: State, runoff: boolean) {
  const tally: Record<string, number> = {};
  Object.values(s.votes).forEach((id) => { tally[id] = (tally[id] || 0) + 1; });
  const max = Math.max(0, ...Object.values(tally));
  const leaders = Object.keys(tally).filter((id) => tally[id] === max);
  s.voteTally = tally;
  s.votedPlayerId = leaders.length === 1 ? leaders[0] : undefined;
  if (leaders.length > 1 && !runoff) {
    s.phase = "runoff";
    s.runoffCandidateIds = leaders;
    s.votes = {};
    s.phaseEndsAt = Date.now() + 45_000;
    return;
  }
  if (leaders.length > 1 && runoff) {
    s.votedPlayerId = undefined;
    s.phase = "guess";
    s.votes = {};
    s.voteTally = tally;
    s.phaseEndsAt = Date.now() + 45_000;
    return;
  }
  if (s.votedPlayerId === s.imposterId) {
    s.winner = "crew"; s.guessedCorrect = false; s.phase = "reveal"; s.phaseEndsAt = undefined;
  } else {
    s.phase = "guess"; s.phaseEndsAt = Date.now() + 45_000;
  }
  s.votes = {};
}

function applyAction(s: State, userId: string, action: string, p: Record<string, unknown>) {
  if (action === "join") {
    const name = cleanName(p.nickname);
    if (!name) throw new Error("Enter a nickname first.");
    if (s.phase !== "lobby") throw new Error("This round has already started. Join the next one!");
    const existing = s.players.find((x) => x.id === userId);
    if (existing) { existing.active = true; return "Welcome back!"; }
    if (s.players.filter((x) => x.active).length >= 12) throw new Error("This room is full (12 players). Try another room.");
    if (s.players.some((x) => x.active && x.name.toLowerCase() === name.toLowerCase())) throw new Error("That nickname is taken in this room. Try another.");
    s.players.push({ id: userId, name, active: true });
    return "You joined the room.";
  }
  member(s, userId);
  switch (action) {
    case "start": {
      host(s, userId);
      if (s.phase !== "lobby") throw new Error("This round is already in progress.");
      const playing = s.players.filter((x) => x.active);
      if (playing.length < 4) throw new Error("You need at least 4 players to start.");
      s.secretWord = pick(WORDS);
      s.imposterId = pick(playing).id;
      s.roles = Object.fromEntries(playing.map((player) => [player.id, player.id === s.imposterId ? { role: "imposter" } : { role: "crew", secretWord: s.secretWord }]));
      s.phase = "role_reveal"; s.readyIds = []; s.clues = []; s.hiddenClues = {}; s.votes = {}; s.voteTally = {};
      s.roundNo += 1; s.phaseEndsAt = Date.now() + 90_000;
      return "Secrets dealt. Everyone, take a quiet look.";
    }
    case "ready": {
      if (s.phase !== "role_reveal") throw new Error("The role screen is closed.");
      if (!s.readyIds.includes(userId)) s.readyIds.push(userId);
      if (s.readyIds.length === s.players.filter((x) => x.active).length) {
        beginClues(s);
      }
      return "Ready when you are.";
    }
    case "force-clues": {
      host(s, userId);
      if (s.phase !== "role_reveal") throw new Error("The role screen is closed.");
      if (!s.readyIds.includes(userId)) throw new Error("Check your own role before you start the clue round.");
      if (s.readyIds.length === s.players.filter((x) => x.active).length) throw new Error("Everyone is ready already.");
      beginClues(s);
      return "The clue round is open. An away player can still reconnect; skip their turn if needed.";
    }
    case "clue": {
      if (s.phase !== "clues") throw new Error("The clue round is closed.");
      if (s.clueOrder[s.clueIndex] !== userId) throw new Error("It's not your turn yet.");
      const text = cleanText(p.text, 44);
      if (!text) throw new Error("Type a short clue first.");
      s.hiddenClues[userId] = text; s.clueIndex += 1; nextPhaseAfterClue(s);
      return "Clue locked in.";
    }
    case "skip-clue": {
      host(s, userId);
      if (s.phase !== "clues") throw new Error("There is no clue turn to skip.");
      const skippedId = s.clueOrder[s.clueIndex];
      if (!skippedId) throw new Error("The clue round is already complete.");
      s.hiddenClues[skippedId] = "Passed"; s.clueIndex += 1; nextPhaseAfterClue(s);
      return `${s.players.find((x) => x.id === skippedId)?.name || "Player"}'s turn was skipped.`;
    }
    case "open-vote": {
      host(s, userId);
      if (s.phase !== "discussion") throw new Error("The vote opens after the clue discussion.");
      s.phase = "voting"; s.votes = {}; s.voteTally = {}; s.phaseEndsAt = Date.now() + 60_000;
      return "Private voting is open.";
    }
    case "vote": {
      if (!["voting", "runoff"].includes(s.phase)) throw new Error("Voting is closed.");
      if (s.votes[userId]) throw new Error("Your vote is already locked.");
      const target = String(p.targetId || "");
      const choices = s.phase === "runoff" ? (s.runoffCandidateIds || []) : s.players.filter((x) => x.active).map((x) => x.id);
      if (target === userId || !choices.includes(target)) throw new Error("Choose another eligible player.");
      s.votes[userId] = target;
      if (Object.keys(s.votes).length >= s.players.filter((x) => x.active).length) finishVote(s, s.phase === "runoff");
      return "Vote locked in. Your ballot is private.";
    }
    case "close-vote": {
      host(s, userId);
      if (!["voting", "runoff"].includes(s.phase)) throw new Error("Voting is not open.");
      if (!Object.keys(s.votes).length) throw new Error("Wait for at least one vote before closing.");
      finishVote(s, s.phase === "runoff");
      return "Voting closed.";
    }
    case "guess": {
      if (s.phase !== "guess" || userId !== s.imposterId) throw new Error("Only the imposter gets the final guess.");
      const guess = cleanText(p.text, 40);
      if (!guess) throw new Error("Enter your one final guess.");
      s.guessedCorrect = norm(guess) === norm(s.secretWord || "");
      s.winner = s.guessedCorrect ? "imposter" : "crew";
      s.phase = "reveal"; s.phaseEndsAt = undefined;
      return s.guessedCorrect ? "The imposter guessed it!" : "Wrong guess. The crew wins!";
    }
    case "again": {
      host(s, userId);
      if (s.phase !== "reveal") throw new Error("Finish the current round first.");
      s.phase = "lobby"; s.secretWord = undefined; s.imposterId = undefined; s.roles = {}; s.readyIds = [];
      s.clueOrder = []; s.clueIndex = 0; s.hiddenClues = {}; s.clues = []; s.votes = {}; s.voteTally = {};
      s.runoffCandidateIds = []; s.votedPlayerId = undefined; s.winner = undefined; s.guessedCorrect = undefined; s.phaseEndsAt = undefined;
      return "Back in the lobby for another round.";
    }
    case "leave": {
      const player = member(s, userId);
      player.active = false;
      s.readyIds = s.readyIds.filter((id) => id !== userId);
      const nextHost = s.players.find((x) => x.active);
      if (s.ownerId === userId && nextHost) s.ownerId = nextHost.id;
      if (s.phase !== "lobby" && s.phase !== "reveal" && s.imposterId === userId) {
        s.winner = "crew"; s.guessedCorrect = false; s.phase = "reveal"; s.phaseEndsAt = undefined;
      } else if (s.phase === "role_reveal" && s.readyIds.length === s.players.filter((x) => x.active).length) {
        beginClues(s);
      } else if (s.phase === "clues") {
        const turn = s.clueOrder.indexOf(userId);
        if (turn >= s.clueIndex) {
          s.hiddenClues[userId] = "Passed";
          s.clueOrder.splice(turn, 1);
          if (turn === s.clueIndex) nextPhaseAfterClue(s);
        }
      } else if (["voting", "runoff"].includes(s.phase)) {
        delete s.votes[userId];
        for (const [voterId, targetId] of Object.entries(s.votes)) if (targetId === userId) delete s.votes[voterId];
        if (s.phase === "runoff") {
          s.runoffCandidateIds = (s.runoffCandidateIds || []).filter((id) => id !== userId);
          s.votes = Object.fromEntries(Object.entries(s.votes).filter(([, targetId]) => s.runoffCandidateIds?.includes(targetId)));
          if ((s.runoffCandidateIds || []).length < 2) {
            s.phase = "guess"; s.phaseEndsAt = Date.now() + 45_000;
          }
        }
        if (["voting", "runoff"].includes(s.phase) && Object.keys(s.votes).length >= s.players.filter((x) => x.active).length && Object.keys(s.votes).length > 0) finishVote(s, s.phase === "runoff");
      }
      return "You left the room.";
    }
    default: throw new Error("Unknown game action.");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Use POST for game actions." }, { status: 405, headers: corsHeaders });
  try {
    const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!jwt) throw new Error("Join as a guest to play.");
    const { data: userData, error: authError } = await admin.auth.getUser(jwt);
    if (authError || !userData.user) throw new Error("Your guest session expired. Refresh and rejoin.");
    const userId = userData.user.id;
    const body = await req.json();
    const action = String(body.action || "");
    let code = String(body.roomCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (action === "create") {
      const name = cleanName(body.nickname);
      if (!name) throw new Error("Enter a nickname first.");
      for (let i = 0; i < 6; i++) {
        code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
        const state: State = { roomCode: code, ownerId: userId, players: [{ id: userId, name, active: true }], phase: "lobby", roundNo: 0, roles: {}, readyIds: [], clueOrder: [], clueIndex: 0, hiddenClues: {}, clues: [], votes: {}, revision: 1 };
        const { error } = await admin.from("game_private").insert({ room_code: code, version: 1, owner_id: userId, game_state: state, expires_at: new Date(Date.now() + 12 * 3600_000).toISOString() });
        if (error?.code === "23505") continue;
        if (error) throw error;
        const publicState = publicSnapshot(state, userId);
        const { error: pubError } = await admin.from("room_public").insert({ room_code: code, snapshot: publicSnapshot(state, "") });
        if (pubError) console.error("Initial room snapshot insert failed", pubError.message);
        await sendBroadcast(code);
        return Response.json({ roomCode: code, publicState, myRole: null }, { headers: corsHeaders });
      }
      throw new Error("Couldn't make a room code just now. Try again.");
    }
    if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error("Enter a valid 6-character room code.");
    if (action === "join") {
      const result = await mutate(code, userId, "join", body);
      return Response.json(result, { headers: corsHeaders });
    }
    if (action === "state") {
      const { state } = await readRoom(code);
      member(state, userId);
      return Response.json({ publicState: publicSnapshot(state, userId), myRole: state.roles[userId] || null }, { headers: corsHeaders });
    }
    const result = await mutate(code, userId, action, body);
    return Response.json(result, { headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The game server hit a snag.";
    const status = /only|not your|closed|already|eligible|need at least|full|taken|closed|guess/i.test(message) ? 400 : 400;
    return Response.json({ error: message }, { status, headers: corsHeaders });
  }
});
