// server.js  (npm i ws)
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';


const PORT = Number(process.env.PORT) || 8080;
const HEARTBEAT_MS = 15_000;
const GRACE_MS = 60_000;
const INVITE_TTL = 30_000;
const MAX_CLIENTS = 76;

import fs from 'node:fs';
import path from 'node:path';
const DATA_DIR = process.env.DATA_DIR || './data';   // on Railway: mount a Volume and set DATA_DIR=/data
const DB_FILE = path.join(DATA_DIR, 'accounts.json');
const HISTORY_MAX = 50;
const MOCK_ELO = 1200;                                // TODO: real rating
// comma-separated list in the Railway variable ALLOWED_ORIGINS, e.g. https://my-site.netlify.app
const ALLOWED = new Set((process.env.ALLOWED_ORIGINS || 'https://chess-chessy.app').split(',').map((s) => s.trim()));

const users = new Map();       // userId -> { nick, nickNorm, avatar, friends:Set, history:[], sockets:Set, tokens:Set, timer, gameId }
const nickIndex = new Map();   // nickNorm -> userId
const tokenIndex = new Map();  // sha256(token) -> userId
const linkCodes = new Map();   // code -> { userId, expires }
const invites = new Map();     // inviteId -> { from, to, min, inc, timer }
const games = new Map();       // gameId -> { white, black, min, inc, moves, turn, clk, since, flag, claims }
const queue = [];              // matchmaking: { userId, min, inc }

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const makeCode = () =>
  Array.from({ length: 8 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const normNick = (s) => String(s).normalize('NFKC').trim().toLowerCase();
const validNick = (s) => /^[\p{L}\p{N}_-]{3,16}$/u.test(s);
const RESERVED = new Set(['admin', 'system', 'moderator']);
const REASONS = new Set(['checkmate', 'stalemate', 'insufficient', 'fifty', 'repetition']);
const validTc = (sec, inc) =>
  Number.isInteger(sec) && Number.isInteger(inc) && sec >= 10 && sec <= 10_800 && inc >= 0 && inc <= 180; 
const nickOf = (id) => users.get(id)?.nick;
const inGame = (id) => !!users.get(id)?.gameId;
const isOnline = (id) => (users.get(id)?.sockets.size ?? 0) > 0;
const other = (g, id) => (g.white === id ? g.black : g.white);

function sendToUser(id, obj) {
  const u = users.get(id);
  if (!u) return;
  const s = JSON.stringify(obj);
  for (const ws of u.sockets) if (ws.readyState === ws.OPEN) ws.send(s);
}
function rateOk(ws, key = 'hits', limit = 20) {   // `limit` messages per 10 s, a separate counter per key
  const now = Date.now();                        // 20 messages per 10 s for the "expensive" commands
  ws[key] = (ws[key] || []).filter((t) => now - t < 10_000);
  if (ws[key].length >= limit) return false;
  ws[key].push(now);
  return true;
}
const unqueue = (id) => { const i = queue.findIndex((q) => q.userId === id); if (i >= 0) queue.splice(i, 1); };

/* ---------- persistence (accounts, friends, history) ---------- */
const AVATAR_PIECES = 'pnbrqk';
const makeAvatar = () => ({ h: crypto.randomInt(360), p: AVATAR_PIECES[crypto.randomInt(AVATAR_PIECES.length)] });

function loadDb() {
  let db;
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') console.error('db load failed:', e); return; }
  for (const a of db.accounts || []) {
    users.set(a.id, {
      nick: a.nick, nickNorm: normNick(a.nick), avatar: a.avatar || makeAvatar(),
      friends: new Set(a.friends || []), history: a.history || [], tokens: new Set(a.tokens || []),
      sockets: new Set(), timer: null, gameId: null,
    });
    nickIndex.set(normNick(a.nick), a.id);
    for (const h of a.tokens || []) tokenIndex.set(h, a.id);
  }
  console.log(`loaded ${users.size} accounts`);
}
function writeDb() {
  const accounts = [...users].map(([id, u]) => ({
    id, nick: u.nick, avatar: u.avatar, friends: [...u.friends], history: u.history, tokens: [...u.tokens],
  }));
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify({ accounts }));
    fs.renameSync(DB_FILE + '.tmp', DB_FILE);          // atomic: never a half-written file
  } catch (e) { console.error('db save failed:', e); }
}
let saveTimer = null;
const save = () => { saveTimer ??= setTimeout(() => { saveTimer = null; writeDb(); }, 1000); };
loadDb();

function recordHistory(g, reason, winner) {            // called once per finished game
  if (g.moves.length < 2) return;                      // aborted games are not recorded
  const at = Date.now();
  for (const id of [g.white, g.black]) {
    const u = users.get(id);
    if (!u) continue;
    const color = id === g.white ? 'w' : 'b';
    u.history.unshift({
      opp: other(g, id), color, res: !winner ? 'draw' : winner === color ? 'win' : 'loss',
      reason, sec: g.sec, inc: g.inc, plies: g.moves.length, at,
    });
    if (u.history.length > HISTORY_MAX) u.history.length = HISTORY_MAX;
  }
  save();
}

/* ---------- invites ---------- */
function closeInvite(id, reason) {
  const inv = invites.get(id);
  if (!inv) return;
  clearTimeout(inv.timer);
  invites.delete(id);
  const m = { type: 'invite_closed', inviteId: id, reason };
  sendToUser(inv.from, m);
  sendToUser(inv.to, m);        // also closes the popup on the recipient's other devices
}

/* ---------- games ---------- */
const gameInfo = (gameId, g, id) => ({
  type: 'game_start', gameId,
  color: id === g.white ? 'w' : 'b',
  you: nickOf(id),
  opponent: nickOf(other(g, id)),
  sec: g.sec, inc: g.inc,
});
function syncMsg(gameId, g, id) {           // full state for a client that (re)connects
  const clk = { ...g.clk };
  if (g.moves.length >= 2) clk[g.turn] = Math.max(0, clk[g.turn] - (Date.now() - g.since));
  return { ...gameInfo(gameId, g, id), type: 'game_sync', moves: g.moves, clk };
}
function startGame(a, b, sec, inc) {
  unqueue(a); unqueue(b);
  for (const [id, inv] of invites)
    if ([a, b].includes(inv.from) || [a, b].includes(inv.to)) closeInvite(id, 'cancelled');
  const gameId = crypto.randomUUID();
  const white = Math.random() < 0.5 ? a : b;
  const black = white === a ? b : a;
  const g = {
    white, black, sec, inc, moves: [], turn: 'w',
    clk: { w: sec * 1000, b: sec * 1000 }, since: Date.now(), flag: null, claims: {},
  };
  games.set(gameId, g);
  users.get(a).gameId = gameId;
  users.get(b).gameId = gameId;
  for (const id of [a, b]) sendToUser(id, gameInfo(gameId, g, id));
}
function endGame(gameId, reason, winner = null) {   // winner: 'w' | 'b' | null (draw)
  const g = games.get(gameId);
  if (!g) return;
  clearTimeout(g.flag);
  recordHistory(g, reason, winner);
  games.delete(gameId);
  for (const id of [g.white, g.black]) {
    const u = users.get(id);
    if (u) u.gameId = null;
    sendToUser(id, { type: 'game_end', reason, winner });
  }
}

function armFlag(gameId, g) {               // the side to move loses on time if it doesn't move
  clearTimeout(g.flag);
  if (g.moves.length < 2) return;           // the clocks start after both first moves
  g.flag = setTimeout(
    () => endGame(gameId, 'timeout', g.turn === 'w' ? 'b' : 'w'),
    g.clk[g.turn] + 50,
  );
}

/* ---------- users & tokens ---------- */
function issueToken(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = sha256(token);
  const tokens = users.get(userId).tokens;
  tokens.add(hash);
  tokenIndex.set(hash, userId);
  if (tokens.size > 10) { const old = tokens.values().next().value; tokens.delete(old); tokenIndex.delete(old); }   // keep the 10 newest devices
  save();
  return token;
}

function attach(ws, userId) {
  const user = users.get(userId);
  clearTimeout(user.timer);                 // cancel delayed deletion
  user.timer = null;
  user.sockets.add(ws);
  ws.userId = userId;
  const g = games.get(user.gameId);
  if (g) {                                  // reload / reconnect in the middle of a game
    ws.send(JSON.stringify(syncMsg(user.gameId, g, userId)));
    sendToUser(other(g, userId), { type: 'opp_status', online: true });
  }
}

function dropSession(userId) {              // the player has been offline for GRACE_MS; the account itself stays
  const user = users.get(userId);
  if (!user) return;
  clearTimeout(user.timer);
  user.timer = null;
  unqueue(userId);
  for (const [c, e] of linkCodes) if (e.userId === userId) linkCodes.delete(c);
  const g = games.get(user.gameId);
  if (g) endGame(user.gameId, 'opponent_left', g.white === userId ? 'b' : 'w');
  for (const [id, inv] of invites) if (inv.from === userId || inv.to === userId) closeInvite(id, 'cancelled');
}

/* ---------- HTTP + WS ---------- */
const server = createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); return res.end('ok'); }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({
  server,
  maxPayload: 1024,
  verifyClient: ({ origin }) => {
    const ok = ALLOWED.has(origin);
    if (!ok) console.log('rejected origin:', origin);
    return ok;
  },
});

wss.on('connection', (ws) => {
  if (wss.clients.size > MAX_CLIENTS) return ws.close(1013, 'server busy');
  ws.userId = null;
  ws.badAttempts = 0;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => {});

  const send = (obj) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(obj));
  const tooMany = () => ++ws.badAttempts > 5 && (ws.close(), true);
  const myGame = () => {
    const gameId = users.get(ws.userId)?.gameId;
    const g = games.get(gameId);
    return g ? { gameId, g } : null;
  };

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    /* ----- registration / sessions ----- */
    if (msg.type === 'register' && !ws.userId) {
      const nick = String(msg.nick ?? '').trim();
      const nickNorm = normNick(nick);
      if (!validNick(nick) || RESERVED.has(nickNorm)) return send({ type: 'error', reason: 'bad_nick' });
      if (nickIndex.has(nickNorm)) return send({ type: 'error', reason: 'nick_taken' });
      const userId = crypto.randomUUID();
      users.set(userId, {
      nick, nickNorm, avatar: makeAvatar(), friends: new Set(), history: [],
      sockets: new Set(), tokens: new Set(), timer: null, gameId: null, 
      });
      nickIndex.set(nickNorm, userId);
      attach(ws, userId);
      return send({ type: 'registered', nick, token: issueToken(userId) });
    }

    if (msg.type === 'resume' && !ws.userId) {
      const userId = tokenIndex.get(sha256(String(msg.token ?? '')));
      if (!userId || !users.has(userId)) {
        if (tooMany()) return;
        return send({ type: 'error', reason: 'bad_token' });
      }
      attach(ws, userId);
      return send({ type: 'registered', nick: users.get(userId).nick, token: msg.token });
    }

    if (msg.type === 'create_link_code' && ws.userId) {
      const code = makeCode();
      linkCodes.set(code, { userId: ws.userId, expires: Date.now() + 2 * 60_000 });
      setTimeout(() => linkCodes.delete(code), 2 * 60_000);
      return send({ type: 'link_code', code });
    }

    if (msg.type === 'redeem' && !ws.userId) {
      const code = String(msg.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const entry = linkCodes.get(code);
      if (!entry || entry.expires < Date.now() || !users.has(entry.userId)) {
        if (tooMany()) return;
        return send({ type: 'error', reason: 'bad_code' });
      }
      linkCodes.delete(code);
      attach(ws, entry.userId);
      return send({ type: 'registered', nick: users.get(entry.userId).nick, token: issueToken(entry.userId) });
    }

    if (!ws.userId) return;                 // everything below needs a registered user

    if (msg.type === 'check_nick') {
    if (!rateOk(ws, 'chk', 30)) return;                 // silent: this is only a UI hint
    const nick = String(msg.nick ?? '');
    const id = validNick(nick.trim()) ? nickIndex.get(normNick(nick)) : null;
  return send({ type: 'nick_status', nick, found: !!id && isOnline(id) && id !== ws.userId, exists: !!id });
  }

  /* ----- friends & profiles ----- */
if (msg.type === 'friends_list') {
  if (!rateOk(ws, 'fl', 20)) return;
  const list = [...users.get(ws.userId).friends].filter((id) => users.has(id)).map((id) => {
    const u = users.get(id);
    return { nick: u.nick, avatar: u.avatar, online: isOnline(id), busy: inGame(id) };
  }).sort((a, b) => b.online - a.online || a.nick.localeCompare(b.nick));
  return send({ type: 'friends', list });
}

if (msg.type === 'profile_get') {
  if (!rateOk(ws, 'pr', 30)) return;
  const nick = String(msg.nick ?? '');
  const id = nickIndex.get(normNick(nick));
  const u = users.get(id);
  if (!u) return send({ type: 'profile', nick, missing: true });
  return send({
    type: 'profile', nick: u.nick, avatar: u.avatar, elo: MOCK_ELO,
    online: isOnline(id), busy: inGame(id),
    self: id === ws.userId, friend: users.get(ws.userId).friends.has(id),
    history: u.history.map((h) => {
      const o = users.get(h.opp);
    return { ...h, sec: h.sec ?? h.min * 60, opp: o?.nick ?? '?', oppAvatar: o?.avatar };
    }),
  });
}

if (msg.type === 'friend_add' || msg.type === 'friend_remove') {
  if (!rateOk(ws, 'fr', 20)) return send({ type: 'error', reason: 'rate_limited' });
  const id = nickIndex.get(normNick(msg.nick ?? ''));
  if (!id || id === ws.userId) return;
  const me = users.get(ws.userId), them = users.get(id);
  const add = msg.type === 'friend_add';
  if (add) { me.friends.add(id); them.friends.add(ws.userId); }        // friendship is mutual
  else { me.friends.delete(id); them.friends.delete(ws.userId); }
  save();
  sendToUser(ws.userId, { type: 'friend_changed', nick: them.nick, friend: add, by: 'you' });
  sendToUser(id, { type: 'friend_changed', nick: me.nick, friend: add, by: 'them' });
  return;
}

    /* ----- matchmaking ----- */
    if (msg.type === 'find') {
      if (!rateOk(ws)) return send({ type: 'error', reason: 'rate_limited' });
      if (inGame(ws.userId)) return send({ type: 'error', reason: 'already_in_game' });
      const sec = Number(msg.sec), inc = Number(msg.inc);
      if (!validTc(sec, inc)) return send({ type: 'error', reason: 'bad_tc' });
      unqueue(ws.userId);
      const i = queue.findIndex((q) => q.sec === sec && q.inc === inc && q.userId !== ws.userId);
      if (i >= 0) {
        const [opp] = queue.splice(i, 1);
        return startGame(opp.userId, ws.userId, sec, inc);
      }
      queue.push({ userId: ws.userId, sec, inc });
      return send({ type: 'searching', sec, inc });
    }

    // cancels both the search and my outgoing invitation
    if (msg.type === 'cancel') {
      unqueue(ws.userId);
      for (const [id, inv] of invites) if (inv.from === ws.userId) closeInvite(id, 'cancelled');
      return send({ type: 'cancelled' });
    }

    /* ----- invitations ----- */
    if (msg.type === 'invite') {
      if (!rateOk(ws)) return send({ type: 'error', reason: 'rate_limited' });
      if (inGame(ws.userId)) return send({ type: 'error', reason: 'already_in_game' });
      const sec = Number(msg.sec), inc = Number(msg.inc);
      if (!validTc(sec, inc)) return send({ type: 'error', reason: 'bad_tc' });
      const toId = nickIndex.get(normNick(msg.to ?? ''));
      if (!toId || !isOnline(toId)) return send({ type: 'error', reason: 'no_such_user' });
      if (toId === ws.userId) return send({ type: 'error', reason: 'self_invite' });
      if (inGame(toId)) return send({ type: 'error', reason: 'user_busy' });
      for (const [id, inv] of invites) if (inv.from === ws.userId) closeInvite(id, 'cancelled');
      unqueue(ws.userId);
      const id = crypto.randomUUID();
      const timer = setTimeout(() => closeInvite(id, 'expired'), INVITE_TTL);
      invites.set(id, { from: ws.userId, to: toId, sec, inc, timer });
      sendToUser(toId, { type: 'invite', inviteId: id, from: nickOf(ws.userId), sec, inc });
      return send({ type: 'invite_sent', inviteId: id, to: nickOf(toId) });
    }

    if (msg.type === 'invite_response') {
      const inv = invites.get(msg.inviteId);
      if (!inv || inv.to !== ws.userId) return;          // only the recipient can answer
      if (!msg.accept) return closeInvite(msg.inviteId, 'declined');
      if (inGame(inv.from) || inGame(inv.to)) return closeInvite(msg.inviteId, 'busy');
      closeInvite(msg.inviteId, 'accepted');
      return startGame(inv.from, inv.to, inv.sec, inv.inc);
    }

    /* ----- game ----- */
    if (msg.type === 'move') {
      const cur = myGame();
      if (!cur || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(String(msg.uci))) return;
      const { gameId, g } = cur;
      const mover = g.turn;
      if (ws.userId !== (mover === 'w' ? g.white : g.black)) return send({ type: 'error', reason: 'not_your_turn' });
      const now = Date.now();
      if (g.moves.length >= 2) {                         // the clock is running from the 3rd ply on
        g.clk[mover] -= now - g.since;
        if (g.clk[mover] <= 0) return endGame(gameId, 'timeout', mover === 'w' ? 'b' : 'w');
        g.clk[mover] += g.inc * 1000;
      }
      g.moves.push(msg.uci);
      g.turn = mover === 'w' ? 'b' : 'w';
      g.since = now;
      g.claims = {};
      armFlag(gameId, g);
      const out = { type: 'move', uci: msg.uci, by: mover, clk: g.clk };
      sendToUser(g.white, out);
      sendToUser(g.black, out);
      return;
    }

    if (msg.type === 'resign') {
      const cur = myGame();
      if (!cur) return;
      return endGame(cur.gameId, 'resign', cur.g.white === ws.userId ? 'b' : 'w');
    }

    // checkmate / stalemate / draws are detected by the clients; the game ends only when BOTH report the same result
    if (msg.type === 'game_over') {
      const cur = myGame();
      if (!cur) return;
      const { gameId, g } = cur;
      const me = g.white === ws.userId ? 'w' : 'b', opp = me === 'w' ? 'b' : 'w';
      if (msg.ply !== g.moves.length || !['w', 'b', 'draw'].includes(msg.result) || !REASONS.has(msg.reason)) return;
      g.claims[me] = { result: msg.result, reason: msg.reason };
      const a = g.claims[me], b = g.claims[opp];
      if (!b) return;
      if (a.result === b.result) return endGame(gameId, a.reason, a.result === 'draw' ? null : a.result);
      g.claims = {};
      return;
    }

    if (msg.type === 'resync') {
      const cur = myGame();
      if (cur) send(syncMsg(cur.gameId, cur.g, ws.userId));
    }
  });

  ws.on('close', () => {
    const user = users.get(ws.userId);
    if (!user) return;
    user.sockets.delete(ws);
    if (user.sockets.size === 0 && !user.timer) {
      const id = ws.userId;
      unqueue(id);
      for (const [iid, inv] of invites) if (inv.from === id) closeInvite(iid, 'cancelled');
      const g = games.get(user.gameId);
      if (g) sendToUser(other(g, id), { type: 'opp_status', online: false });
      user.timer = setTimeout(() => removeUser(id), GRACE_MS);
    }
  });
});

// Heartbeat: ping every 15 s, drop those who did not answer the previous one
const hb = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);
wss.on('close', () => clearInterval(hb));
server.listen(PORT, '0.0.0.0', () => console.log(`listening on :${PORT}`));

// graceful shutdown (Railway sends SIGTERM)
process.on('SIGTERM', () => {
  clearInterval(hb);
  writeDb();
  for (const ws of wss.clients) ws.close(1001, 'server restarting');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
});