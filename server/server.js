// server.js  (npm i ws)
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT) || 8080;
const HEARTBEAT_MS = 15_000;
const GRACE_MS = 60_000;

const users = new Map();       // userId -> { nick, nickNorm, sockets:Set, tokens:Set, timer }
const nickIndex = new Map();   // nickNorm -> userId
const tokenIndex = new Map();  // sha256(token) -> userId
const linkCodes = new Map();   // code -> { userId, expires }

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const makeCode = () =>
  Array.from({ length: 8 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const normNick = (s) => String(s).normalize('NFKC').trim().toLowerCase();
const validNick = (s) => /^[\p{L}\p{N}_-]{3,16}$/u.test(s);
const RESERVED = new Set(['admin', 'system', 'moderator']);
const ALLOWED = new Set(['https://ваш-сайт.netlify.app']);
const MAX_CLIENTS = 76;

const wss = new WebSocketServer({
  server,
  maxPayload: 1024,
  verifyClient: ({ origin }) => ALLOWED.has(origin),
});

wss.on('connection', (ws, req) => {
  if (wss.clients.size > MAX_CLIENTS) {
    ws.close(1013, 'server busy'); // 1013 = Try Again Later
    return;
  }
});

function issueToken(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = sha256(token);
  users.get(userId).tokens.add(hash);
  tokenIndex.set(hash, userId);
  return token;
}

function attach(ws, userId) {
  const user = users.get(userId);
  clearTimeout(user.timer);            // cancelling delayed deletion
  user.timer = null;
  user.sockets.add(ws);
  ws.userId = userId;
}

function removeUser(userId) {
  const user = users.get(userId);
  if (!user) return;
  clearTimeout(user.timer);
  for (const h of user.tokens) tokenIndex.delete(h);
  for (const [c, e] of linkCodes) if (e.userId === userId) linkCodes.delete(c);
  nickIndex.delete(user.nickNorm);
  users.delete(userId);
}

// HTTP-сервер is mandatory for Railway (/health) and WS upgrade
const server = createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); return res.end('ok'); }
  res.writeHead(404); res.end();
});

wss.on('connection', (ws) => {
  ws.userId = null;
  ws.badAttempts = 0;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const send = (obj) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(obj));
  const tooMany = () => ++ws.badAttempts > 5 && (ws.close(), true);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Registration
    if (msg.type === 'register' && !ws.userId) {
      const nick = String(msg.nick ?? '').trim();
      const nickNorm = normNick(nick);
      if (!validNick(nick) || RESERVED.has(nickNorm))
        return send({ type: 'error', reason: 'bad_nick' });
      if (nickIndex.has(nickNorm))
        return send({ type: 'error', reason: 'nick_taken' });

      const userId = crypto.randomUUID();
      users.set(userId, { nick, nickNorm, sockets: new Set(), tokens: new Set(), timer: null });
      nickIndex.set(nickNorm, userId);
      attach(ws, userId);
      return send({ type: 'registered', nick, token: issueToken(userId) });
    }

    // reloading after F5 / page update
    if (msg.type === 'resume' && !ws.userId) {
      const userId = tokenIndex.get(sha256(String(msg.token ?? '')));
      if (!userId || !users.has(userId)) {
        if (tooMany()) return;
        return send({ type: 'error', reason: 'bad_token' });
      }
      attach(ws, userId);
      return send({ type: 'registered', nick: users.get(userId).nick, token: msg.token });
    }

    // Code for pairing another device
    if (msg.type === 'create_link_code' && ws.userId) {
      const code = makeCode();
      linkCodes.set(code, { userId: ws.userId, expires: Date.now() + 2 * 60_000 });
      setTimeout(() => linkCodes.delete(code), 2 * 60_000);
      return send({ type: 'link_code', code });
    }

    // New device enters code
    if (msg.type === 'redeem' && !ws.userId) {
      const code = String(msg.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const entry = linkCodes.get(code);
      if (!entry || entry.expires < Date.now() || !users.has(entry.userId)) {
        if (tooMany()) return;
        return send({ type: 'error', reason: 'bad_code' });
      }
      linkCodes.delete(code);
      attach(ws, entry.userId);
      return send({ type: 'registered', nick: users.get(entry.userId).nick,
                    token: issueToken(entry.userId) });
    }
  });

  ws.on('close', () => {
    const user = users.get(ws.userId);
    if (!user) return;
    user.sockets.delete(ws);
    if (user.sockets.size === 0 && !user.timer) {
      const id = ws.userId;
      user.timer = setTimeout(() => removeUser(id), GRACE_MS);
    }
  });
});

// Heartbeat: ping every 15s, we close those who haven't answered the last time
const hb = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }  // terminate will let out 'close'
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);
wss.on('close', () => clearInterval(hb));
server.listen(PORT, '0.0.0.0', () => console.log(`listening on :${PORT}`));

// graceful shutdown (Railway lets out SIGTERM)
process.on('SIGTERM', () => {
  clearInterval(hb);
  for (const ws of wss.clients) ws.close(1001, 'server restarting');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
});