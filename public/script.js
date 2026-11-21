/* ======================= Background game ======================= */
/* Morphy vs Duke of Savoy & Count Isouard, 1858 ("Opera Game").
   Moves are [from, to]; captures are detected by the occupied target square. */
   //landingBgGenerate() to method that is using GAME const
/*THE OPERA GAME (TODO in case json doesn't load)const GAME = [ //json.select(freeID)
  ['e2','e4'],['e7','e5'],
  ['g1','f3'],['d7','d6'],
  ['d2','d4'],['c8','g4'],
  ['d4','e5'],['g4','f3'],
  ['d1','f3'],['d6','e5'],
  ['f1','c4'],['g8','f6'],
  ['f3','b3'],['d8','e7'],
  ['b1','c3'],['c7','c6'],
  ['c1','g5'],['b7','b5'],
  ['c3','b5'],['c6','b5'],
  ['c4','b5'],['b8','d7'],
  ['e1','c1'],['a8','d8'],   // white castles queenside (rook a1→d1 handled below)
  ['d1','d7'],['d8','d7'],
  ['h1','d1'],['e7','e6'],
  ['b5','d7'],['f6','d7'],
  ['b3','b8'],['d7','b8'],
  ['d1','d8']                // checkmate
];*/

// \uFE0E forces text (not emoji) rendering on phones
const GLYPH = { k:'♚\uFE0E', q:'♛\uFE0E', r:'♜\uFE0E', b:'♝\uFE0E', n:'♞\uFE0E', p:'♟\uFE0E' };
const FILES = 'abcdefgh';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const bgEl = document.getElementById('boards');      // holds all background boards
const bgProbe = document.getElementById('bgProbe');  // invisible box = space the boards may use
const MAX_BG_BOARDS = 5;
const bgBoards = [];      // { el, pieces, id, plies, step, running, dead }
let reader = null, IDs = [];   // filled by GamesReader.load(); declared here because layoutBgBoards() runs before the load
let game = null;   // { gameId, color, opponent }

const sleep = ms => new Promise(res => setTimeout(res, ms));
const col = sq => FILES.indexOf(sq[0]);
const row = sq => 8 - Number(sq[1]);

function place(el, sq) {
  el.style.transform = `translate(${col(sq) * 100}%, ${row(sq) * 100}%)`;
}

function createBgBoard() {
  const el = document.createElement('div');
  el.className = 'board';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const d = document.createElement('div');
      d.className = 'sq ' + ((r + c) % 2 === 0 ? 'l' : 'd');
      el.appendChild(d);
    }
  }
  bgEl.appendChild(el);
  return { el, pieces: {} };
}

function bgSpawn(b, type, color, sq) {
  const el = document.createElement('div');
  el.className = `piece ${color} in`;
  el.dataset.type = type;
  el.textContent = GLYPH[type];
  place(el, sq);
  b.el.appendChild(el);
  b.pieces[sq] = el;
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('in')));
}

function bgSetup(b) {
  b.el.querySelectorAll('.piece').forEach(p => p.remove());
  b.pieces = {};
  const back = 'rnbqkbnr';
  for (let i = 0; i < 8; i++) {
    const f = FILES[i];
    bgSpawn(b, back[i], 'b', f + '8');
    bgSpawn(b, 'p',     'b', f + '7');
    bgSpawn(b, 'p',     'w', f + '2');
    bgSpawn(b, back[i], 'w', f + '1');
  }
}

/* deadcode  deadcode  deadcode  deadcode  deadcode  deadcode  deadcode  deadcode function landingBgGenerate(minVal, maxVal) { 
 let busyIDs = [...IDs];
 const generatedID = Math.floor(Math.random() * (maxVal - minVal + 1)) + minVal;
 busyIDs = busyIDs.filter(ID => ID == generatedID);
 let freeIDs = [...IDs].filter(ID => ID !== generatedID);
}

function landingBgDraw(freeIDs, ) {
 
} deadcode  deadcode  deadcode  deadcode  deadcode  deadcode  deadcode  deadcode  deadcode  deadcode  deadcode  deadcode */

function bgMove(b, from, to, instant) {
  const el = b.pieces[from];
  if (!el) return;
  const victim = b.pieces[to];
  if (victim) {
    if (instant) victim.remove();
    else { victim.classList.add('out'); setTimeout(() => victim.remove(), 400); }
  }
  delete b.pieces[from];
  b.pieces[to] = el;
  if (!instant) {
    el.style.zIndex = 5;
    setTimeout(() => { el.style.zIndex = ''; }, 700);
  }
  place(el, to);
}

function bgFadeOut(b) {
  b.el.querySelectorAll('.piece').forEach(p => p.classList.add('out'));
}

// every board owns its game: b.id / b.plies / b.step; it starts as soon as the reader is loaded
function addBgBoard() {
  const b = createBgBoard();
  Object.assign(b, { id: null, plies: [], step: 0, running: false, dead: false });
  bgBoards.push(b);
  bgSetup(b);
  if (reader) runBoard(b);
}

/* How many boards (1-5) and how big. Every candidate grid (cols x rows, up to 5 boards) gets the
   largest square side that fits the free area whole; we pick the grid that shows the most board area,
   and take more boards only when that gives at least 15% more area than the smaller count. */
function pickBgLayout(W, H) {
  const gap = Math.round(Math.min(Math.max(Math.min(W, H) * 0.025, 8), 24));
  const pad = gap;
  const bestByCount = {};
  for (let cols = 1; cols <= MAX_BG_BOARDS; cols++) {
    for (let rows = 1; cols * rows <= MAX_BG_BOARDS; rows++) {
      const s = Math.floor(Math.min(
        (W - 2 * pad - (cols - 1) * gap) / cols,
        (H - 2 * pad - (rows - 1) * gap) / rows));
      if (s < 1) continue;
      const n = cols * rows, area = n * s * s;
      if (!bestByCount[n] || area > bestByCount[n].area) bestByCount[n] = { cols, rows, s, gap, n, area };
    }
  }
  let best = null;
  for (let n = 1; n <= MAX_BG_BOARDS; n++) {
    const c = bestByCount[n];
    if (c && (!best || c.area > best.area * 1.15)) best = c;
  }
  return best;
}

function layoutBgBoards() {
  const W = bgProbe.clientWidth, H = bgProbe.clientHeight;
  if (!W || !H) return;
  const L = pickBgLayout(W, H);
  if (!L) return;
  bgEl.style.setProperty('--s', L.s + 'px');
  bgEl.style.setProperty('--cols', L.cols);
  bgEl.style.setProperty('--rows', L.rows);
  bgEl.style.setProperty('--gap', L.gap + 'px');
  while (bgBoards.length < L.n) addBgBoard();
  while (bgBoards.length > L.n) { const b = bgBoards.pop(); b.dead = true; b.el.remove(); }
}
layoutBgBoards();
new ResizeObserver(layoutBgBoards).observe(bgProbe);

GamesReader.load('games.json')
  .then(r => { reader = r; IDs = r.IDs; play(); })
  .catch(err => console.error('games.json failed to load', err));

// picks a game that no board is playing right now (the board's own current game counts as busy too)
function generateBackground(minVal = -Infinity, maxVal = Infinity) {
  const busy = new Set(bgBoards.map(b => b.id).filter(id => id != null));
  let pool = IDs.filter(id => id >= minVal && id <= maxVal && !busy.has(id));
  if (!pool.length) pool = IDs.filter(id => id >= minVal && id <= maxVal);   // fewer games than boards
  return pool[Math.floor(Math.random() * pool.length)];
}

// plays one ply on one board: handles any castling, en passant and promotion
function bgPlayPly(b, ply, instant) {
  if (ply.castle) bgMove(b, ply.castle[0], ply.castle[1], instant);
  if (ply.enPassant) {
    const v = b.pieces[ply.enPassant]; delete b.pieces[ply.enPassant];
    if (v) { if (instant) v.remove(); else { v.classList.add('out'); setTimeout(() => v.remove(), 400); } }
  }
  bgMove(b, ply.from, ply.to, instant);
  if (ply.promo) { const el = b.pieces[ply.to]; if (el) { el.dataset.type = ply.promo; el.textContent = GLYPH[ply.promo]; } }
}

// an independent endless loop for ONE board: new free game -> play -> fade out -> next game
async function runBoard(b) {
  if (b.running) return;
  b.running = true;
  while (!b.dead) {
    b.id = generateBackground();            // no await between pick and assignment, so two boards never grab the same id
    b.plies = reader.get(b.id).plies;
    b.step = 0;
    bgSetup(b);
    await sleep(1400);
    while (b.step < b.plies.length) {
      if (b.dead) return;
      bgPlayPly(b, b.plies[b.step]);
      b.step++;
      await sleep(reduceMotion ? 1600 : 1300);
    }
    await sleep(3000);
    if (b.dead) return;
    bgFadeOut(b);
    await sleep(700);
  }
}

function play() {
  bgEl.style.setProperty('--move-ms', reduceMotion ? '0ms' : '650ms');
  bgBoards.forEach(runBoard);               // boards created before games.json arrived
}

/* ======================= Play dialog ======================= */
const dlg = document.getElementById('playDialog');
const statusEl = document.getElementById('status');
const findBtn = document.getElementById('findBtn');
const QUICK = { bullet: [1, 0], blitz: [3, 2], rapid: [10, 0] };   // menu shortcuts preselect a time control

function openPlay(e, tc) {
  if (e && e.preventDefault) e.preventDefault();
  statusEl.textContent = '';
  connect();                       // client.js: opens the socket if needed
  if (tc) pickOnlineTc(tc[0], tc[1]);
  renderPlay();
  dlg.showModal();
}
document.getElementById('playBtn').addEventListener('click', openPlay);
document.getElementById('acctBtn').addEventListener('click', openPlay);   // top right: Register / nickname
document.getElementById('closeDlg').addEventListener('click', () => dlg.close());
//dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

/* ======================= Main menu ======================= */
// \uFE0E keeps the symbols as text on phones (no emoji)
const V = '\uFE0E';
const MENU = [
  { main: true, id: 'play', icon: '♟', title: 'Play', sub: 'Find an opponent online' },
  { group: 'Play', items: [
    { id: 'inperson', icon: '♙', title: 'Play in Person', sub: 'Two players, one device' },
    { id: 'blitz',  icon: '♞', title: 'Blitz',          sub: '3 and 5 minute games' },
    { id: 'bullet', icon: '♝', title: 'Bullet',         sub: '1 minute, pure speed' },
    { id: 'rapid',  icon: '♜', title: 'Rapid',          sub: '10 minutes and more' },
    { id: 'daily',  icon: '♚', title: 'Daily',          sub: 'One move a day, no clock pressure' },
    { id: 'bots',   icon: '♛', title: 'Play with Bots', sub: 'Practice against the engine' },
    { id: 'fun',    icon: '✦', title: 'Fun',            sub: 'Chess960, King of the Hill, more' },
  ]},
  { group: 'Improve', items: [
    { id: 'problems', icon: '♘', title: 'Problems',  sub: 'Solve chess puzzles' },
    { id: 'learn',    icon: '♗', title: 'Lessons',   sub: 'Rules, tactics and strategy' },
    { id: 'openings', icon: '♖', title: 'Openings',  sub: 'Learn openings' },
    { id: 'analysis', icon: '◎', title: 'Analysis',  sub: 'Review your games with the engine' },
  ]},
  { group: 'Community', items: [
    { id: 'leaders', icon: '♕', title: 'Leaderboard', sub: 'Top players' },
    { id: 'watch',   icon: '◉', title: 'Watch',       sub: 'Live games from other players' },
    { id: 'friends', icon: '☺', title: 'Friends',     sub: 'Find players by nickname' },
    { id: 'themes',  icon: '◐', title: 'Themes',      sub: 'Boards and pieces style' },
  ]},
];

const drawer = document.getElementById('drawer');
const burger = document.getElementById('burger');
const toastEl = document.getElementById('toast');
let idx = 0;

function itemHTML(it) {
  return `<button class="menu-item${it.main ? ' main' : ''}" type="button" data-id="${it.id}" style="--i:${idx++}">
    <span class="mi-icon" aria-hidden="true">${it.icon}${V}</span>
    <span class="mi-text"><span class="mi-title">${it.title}</span><span class="mi-sub">${it.sub}</span></span>
  </button>`;
}
drawer.innerHTML = MENU.map(block => block.main
  ? `<div class="menu-group">${itemHTML(block)}</div>`
  : `<div class="menu-group"><h2>${block.group}</h2>${block.items.map(itemHTML).join('')}</div>`
).join('');

function setMenu(open) {
  document.body.classList.toggle('menu-open', open);
  burger.setAttribute('aria-expanded', open);
  burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  if (open) setTimeout(() => drawer.querySelector('.menu-item').focus({ preventScroll: true }), 380);
}
const menuOpen = () => document.body.classList.contains('menu-open');

burger.addEventListener('click', () => setMenu(!menuOpen()));
document.getElementById('backdrop').addEventListener('click', () => setMenu(false));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && menuOpen()) { setMenu(false); burger.focus(); }
});

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

drawer.addEventListener('click', e => {
  const btn = e.target.closest('.menu-item');
  if (!btn) return;
  const id = btn.dataset.id;
  setMenu(false);
  if (id === 'play') { setTimeout(() => openPlay(), 200); return; }
  if (id === 'inperson') { setTimeout(() => openTimeScreen(), 200); return; }
  if (id === 'friends') { setTimeout(() => openFriends(), 200); return; }
  if (QUICK[id]) { setTimeout(() => openPlay(null, QUICK[id]), 200); return; }
  // TODO: route to real pages once they exist (e.g. location.href = '/' + id)
  const title = btn.querySelector('.mi-title').textContent;
  setTimeout(() => toast(title + ' is coming soon'), 250);
});

/* ======================= Play in Person ======================= */
const $ = id => document.getElementById(id);
const timeScreen = $('timeScreen'), gameScreen = $('gameScreen');
const lockScroll = () => { document.body.style.overflow = (!timeScreen.hidden || !gameScreen.hidden) ? 'hidden' : ''; };
function openTimeScreen() { timeScreen.hidden = false; lockScroll(); }
$('tsBack').addEventListener('click', () => { timeScreen.hidden = true; lockScroll(); });

/* ---------- Time control page ---------- */
// [minutes, bonus seconds per move]; 0 minutes = no clock
const TC_GROUPS = [
  { name: 'Bullet',    hint: 'under 3 minutes',   items: [[1, 0], [1, 1], [2, 1]] },
  { name: 'Blitz',     hint: '3 to 8 minutes',    items: [[3, 0], [3, 2], [5, 0], [5, 3]] },
  { name: 'Rapid',     hint: '10 to 30 minutes',  items: [[10, 0], [10, 5], [15, 10], [30, 0]] },
  { name: 'Classical', hint: 'long games',        items: [[60, 0], [90, 30], [0, 0]] },
];
let tcSel = { min: 10, inc: 0, cat: 'Rapid', custom: false };
const tcGroupsEl = $('tcGroups');

// same idea as Lichess: category from estimated duration (base + 40 moves of bonus)
const catOf = (min, inc) => { const e = min * 60 + inc * 40; return e < 180 ? 'Bullet' : e < 480 ? 'Blitz' : e < 1500 ? 'Rapid' : 'Classical'; };
const tcLabel = (min, inc) => min === 0 ? 'No time limit' : `${min} min` + (inc ? ` + ${inc} sec` : '');

tcGroupsEl.innerHTML = TC_GROUPS.map(g => `
  <div class="tc-group">
    <h2>${g.name}<small>${g.hint}</small></h2>
    <div class="tiles">${g.items.map(([m, i]) => `
      <button type="button" class="tile" data-m="${m}" data-i="${i}" data-cat="${g.name}">
        <span class="t-main">${m === 0 ? 'No limit' : m + ' min'}</span>
        <span class="t-sub">${m === 0 ? 'no clock' : (i ? '+' + i + ' sec' : 'no bonus')}</span>
      </button>`).join('')}
    </div>
  </div>`).join('');

function refreshTc() {
  tcGroupsEl.querySelectorAll('.tile').forEach(t => {
    const on = !tcSel.custom && +t.dataset.m === tcSel.min && +t.dataset.i === tcSel.inc && t.dataset.cat === tcSel.cat;
    t.classList.toggle('sel', on);
    t.setAttribute('aria-pressed', on);
  });
  $('customRow').classList.toggle('sel', tcSel.custom);
  $('tcSummary').textContent = tcSel.min === 0 ? 'No time limit' : `${tcSel.cat}: ${tcLabel(tcSel.min, tcSel.inc)}`;
}
tcGroupsEl.addEventListener('click', e => {
  const t = e.target.closest('.tile');
  if (!t) return;
  tcSel = { min: +t.dataset.m, inc: +t.dataset.i, cat: t.dataset.cat, custom: false };
  refreshTc();
});
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function readCustom(normalize) {
  let m = parseInt($('cMin').value, 10), i = parseInt($('cInc').value, 10);
  m = clamp(isNaN(m) ? 1 : m, 1, 180);
  i = clamp(isNaN(i) ? 0 : i, 0, 180);
  if (normalize) { $('cMin').value = m; $('cInc').value = i; }
  tcSel = { min: m, inc: i, cat: catOf(m, i), custom: true };
  refreshTc();
}
['cMin', 'cInc'].forEach(id => {
  $(id).addEventListener('input', e => {
    const el = e.target, d = el.value.replace(/\D/g, '');
    if (el.value !== d) el.value = d;                 // digits only
    readCustom(false);
  });
  $(id).addEventListener('keydown', e => {              // keep the ↑ / ↓ keys working without visible arrows
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const el = e.target, lo = +el.dataset.min, hi = +el.dataset.max;
    const v = parseInt(el.value, 10);
    el.value = clamp((isNaN(v) ? lo : v) + (e.key === 'ArrowUp' ? 1 : -1), lo, hi);
    readCustom(false);
  });
  $(id).addEventListener('change', () => readCustom(true));
  $(id).addEventListener('focus', () => readCustom(false));
});
refreshTc();
$('tsPlay').addEventListener('click', () => startGame({ min: tcSel.min, inc: tcSel.inc, cat: tcSel.cat }));

/* ---------- Chess rules ---------- */
const N_OFF = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const K_OFF = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const B_DIR = [[-1,-1],[-1,1],[1,-1],[1,1]];
const R_DIR = [[-1,0],[1,0],[0,-1],[0,1]];
const inB = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
// square index = row * 8 + col, row 0 is rank 8 (a8 = 0, h1 = 63)
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function startState() {
  const b = Array(64).fill(null), back = ['r','n','b','q','k','b','n','r'];
  for (let c = 0; c < 8; c++) {
    b[c] = 'b' + back[c]; b[8 + c] = 'bp';
    b[48 + c] = 'wp';     b[56 + c] = 'w' + back[c];
  }
  return { b, turn: 'w', cast: { wK: 1, wQ: 1, bK: 1, bQ: 1 }, ep: -1, half: 0, full: 1 };
}

function attacked(b, sq, by) {
  const r = sq >> 3, c = sq & 7;
  const pr = by === 'w' ? r + 1 : r - 1;
  if (pr >= 0 && pr < 8) for (const dc of [-1, 1]) if (inB(pr, c + dc) && b[pr * 8 + c + dc] === by + 'p') return true;
  for (const [dr, dc] of N_OFF) if (inB(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === by + 'n') return true;
  for (const [dr, dc] of K_OFF) if (inB(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === by + 'k') return true;
  for (const [dirs, t] of [[R_DIR, 'r'], [B_DIR, 'b']]) {
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (inB(rr, cc)) {
        const p = b[rr * 8 + cc];
        if (p) { if (p[0] === by && (p[1] === t || p[1] === 'q')) return true; break; }
        rr += dr; cc += dc;
      }
    }
  }
  return false;
}
const kingSq = (b, col) => b.indexOf(col + 'k');

function pseudo(s) {
  const b = s.b, me = s.turn, opp = me === 'w' ? 'b' : 'w', out = [];
  const add = (from, to, extra) => out.push(Object.assign({ from, to }, extra));
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq];
    if (!p || p[0] !== me) continue;
    const t = p[1], r = sq >> 3, c = sq & 7;
    if (t === 'p') {
      const dir = me === 'w' ? -1 : 1, start = me === 'w' ? 6 : 1, lastRow = me === 'w' ? 0 : 7, r1 = r + dir;
      if (r1 < 0 || r1 > 7) continue;
      const addPawn = to => {
        if ((to >> 3) === lastRow) for (const pr of ['q', 'r', 'b', 'n']) add(sq, to, { promo: pr });
        else add(sq, to);
      };
      if (!b[r1 * 8 + c]) {
        addPawn(r1 * 8 + c);
        if (r === start && !b[(r + 2 * dir) * 8 + c]) add(sq, (r + 2 * dir) * 8 + c, { dbl: true });
      }
      for (const dc of [-1, 1]) {
        if (!inB(r1, c + dc)) continue;
        const to = r1 * 8 + c + dc;
        if (b[to] && b[to][0] === opp) addPawn(to);
        else if (to === s.ep) add(sq, to, { ep: true });
      }
    } else if (t === 'n' || t === 'k') {
      for (const [dr, dc] of (t === 'n' ? N_OFF : K_OFF)) {
        if (!inB(r + dr, c + dc)) continue;
        const to = (r + dr) * 8 + c + dc;
        if (!b[to] || b[to][0] === opp) add(sq, to);
      }
      if (t === 'k') {
        const home = me === 'w' ? 60 : 4;
        if (sq === home && !attacked(b, home, opp)) {
          if (s.cast[me + 'K'] && b[home + 3] === me + 'r' && !b[home + 1] && !b[home + 2] &&
              !attacked(b, home + 1, opp) && !attacked(b, home + 2, opp)) add(sq, home + 2, { castle: 'K' });
          if (s.cast[me + 'Q'] && b[home - 4] === me + 'r' && !b[home - 1] && !b[home - 2] && !b[home - 3] &&
              !attacked(b, home - 1, opp) && !attacked(b, home - 2, opp)) add(sq, home - 2, { castle: 'Q' });
        }
      }
    } else {
      const dirs = t === 'r' ? R_DIR : t === 'b' ? B_DIR : R_DIR.concat(B_DIR);
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (inB(rr, cc)) {
          const to = rr * 8 + cc;
          if (!b[to]) add(sq, to);
          else { if (b[to][0] === opp) add(sq, to); break; }
          rr += dr; cc += dc;
        }
      }
    }
  }
  return out;
}

function applyMove(s, m) {
  const b = s.b.slice(), me = s.turn, p = b[m.from];
  let captured = b[m.to];
  b[m.to] = m.promo ? me + m.promo : p;
  b[m.from] = null;
  if (m.ep) { const cs = m.to + (me === 'w' ? 8 : -8); captured = b[cs]; b[cs] = null; }
  if (m.castle === 'K') { b[m.from + 1] = b[m.from + 3]; b[m.from + 3] = null; }
  if (m.castle === 'Q') { b[m.from - 1] = b[m.from - 4]; b[m.from - 4] = null; }
  const cast = Object.assign({}, s.cast);
  if (p[1] === 'k') { cast[me + 'K'] = 0; cast[me + 'Q'] = 0; }
  for (const [q, key] of [[63, 'wK'], [56, 'wQ'], [7, 'bK'], [0, 'bQ']]) if (m.from === q || m.to === q) cast[key] = 0;
  return {
    b, turn: me === 'w' ? 'b' : 'w', cast,
    ep: m.dbl ? (m.from + m.to) / 2 : -1,
    half: (p[1] === 'p' || captured) ? 0 : s.half + 1,
    full: me === 'b' ? s.full + 1 : s.full,
  };
}

function legalMoves(s) {
  const me = s.turn, opp = me === 'w' ? 'b' : 'w';
  return pseudo(s).filter(m => { const n = applyMove(s, m); return !attacked(n.b, kingSq(n.b, me), opp); });
}
const inCheck = s => attacked(s.b, kingSq(s.b, s.turn), s.turn === 'w' ? 'b' : 'w');

function insufficient(b) {
  const minors = [];
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p || p[1] === 'k') continue;
    if (p[1] === 'p' || p[1] === 'r' || p[1] === 'q') return false;
    minors.push([p[1], i]);
  }
  if (minors.length <= 1) return true;
  if (minors.every(([t]) => t === 'b')) return new Set(minors.map(([, i]) => ((i >> 3) + (i & 7)) % 2)).size === 1;
  return false;
}
function hasMating(b, col) {   // can this side ever deliver mate? (used when the opponent's flag falls)
  const minors = [];
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p || p[0] !== col || p[1] === 'k') continue;
    if (p[1] === 'p' || p[1] === 'r' || p[1] === 'q') return true;
    minors.push([p[1], i]);
  }
  if (minors.length < 2) return false;
  if (minors.every(([t]) => t === 'b')) return new Set(minors.map(([, i]) => ((i >> 3) + (i & 7)) % 2)).size > 1;
  return true;
}

/* ---------- Game state & UI ---------- */
const FILES_ = 'abcdefgh';
const SIDE = { w: 'White', b: 'Black' };
const THEMES = {
  green: { name: 'Green', l: '#eeeed2', d: '#769656' },
  brown: { name: 'Brown', l: '#f0d9b5', d: '#b58863' },
  blue:  { name: 'Blue',  l: '#dee3e6', d: '#8ca2ad' },
  gray:  { name: 'Gray',  l: '#e6e6e6', d: '#8a8f98' },
};
const PIECE_SVG = {"cburnett":{"wK":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 45 45\"><g fill=\"none\" fill-rule=\"evenodd\" stroke=\"#000\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path stroke-linejoin=\"miter\" d=\"M22.5 11.63V6M20 8h5\"/><path fill=\"#fff\" stroke-linecap=\"butt\" stroke-linejoin=\"miter\" d=\"M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5\"/><path fill=\"#fff\" d=\"M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10z\"/><path d=\"M11.5 30c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0\"/></g></svg>","wQ":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"45\" height=\"45\" viewBox=\"0 0 45 45\"><g fill=\"#fff\" fill-rule=\"evenodd\" stroke=\"#000\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path d=\"M8 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0m16.5-4.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0M41 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0M16 8.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0M33 9a2 2 0 1 1-4 0 2 2 0 1 1 4 0\"/><path stroke-linecap=\"butt\" d=\"M9 26c8.5-1.5 21-1.5 27 0l2-12-7 11V11l-5.5 13.5-3-15-3 15-5.5-14V25L7 14z\"/><path stroke-linecap=\"butt\" d=\"M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z\"/><path fill=\"none\" d=\"M11.5 30c3.5-1 18.5-1 22 0M12 33.5c6-1 15-1 21 0\"/></g></svg>","wR":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"45\" height=\"45\" viewBox=\"0 0 45 45\"><g fill=\"#fff\" fill-rule=\"evenodd\" stroke=\"#000\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path stroke-linecap=\"butt\" d=\"M9 39h27v-3H9zm3-3v-4h21v4zm-1-22V9h4v2h5V9h5v2h5V9h4v5\"/><path d=\"m34 14-3 3H14l-3-3\"/><path stroke-linecap=\"butt\" stroke-linejoin=\"miter\" d=\"M31 17v12.5H14V17\"/><path d=\"m31 29.5 1.5 2.5h-20l1.5-2.5\"/><path fill=\"none\" stroke-linejoin=\"miter\" d=\"M11 14h23\"/></g></svg>","wB":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"45\" height=\"45\" viewBox=\"0 0 45 45\"><g fill=\"none\" fill-rule=\"evenodd\" stroke=\"#000\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><g fill=\"#fff\" stroke-linecap=\"butt\"><path d=\"M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.35.49-2.32.47-3-.5 1.35-1.94 3-2 3-2z\"/><path d=\"M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z\"/><path d=\"M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z\"/></g><path stroke-linejoin=\"miter\" d=\"M17.5 26h10M15 30h15m-7.5-14.5v5M20 18h5\"/></g></svg>","wN":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"45\" height=\"45\" viewBox=\"0 0 45 45\"><g fill=\"none\" fill-rule=\"evenodd\" stroke=\"#000\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path fill=\"#fff\" d=\"M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21\"/><path fill=\"#fff\" d=\"M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4.003 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3\"/><path fill=\"#000\" d=\"M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0m5.433-9.75a.5 1.5 30 1 1-.866-.5.5 1.5 30 1 1 .866.5\"/></g></svg>","wP":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"45\" height=\"45\" viewBox=\"0 0 45 45\"><path fill=\"#fff\" stroke=\"#000\" stroke-linecap=\"round\" stroke-width=\"1.5\" d=\"M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z\"/></svg>","bK":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 45 45\"><g fill=\"none\" fill-rule=\"evenodd\" stroke=\"#000\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path stroke-linejoin=\"miter\" d=\"M22.5 11.6V6\"/><path fill=\"#000\" stroke-linecap=\"butt\" stroke-linejoin=\"miter\" d=\"M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5\"/><path fill=\"#000\" d=\"M11.5 37a22.3 22.3 0 0 0 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10z\"/><path stroke-linejoin=\"miter\" d=\"M20 8h5\"/><path stroke=\"#ececec\" d=\"M32 29.5s8.5-4 6-9.7C34.1 14 25 18 22.5 24.6v2.1-2.1C20 18 9.9 14 7 19.9c-2.5 5.6 4.8 9 4.8 9\"/><path stroke=\"#ececec\" d=\"M11.5 30c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0\"/></g></svg>","bQ":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"45\" height=\"45\" viewBox=\"0 0 45 45\"><g fill-rule=\"evenodd\" stroke=\"#000\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><g stroke=\"none\"><circle cx=\"6\" cy=\"12\" r=\"2.75\"/><circle cx=\"14\" cy=\"9\" r=\"2.75\"/><circle cx=\"22.5\" cy=\"8\" r=\"2.75\"/><circle cx=\"31\" cy=\"9\" r=\"2.75\"/><circle cx=\"39\" cy=\"12\" r=\"2.75\"/></g><path stroke-linecap=\"butt\" d=\"M9 26c8.5-1.5 21-1.5 27 0l2.5-12.5L31 25l-.3-14.1-5.2 13.6-3-14.5-3 14.5-5.2-13.6L14 25 6.5 13.5z\"/><path stroke-linecap=\"butt\" d=\"M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z\"/><path fill=\"none\" stroke-linecap=\"butt\" d=\"M11 38.5a35 35 1 0 0 23 0\"/><path fill=\"none\" stroke=\"#ececec\" d=\"M11 29a35 35 1 0 1 23 0m-21.5 2.5h20m-21 3a35 35 1 0 0 22 0m-23 3a35 35 1 0 0 24 0\"/></g></svg>","bR":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"45\" height=\"45\" viewBox=\"0 0 45 45\"><g fill-rule=\"evenodd\" stroke=\"#000\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path stroke-linecap=\"butt\" d=\"M9 39h27v-3H9zm3.5-7 1.5-2.5h17l1.5 2.5zm-.5 4v-4h21v4z\"/><path stroke-linecap=\"butt\" stroke-linejoin=\"miter\" d=\"M14 29.5v-13h17v13z\"/><path stroke-linecap=\"butt\" d=\"M14 16.5 11 14h23l-3 2.5zM11 14V9h4v2h5V9h5v2h5V9h4v5z\"/><path fill=\"none\" stroke=\"#ececec\" stroke-linejoin=\"miter\" stroke-width=\"1\" d=\"M12 35.5h21m-20-4h19m-18-2h17m-17-13h17M11 14h23\"/></g></svg>","bB":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"45\" height=\"45\" viewBox=\"0 0 45 45\"><g fill=\"none\" fill-rule=\"evenodd\" stroke=\"#000\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><g fill=\"#000\" stroke-linecap=\"butt\"><path d=\"M9 36c3.4-1 10.1.4 13.5-2 3.4 2.4 10.1 1 13.5 2 0 0 1.6.5 3 2-.7 1-1.6 1-3 .5-3.4-1-10.1.5-13.5-1-3.4 1.5-10.1 0-13.5 1-1.4.5-2.3.5-3-.5 1.4-2 3-2 3-2z\"/><path d=\"M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z\"/><path d=\"M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z\"/></g><path stroke=\"#ececec\" stroke-linejoin=\"miter\" d=\"M17.5 26h10M15 30h15m-7.5-14.5v5M20 18h5\"/></g></svg>","bN":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"45\" height=\"45\" viewBox=\"0 0 45 45\"><g fill=\"none\" fill-rule=\"evenodd\" stroke=\"#000\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path fill=\"#000\" d=\"M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21\"/><path fill=\"#000\" d=\"M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.04-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-1-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-2 2.5-3c1 0 1 3 1 3\"/><path fill=\"#ececec\" stroke=\"#ececec\" d=\"M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0m5.43-9.75a.5 1.5 30 1 1-.86-.5.5 1.5 30 1 1 .86.5\"/><path fill=\"#ececec\" stroke=\"none\" d=\"m24.55 10.4-.45 1.45.5.15c3.15 1 5.65 2.49 7.9 6.75S35.75 29.06 35.25 39l-.05.5h2.25l.05-.5c.5-10.06-.88-16.85-3.25-21.34s-5.79-6.64-9.19-7.16z\"/></g></svg>","bP":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"45\" height=\"45\" viewBox=\"0 0 45 45\"><path stroke=\"#000\" stroke-linecap=\"round\" stroke-width=\"1.5\" d=\"M22.5 9a4 4 0 0 0-3.22 6.38 6.48 6.48 0 0 0-.87 10.65c-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47a6.46 6.46 0 0 0-.87-10.65A4.01 4.01 0 0 0 22.5 9z\"/></svg>"},"chessnut":{"wK":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 800\"><path fill=\"#fff\" d=\"M405.3 700c-59.8 0-116.1-5.3-158.7-14.8-47.4-10.6-71.1-24.6-72.1-42.8L158.1 576v-1.1c0-9.1 5.2-18 15.2-26.5-6.2-21.9-21.6-45.5-36.6-68.4-18.4-28-35.7-54.4-35.7-77.7 0-25.5 18.4-41.4 47.8-41.4h1.3l7 .1 19.3.2c-5.4-26.7-3.8-45.9 5-59.9 13.3-21.5 36.9-24 53.6-24 14.1 0 29.8 2.1 46.4 4.4a54.4 54.4 0 0 1 17.2-36.9c7.8-6.8 17-10.3 27-10.3 21.3 0 42.2 14.9 60.8 28 7 5 13.6 9.7 19 12.5 5.4-2.9 12.1-7.6 19-12.5 18.5-13.1 39.5-28 60.7-28a40 40 0 0 1 27 10.3 54.5 54.5 0 0 1 17.1 36.9c16.6-2.3 32.3-4.4 46.4-4.4 16.6 0 40.3 2.5 53.6 24 8.6 14 10.3 33.3 4.9 60l19.8-.2 6.5-.1h1.3c29.5 0 47.1 15.4 47.1 41.4 0 23.2-17.6 49.7-36.3 77.7-15.2 22.8-30.8 46.3-37 68.1 10.7 8.2 16.1 17.3 16.1 26.8v1.1l-15.8 67.2c-1.6 17.9-25.5 31.9-72.8 42.3A778.1 778.1 0 0 1 405.3 700\"/><path d=\"M325.6 243.8c28.2 0 60.4 33.6 79.8 41.5 19.4-8 51.6-41.5 79.8-41.5 7.3 0 14.5 2.3 21.1 8 10.2 8.9 14.3 22.9 14.6 40.4 20-2.8 38.8-5.7 55-5.7 20.2 0 36.4 4.5 45.8 19.7s7.9 38 1.2 64.3l7.8.1c10.3 0 21.7-.2 30.1-.3h1.2c21.4 0 37.9 9.2 37.9 32.2 0 39.1-60.9 95.7-73.9 146.7v3.3c10.8 6.9 16.5 14.5 16.5 22.5l-15.6 66.9c-1.3 27.2-100 49.1-221.5 49.1-122.3 0-221.5-22.2-221.5-49.7L167.6 575c0-7.9 5.8-15.6 15.6-22.5v-3.6c-11.9-51-72.8-107.6-72.8-146.7 0-23 17.3-32.2 38.7-32.2h1.2c8.5.1 20.3.4 30.6.4l7.5-.1c-6.7-26.4-8.1-49.1 1.3-64.3 9.4-15.1 25.5-19.7 45.8-19.7 16.2 0 35 2.9 55 5.7.3-17.5 4.4-31.6 14.6-40.4 6-5.5 13.1-7.8 20.5-7.8m0-18.3a48.9 48.9 0 0 0-33 12.5 59.4 59.4 0 0 0-18.7 33.5 304 304 0 0 0-38.9-3.2 91.3 91.3 0 0 0-33.7 5.4 55.5 55.5 0 0 0-27.8 22.9c-8.6 14-11.3 32-8.1 55.5l-8.2-.1-7-.1h-1.4a63.8 63.8 0 0 0-38.2 11 47 47 0 0 0-18.8 39.4c0 26 18.1 53.6 37.3 82.7 13.4 20.4 27.3 41.4 34 60.5a41 41 0 0 0-13.6 29.4v2.3l.3 2.2 15.8 64.6c1.1 12.9 10.2 24 27 32.8a216.7 216.7 0 0 0 52.1 17.5c43.1 9.6 100.2 15 160.6 15 60 0 116.7-5.3 159.7-14.8a222.3 222.3 0 0 0 52.1-17.3c17-8.9 26.4-19.8 27.8-32.5l15.1-65.6.3-2.1v-2.2c0-10.8-4.8-20.7-14.4-29.8 6.8-19 20.7-39.9 34.2-60 19.4-29.2 37.8-56.7 37.8-82.7 0-21.1-9.8-33-18.1-39.3a61 61 0 0 0-38-11.2h-1.4l-6.5.1-8.7.1c3.3-23.5.6-41.6-8-55.5a55.5 55.5 0 0 0-27.8-22.9 90.3 90.3 0 0 0-33.6-5.4 304 304 0 0 0-38.9 3.2 59.7 59.7 0 0 0-18.7-33.5 48.9 48.9 0 0 0-33-12.5c-24.2 0-47.4 16.4-66.1 29.7-4.8 3.3-9.6 6.8-13.7 9.4-4.1-2.6-9-6-13.7-9.4-18.7-13.2-41.9-29.6-66.1-29.6\"/><g stroke=\"#000\" stroke-miterlimit=\"10\"><g fill=\"none\" stroke-linecap=\"round\"><g stroke-width=\"18.4\"><path d=\"M187.4 370.4c-11.9.3-25.9-.1-37.5-.3-21.9-.3-39.4 8.7-39.4 32.2 0 39.1 60.6 95.7 73.3 146.7\"/><path d=\"M289.5 292.4c-45.6-6.3-83.3-13.8-100.3 13.7-27 43.6 35.6 150.7 55.1 222.4\"/><path d=\"M404.3 285.7c-24.3-9-67.9-61.7-99.8-33.9-43.6 37.9 22.9 173.9 38.1 260.5m280.7-141.9c11.9.3 25.9-.1 37.5-.3 21.9-.3 39.4 8.7 39.4 32.2 0 39.1-60.6 95.7-73.3 146.7\"/><path d=\"M521.3 292.4c45.6-6.3 83.3-13.8 100.3 13.7 27 43.6-35.6 150.7-55.1 222.4\"/><path d=\"M406.5 285.7c24.3-9 67.9-61.7 99.8-33.9 43.6 37.9-22.9 173.9-38.1 260.5\"/></g><path stroke-width=\"15.1\" d=\"M405.4 271.7v184.5\"/></g><path fill=\"#fff\" stroke-width=\"18.4\" d=\"m632.9 552.5 27.8-68.8c-11.1 14.6-24.8 16.8-33.9 14.3-27-8-26.5-40.6-24.4-66.5-16.4 29.5-39.3 44.7-63.9 39.5-24.9-5.3-40-40.5-39-68.6-17.5 35.6-49.4 54.1-94.1 54.1s-76.6-18.5-94.1-54.1c1.1 28.1-14 63.3-39 68.6-24.6 5.2-47.4-10-63.9-39.5 1.9 25.9 2.6 58.5-24.4 66.5-9.1 2.7-22.9.3-33.9-14.3l27.8 68.8\"/><g fill=\"none\"><g stroke-linecap=\"round\" stroke-width=\"21.6\"><path d=\"M167.9 574.8c0-34.3 106.3-61.7 237.4-61.7s237.4 27.3 237.4 61.7m-475 1.9 16.2 65m459.2-65-16.2 65\"/><ellipse cx=\"405.4\" cy=\"641.1\" rx=\"221.4\" ry=\"49.7\"/></g><path stroke-width=\"30.2\" d=\"M404.3 94.6v189m-61.5-124.2H468\"/></g></g></svg>","wQ":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 800\"><g fill=\"#fff\" stroke=\"#000\" stroke-miterlimit=\"10\"><path stroke-width=\"20.5\" d=\"M401.1 704.4c-62 0-120.5-5.5-164.8-15.4-49.6-11.1-74.1-25.8-75-44.7l-10.2-54v-.9c0-5.4 1.6-13.2 8.6-21.4-8-46.5-25.9-125.2-44.6-195.5a47.7 47.7 0 1 1 54-14.7C190.2 424.9 216 494.5 234 533l5.3-1.3c-.5-55.3-9.1-164.3-20.6-261.6a51.3 51.3 0 1 1 56.6-10.8c17.9 93.5 47.7 211.6 65.3 258.9l5.4-.3c8.6-66 19.4-184.5 24.6-294.5a54 54 0 1 1 60.7 0c5.2 110.1 16 228.5 24.6 294.5l5.4.3c17.6-47.3 47.4-165.3 65.3-258.9a51.3 51.3 0 1 1 56.6 10.8c-11.6 97.3-20.2 206.3-20.6 261.6l5.3 1.3c18-38.4 43.8-108.1 64.9-175.2a47.7 47.7 0 1 1 54 14.7A2624.1 2624.1 0 0 0 642.2 568a32.5 32.5 0 0 1 8.6 21.3v.9l-10.3 54.3c-1.2 18.9-25.7 33.5-75 44.6-43.8 9.8-102.3 15.3-164.4 15.3zm-189.4-90.7c1.4 3 13.7 12.4 54.6 20.3 36.5 7 84.2 11 134.6 11 50.3 0 98.2-3.9 134.6-11 40.9-8 53.4-17.3 54.6-20.3-1.4-3-13.7-12.4-54.6-20.3-36.5-7-84.2-11-134.6-11-50.3 0-98.2 3.9-134.6 11-40.8 7.9-53.1 17.3-54.6 20.3z\"/><path stroke-width=\"16.2\" d=\"M592.9 607.6c-41.8 13.8-112.3 23.2-191.8 23.2-80.4 0-148.9-9.5-190.6-23.5C197 610.8 171 628.4 171 643c0 28.5 103 51.6 230 51.6s230-23.1 230-51.6c.1-14.2-24.4-31.7-38.1-35.4z\"/><path stroke-width=\"17.3\" d=\"M401.1 591.4c127.1 0 230.1 23.1 230.1 51.6l10.2-60.3c0-6.3-3.2-12.3-9.4-18.1 7.5-44.9 26.1-121.9 47-199.9a38 38 0 1 0-35.1-9.4c-20.8 67-50.1 141.4-70.4 182.4l-20.4-4.9c-.3-54.2 9.2-167.8 21.5-269.9a41.7 41.7 0 1 0-37.2-7.2c-18 95.8-51.2 221.4-69.4 266.1l-20.4-1.3a3816.1 3816.1 0 0 1-26-302.6 44.3 44.3 0 1 0-41 0 3723 3723 0 0 1-26 302.6l-20.4 1.3c-18.1-44.7-51.4-170.3-69.4-266.1a41.6 41.6 0 0 0-25.7-74.3 41.6 41.6 0 0 0-11.6 81.6c12.3 102 21.8 215.5 21.5 269.8l-20.4 4.9a1418.4 1418.4 0 0 1-70.4-182.4 38 38 0 1 0-35.1 9.4c20.8 78 39.5 155 47 199.9-6 5.7-9.4 11.8-9.4 18.1l10.2 60.3c0-28.5 103.1-51.6 230.2-51.6z\"/></g><circle cx=\"401.1\" cy=\"112.9\" r=\"25.9\"/><circle cx=\"226.1\" cy=\"164.8\" r=\"23\"/><circle cx=\"114.9\" cy=\"273.8\" r=\"22.4\"/><circle cx=\"576\" cy=\"164.8\" r=\"23\"/><circle cx=\"688.4\" cy=\"273.8\" r=\"22.4\"/></svg>","wR":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 800\"><path fill=\"#fff\" d=\"M400.4 708.3c-57.1 0-110.8-5.8-151.2-16.5-45.5-12-68.5-28.4-68.5-48.6V582c0-28.4 44.1-46.2 74.7-55.3l8.1-172.4a31.9 31.9 0 0 1-7.3-8.1l-.2-.3-24.7-52.8c-19.3-9.5-19.3-19-19.3-22.2V145.3h74.5v50.8h43.2v-50.3l137.2.1v50.2H510v-50.8h75.6v125.4c0 7.8-4.2 14.5-13 19.9l-24 55.4-.4.8c-2.1 3.1-5 6-8.5 8.6l7.6 170.9c21.1 6 38.8 13.5 51.5 21.6 16.5 10.5 24.8 21.9 24.8 34.1l-.1 2.5-.1 58.6c0 20.2-23.4 36.6-69.6 48.6-40.9 10.7-95.5 16.6-153.4 16.6\"/><path d=\"M576 155v115.7c0 4.5-3.2 9-10.9 13.1l-24.9 57.7a31.6 31.6 0 0 1-10.4 9L538 534c47.2 12.5 76 30.8 76 48.2l-.1 1.9-.1 59.3c0 30.6-95 55.4-213.3 55.4-116.6 0-210-24.7-210-55.4v-61.2c0-17.2 28.2-35.3 74.4-47.8l8.6-184.7a27.4 27.4 0 0 1-8.9-8.1l-26-55.7c-10.4-4.5-16.8-9.6-16.8-15V155H277v50.8h62.6v-50.3l117.7.1v50.2H520V155zm19.5-19.4h-95.1v50.7h-23.8v-50.2h-19.4l-117.5-.1H320v50.3h-23.8v-50.7h-93.9v135.1c0 15.4 12.5 24.6 21.6 29.5l23.1 49.4.3.8.4.8c1.5 2.6 3.5 5.1 5.8 7.5l-7.6 160.8a198.9 198.9 0 0 0-46.2 20.5 75.8 75.8 0 0 0-19.5 17.1 39.8 39.8 0 0 0-9.3 24.9v61.3c0 18.3 13.9 30.8 25.5 38a184.6 184.6 0 0 0 50.2 20c41.1 10.9 95.7 16.8 153.7 16.8 58.8 0 114-5.9 155.8-16.8a191.2 191.2 0 0 0 50.9-19.9c11.9-7.3 25.9-19.9 25.9-38.1l.1-58.2.1-3c0-8.7-3.1-17.3-9.4-25.2a80.4 80.4 0 0 0-19.9-17.2 198.6 198.6 0 0 0-47.3-20.6l-7-159.1c2.7-2.4 5-5 6.8-7.8l1-1.4.6-1.6 22.5-52.1c12.3-8.7 14.9-18.9 14.9-26.4V135.6z\"/><g fill=\"#fff\" stroke=\"#000\" stroke-miterlimit=\"10\"><path stroke-linecap=\"round\" stroke-width=\"18.4\" d=\"M191 581.6v61.6c0 30.6 93.1 55.4 209.6 55.4 118.3 0 213.2-24.8 213.2-55.4l-.3-61.3\"/><path stroke-width=\"21.6\" d=\"M613.9 582c0 30.6-94.5 55.4-211.1 55.4S191.7 612.6 191.7 582s87.5-64 211.1-64c121.6-.1 211.1 33.3 211.1 64z\"/><path stroke-width=\"15.1\" d=\"m275.8 260.9-10.5 280.6c0 19.7 62.1 34.1 136.8 34.1 74.8 0 136.1-14.4 136.1-33.9l-14.9-280.8z\"/><path stroke-width=\"15.1\" d=\"m231.3 268.1 33.8 73.1c9.5 16.5 61.6 28.5 137.6 28.5s126.4-11.7 137.6-28.5l32.8-73.1\"/><path stroke-linecap=\"square\" stroke-width=\"19.4\" d=\"M522 154v50.8h-63.7v-49.1l-116.6-.1v49.2H278V154h-55.1v116.7c0 20.1 83.1 36.4 178.5 36.4 95.5 0 176.8-16.3 176.8-36.4V154z\"/></g></svg>","wB":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 800\"><path fill=\"#fff\" d=\"M238.9 701.8c-41.8 0-77-14.8-101.8-42.8-22.9-25.8-35.5-62.1-35.5-102.2 0-58.9 41.1-72.9 77.1-78.5l15.6-2.5-4.8 15c-6.5 20.5-10.2 43-10.2 61.3 0 54.3 24.5 88.1 64.2 88.1 29.5 0 57.2-24.2 71.4-61.1-33-6.6-49.5-16.4-50.1-29.9l-7.3-55.7v-.5c0-9.1 5.9-15.3 13.2-20.3l-5.1-13.8C249 414 228.3 358.1 228.3 315.3c0-50.2 22.1-95.1 62.3-126.5 22.9-32 69.2-68.5 105.3-90.6l5.1-3.1 5.1 3.1c36 22 82.3 58.5 105.3 90.7a157.2 157.2 0 0 1 62.3 126c0 43-20.7 99.4-37.4 144.6l-4.9 13.2c7.2 5 13.2 11.3 13.2 20.3v.6l-7.2 55.5c-.5 13.5-17 23.4-50 29.9 14.1 36.9 41.9 61.1 71.4 61.1 39.5 0 64.2-33.8 64.2-88.1 0-18.5-3.7-40.8-10.2-61.3l-4.8-15 15.6 2.5c25.2 4 42.6 10.8 54.9 21.6 14.9 13.1 22.2 31.8 22.2 56.9 0 40.1-12.6 76.4-35.5 102.2-24.8 28-59.9 42.8-101.8 42.8-65.4 0-118.6-45.1-137.4-115.8a679.3 679.3 0 0 1-49.6 0c-19 70.8-72.1 115.9-137.5 115.9\"/><path d=\"M401.1 106.4c33.5 20.5 80.6 56.8 103.2 89.3A147 147 0 0 1 564 315c0 48.3-28.5 117.6-44.4 161.9 9.7 5.4 15.2 10.2 15.2 16.2l-7.2 55.4c0 9.5-21 17.9-53.1 23.1 13.2 44.7 45.9 78.4 84.2 78.4 45.7 0 73.9-38.9 73.9-97.8 0-20-4-43.3-10.7-64.3 41.5 6.6 68.9 21.9 68.9 68.9 0 75-45.6 135.2-127.5 135.2-62 0-113.6-43.6-129.9-116.1a560.9 560.9 0 0 1-64.8 0c-16.2 72.5-68 116.1-130 116.1-82 0-127.5-60.3-127.5-135.2 0-47 27.4-62.4 68.9-68.9-6.6 21-10.7 44.4-10.7 64.3 0 59 28.1 97.8 73.9 97.8 38.3 0 71.1-33.7 84.2-78.4-32.2-5.2-53.1-13.5-53.1-23L267 493c0-5.9 5.5-10.8 15.2-16.2-15.8-44.3-44.4-113.3-44.4-161.6 0-51 23.9-92.2 59.7-119.7 23-32.4 70.1-68.5 103.6-89.1m0-22.8-10.2 6.3C357 110.6 309.1 147 283.6 182a167.3 167.3 0 0 0-65 133.3c0 44.6 21 101.3 37.8 147l2.6 7.1a31.7 31.7 0 0 0-11.3 23.7v1.3l.2 1.3 7.1 54.8c.3 5.5 2.6 12.9 10.3 19.8 4.1 3.7 9.4 6.8 16.1 9.7 5.6 2.4 12.2 4.5 19.8 6.5a97.2 97.2 0 0 1-19.7 27.4 56 56 0 0 1-38.1 17.1 45.4 45.4 0 0 1-38.4-19c-10.4-13.9-15.9-34.6-15.9-59.4 0-17.5 3.6-38.8 9.7-58.4l9.4-29.9-31 4.9c-27.1 4.3-46 11.9-59.7 23.9-17 14.8-25.5 36.4-25.5 64.3 0 21 3.1 40.8 9.5 59.1a146.7 146.7 0 0 0 28.5 49.6c26.7 30.1 64.4 46 109.1 46 67.6 0 123-44.8 144.6-115.5a513.5 513.5 0 0 0 35.2 0c21.7 70.6 77 115.5 144.6 115.5 44.7 0 82.4-15.9 109.1-46 12.4-14 22-30.7 28.5-49.6 6.3-18.3 9.5-38.1 9.5-59.1 0-27.8-8.5-49.5-25.5-64.3-13.7-12-32.7-19.7-59.7-23.9l-31-4.9 9.4 29.9c6.2 19.7 9.7 40.9 9.7 58.4 0 24.8-5.5 45.5-15.9 59.4a45.7 45.7 0 0 1-38.4 19 56 56 0 0 1-38.1-17.1 96.3 96.3 0 0 1-19.7-27.5c7.6-1.9 14.1-4.1 19.8-6.5 6.7-2.9 12-6 16.1-9.7a28.7 28.7 0 0 0 10.2-19.8l7.1-54.5.1-1.3v-1.4c0-10.5-5.3-18.1-11.3-23.7l2.4-6.5c17-46 38-103.1 38-148a166 166 0 0 0-65-132.8 291.4 291.4 0 0 0-49.4-50.4 510.2 510.2 0 0 0-58-41.8z\"/><g stroke=\"#000\" stroke-miterlimit=\"10\"><path fill=\"none\" stroke-linecap=\"round\" stroke-width=\"16.9\" d=\"m527.8 548.5 7.2-55.7c0-19.7-58.9-35.2-133.9-35.2-75.1 0-133.9 15.7-133.9 35.2l7.2 55.7\"/><ellipse cx=\"401.1\" cy=\"548.5\" fill=\"none\" stroke-linecap=\"round\" stroke-width=\"15.9\" rx=\"126.7\" ry=\"28.4\"/><path fill=\"#fff\" stroke-width=\"18.4\" d=\"M333.9 527.1c0 64.4-40.4 121.9-90.5 121.9-45.7 0-73.9-38.9-73.9-97.8 0-20 4-43.3 10.7-64.3-41.5 6.6-68.9 21.9-68.9 68.9 0 75 45.6 135.2 127.5 135.2 74.5 0 134.2-63.2 135.2-163.6m94.4-.3c0 64.4 40.4 121.9 90.5 121.9 45.7 0 73.9-38.9 73.9-97.8 0-20-4-43.3-10.7-64.3 41.5 6.6 68.9 21.9 68.9 68.9 0 75-45.6 135.2-127.5 135.2-74.5 0-134.2-63.2-135.2-163.6\"/><g fill=\"none\"><path stroke-width=\"20.5\" d=\"M519.8 476.2c15.8-44.7 44.4-113.3 44.4-161.6 0-51-23.9-92.4-59.7-119.9-22.7-32.4-69.9-69.2-103.2-89.7-33.5 20.5-80.6 57.2-103.2 89.7a147.9 147.9 0 0 0-59.7 119.8c0 48.3 28.6 117 44.4 161.7\"/><path stroke-width=\"19.4\" d=\"M401.1 211.2v184.7m-70.2-94h140.4\"/></g></g></svg>","wN":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 800\"><g stroke=\"#000\" stroke-miterlimit=\"10\"><path fill=\"#fff\" stroke-linecap=\"round\" stroke-width=\"29.2\" d=\"M645.3 692.2V280.6C588 238.8 503 194.8 448.7 182.5c-42.6-9.7-101.3-2.1-148.6 13.2a96 96 0 0 0-81.5-60.4c6.3 29.6 5.9 74.3 24.3 97.7-7 16.2-32.1 69.4-48.7 119.3v39.4a5617.5 5617.5 0 0 0-43.4 212.8L271.7 656l22.4-58.1c15.2-22.7 45.7-60.9 65-78.2 24.5-10.3 55.9-29.4 66.7-59.2 14-38.4 6.3-84.3-10.5-119.9 31 30.2 50 77 50 127.8 0 68.1-38.1 145.9-104.7 223.7h284.7z\"/><path stroke-width=\"9.2\" d=\"M179.8 574.8c19.4-10.9 33.9 3.8 22.4 25.2z\"/><path d=\"M231.5 357.9c-7 9.5-.6 29.3 6 34.5a50 50 0 0 0 18.6-8l21.5-24.9-4.5-3.7a264 264 0 0 0-41.6 2.1z\"/><path fill=\"#fff\" stroke-linecap=\"square\" stroke-width=\"23.8\" d=\"M320 186c-12.4-17.9-9.8-49.7 7-75.1a68.2 68.2 0 0 1 35.2 70.6\"/></g></svg>","wP":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 800\"><g stroke=\"#000\" stroke-miterlimit=\"10\"><path fill=\"#fff\" stroke-width=\"30.24\" d=\"M497.9 240c0 53.6-44 93.9-98.1 93.9s-98.1-40.3-98.1-93.9 44-93.9 98.1-93.9c54.2.1 98.1 40.4 98.1 93.9zm28.5 97.6v55.3c-30.2 3-42.8 12.1-42.8 28 0 56.9 36 123.4 109.1 187.9v60.9c0 17.4-87.5 30.8-192.7 30.8s-192.7-13.4-192.7-30.8l-.1-60.6c73.1-64.5 108.1-131.1 108.1-188 0-15.9-13.6-25.2-43.8-28.2v-55.3z\"/><path fill=\"none\" stroke-width=\"16.2\" d=\"M207.2 608c0 17.4 87.5 30.3 192.7 30.3s192.6-12.9 192.6-30.2\"/><path fill=\"none\" stroke-width=\"14.04\" d=\"M272.6 386.7h252.7\"/></g></svg>","bK":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 800\"><path d=\"M694.7 363.2a60.8 60.8 0 0 0-38-11.2h-1.4l-6.5.1-8.5.1c3.3-23.7.6-41.6-8-55.5a55.5 55.5 0 0 0-27.8-22.9 90.3 90.3 0 0 0-33.6-5.4 301 301 0 0 0-38.8 3.2 59.1 59.1 0 0 0-18.7-33.5 48.9 48.9 0 0 0-33-12.5c-24.1 0-47.2 16.3-65.9 29.6v-80.7h49.7v-30.2h-49.7V94.6h-30.2v49.7h-46.4v30.2h46.4v78.9c-18.3-13-40.4-28-63.5-28a48.9 48.9 0 0 0-33 12.5 59.4 59.4 0 0 0-18.7 33.5 304 304 0 0 0-38.9-3.2 91.3 91.3 0 0 0-33.7 5.4 55.5 55.5 0 0 0-27.8 22.9c-8.6 14-11.3 32-8.1 55.5l-8.2-.1-7-.1H144a64 64 0 0 0-38.2 11.1 46.8 46.8 0 0 0-18.6 39.4c0 26.1 18.3 53.8 37.5 83.2l5.7 8.7 25.6 53.9a39 39 0 0 0-11.3 26.8v2.2l.4 2.2 15.7 64.6c1.1 12.9 10.2 24 27 32.9a216.7 216.7 0 0 0 52.1 17.5c43.1 9.7 100.1 15 160.6 15 60 0 116.7-5.3 159.7-14.8a224 224 0 0 0 52.1-17.3c17.1-8.9 26.5-19.9 27.9-32.6l14.7-65.7.6-1.9v-2.1c0-9.4-4-18.1-11.6-26.1l23.8-52.6 7.3-11c19.4-29.2 37.8-56.7 37.8-82.7a47 47 0 0 0-18.1-39.3\"/><g stroke=\"#f2f2f2\" stroke-linecap=\"round\" stroke-miterlimit=\"10\"><g fill=\"none\" stroke-width=\"15.1\"><path d=\"M182 371.5c-11.9.3-25.9-.1-37.5-.3-21.9-.3-39.4 8.7-39.4 32.2 0 39.1 60.6 95.7 73.3 146.7\"/><path d=\"M284.1 293.5c-45.6-6.3-83.3-13.8-100.3 13.7-27 43.6 35.6 150.7 55.1 222.4\"/><path d=\"M398.9 286.8c-24.3-9-67.9-61.7-99.8-33.9-43.6 37.9 22.9 173.9 38.1 260.5m280.7-141.9c11.9.3 25.9-.1 37.5-.3 21.9-.3 39.4 8.7 39.4 32.2 0 39.1-60.6 95.7-73.3 146.7\"/><path d=\"M515.9 293.5c45.6-6.3 83.3-13.8 100.3 13.7 27 43.6-35.6 150.7-55.1 222.4\"/><path d=\"M401.1 286.8c24.3-9 67.9-61.7 99.8-33.9 43.6 37.9-22.9 173.9-38.1 260.5\"/></g><path stroke-width=\"13\" d=\"M177.9 554c34-23.3 120.6-39.6 222-39.6 102.5 0 190.3 16.3 223.6 40l31.8-78.1c-11.8 13.1-23.7 18.5-33.9 15.3-26.9-8.4-26.5-40.6-24.4-66.5-16.4 29.5-39.3 44.7-63.9 39.5-24.9-5.3-40-40.5-39-68.6-17.5 35.6-49.4 54.1-94.1 54.1s-76.6-18.6-94.1-54.2c1.1 28.1-14 63.3-39 68.6-24.6 5.2-47.4-10-63.9-39.5 1.9 25.9 2.6 58.5-24.4 66.5-9.1 2.7-22.1-3.8-33.9-15.3z\"/><g fill=\"none\"><path stroke-width=\"13\" d=\"M162.5 575.9c0-34.3 106.3-61.7 237.4-61.7s237.4 27.3 237.4 61.7m-475 1.8 16.2 65.1m459.2-65.1-16.2 65.1\"/><path stroke-width=\"15.1\" d=\"M178.6 642.2c0-27.4 99.1-49.7 221.4-49.7s221.4 22.2 221.4 49.7\"/><path stroke-width=\"6.5\" d=\"M400 286.8v160.9\"/></g></g></svg>","bQ":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 800\"><path d=\"M400 704.4c-62 0-120.5-5.5-164.8-15.4-49.7-11.1-74.2-25.8-75-44.8L150 587v-.9c0-5.4 1.6-13.2 8.6-21.4-7.5-43.1-24.6-117.2-44.6-192.2a47.5 47.5 0 0 1-30.8-44.6 47.7 47.7 0 1 1 95.4 0c0 11.1-3.7 21.5-10.6 29.9 21.1 67.1 46.9 136.7 64.9 175.2l5.3-1.3c-.5-55.3-9.1-164.3-20.6-261.6-18.6-8-31-26.6-31-47.1 0-28.3 23-51.3 51.3-51.3a51.34 51.34 0 0 1 36.3 87.6c17.9 93.5 47.7 211.6 65.3 258.9l5.4-.3c8.6-66 19.4-184.5 24.6-294.5a53.24 53.24 0 0 1-23.8-44.5c0-29.8 24.2-54 54-54a54.03 54.03 0 0 1 30.5 98.6c5.2 110.1 16 228.5 24.6 294.5l5.4.3c17.6-47.3 47.4-165.3 65.3-258.9a51.34 51.34 0 0 1 36.3-87.6c28.3 0 51.3 23 51.3 51.3 0 20.6-12.4 39.1-31 47.1-11.6 97.3-20.2 206.3-20.6 261.6l5.3 1.3c18-38.4 43.8-108.1 64.9-175.2a46.88 46.88 0 0 1-10.6-29.9 47.7 47.7 0 1 1 95.4 0 47.5 47.5 0 0 1-30.8 44.6c-19.9 75.1-37 149.1-44.6 192.2 5.7 6.7 8.6 13.8 8.6 21.3v.9l-10.3 57.7c-1.2 18.9-25.7 33.5-75 44.6-43.8 9.6-102.3 15.1-164.4 15.1m-185-71.7c10.8 7.2 34.9 14.3 66.2 19.1 34.3 5.4 75.4 8.2 118.8 8.2 98 0 163.9-13.8 184.2-26.9l3.3-2.9c-4.2-4.2-17-11.4-48.7-17.7-35.3-6.9-84.7-10.7-138.9-10.7-50.3 0-98.2 3.9-134.6 11-33.2 6.5-47.5 13.8-52.6 17.9z\"/><path d=\"M400 134.5c24.4 0 44.3 19.9 44.3 44.3 0 17.1-9.6 31.9-23.8 39.2 5.1 114 16.8 242.6 26 309.1l20.4 1.3c18.1-44.7 51.4-176.8 69.4-272.6a41.38 41.38 0 0 1-15.9-32.7c0-23 18.6-41.6 41.6-41.6s41.6 18.6 41.6 41.6c0 19-12.7 35-30.2 40-12.3 102.1-21.8 222-21.5 276.4l20.4 4.9c20.3-41.1 49.7-121.9 70.4-188.9a37.98 37.98 0 0 1 26.2-65.5 37.98 37.98 0 0 1 8.9 74.9c-20.8 78-39.5 158.2-47 203.1 6 5.7 9.4 11.8 9.4 18.1l-10.2 57-.1.1c0 28.5-103 51.6-230 51.6-127.1 0-230-23.4-230-51.5l-10.2-57.1c0-6.3 3.2-12.5 9.4-18.3-7.5-44.9-26.1-125.2-47-203.1-16.6-4-29.1-19-29.1-36.9 0-21 17-38 38-38 21.1 0 38 17 38 38 0 10.8-4.5 20.6-11.8 27.5 20.8 67 50.1 147.9 70.4 188.9l20.4-4.9c.3-54.2-9.2-174.3-21.5-276.4-17.4-5-30.2-21-30.2-40 0-23 18.6-41.6 41.6-41.6s41.6 18.6 41.6 41.6c0 13.3-6.3 25.1-15.9 32.7 18 95.8 51.2 227.9 69.4 272.6l20.4-1.3c9.1-66.5 20.8-195 26-309.1-14.1-7.5-23.8-22.1-23.8-39.2.1-24.3 20-44.2 44.4-44.2m0 535.3c89.4 0 165-12.1 190.2-28.8l9-7.9c0-25.6-89.1-41-199-41s-199 18.4-199 41l8.1 7.2c24 17 100.3 29.5 190.7 29.5m0-554.7a63.8 63.8 0 0 0-63.7 63.7c0 19.3 8.6 37.3 23.2 49.2-4.4 92.8-12.9 190.8-20.5 257.8-17-55.4-39.6-148.1-54.3-223.5a60.77 60.77 0 0 0 14.4-39.3c0-33.7-27.3-61-61-61s-61 27.3-61 61c0 13.5 4.3 26.4 12.6 37.2 5.2 6.7 11.7 12.3 19.1 16.4 9.1 77.4 16.2 161.5 18.9 219.2-15.3-37.6-33.2-87.4-48.6-136.3 6.2-9.3 9.6-20.4 9.6-31.6 0-31.6-25.8-57.5-57.5-57.5-31.6 0-57.6 25.7-57.6 57.3 0 22.5 12.9 42.2 32.3 51.6 18.7 70.8 34.8 140.2 42.4 182.6-6.5 9.1-8.1 17.7-8.1 24v1.7l.3 1.7 9.9 55.8c.4 5.7 2.6 13.5 9.7 21.4 4.6 5 10.7 9.4 18.7 13.6 13.1 6.9 31.3 13.1 54.1 18.1 45 10.2 104.3 15.7 167 15.7 62.9 0 122.1-5.5 167-15.7 22.8-5.1 41-11.2 54.1-18.3 8-4.2 14-8.7 18.7-13.7 4.1-4.5 6.6-9.1 8-13.2l.3-.3.3-1.8c.5-1.9.9-3.8 1-5.5l10-56.4.3-1.7V586c0-6.2-1.6-14.8-8.1-23.9 7.6-42.4 23.8-111.8 42.4-182.6a57.4 57.4 0 0 0 32.3-51.6c0-31.6-25.8-57.5-57.5-57.5-31.6 0-57.5 25.8-57.5 57.5 0 11.3 3.3 22.4 9.6 31.6-15.4 48.9-33.4 98.7-48.6 136.3 2.7-57.8 9.8-141.8 18.9-219.2 7.3-4.1 13.9-9.6 19.1-16.4a60.54 60.54 0 0 0 12.6-37.2c0-33.7-27.3-61-61-61s-61 27.3-61 61c0 14.6 5.1 28.4 14.4 39.3-14.7 75.4-37.4 168-54.3 223.5-7.7-67-16.1-164.9-20.5-257.8a63.37 63.37 0 0 0 23.1-49.1c.2-35.2-28.4-63.8-63.5-63.8M234 631c8.5-3 21.6-6.7 41.3-10 34.7-6 78.9-9.3 124.7-9.3 48 0 91.2 2.9 125.1 8.4 21.1 3.5 34.3 7.1 42.7 10.4-9.5 3.6-25.5 8.1-51.5 12.1-33.7 5.2-73.9 7.9-116.2 7.9-42.9 0-83.4-2.8-117.3-8.1-24-3.8-39.2-8.1-48.8-11.4\"/><circle cx=\"400\" cy=\"112.9\" r=\"25.9\"/><circle cx=\"225\" cy=\"164.8\" r=\"23\"/><circle cx=\"113.8\" cy=\"273.8\" r=\"22.4\"/><circle cx=\"575\" cy=\"164.8\" r=\"23\"/><circle cx=\"687.3\" cy=\"273.8\" r=\"22.4\"/><g fill=\"none\" stroke=\"#f2f2f2\" stroke-linecap=\"round\" stroke-miterlimit=\"10\"><path stroke-width=\"17.28\" d=\"m117.6 287.9-4.5-15\"/><path stroke-width=\"18.36\" d=\"m228.8 180.7-4.4-18\"/><path stroke-width=\"17.28\" d=\"m682.7 287.9 4.6-15\"/><path stroke-width=\"18.36\" d=\"m570.4 180.7 4.6-18\"/><path stroke-width=\"20.52\" d=\"M399.5 108.6V127\"/><g stroke-linejoin=\"round\" stroke-width=\"15.12\"><path d=\"M263.7 255.8c9.7-7.6 15.9-19.4 15.9-32.7 0-23-18.6-41.6-41.6-41.6s-41.6 18.6-41.6 41.6c0 19 12.7 35 30.2 40 12.3 102.1 21.8 215.6 21.5 269.9l-20.4 4.9M420.5 218c14.1-7.5 23.8-22.1 23.8-39.2 0-24.4-19.9-44.3-44.3-44.3s-44.3 19.9-44.3 44.3c0 17.1 9.6 31.9 23.8 39.2-5.1 114-16.8 236.1-26 302.6l-20.4 1.3M573.3 263c17.4-5 30.2-21 30.2-40 0-23-18.6-41.6-41.6-41.6S520.3 200 520.3 223c0 13.3 6.3 25.1 15.9 32.7-18 95.8-51.2 221.4-69.4 266.1l-20.4-1.3m231.5-155.7c16.6-4 29.1-19 29.1-36.9 0-21-17-38-38-38a37.98 37.98 0 0 0-26.2 65.5c-20.8 67-50.1 141.4-70.4 182.4l-20.4-4.9\"/><path d=\"M157.2 355.4a37.98 37.98 0 0 0-26.2-65.5c-21.1 0-38 17-38 38 0 17.9 12.4 32.9 29.1 36.9 20.8 78 39.5 155 47 199.9-6 5.7-9.4 11.8-9.4 18.1l10.2 60.3c0-28.5 103-51.6 230.1-51.6s230.1 23.1 230.1 51.6l10.2-60.3c0-6.3-3.2-12.3-9.4-18.1\"/></g></g></svg>","bR":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 800\"><path d=\"M398.3 708.2c-56.2 0-108.6-5.8-148.3-16.5-44.6-12.1-67.1-28.4-67.1-48.5V582c0-28.3 43.1-46.1 73.2-55.2l7.9-172.5a28.5 28.5 0 0 1-7.2-8.2l-.2-.3-24.3-52.8c-7-3.5-19-10.7-19-22.2V145.3h73.4v50.8h42.1v-50.2l135 .1v50.1h42.1v-50.8h74.5v125.4c0 7.7-4.1 14.4-12.7 19.8L544.1 346l-.4.8q-3.15 4.65-8.4 8.7l7.5 171.1a196 196 0 0 1 50.5 21.6c16.2 10.5 24.3 21.8 24.3 34l-.1 2.5-.1 58.8c0 20.2-23 36.5-68.4 48.5-40.4 10.3-93.8 16.2-150.7 16.2\"/><path d=\"M570.6 155v115.7c0 4.5-3.1 9-10.7 13.1l-24.5 57.7a30.7 30.7 0 0 1-10.2 9l8 183.5c46.3 12.5 74.6 30.8 74.6 48.2l-.1 1.9-.1 59.3c0 30.6-93.1 55.4-209.2 55.4-114.5 0-205.8-24.7-205.8-55.4v-61.2c0-17.2 27.4-35.3 72.8-47.8l8.4-184.7c-4-2.6-7.1-5.3-8.7-8.1l-25.6-55.7c-10.2-4.5-16.6-9.6-16.6-15V155h54v50.8h61.6v-50.3l115.6.1v50.2h61.6V155zm19.5-19.4h-92.9v50.7h-23.8v-50h-19.3l-115-.1H320v50.1h-23.8v-50.7h-92.7v135.1c0 15.3 12.4 24.4 21.3 29.3l22.8 49.5.3.8.4.8c1.5 2.7 3.5 5.2 5.7 7.5l-7.3 161.1a191.2 191.2 0 0 0-45.4 20.6c-12.9 8.4-28.1 22.6-28.1 41.8v61.2c0 18 13.5 30.6 24.8 37.8 12 7.7 28.5 14.4 49.4 20 40.4 10.9 94 16.8 151 16.8 57.7 0 112.1-6 153.1-16.8a183.8 183.8 0 0 0 50.1-20c11.6-7.2 25.4-19.8 25.4-37.9l.1-58.2.1-3c0-8.6-3.1-17.1-9.2-24.9a76 76 0 0 0-19.5-17.2 192.4 192.4 0 0 0-46.4-20.7l-6.9-159.5c2.7-2.5 4.9-5.1 6.7-7.8l1-1.4.6-1.5 22.1-52.1c12.1-8.6 14.7-18.8 14.7-26.1V135.6z\"/><g fill=\"none\" stroke=\"#f2f2f2\" stroke-linecap=\"round\" stroke-miterlimit=\"10\"><path stroke-linejoin=\"round\" stroke-width=\"16.1\" d=\"M606.1 586.6c-8.9 28.4-96.9 50.8-205.4 50.8-114.5 0-208.3-25.1-208.3-55.6\"/><path stroke-width=\"13\" d=\"M534.3 541.2c0 19.7-60.9 33.9-134.4 33.9h.1c-73.4 0-134.4-14.3-134.4-33.9l6.5-190.7\"/><path stroke-width=\"10.8\" d=\"M534.6 341.3C525.2 357.9 472.9 370 400 370h.1c-72.9 0-125.3-12.1-134.7-28.6l-24.5-54.5\"/><path stroke-width=\"15.1\" d=\"M572.8 270.6V154h-57.2v50.8H454v-49.1l-115.6-.1v49.2h-61.6V154H224v116.6c0 20.1 81.5 36.4 175.3 36.4 93.7 0 173.5-16.2 173.5-36.4z\"/></g></svg>","bB":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 800\"><path d=\"M237.8 702.4c-42 0-77.3-14.9-102.2-43-23-25.9-35.6-62.3-35.6-102.5 0-59.2 41.5-73.3 77.5-79.1l16.4-2.6-5 15.8a213 213 0 0 0-10.2 61.2c0 54 24.4 87.6 63.6 87.6 29.2 0 56.6-23.8 70.7-60.2a157.1 157.1 0 0 1-29.1-8.4c-13.4-5.6-20.1-13-20.5-21.8l-7-55.7v-.6c0-9.1 5.6-15.6 12.9-20.5l-5.1-13.5c-16.6-44.9-37.3-100.9-37.3-143.7 0-50.4 22.1-95.4 62.4-126.9 10.9-15.3 27.2-32 48.5-49.7 17.8-14.8 38-29.3 56.9-40.9l5.4-3.2 5.4 3.2c36.1 22.1 82.4 58.6 105.4 90.7a157.9 157.9 0 0 1 62.5 126.5c0 43.1-20.7 99.5-37.5 144.7l-4.4 12.7c7.2 5 13.3 11.4 13.3 20.5v.6l-7.6 55.6c-.6 13.7-17.1 23.7-50 30.3 14.1 36.4 41.5 60.2 70.6 60.2 39.2 0 63.5-33.6 63.5-87.6 0-18.4-3.7-40.7-10.2-61.2l-5-15.8 16.3 2.6c25.3 4 42.8 10.9 55.2 21.7 15 13.2 22.4 32 22.4 57.3 0 40.2-12.6 76.6-35.6 102.5-24.8 28.1-60.3 43-102.2 43-65.6 0-118.8-45.1-137.8-115.7a653 653 0 0 1-48.8 0c-18.9 70.7-72.3 115.9-137.8 115.9\"/><path d=\"M400 106.5c33.5 20.5 80.6 56.7 103.2 89.2A147.2 147.2 0 0 1 563 315c0 48.3-28.5 117.6-44.4 161.9 9.7 5.4 15.2 10.2 15.2 16.2l-7.2 55.4c0 9.5-21 17.9-53.1 23.1 13.2 44.7 45.9 78.4 84.2 78.4 45.7 0 73.9-38.9 73.9-97.8 0-20-4-43.3-10.7-64.3 41.5 6.6 68.9 21.9 68.9 68.9 0 75-45.6 135.2-127.5 135.2-62 0-113.6-43.6-129.9-116.1a560.9 560.9 0 0 1-64.8 0c-16.3 72.5-68 116.1-130 116.1-82 0-127.5-60.3-127.5-135.2 0-47 27.4-62.4 68.9-68.9-6.6 21-10.7 44.4-10.7 64.3 0 59 28.1 97.8 73.9 97.8 38.3 0 71.1-33.7 84.2-78.4-32.2-5.2-53.1-13.5-53.1-23L266 493c0-5.9 5.5-10.8 15.2-16.2-15.8-44.3-44.4-113.3-44.4-161.6 0-51 23.9-92.2 59.7-119.7 22.9-32.4 70-68.4 103.5-89m0-24L389.3 89c-34 20.8-82 57.1-107.6 92.1a168.1 168.1 0 0 0-65.2 134c0 44.7 21.1 101.6 37.9 147.3l2.4 6.5a32.7 32.7 0 0 0-11.2 24.1v1.3l.2 1.3 7.1 54.8c.3 5.7 2.7 13.4 10.6 20.4 4.2 3.8 9.5 6.9 16.4 9.8 5.3 2.3 11.6 4.3 18.6 6.2a96.8 96.8 0 0 1-18.9 26c-8 7.7-21 16.7-37.4 16.7a44.7 44.7 0 0 1-37.6-18.6c-10.3-13.8-15.7-34.1-15.7-58.8 0-17.4 3.6-38.6 9.7-58.1l9.9-31.6-32.7 5.2c-37 5.8-86.2 21.5-86.2 89.2 0 21.1 3.2 41 9.5 59.4 6.5 19 16.2 35.7 28.7 49.9 26.9 30.3 64.9 46.4 109.8 46.4 67.9 0 123.4-44.7 145.5-115.5l16.8.2 16.8-.2c21.9 70.7 77.5 115.5 145.5 115.5 45 0 82.9-16.1 109.8-46.4a147.5 147.5 0 0 0 28.7-49.9c6.3-18.4 9.5-38.3 9.5-59.4 0-67.7-49.1-83.4-86.2-89.2l-32.7-5.2 9.9 31.6c6.2 19.5 9.7 40.7 9.7 58.1 0 24.6-5.4 44.9-15.7 58.8a44.7 44.7 0 0 1-37.6 18.6 55.5 55.5 0 0 1-37.4-16.7c-7.2-7-13.7-15.9-18.9-26a128 128 0 0 0 18.7-6.2 60.4 60.4 0 0 0 16.4-9.9 29.8 29.8 0 0 0 10.6-20.4l7.1-54.5.1-1.3v-1.4c0-10.6-5.2-18.4-11.1-24 .6-1.9 1.4-3.9 2.2-5.8 17-46 38-103.4 38-148.3 0-52.9-23.1-100.2-65.2-133.6A277.9 277.9 0 0 0 469 131a534.5 534.5 0 0 0-58.1-41.9z\"/><g fill=\"none\" stroke=\"#f2f2f2\" stroke-miterlimit=\"10\"><g stroke-width=\"15.1\"><g stroke-linecap=\"round\"><path d=\"m526.7 548.5 7.2-55.7c0-19.7-58.9-35.2-133.9-35.2-75.1 0-133.9 15.7-133.9 35.2l7.2 55.7\"/><path d=\"M273.4 548.5c0-15.7 56.7-28.4 126.7-28.4s126.7 12.7 126.7 28.4\"/><path d=\"M169.8 491.2c-35.2 6.3-58.5 21.1-58.5 66.2 0 72 38.8 126.7 108.3 126.7 63.3 0 113.9-59.6 114.8-156.2m295.7-36.7c35.2 6.3 58.5 21.1 58.5 66.2 0 72-38.8 126.7-108.3 126.7-63.3 0-113.9-59.6-114.8-156.2\"/></g><path d=\"M518.7 476.2c15.8-44.7 44.4-113.3 44.4-161.6 0-51-23.9-92.1-59.7-119.7-22.7-32.4-69.9-69-103.2-89.5-33.5 20.5-80.6 57.1-103.2 89.5a147.6 147.6 0 0 0-59.7 119.7c0 48.3 28.6 116.9 44.4 161.6\"/></g><path stroke-width=\"17.3\" d=\"M398.9 211.2v184.7m-69.1-94h140.4\"/></g></svg>","bN":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 800\"><path d=\"M137.8 605.9c8-43 28.9-151 43.3-212v-40l.5-1.6c13.9-41.9 33.6-85.5 44.1-109l2.6-5.7c-11.9-19-15.2-45.7-18.4-69.4-1.3-9.9-2.5-19.3-4.2-27.3l-2.9-13.7 14 .8a106.4 106.4 0 0 1 83.6 51.9c-5.9-21.6-.9-49.4 14.4-72.1l5.8-8.7 9.4 4.8a81 81 0 0 1 42.6 68.7c10.7-1.1 21.2-1.6 31.1-1.6 16.7 0 32 1.5 45.3 4.5 53 12 139.4 55 200.9 99.9l4.4 3.2v428.3H334.8L350 689c66.7-78.1 102.1-153 102.1-216.9 0-22-3.9-43.7-11.1-63.5 1.4 21.1-1 41.3-7.5 59.1-12.6 34.9-49.1 55.3-70.8 64.7a508.8 508.8 0 0 0-61.3 74l-25.9 67.4-139.1-59.3z\"/><path fill=\"#f2f2f2\" d=\"M177.4 578.1c19.4-10.9 33.9 3.8 22.4 25.2zm51.6-217c-6.9 9.5-.6 29.3 6 34.5a50 50 0 0 0 18.6-8l21.5-24.9-4.5-3.7c-8.7-.1-30.7-.1-41.6 2.1m90.8-160.8.6-2.9c31.1-5.1 73-6 97.3-6 45.7 0 148 58.8 209.5 104.1v55.1c-45-43.5-141.2-118.8-196.3-135.8a335.3 335.3 0 0 0-111.1-14.5\"/></svg>","bP":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 800\"><path d=\"M489.3 418.3c.1-17 12-25.1 65.1-29.9V330h-90.7c32-19.5 52.8-53.5 52.8-92.9 0-61.9-51.3-110.4-116.7-110.4s-116.7 48.5-116.7 110.4a108 108 0 0 0 52.8 92.9h-91.4v58.4c53.7 4.8 65.2 12.9 65.2 29.8 0 60.7-37.6 131.5-115.5 200.1l.1 64c0 18.6 93.2 32 205.3 32s205.4-13.5 205.4-32l.1-64c-77.9-68.5-115.8-139.4-115.8-200\"/><path fill=\"none\" stroke=\"#f2f2f2\" stroke-linecap=\"round\" stroke-miterlimit=\"10\" stroke-width=\"19.4\" d=\"M232.1 627.2c0 13.7 76 25.7 167.6 25.7 91.5 0 167.4-11 167.4-24.6\"/><path fill=\"none\" stroke=\"#f2f2f2\" stroke-linecap=\"round\" stroke-miterlimit=\"10\" stroke-width=\"16.2\" d=\"M400.9 150.3c-24-.2-47.6 8.6-66.3 27.3a87.5 87.5 0 0 0-20 95.3\"/></svg>"}};
// Piece sets come from the Lichess open-source repo (public/piece), see credits in Settings.
const PSETS = { classic: { name: 'Symbols' }, cburnett: { name: 'Cburnett' }, chessnut: { name: 'Chessnut' } };
(function buildPieceCss() {
  let css = '';
  for (const [set, m] of Object.entries(PIECE_SVG))
    for (const [k, svg] of Object.entries(m))
      css += `.ps-${set} .pc-${k}{background-image:url("data:image/svg+xml,${encodeURIComponent(svg)}")}`;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
})();
const pkey = p => p[0] + p[1].toUpperCase();   // 'wn' -> 'wN'
function pieceHTML(p, rot, spin) {
  const r = (rot ? ' rot' : '') + (spin ? ' tw' : '');
  return opts.pieces === 'classic'
    ? `<span class="gp ${p[0]}${r}">${GLYPH[p[1]]}</span>`
    : `<span class="pimg pc-${pkey(p)}${r}"></span>`;
}
const opts = { autoFlip: false, flipPieces: false, showEval: false, pieces: 'cburnett', theme: 'green' };
try { Object.assign(opts, JSON.parse(localStorage.getItem('chessy.opts') || '{}')); } catch (e) {}
if (!THEMES[opts.theme]) opts.theme = 'green';
if (!PSETS[opts.pieces]) opts.pieces = 'cburnett';
const saveOpts = () => { try { localStorage.setItem('chessy.opts', JSON.stringify(opts)); } catch (e) {} };

const G = { s: null, legal: [], sel: -1, score: 0, last: null, anim: false, over: false, paused: false, hold: false,
            pending: null, tc: null, clk: { w: 0, b: 0 }, tick: 0, moves: 0, seen: {}, flipped: false, unlimited: false,
            hist: [], hi: 0, res: null };
const posKey = s => s.b.map(p => p || '..').join('') + s.turn + s.cast.wK + s.cast.wQ + s.cast.bK + s.cast.bQ + s.ep;

function fmt(ms) {
  if (ms < 10000) return (Math.max(ms, 0) / 1000).toFixed(1);
  const t = Math.ceil(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// Random Guest avatars: a chess piece portrait on a colored background
const AV_BG = ['#7aa2d6', '#e0a458', '#8bc48a', '#c98bb9', '#d97b6c', '#6cc4c0', '#b8a1e3', '#e3c76f'];
function pickAvatars() {
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const make = (notK, notBg) => {
    let k, bg;
    do { k = pick(['w', 'b']) + pick(['K', 'Q', 'R', 'B', 'N', 'P']); } while (k === notK);
    do { bg = pick(AV_BG); } while (bg === notBg);
    return { k, bg };
  };
  const w = make(), b = make(w.k, w.bg);
  return { w, b };
}
// pieces of the OPPOSITE colour that are missing from the board = captured by `col`; biggest first
const CAP_ORDER = ['q', 'r', 'b', 'n', 'p'], CAP_START = { p: 8, n: 2, b: 2, r: 2, q: 1 };
function capturedHTML(col, cnt) {
  const opp = col === 'w' ? 'b' : 'w';
  let html = '';
  for (const t of CAP_ORDER) {
    const n = Math.max(0, CAP_START[t] - cnt[opp][t]);   // a promotion can't give a negative count
    if (!n) continue;
    const one = opts.pieces === 'classic'
      ? `<span class="cp gp ${opp}${opp === 'b' ? ' cb' : ''}">${GLYPH[t]}</span>`
      : `<span class="cp pimg${opp === 'b' ? ' cb' : ''} pc-${opp}${t.toUpperCase()}"></span>`;
    html += `<span class="cgrp">${one.repeat(n)}</span>`;
  }
  const lead = col === 'w' ? G.score : -G.score;           // only the side that is ahead gets a number
  if (lead > 0) html += `<span class="pscore">+${lead}</span>`;
  return html;
}
function setBar(el, col, cnt) {
  const name = G.net ? (col === G.net.color ? G.net.me : G.net.opponent) : 'Guest';
  const av = G.av[col];
  el.innerHTML = `
    <div class="avatar ps-cburnett" style="background:${av.bg}" aria-hidden="true"><span class="pimg pc-${av.k}"></span></div>
    <div class="pinfo">
      <div class="prow">
        <span class="pnm"><span class="pname"></span><span class="pelo">${G.net ? '' : '(???)'}</span></span>
        <span class="pcap" aria-label="Captured pieces">${capturedHTML(col, cnt)}</span>
      </div>
      <span class="pside">${SIDE[col]}</span>
    </div>
    <div class="clock" data-c="${col}" aria-label="${SIDE[col]} clock">0:00</div>`;
    el.querySelector('.pname').textContent = name;
}
function renderBars() {
  const bottom = G.flipped ? 'b' : 'w';
  const cnt = countPieces(G.s.b);
  setBar($('botBar'), bottom, cnt);
  setBar($('topBar'), bottom === 'w' ? 'b' : 'w', cnt);
}
function updateClocks() {
  if (!G.s) return;
  gameScreen.querySelectorAll('.clock').forEach(el => {
    const c = el.dataset.c;
    const running = !G.over && !G.paused && G.moves >= 2 && !G.unlimited && G.s.turn === c;
    el.textContent = G.unlimited ? '∞' : fmt(G.clk[c]);
    el.classList.toggle('active', running);
    el.classList.toggle('turn', !G.over && G.s.turn === c);
    el.classList.toggle('low', !G.unlimited && G.clk[c] < 10000);
  });
  syncHist();
}

function render() {
  const b = G.s.b;
  const chkSq = inCheck(G.s) ? kingSq(b, G.s.turn) : -1
  const rotAll = opts.flipPieces && !G.net && G.s.turn === 'b';
  const targets = new Set(G.sel >= 0 ? G.legal.filter(m => m.from === G.sel).map(m => m.to) : []);
  let html = '';
  for (let i = 0; i < 64; i++) {
    const sq = G.flipped ? 63 - i : i, r = sq >> 3, c = sq & 7, p = b[sq];
    let cls = 'gsq ' + ((r + c) % 2 === 0 ? 'l' : 'd');
    if (G.last && (sq === G.last.from || sq === G.last.to)) cls += ' last';
    if (sq === G.sel) cls += ' sel';
    if (sq === chkSq) cls += ' chk';
    if (targets.has(sq)) cls += p ? ' hint cap' : ' hint';
    if (G.anim && G.last && sq === G.last.to) cls += ' pop';
    let inner = '';
    if (i % 8 === 0) inner += `<span class="coord rk">${8 - r}</span>`;
    if (i >= 56) inner += `<span class="coord fl">${FILES_[c]}</span>`;
    if (p) inner += pieceHTML(p, rotAll, opts.flipPieces && !G.net && G.anim);   // every piece turns 180° while Black is to move
    html += `<div class="${cls}" data-sq="${sq}">${inner}</div>`;
  }
  $('gsq').innerHTML = html;
  G.anim = false;
}

function applyFlip() {
  if (!G.over) G.flipped = opts.autoFlip && G.s.turn === 'b';   // after the game ends the board stays as it is
}
function refreshAll() { renderBars(); updateEval(); fitBoard(); render(); updateClocks(); }

/* The board takes the largest square that fits between the player bars (nicknames) and the bottom menu.
   Everything inside scales with --bs (pieces, coordinates, bars, promotion buttons). */
const gMain = gameScreen.querySelector('.g-main');
function fitBoard() {
  if (gameScreen.hidden) return;
  const cs = getComputedStyle(gMain);
  const evSpace = opts.showEval ? 2 * (parseFloat(cs.getPropertyValue('--ev-w')) + parseFloat(cs.getPropertyValue('--ev-gap')) + 6) : 0;
  const w = gMain.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - evSpace;
  const h = gMain.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
          - $('topBar').offsetHeight - $('botBar').offsetHeight;
  const bs = Math.floor(Math.min(w, h));
  if (bs > 0) gameScreen.style.setProperty('--bs', bs + 'px');
}
// refit whenever anything that decides the free space changes (screen shown, window resized, a bar's height changed
// e.g. after a web font arrives), so the board has its final size before the first move and never jumps later
const fitRO = new ResizeObserver(fitBoard);
[gMain, $('topBar'), $('botBar')].forEach(el => fitRO.observe(el));
addEventListener('resize', fitBoard);
addEventListener('orientationchange', fitBoard);
if (document.fonts) { document.fonts.ready.then(fitBoard); document.fonts.addEventListener('loadingdone', fitBoard); }

// crude material-only bar for now (tanh squashes the score into 0..100%), to be replaced by a real evaluation later
function updateEval() {
  const bar = $('evalBar');
  bar.hidden = !(opts.showEval && G.s);
  if (bar.hidden) return;
  const sc = G.score, white = 50 + 50 * Math.tanh(sc / 6);
  $('evFill').style.height = white.toFixed(1) + '%';
  bar.classList.toggle('flip', !!G.flipped);                 // White's end of the bar follows the board orientation
  bar.classList.toggle('lw', sc >= 0);
  bar.classList.toggle('lb', sc < 0);
  $('evNum').textContent = sc > 0 ? '+' + sc : sc < 0 ? '\u2212' + (-sc) : '0';
}

function syncPauseBtn() {
  const btn = $('gmPause');
  btn.querySelector('span').textContent = G.paused ? 'Resume' : 'Pause';
  btn.querySelector('svg').innerHTML = G.paused ? '<path d="M8 5l11 7-11 7z"/>' : '<path d="M8 5v14M16 5v14"/>';
}

function newGame() {
  const tc = G.tc;
  G.s = startState(); G.legal = legalMoves(G.s);
  G.sel = -1; G.last = null; G.anim = false; G.over = false; G.paused = false; G.hold = false; G.pending = null;
  scoreEvaluate();
  G.unlimited = tc.min === 0;
  G.clk = { w: tc.min * 60000, b: tc.min * 60000 };
  G.moves = 0; G.seen = {}; G.seen[posKey(G.s)] = 1;
  G.res = null; G.hist = [snapshot(null)]; G.hi = 0;
  G.flipped = false; G.tick = performance.now();
  G.av = pickAvatars();
  ['promoOv', 'resultOv', 'pauseOv'].forEach(id => { $(id).hidden = true; });
  syncPauseBtn(); refreshAll();
}
function startGame(tc) {
  G.tc = tc;
  timeScreen.hidden = true; gameScreen.hidden = false; lockScroll();
  applyTheme(); applyPieces(); newGame();
}

function endGame(title, sub) {
  G.over = true; G.paused = false; G.res = { title, sub };
  $('resTitle').textContent = title; $('resSub').textContent = sub;
  $('resultOv').hidden = false;
  syncPauseBtn();
}

/* ---------- Undo / Redo ---------- */
// snapshot of the position right after a move; bonus = increment that move gave its author (taken back on undo)
function snapshot(bonus) {
  return { s: G.s, last: G.last, moves: G.moves, seen: Object.assign({}, G.seen),
           res: G.over ? G.res : null, bonus };
}
// a game that ended on the clock can't be rewound (the flag has fallen); a game ended by a move (mate, draw) can
const histOpen = () => !!G.s && !G.paused && !(G.over && !(G.hist[G.hi] && G.hist[G.hi].res));
const canUndo = () => histOpen() && G.hi > 0;
const canRedo = () => histOpen() && G.hi < G.hist.length - 1;
function syncHist() {
  $('gmUndo').disabled = !canUndo();
  $('gmRedo').disabled = !canRedo();
}
function gotoHist(i) {
  const from = G.hist[G.hi], to = G.hist[i];
  // the increment follows the move: removed when it is undone, restored when it is redone
  if (i < G.hi && from.bonus) G.clk[from.bonus.c] -= from.bonus.ms;
  if (i > G.hi && to.bonus) G.clk[to.bonus.c] += to.bonus.ms;
  G.hi = i;
  G.s = to.s; G.legal = legalMoves(to.s); G.last = to.last; G.moves = to.moves;
  scoreEvaluate();
  G.seen = Object.assign({}, to.seen);
  G.sel = -1; G.pending = null; $('promoOv').hidden = true;
  G.over = !!to.res; G.res = to.res;
  if (to.res) { $('resTitle').textContent = to.res.title; $('resSub').textContent = to.res.sub; }
  $('resultOv').hidden = !to.res;
  G.anim = !!to.last;
  G.tick = performance.now();
  applyFlip();
  refreshAll();
}
function undoMove() { tick(); if (canUndo()) gotoHist(G.hi - 1); }
function redoMove() { tick(); if (canRedo()) gotoHist(G.hi + 1); }
$('gmUndo').addEventListener('click', undoMove);
$('gmRedo').addEventListener('click', redoMove);
document.addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (gameScreen.hidden || gSet.open || dlg.open || menuOpen()) return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  e.preventDefault();
  e.key === 'ArrowLeft' ? undoMove() : redoMove();
});

const PROMO_NAME = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };

/*$('promoBtns').addEventListener('click', e => {
  const b = e.target.closest('.pbtn');
  const m = b && G.pending && G.pending.find(x => x.promo === b.dataset.p);
  if (m) doMove(m);
});
$('promoOv').addEventListener('click', e => {
  if (e.target === $('promoOv')) { G.pending = null; $('promoOv').hidden = true; }
});*/

// { w: {p,n,b,r,q,k}, b: {...}, total: N } for a board array
function countPieces(b) {
  const z = () => ({ p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 });
  const res = { w: z(), b: z(), total: 0 };
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p) continue;
    res[p[0]][p[1]]++;
    res.total++;
  }
  return res;
}

// G.score > 0: White is ahead, < 0: Black is ahead (white material minus black material)
function scoreEvaluate() {
  const res = countPieces(G.s.b);
  let scoreEvaluation = 0;
  for (const t in PIECE_VALUE)                       // p, n, b, r, q, k
    scoreEvaluation += (res.w[t] - res.b[t]) * PIECE_VALUE[t];   //TODO optimize this part O(N^2) when you'll be writing a chess bot engine
  G.score = scoreEvaluation;
  return scoreEvaluation;   // without this `G.score = scoreEvaluate()` in doMove would overwrite the score with undefined
}

const move = m => (G.net ? netMove(m) : doMove(m));   // netMove lives in client.js
function doMove(m) {
  tick();
  if (G.over) return;
  const mover = G.s.turn, next = applyMove(G.s, m);
  // the clocks start once both players have made their first move; the bonus is added after each later move
  const bonus = (!G.unlimited && G.moves >= 2) ? G.tc.inc * 1000 : 0;
  G.clk[mover] += bonus;
  G.moves++;
  G.s = next; G.last = { from: m.from, to: m.to }; G.anim = true;
  G.score = scoreEvaluate();
  G.sel = -1; G.pending = null; $('promoOv').hidden = true;
  const key = posKey(next);
  G.seen[key] = (G.seen[key] || 0) + 1;
  G.legal = legalMoves(next);
  G.tick = performance.now();
  if (!G.legal.length) {
    if (inCheck(next)) endGame(SIDE[mover] + ' wins', 'Checkmate');
    else endGame('Draw', 'Stalemate');
  } else if (insufficient(next.b)) endGame('Draw', 'Insufficient material');
  else if (next.half >= 100) endGame('Draw', 'Fifty-move rule');
  else if (G.seen[key] >= 3) endGame('Draw', 'Threefold repetition');
  G.hist.length = G.hi + 1;                       // a new move cuts off the redo branch
  G.hist.push(snapshot({ c: mover, ms: bonus }));
  G.hi = G.hist.length - 1;
  applyFlip();
  refreshAll();
}

function onSquare(sq) {
  if (G.over || G.paused || G.pending || !canAct()) return;
  if (G.sel >= 0) {
    const cands = G.legal.filter(m => m.from === G.sel && m.to === sq);
    if (cands.length) { cands.length > 1 ? askPromo(cands) : move(cands[0]); return; }
  }
  const p = G.s.b[sq];
  G.sel = (p && p[0] === G.s.turn && sq !== G.sel) ? sq : -1;
  render();
}
/* ---------- Drag & drop ---------- */
// Hold the left button on your piece, move it with the cursor, release on a square it can go to.
// Dropping anywhere else puts the piece back (it stays selected). Click-to-move still works.
const gsqEl = $('gsq');
const DRAG_PX = 4;          // movement below this counts as a plain click
let drag = null, swallowClick = false;

function sqAt(x, y) {       // board square under the point, -1 outside the board
  const r = gsqEl.getBoundingClientRect();
  if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return -1;
  const i = Math.floor((y - r.top) / r.height * 8) * 8 + Math.floor((x - r.left) / r.width * 8);
  return G.flipped ? 63 - i : i;
}
function moveGhost(x, y) {
  // the 180° turn lives inside transform: the CSS `rotate` property is applied outside of it and would mirror the translate off-screen
  drag.ghost.style.transform = `translate(${x - drag.half}px, ${y - drag.half}px) ${drag.rot ? 'rotate(180deg) ' : ''}scale(1.1)`;
}
function endDrag() {
  if (!drag) return;
  drag.ghost.remove();
  drag.src.classList.remove('drag-src');
  gsqEl.style.cursor = '';
  drag = null;
}

gsqEl.addEventListener('pointerdown', e => {
  if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
  if (!G.s || G.over || G.paused || G.pending || !canAct()) return;
  const d = e.target.closest('.gsq');
  if (!d) return;
  const sq = +d.dataset.sq, p = G.s.b[sq];
  if (!p || p[0] !== G.s.turn) return;           // only the side to move can pick up pieces
  const sqSize = d.getBoundingClientRect().width;  // measure before render() replaces the squares
  const wasSel = G.sel === sq;
  G.sel = sq; render();                          // selects the piece and shows its legal targets
  const src = gsqEl.querySelector(`.gsq[data-sq="${sq}"] .gp, .gsq[data-sq="${sq}"] .pimg`);
  const size = src.classList.contains('pimg') ? sqSize * .96 : sqSize;   // same size as the piece on the board
  const ghost = src.cloneNode(true);
  const rot = ghost.classList.contains('rot');   // pieces are turned 180° while Black is to move
  ghost.classList.remove('tw', 'rot');           // no turn animation, and no `rotate` property (see moveGhost)
  ghost.classList.add('drag-ghost');
  ghost.style.width = ghost.style.height = size + 'px';
  gameScreen.appendChild(ghost);
  src.classList.add('drag-src');
  drag = { from: sq, wasSel, src, ghost, rot, half: size / 2, x0: e.clientX, y0: e.clientY, moved: false, id: e.pointerId };
  gsqEl.setPointerCapture(e.pointerId);          // keep receiving events even outside the board
  gsqEl.style.cursor = 'grabbing';
  moveGhost(e.clientX, e.clientY);
  e.preventDefault();
});

gsqEl.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > DRAG_PX) drag.moved = true;
  moveGhost(e.clientX, e.clientY);
});

gsqEl.addEventListener('pointerup', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const { from, wasSel, moved } = drag;
  const to = sqAt(e.clientX, e.clientY);
  endDrag();
  swallowClick = true; setTimeout(() => { swallowClick = false; }, 50);
  if (G.over || G.paused || G.pending) return;   // the game state changed while dragging
  if (to === from || to < 0) {
    if (to === from && !moved && wasSel) { G.sel = -1; render(); }   // click on the selected piece = deselect
    return;
  }
  const cands = G.legal.filter(m => m.from === from && m.to === to);
  if (cands.length) cands.length > 1 ? askPromo(cands) : move(cands[0]);
});

gsqEl.addEventListener('pointercancel', endDrag);

gsqEl.addEventListener('click', e => {
  if (swallowClick) return;                      // the click that follows a drag / pick-up must not be handled twice
  const d = e.target.closest('.gsq');
  if (d) onSquare(+d.dataset.sq);
});

function askPromo(cands) {
  G.pending = cands;
  const col = G.s.turn;
  $('promoBtns').innerHTML = cands.map(m =>
    `<button type="button" class="pbtn ${col}" data-p="${m.promo}" aria-label="${PROMO_NAME[m.promo]}">${opts.pieces === 'classic' ? GLYPH[m.promo] : `<span class="pimg pc-${col}${m.promo.toUpperCase()}"></span>`}</button>`).join('');
  $('promoOv').hidden = false;
}
$('promoBtns').addEventListener('click', e => {
  const b = e.target.closest('.pbtn');
  const m = b && G.pending && G.pending.find(x => x.promo === b.dataset.p);
  if (m) move(m);
});
$('promoOv').addEventListener('click', e => {
  if (e.target === $('promoOv')) { G.pending = null; $('promoOv').hidden = true; }
});

/* ---------- Clocks ---------- */
function tick() {
  const now = performance.now(), dt = now - G.tick;
  G.tick = now;
  if (!G.s || G.over || G.paused || G.hold || G.unlimited || G.moves < 2) return;
  const c = G.s.turn;
  G.clk[c] -= dt;
  if (G.clk[c] <= 0) {
    G.clk[c] = 0;
    if (G.net) return;                 // online the server decides on time
    const w = c === 'w' ? 'b' : 'w';
    if (hasMating(G.s.b, w)) endGame(SIDE[w] + ' wins', SIDE[c] + ' ran out of time');
    else endGame('Draw', SIDE[c] + ' ran out of time, but ' + SIDE[w] + ' cannot checkmate');
  }
}
setInterval(() => {
  if (gameScreen.hidden) { G.tick = performance.now(); return; }
  tick(); updateClocks();
}, 100);

/* ---------- Game menu ---------- */
function confirmLoss(msg) { return G.over || G.moves === 0 || confirm(msg); }
function backToTimes() { gameScreen.hidden = true; timeScreen.hidden = false; lockScroll(); }

$('gmReturn').addEventListener('click', () => { if (confirmLoss('Leave this game? The current game will be lost.')) backToTimes(); });
$('gmRestart').addEventListener('click', () => { if (confirmLoss('Restart the game?')) newGame(); });
function togglePause() {
  if (G.over) return;
  tick();
  G.paused = !G.paused;
  $('pauseOv').hidden = !G.paused;
  if (!G.paused) G.tick = performance.now();
  syncPauseBtn(); updateClocks();
}
$('gmPause').addEventListener('click', togglePause);
$('resumeBtn').addEventListener('click', togglePause);
$('rematchBtn').addEventListener('click', newGame);
$('newTcBtn').addEventListener('click', backToTimes);
$('viewBoardBtn').addEventListener('click', () => { $('resultOv').hidden = true; });

/* ---------- Game settings ---------- */
const gSet = $('gSettings'), themeBtns = $('themeBtns');
themeBtns.innerHTML = Object.entries(THEMES).map(([k, t]) =>
  `<button type="button" class="theme-btn" data-t="${k}" style="--a:${t.l};--b:${t.d}"><span class="swatch"></span>${t.name}</button>`).join('');
function applyTheme() {
  const t = THEMES[opts.theme];
  gameScreen.style.setProperty('--gl', t.l);
  gameScreen.style.setProperty('--gd', t.d);
  themeBtns.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('sel', b.dataset.t === opts.theme));
}
applyTheme();
$('optFlip').checked = opts.autoFlip;
$('optRot').checked = opts.flipPieces;
$('optEval').checked = opts.showEval;

const setBtns = $('setBtns');
setBtns.innerHTML = Object.entries(PSETS).map(([k, st]) => `
  <button type="button" class="set-btn" data-s="${k}">
    <span class="prev ps-${k}">${k === 'classic'
      ? `<span class="pg w">${GLYPH.n}</span><span class="pg b">${GLYPH.n}</span>`
      : '<i class="pimg pc-wN"></i><i class="pimg pc-bN"></i>'}</span>${st.name}
  </button>`).join('');
function applyPieces() {
  Object.keys(PSETS).forEach(k => gameScreen.classList.remove('ps-' + k));
  gameScreen.classList.add('ps-' + opts.pieces);
  setBtns.querySelectorAll('.set-btn').forEach(b => b.classList.toggle('sel', b.dataset.s === opts.pieces));
}
applyPieces();
setBtns.addEventListener('click', e => {
  const b = e.target.closest('.set-btn');
  if (!b) return;
  opts.pieces = b.dataset.s; saveOpts(); applyPieces();
  if (G.s) { renderBars(); render(); updateClocks(); }
});
$('optRot').addEventListener('change', e => {
  opts.flipPieces = e.target.checked; saveOpts();
  if (G.s) render();
});
$('optEval').addEventListener('change', e => {
  opts.showEval = e.target.checked; saveOpts();
  if (G.s) refreshAll();                                      // shows/hides the bar and re-fits the board
});

$('gmSettings').addEventListener('click', () => { G.hold = true; $('optFlip').checked = opts.autoFlip; $('optRot').checked = opts.flipPieces; $('optEval').checked = opts.showEval; gSet.showModal(); });  // clock is held while settings are open
$('gsClose').addEventListener('click', () => gSet.close());
gSet.addEventListener('click', e => { if (e.target === gSet) gSet.close(); });
gSet.addEventListener('close', () => { G.hold = false; G.tick = performance.now(); });
$('optFlip').addEventListener('change', e => {
  opts.autoFlip = e.target.checked; saveOpts();
  if (G.s) { G.flipped = opts.autoFlip ? G.s.turn === 'b' : false; refreshAll(); }
});
themeBtns.addEventListener('click', e => {
  const b = e.target.closest('.theme-btn');
  if (!b) return;
  opts.theme = b.dataset.t; saveOpts(); applyTheme();
});

// TODO (backend stage): replace with fetch('/api/players?nick=' + encodeURIComponent(nick))
/*document.getElementById('searchForm').addEventListener('submit', e => {
  e.preventDefault();
  const nick = document.getElementById('nick').value.trim();
  statusEl.textContent = nick
    ? 'Player search isn’t connected yet. It arrives with the backend.'
    : 'Enter a nickname to search.';
});*/

/*function showInvitePopup(inviteId, from) {
  hideInvitePopup(inviteId);
  const box = document.createElement('div');
  box.id = `invite-${inviteId}`;
  box.className = 'invite';

  const text = document.createElement('span');
  text.textContent = `${from} is inviting you for a game`;

  const yes = document.createElement('button');
  yes.textContent = 'Accept';
  yes.addEventListener('click', () => {
    send({ type: 'invite_response', inviteId, accept: true });
    box.remove();
  });

  const no = document.createElement('button');
  no.textContent = 'Decline';
  no.addEventListener('click', () => {
    send({ type: 'invite_response', inviteId, accept: false });
    box.remove();
  });

  box.append(text, yes, no);
  document.body.append(box);
}

function hideInvitePopup(inviteId) {
  document.getElementById(`invite-${inviteId}`)?.remove();
}*/