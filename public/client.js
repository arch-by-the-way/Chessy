/* ======================= Multiplayer client ======================= */
/* Loaded AFTER script.js. Local game code in script.js is untouched; online games use netMove() below. */
const URL_WS = 'wss://chess-chessy.up.railway.app/ws';
const KEY = 'session';
const TTL = 60_000;

G.net = null;      // null = local game, { gameId, color, me, opponent } = online game

const loadToken = () => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Date.now() - s.seen < TTL) return s.token;
  } catch {}
  localStorage.removeItem(KEY);
  return null;
};
const saveToken = (t) => { try { localStorage.setItem(KEY, JSON.stringify({ token: t, seen: Date.now() })); } catch {} };

let ws = null, retry = 0, retryTimer = null, token = null, myNick = null;
let netBusy = null;                    // null | 'search' | 'invite'
let outInviteId = null, outInviteTo = '';

const wsOpen = () => ws?.readyState === WebSocket.OPEN;
function send(o) {
  if (!wsOpen()) return false;
  ws.send(JSON.stringify(o));
  return true;
}
// can the local player touch the board right now? (always true in a local game)
const canAct = () => !G.net || (G.s.turn === G.net.color && wsOpen());
const say = (t) => { statusEl.textContent = t; };

/* ---------- connection ---------- */
function connect() {
  clearTimeout(retryTimer);
  if (ws && ws.readyState <= WebSocket.OPEN) return;
  const sock = new WebSocket(URL_WS);
  ws = sock;
  sock.onopen = () => {
    retry = 0;
    const t = loadToken();
    if (t) send({ type: 'resume', token: t }); else { token = null; myNick = null; }
    renderPlay();
  };
  sock.onmessage = (e) => { if (sock === ws) onNet(e.data); };
  sock.onclose = () => {
    if (sock !== ws) return;
    renderPlay();
    if (G.net && !G.over) toast('Connection lost. Reconnecting…');
    retryTimer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 10_000));
  };
}
setInterval(() => { if (token && wsOpen()) saveToken(token); }, 5_000);
if (loadToken()) connect();

/* ---------- incoming messages ---------- */
const ERR = {
  bad_nick: 'Nickname: 3–16 letters, digits, _ or -',
  nick_taken: 'This nickname is already taken',
  no_such_user: 'No player with that nickname is online',
  self_invite: 'You can’t invite yourself',
  user_busy: 'This player is in a game right now',
  already_in_game: 'You are already in a game',
  rate_limited: 'Slow down a little',
  bad_tc: 'Invalid time control',
  bad_code: 'Wrong or expired code',
};
const END_TEXT = {
  checkmate: 'Checkmate', stalemate: 'Stalemate', insufficient: 'Insufficient material',
  fifty: 'Fifty-move rule', repetition: 'Threefold repetition',
};

function onNet(raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  switch (m.type) {
    case 'registered':   token = m.token; myNick = m.nick; saveToken(token); say(''); renderPlay(); break;
    case 'error':        onNetError(m.reason); break;
    case 'link_code':    say(`Link code: ${m.code.slice(0, 4)}-${m.code.slice(4)} (valid for 2 minutes). Enter it on your other device.`); break;
    case 'searching':    setBusy('search', 'Looking for an opponent…'); break;
    case 'invite_sent':  outInviteId = m.inviteId; outInviteTo = m.to; setBusy('invite', `Invitation sent to ${m.to}. Waiting for an answer…`); break;
    case 'invite':       showInvitePopup(m.inviteId, m.from, m.min, m.inc); break;
    case 'invite_closed': onInviteClosed(m); break;
    case 'game_start':
    case 'game_sync':    onGame(m); break;
    case 'move':         onNetMove(m); break;
    case 'game_end':     onNetEnd(m); break;
    case 'opp_status':   if (G.net && !G.over) toast(m.online ? 'Opponent is back' : 'Opponent disconnected. Waiting up to 60 s…'); break;
    case 'nick_status': onNickStatus(m); break;
  }
}

function onNetError(r) {
  if (r === 'bad_token') {
    localStorage.removeItem(KEY); token = null; myNick = null;
    if (G.net && !G.over) endGame('Game interrupted', 'The server lost this game');
    renderPlay();
    return;
  }
  if (r === 'not_your_turn') { send({ type: 'resync' }); return; }
  setBusy(null, ERR[r] || 'Something went wrong');
}

function onInviteClosed(m) {
  hideInvitePopup(m.inviteId);
  if (m.inviteId !== outInviteId) return;
  outInviteId = null;
  const text = {
    declined: `${outInviteTo} declined the invitation`,
    expired: 'The invitation expired',
    busy: `${outInviteTo} is busy`,
    cancelled: '',
  }[m.reason];
  if (text !== undefined) setBusy(null, text);
}

/* ---------- online game: its own move function ---------- */
const sqName = (i) => 'abcdefgh'[i & 7] + (8 - (i >> 3));
const sqIdx = (s) => (8 - Number(s[1])) * 8 + 'abcdefgh'.indexOf(s[0]);
const uciOf = (m) => sqName(m.from) + sqName(m.to) + (m.promo || '');

// What doMove() does for a local game, minus: undo history, local increment, auto-flip.
// remote = true for a move that came from the server (it must not be sent back).
function netMove(m, remote) {
  tick();
  if (G.over) return;
  if (!remote) send({ type: 'move', uci: uciOf(m) });
  const mover = G.s.turn, next = applyMove(G.s, m);
  G.moves++;
  G.s = next; G.last = { from: m.from, to: m.to }; G.anim = true;
  scoreEvaluate();
  G.sel = -1; G.pending = null; $('promoOv').hidden = true;
  const key = posKey(next);
  G.seen[key] = (G.seen[key] || 0) + 1;
  G.legal = legalMoves(next);
  G.tick = performance.now();
  G.flipped = G.net.color === 'b';              // the board always faces my side
  // the server owns the clocks and the increment: setClocks() adopts them when its 'move' message arrives

  let end = null;                               // [title, subtitle, result, reason]
  if (!G.legal.length) end = inCheck(next)
    ? [SIDE[mover] + ' wins', 'Checkmate', mover, 'checkmate']
    : ['Draw', 'Stalemate', 'draw', 'stalemate'];
  else if (insufficient(next.b)) end = ['Draw', 'Insufficient material', 'draw', 'insufficient'];
  else if (next.half >= 100) end = ['Draw', 'Fifty-move rule', 'draw', 'fifty'];
  else if (G.seen[key] >= 3) end = ['Draw', 'Threefold repetition', 'draw', 'repetition'];

  if (end) {
    endGame(end[0], end[1]);                    // the original endGame, local screen only
    // the server finishes the game only when BOTH clients report the same result
    send({ type: 'game_over', ply: G.moves, result: end[2], reason: end[3] });
  }
  refreshAll();
}

function playUci(u) {                            // applies a move received from the server
  const from = sqIdx(u.slice(0, 2)), to = sqIdx(u.slice(2, 4)), promo = u[4];
  const m = G.legal.find((x) => x.from === from && x.to === to && (x.promo || undefined) === promo);
  if (!m) return false;
  netMove(m, true);
  return true;
}
function setClocks(clk) {                        // the server is the only authority for time
  G.clk = { w: clk.w, b: clk.b };
  G.tick = performance.now();
  updateClocks();
}

function onGame(m) {
  const same = G.net && G.net.gameId === m.gameId && !gameScreen.hidden;
  if (m.type === 'game_sync' && same && G.moves === m.moves.length) { setClocks(m.clk); return; }
  beginOnline(m);
}

function beginOnline(m) {
  setBusy(null);
  outInviteId = null;
  clearInvites();
  if (dlg.open) dlg.close();
  if (gSet.open) gSet.close();
  setMenu(false);
  timeScreen.hidden = true;
  G.net = { gameId: m.gameId, color: m.color, me: m.you, opponent: m.opponent };
  G.tc = { min: m.min, inc: m.inc, cat: catOf(m.min, m.inc) };
  gameScreen.hidden = false; lockScroll();
  applyTheme(); applyPieces(); newGame();        // the original newGame; it resets G.hist, so undo/redo stay disabled
  G.flipped = m.color === 'b';
  for (const u of m.moves || []) if (!playUci(u)) break;       // replay after a reload / reconnect
  if (m.clk) setClocks(m.clk);
  syncOnlineUi();
  refreshAll();
}

function onNetMove(m) {
  if (!G.net || G.over) return;
  if (m.by !== G.net.color && !playUci(m.uci)) { send({ type: 'resync' }); return; }
  setClocks(m.clk);                              // for my own move this just adopts the server clocks
}

function onNetEnd(m) {
  if (!G.net || G.over) return;                  // already shown: we detected the end ourselves
  const w = m.winner, l = w === 'w' ? 'b' : 'w';
  if (m.reason === 'resign') endGame(SIDE[w] + ' wins', SIDE[l] + ' resigned');
  else if (m.reason === 'opponent_left') endGame(SIDE[w] + ' wins', 'Opponent left the game');
  else if (m.reason === 'timeout') {
    if (hasMating(G.s.b, w)) endGame(SIDE[w] + ' wins', SIDE[l] + ' ran out of time');
    else endGame('Draw', SIDE[l] + ' ran out of time, but ' + SIDE[w] + ' cannot checkmate');
  } else endGame(w ? SIDE[w] + ' wins' : 'Draw', END_TEXT[m.reason] || '');
}

/* ---------- online game: game menu (capture phase, so the original handlers never run online) ---------- */
const RESTART_HTML = $('gmRestart').innerHTML;
const RESIGN_HTML = '<svg class="ic" viewBox="0 0 24 24"><path d="M6 21V4M6 5h11l-2 4 2 4H6"/></svg>Resign';
function syncOnlineUi() {
  const on = !!G.net;
  gameScreen.classList.toggle('online', on);
  $('gmRestart').innerHTML = on ? RESIGN_HTML : RESTART_HTML;
  $('newTcBtn').textContent = on ? 'Back to menu' : 'New time control';
}
function closeOnlineGame() {
  G.net = null;
  syncOnlineUi();
  gameScreen.hidden = true; lockScroll();
}
$('gmReturn').addEventListener('click', (e) => {
  if (!G.net) return;
  e.stopImmediatePropagation();
  if (!G.over && !confirm('Leave this game? It counts as a resignation.')) return;
  if (!G.over) send({ type: 'resign' });
  closeOnlineGame();
}, true);
$('gmRestart').addEventListener('click', (e) => {      // online this button is "Resign"
  if (!G.net) return;
  e.stopImmediatePropagation();
  if (!G.over && confirm('Resign this game?')) send({ type: 'resign' });
}, true);
$('newTcBtn').addEventListener('click', (e) => {       // "Back to menu" on the result screen
  if (!G.net) return;
  e.stopImmediatePropagation();
  closeOnlineGame();
}, true);
// these run AFTER the original handlers and undo what must not happen online
$('gmSettings').addEventListener('click', () => { if (G.net) G.hold = false; });   // the online clock can't be stopped
$('optFlip').addEventListener('change', () => {
  if (G.net) { G.flipped = G.net.color === 'b'; refreshAll(); }
});

/* ---------- invitation popup ---------- */
/* ---------- invitation popups: stacked; the oldest fold into an "Invites" row ---------- */
const invStack = document.createElement('div');
invStack.id = 'invite-stack';
invStack.className = 'invite-stack';
invStack.innerHTML = `
  <div class="invite-sum" hidden>
    <button type="button" class="invite-sumbtn" aria-expanded="false">
      <span>Invites</span><b class="n"></b>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
    </button>
    <div class="invite-sumlist"></div>
  </div>`;
const invSum = invStack.firstElementChild;
const invSumBtn = invSum.querySelector('button');
const invList = invSum.querySelector('.invite-sumlist');

invSumBtn.addEventListener('click', () => {
  const open = invSum.classList.toggle('open');
  invSumBtn.setAttribute('aria-expanded', open);
});

function layoutInvites() {
  const boxes = [...invStack.querySelectorAll('.invite')];      // DOM order = arrival order, oldest first
  const wasOpen = invSum.classList.contains('open');
  invSum.classList.remove('open');                               // measure with the list closed
  invSum.hidden = true;
  invStack.append(...boxes);                                     // start with everything expanded
  const limit = innerHeight * 0.5;
  let folded = 0;
  while (folded < boxes.length - 1 && invStack.getBoundingClientRect().bottom > limit) {
    invList.append(boxes[folded++]);                             // fold the oldest one
    invSum.hidden = false;
  }
  invSum.hidden = folded === 0;
  invSum.querySelector('.n').textContent = folded || '';
  invSum.classList.toggle('open', wasOpen && folded > 0);
  invSumBtn.setAttribute('aria-expanded', invSum.classList.contains('open'));
}

// while the play dialog is open (top layer) the stack must live inside it, otherwise it is hidden behind it
function mountInvites() {
  const host = dlg.open ? dlg.querySelector('.dlg') : document.body;
  if (invStack.parentNode !== host) host.append(invStack);
  layoutInvites();
}
new MutationObserver(mountInvites).observe(dlg, { attributes: true, attributeFilter: ['open'] });
addEventListener('resize', layoutInvites);
mountInvites();

function showInvitePopup(inviteId, from, min, inc) {
  hideInvitePopup(inviteId);
  const box = document.createElement('div');
  box.id = `invite-${inviteId}`;
  box.className = 'invite';
  box.setAttribute('role', 'alertdialog');

  const text = document.createElement('span');
  text.textContent = `${from} invites you to a ${min}+${inc} game`;

  const yes = document.createElement('button');
  yes.type = 'button'; yes.className = 'btn primary'; yes.textContent = 'Accept';
  yes.addEventListener('click', () => { send({ type: 'invite_response', inviteId, accept: true }); hideInvitePopup(inviteId); });

  const no = document.createElement('button');
  no.type = 'button'; no.className = 'btn secondary'; no.textContent = 'Decline';
  no.addEventListener('click', () => { send({ type: 'invite_response', inviteId, accept: false }); hideInvitePopup(inviteId); });

  box.append(text, yes, no);
  invStack.append(box);
  mountInvites();
}
function hideInvitePopup(inviteId) {
  document.getElementById(`invite-${inviteId}`)?.remove();
  layoutInvites();
}
function clearInvites() {
  invStack.querySelectorAll('.invite').forEach((b) => b.remove());
  layoutInvites();
}

/* ---------- play dialog ---------- */
const OL_TC = [[1, 0], [1, 1], [3, 0], [3, 2], [5, 0], [10, 0], [15, 10], [30, 0]];
let olSel = [5, 0];

function renderOlTc() {
  $('olTc').innerHTML = OL_TC.map(([m, i]) => `
    <button type="button" class="tile${m === olSel[0] && i === olSel[1] ? ' sel' : ''}" data-m="${m}" data-i="${i}"${netBusy ? ' disabled' : ''}>
      <span class="t-main">${m}+${i}</span><span class="t-sub">${catOf(m, i)}</span>
    </button>`).join('');
}
function pickOnlineTc(min, inc) { olSel = [min, inc]; renderOlTc(); }
$('olTc').addEventListener('click', (e) => {
  const t = e.target.closest('.tile');
  if (t && !netBusy) pickOnlineTc(+t.dataset.m, +t.dataset.i);
});

function setBusy(kind, text = '') {
  netBusy = kind;
  findBtn.textContent = kind ? 'Cancel' : 'Find opponent';
  $('nick').disabled = $('inviteBtn').disabled = !!kind;
  renderOlTc();
  if (kind) markFound(false);
    else nickEl.dispatchEvent(new Event('input'));       // re-check after the busy state ends
  say(text);
}

function renderPlay() {
  const open = wsOpen();
  connect();
  $('connState').textContent = open ? '' : 'Connecting to the server…';
  $('regForm').hidden = !open || !!myNick;
  $('lobby').hidden = !open || !myNick;
  $('meNick').textContent = myNick || '';
  $('playTitle').textContent = myNick ? 'Play online' : 'Register';
  const acct = $('acctBtn');
  acct.textContent = myNick || 'Register';
  acct.classList.toggle('in', !!myNick);
  acct.setAttribute('aria-label', myNick ? `Account: ${myNick}` : 'Register');
  renderOlTc();
}

$('regForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const nick = $('regNick').value.trim();
  if (!/^[\p{L}\p{N}_-]{3,16}$/u.test(nick)) return say(ERR.bad_nick);
  say('');
  if (!send({ type: 'register', nick })) say('Not connected to the server yet.');
});
$('redeemBtn').addEventListener('click', () => {
  const code = $('linkCode').value;
  if (!code.trim()) return say('Enter the code from your other device.');
  if (!send({ type: 'redeem', code })) say('Not connected to the server yet.');
});
$('linkBtn').addEventListener('click', () => { if (!send({ type: 'create_link_code' })) say('Not connected to the server yet.'); });

findBtn.addEventListener('click', () => {
  if (netBusy) { send({ type: 'cancel' }); outInviteId = null; setBusy(null); return; }
  if (!send({ type: 'find', min: olSel[0], inc: olSel[1] })) return say('Not connected to the server yet.');
  setBusy('search', 'Looking for an opponent…');
});
$('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const nick = $('nick').value.trim();
  if (!nick) return say('Enter a nickname to search.');
  outInviteTo = nick;
  if (!send({ type: 'invite', to: nick, min: olSel[0], inc: olSel[1] })) say('Not connected to the server yet.');
});

dlg.addEventListener('close', () => {
  if (netBusy) send({ type: 'cancel' });
  outInviteId = null;
  setBusy(null);
});

/* ---------- live nickname check (500 ms after the last keystroke) ---------- */
const nickEl = $('nick'), inviteBtnEl = $('inviteBtn');
const normNickC = (s) => s.normalize('NFKC').trim().toLowerCase();
let nickTimer = null;

const markFound = (on) => inviteBtnEl.classList.toggle('found', on);

nickEl.addEventListener('input', () => {
  clearTimeout(nickTimer);
  markFound(false);                                    // any edit invalidates the previous answer
  const nick = nickEl.value.trim();
  if (!/^[\p{L}\p{N}_-]{3,16}$/u.test(nick)) return;
  nickTimer = setTimeout(() => send({ type: 'check_nick', nick }), 500);
});

function onNickStatus(m) {
  // ignore stale answers: the field may have changed while the request was in flight
  if (normNickC(m.nick) === normNickC(nickEl.value)) markFound(m.found && !netBusy);
}