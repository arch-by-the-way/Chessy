/* ======================= Multiplayer client ======================= */
/* Loaded AFTER script.js. Local game code in script.js is untouched; online games use netMove() below. */
const URL_WS = 'wss://chess-chessy.up.railway.app/ws';
const KEY = 'session';
//const TTL = 60_000;

G.net = null;      // null = local game, { gameId, color, me, opponent } = online game
const friendsScreen = $('friendsScreen'), profileScreen = $('profileScreen');

const loadToken = () => {
  try { return JSON.parse(localStorage.getItem(KEY))?.token ?? null; } catch { return null; }
};
const saveToken = (t) => { try { localStorage.setItem(KEY, JSON.stringify({ token: t })); } catch {} };

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
const say = (t) => { statusEl.textContent = t; if (t && !dlg.open) toast(t); };

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
//setInterval(() => { if (token && wsOpen()) saveToken(token); }, 5_000);
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
    case 'registered':   token = m.token; myNick = m.nick; saveToken(token); say(''); renderPlay(); if (!friendsScreen.hidden) send({ type: 'friends_list' }); break;
    case 'error':        onNetError(m.reason); break;
    case 'link_code':    say(`Link code: ${m.code.slice(0, 4)}-${m.code.slice(4)} (valid for 2 minutes). Enter it on your other device.`); break;
    case 'searching':    setBusy('search', 'Looking for an opponent…'); break;
    case 'invite_sent':  outInviteId = m.inviteId; outInviteTo = m.to; setBusy('invite', `Invitation sent to ${m.to}. Waiting for an answer…`); break;
    case 'invite':       showInvitePopup(m.inviteId, m.from, m.sec, m.inc); break;
    case 'invite_closed': onInviteClosed(m); break;
    case 'game_start':
    case 'game_sync':    onGame(m); break;
    case 'move':         onNetMove(m); break;
    case 'game_end':     onNetEnd(m); break;
    case 'opp_status':   if (G.net && !G.over) toast(m.online ? 'Opponent is back' : 'Opponent disconnected. Waiting up to 60 s…'); break;
    case 'nick_status': onNickStatus(m); break;
    case 'friends':        renderFriends(m.list); break;
    case 'profile':        onProfile(m); break;
    case 'friend_changed': onFriendChanged(m); break;
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
  hideSocial();
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
  G.tc = { min: m.sec / 60, inc: m.inc, cat: catOf(m.sec / 60, m.inc) };
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
const tcDlg = $('tcDialog');                     // (declare above `const invStack`)
function mountInvites() {
  const host = (dlg.open ? dlg : tcDlg.open ? tcDlg : null)?.querySelector('.dlg') ?? document.body;
  if (invStack.parentNode !== host) host.append(invStack);
  layoutInvites();
}

new MutationObserver(mountInvites).observe(dlg, { attributes: true, attributeFilter: ['open'] });
new MutationObserver(mountInvites).observe(tcDlg, { attributes: true, attributeFilter: ['open'] });
addEventListener('resize', layoutInvites);
mountInvites();

function showInvitePopup(inviteId, from, sec, inc) {
  hideInvitePopup(inviteId);
  const box = document.createElement('div');
  box.id = `invite-${inviteId}`;
  box.className = 'invite';
  box.setAttribute('role', 'alertdialog');

  const text = document.createElement('span');
  text.textContent = `${from} invites you to a ${fmtTc(sec, inc)} game`;

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
const fmtBase = (sec) => sec % 60 === 0 ? String(sec / 60) : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const fmtTc = (sec, inc) => `${fmtBase(sec)}+${inc}`;
const OL_TC = [[60, 0], [60, 1], [180, 0], [180, 2], [300, 0], [600, 0], [900, 10], [1800, 0]];   // [seconds, bonus seconds]
let olSel = [300, 0];

function renderOlTc() {
  $('olTc').innerHTML = OL_TC.map(([s, i]) => `
    <button type="button" class="tile${s === olSel[0] && i === olSel[1] ? ' sel' : ''}" data-s="${s}" data-i="${i}"${netBusy ? ' disabled' : ''}>
      <span class="t-main">${fmtTc(s, i)}</span><span class="t-sub">${catOf(s / 60, i)}</span>
    </button>`).join('');
}
function pickOnlineTc(sec, inc) { olSel = [sec, inc]; renderOlTc(); }
$('olTc').addEventListener('click', (e) => {
  const t = e.target.closest('.tile');
  if (t && !netBusy) pickOnlineTc(+t.dataset.s, +t.dataset.i);
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
  if (!send({ type: 'find', sec: olSel[0], inc: olSel[1] })) return say('Not connected to the server yet.');
  setBusy('search', 'Looking for an opponent…');
});
$('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const nick = $('nick').value.trim();
  if (!nick) return say('Enter a nickname to search.');
  outInviteTo = nick;
  if (!send({ type: 'invite', to: nick, sec: olSel[0], inc: olSel[1] })) say('Not connected to the server yet.');
});

dlg.addEventListener('close', () => {
  if (netBusy) send({ type: 'cancel' });
  outInviteId = null;
  setBusy(null);
});

/* ---------- live nickname check (500 ms after the last keystroke) ---------- */
// field: 'found' = online and can be invited (Invite); 'exists' = has an account (Open in Friends)
const normNickC = (s) => s.normalize('NFKC').trim().toLowerCase();
function liveNickCheck(input, btn, field) {
  let timer = null;
  const mark = (on) => btn.classList.toggle('found', on);
  input.addEventListener('input', () => {
    clearTimeout(timer);
    mark(false);                                       // any edit invalidates the previous answer
    const nick = input.value.trim();
    if (!/^[\p{L}\p{N}_-]{3,16}$/u.test(nick)) return;
    timer = setTimeout(() => send({ type: 'check_nick', nick }), 500);
  });
  return {
    mark,
    onStatus(m) {                                      // ignore stale answers: the field may have changed meanwhile
      if (normNickC(m.nick) === normNickC(input.value)) mark(!!m[field] && !(field === 'found' && netBusy));
    },
  };
}
const nickEl = $('nick');
const inviteCheck = liveNickCheck(nickEl, $('inviteBtn'), 'found');
const openCheck = liveNickCheck($('frNick'), $('frOpen'), 'exists');
const markFound = inviteCheck.mark;                    // setBusy() uses this name
function onNickStatus(m) { inviteCheck.onStatus(m); openCheck.onStatus(m); }

/* ---------- profile ---------- */
let pfNick = null, pfData = null;
const pfStack = [];                              // profiles we came from (opponent -> opponent -> ...)

function openProfile(nick, fromProfile = false) {
  if (fromProfile && pfNick) pfStack.push(pfNick);
  pfNick = nick; pfData = null;
  $('pfBody').innerHTML = '<p class="s-lead">Loading…</p>';
  profileScreen.hidden = false; syncLock();
  send({ type: 'profile_get', nick });
}
$('pfBack').addEventListener('click', () => {
  const prev = pfStack.pop();
  if (prev) { openProfile(prev); return; }
  profileScreen.hidden = true; pfNick = null; pfData = null; syncLock();
});
function onProfile(m) {
  if (profileScreen.hidden || !pfNick || !sameNick(m.nick, pfNick)) return;   // stale answer
  pfData = m;
  renderProfile(m);
}
function onFriendChanged(m) {
  toast({
    you: m.friend ? `${m.nick} added to friends` : `${m.nick} removed from friends`,
    them: m.friend ? `${m.nick} added you as a friend` : `${m.nick} removed you from friends`,
  }[m.by] || '');
  if (pfData && sameNick(pfData.nick, m.nick)) { pfData.friend = m.friend; renderProfile(pfData); }
  if (!friendsScreen.hidden) send({ type: 'friends_list' });
}

function histRow(h) {
  return `<button type="button" class="hr ${h.res}" data-nick="${esc(h.opp)}">
    <span class="hr-res">${{ win: 'W', loss: 'L', draw: 'D' }[h.res]}</span>
    ${avatarHTML(h.oppAvatar, 's')}
    <span class="hr-main"><b>${esc(h.opp)}</b><small>${fmtTc(h.sec, h.inc)} · ${REASON[h.reason] || ''} · ${Math.ceil(h.plies / 2)} moves</small></span>
    <span class="hr-when" title="${new Date(h.at).toLocaleString()}">${ago(h.at)}</span>
  </button>`;
}
function renderProfile(p) {
  const body = $('pfBody');
  if (p.missing) { body.innerHTML = `<p class="s-lead">Player “${esc(p.nick)}” was not found.</p>`; return; }
  const n = p.history.length;
  const cnt = (r) => p.history.filter((h) => h.res === r).length;
  const w = cnt('win'), d = cnt('draw'), l = cnt('loss');
  const pct = (x) => (n ? (x / n * 100).toFixed(1) : 0);
  const can = p.online && !p.busy;
  const actions = p.self ? '' : `
    <button type="button" class="pf-btn" data-act="friend" title="${p.friend ? 'Remove from friends' : 'Add to friends'}" aria-label="${p.friend ? 'Remove from friends' : 'Add to friends'}">${p.friend ? ICON.delUser : ICON.addUser}</button>
    <button type="button" class="pf-btn" data-act="chat" title="Chat" aria-label="Chat">${ICON.chat}</button>
    <button type="button" class="pf-btn go" data-act="invite" title="${can ? `Invite to ${olSel[0]}+${olSel[1]}` : p.busy ? 'In a game' : 'Offline'}" aria-label="Invite to a game"${can ? '' : ' disabled'}>${ICON.swords}</button>`;
  body.innerHTML = `
  <div class="pf" style="--h:${p.avatar.h | 0}">
    <div class="pf-banner"></div>
    <div class="pf-left">
      <div class="pf-av">${avatarHTML(p.avatar, 'big')}</div>
      <div class="pf-side">
        <div class="card">
          <h3>${n ? `Last ${n} game${n === 1 ? '' : 's'}` : 'Statistics'}</h3>
          <div class="stats"><span><b>${w}</b>Wins</span><span><b>${d}</b>Draws</span><span><b>${l}</b>Losses</span></div>
          <div class="bar"><i class="w" style="width:${pct(w)}%"></i><i class="d" style="width:${pct(d)}%"></i><i class="l" style="width:${pct(l)}%"></i></div>
        </div>
        <div class="card soon"><h3>Achievements</h3><p>Coming soon</p></div>
      </div>
    </div>
    <div class="pf-right">
      <div class="pf-head">
        <div class="pf-name">
          <h2>${esc(p.nick)}</h2>
          <span class="pf-elo" title="Rating (placeholder)"><b>${p.elo}</b><small>ELO</small></span>
          ${p.online ? '<span class="pf-on">online</span>' : ''}
        </div>
        <div class="pf-actions">${actions}</div>
      </div>
      <div class="pf-hist">
        <h3>Match history</h3>
        ${n ? `<div class="hist">${p.history.map(histRow).join('')}</div>` : '<p class="muted">No games yet.</p>'}
      </div>
    </div>
  </div>`;
}
$('pfBody').addEventListener('click', (e) => {
  const hr = e.target.closest('.hr');
  if (hr) { openProfile(hr.dataset.nick, true); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act || !pfData) return;
  if (act === 'chat') toast('Chat is coming soon');
  else if (act === 'invite') inviteNick(pfData.nick);
  else if (act === 'friend') {
    if (pfData.friend && !confirm(`Remove ${pfData.nick} from friends?`)) return;
    send({ type: pfData.friend ? 'friend_remove' : 'friend_add', nick: pfData.nick });
  }
});

/* ---------- time-control picker for invitations (crossed swords) ---------- */
let tcdTarget = '', tcdLast = null, tcdSel = { sec: 300, inc: 0, custom: false };

function renderTcd() {
  $('tcdTiles').innerHTML = OL_TC.map(([s, i]) => `
    <button type="button" class="tile${!tcdSel.custom && s === tcdSel.sec && i === tcdSel.inc ? ' sel' : ''}" data-s="${s}" data-i="${i}">
      <span class="t-main">${fmtTc(s, i)}</span><span class="t-sub">${catOf(s / 60, i)}</span>
    </button>`).join('');
  $('tcdCustom').classList.toggle('sel', tcdSel.custom);
  $('tcdSummary').textContent = `${catOf(tcdSel.sec / 60, tcdSel.inc)}: ${fmtTc(tcdSel.sec, tcdSel.inc)}`;
}
function readTcd(normalize) {                      // custom fields -> whole seconds
  const { sec, inc } = toTc($('tcdMin').value, $('tcdInc').value);
  if (normalize) { $('tcdMin').value = minText(sec); $('tcdInc').value = inc; }
  tcdSel = { sec, inc, custom: true };
  renderTcd();
}
function openTcPicker(nick) {
  tcdTarget = nick;
  const s = tcdLast || { sec: olSel[0], inc: olSel[1] };
  tcdSel = { ...s, custom: !OL_TC.some(([a, b]) => a === s.sec && b === s.inc) };
  $('tcdMin').value = minText(s.sec); $('tcdInc').value = s.inc;
  $('tcdTitle').textContent = `Invite ${nick}`;
  renderTcd();
  tcDlg.showModal();
}
function inviteNick(nick) { openTcPicker(nick); }  // called by the crossed-swords buttons

$('tcdTiles').addEventListener('click', (e) => {
  const t = e.target.closest('.tile');
  if (!t) return;
  tcdSel = { sec: +t.dataset.s, inc: +t.dataset.i, custom: false };
  $('tcdMin').value = minText(tcdSel.sec); $('tcdInc').value = tcdSel.inc;     // the custom fields mirror the choice
  renderTcd();
});
['tcdMin', 'tcdInc'].forEach((id) => {
  const el = $(id);
  el.addEventListener('input', () => { const d = cleanDecimal(el.value); if (el.value !== d) el.value = d; readTcd(false); });
  el.addEventListener('change', () => readTcd(true));
  el.addEventListener('focus', () => readTcd(false));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { readTcd(true); $('tcdSend').click(); } });
});
$('tcdClose').addEventListener('click', () => tcDlg.close());
$('tcdSend').addEventListener('click', () => {
  tcdLast = { sec: tcdSel.sec, inc: tcdSel.inc };
  tcDlg.close();
  outInviteTo = tcdTarget;
  if (!send({ type: 'invite', to: tcdTarget, sec: tcdSel.sec, inc: tcdSel.inc })) toast('Not connected to the server yet.');
});

/* ======================= Friends & profile screens ======================= */
/* openFriends() is called from the drawer menu in script.js */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sameNick = (a, b) => normNickC(String(a ?? '')) === normNickC(String(b ?? ''));

const ICON = {
  addUser: '<svg class="ic" viewBox="0 0 24 24"><circle cx="10" cy="8" r="3.5"/><path d="M3.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M19 8v6M16 11h6"/></svg>',
  delUser: '<svg class="ic" viewBox="0 0 24 24"><circle cx="10" cy="8" r="3.5"/><path d="M3.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 11h6"/></svg>',
  chat:    '<svg class="ic" viewBox="0 0 24 24"><path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/></svg>',
  swords:  '<svg class="ic" viewBox="0 0 24 24"><path d="M4 4l13 13M20 4L7 17M13 17l4-4M7 13l4 4M16 16l3 3M8 16l-3 3"/></svg>',
};
const REASON = {
  checkmate: 'Checkmate', stalemate: 'Stalemate', insufficient: 'Insufficient material', fifty: 'Fifty-move rule',
  repetition: 'Repetition', timeout: 'Timeout', resign: 'Resignation', opponent_left: 'Opponent left',
};
const AV_GLYPH = { p: '♟\uFE0E', n: '♞\uFE0E', b: '♝\uFE0E', r: '♜\uFE0E', q: '♛\uFE0E', k: '♚\uFE0E' };
function avatarHTML(av, size = 'm') {
  const a = av || { h: 210, p: 'p' };
  return `<span class="av ${size}" style="--h:${a.h | 0}" aria-hidden="true">${AV_GLYPH[a.p] || AV_GLYPH.p}</span>`;
}
function ago(t) {
  const m = Math.floor(Math.max(0, Date.now() - t) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d} d ago` : new Date(t).toLocaleDateString();
}

// the page must not scroll while any full-screen view is open
function syncLock() {
  const any = [timeScreen, gameScreen, friendsScreen, profileScreen].some((s) => !s.hidden);
  document.body.style.overflow = any ? 'hidden' : '';
}
function hideSocial() {                       // an online game is starting: close Friends and Profile
  friendsScreen.hidden = true; profileScreen.hidden = true;
  pfStack.length = 0; pfNick = null; pfData = null;
  syncLock();
}

function openFriends() {
  if (!myNick) {
    openPlay();
    say('Pick a nickname to use Friends.');
    return;
  }
  $('frList').innerHTML = '<p class="s-lead">Loading…</p>';
  friendsScreen.hidden = false; syncLock();
  if (!send({ type: 'friends_list' })) $('frList').innerHTML = '<p class="s-lead">Connecting to the server…</p>';
}

function renderFriends(list) {
  $('frList').innerHTML = list.length ? list.map((f) => {
    const can = f.online && !f.busy;
    const status = f.busy ? 'In a game' : f.online ? 'Online' : 'Offline';
    return `<div class="fr-row">
      <button type="button" class="fr-open" data-nick="${esc(f.nick)}">
        <span class="av-wrap">${avatarHTML(f.avatar, 'm')}<i class="dot${f.online ? ' on' : ''}"></i></span>
        <span class="fr-main"><b>${esc(f.nick)}</b><small>${status}</small></span>
      </button>
      <button type="button" class="ic-btn go" data-invite="${esc(f.nick)}" title="${can ? 'Invite to a game' : 'Not available right now'}" aria-label="Invite ${esc(f.nick)} to a game"${can ? '' : ' disabled'}>${ICON.swords}</button>
    </div>`;
  }).join('') : '<p class="s-lead">No friends yet. Find a player above and add them from their profile.</p>';
}

$('frList').addEventListener('click', (e) => {
  const inv = e.target.closest('[data-invite]');
  if (inv) { if (!inv.disabled) inviteNick(inv.dataset.invite); return; }
  const open = e.target.closest('.fr-open');
  if (open) openProfile(open.dataset.nick);
});
$('frBack').addEventListener('click', () => { friendsScreen.hidden = true; syncLock(); });
$('frMe').addEventListener('click', () => { if (myNick) openProfile(myNick); });
$('frSearch').addEventListener('submit', (e) => {
  e.preventDefault();
  const n = $('frNick').value.trim();
  if (n) openProfile(n);
});