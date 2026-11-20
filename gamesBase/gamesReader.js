/* games-reader.js — читает games.json и выдаёт партии по уникальному ID.
 *
 * Подключение:   <script src="games-reader.js"></script>
 * Использование: const reader = await GamesReader.load('games.json');
 *
 *   reader.IDs                      -> [1, 2, 3, … N]   (ID назначаются читателем по порядку в файле)
 *   reader.size                     -> N
 *   reader.has(id)                  -> true / false
 *   reader.get(id)                  -> { id, title, white, black, event, year, result, category, note,
 *                                        uci: ['e2e4', …], plies: [ply, …] }
 *   reader.randomID(min, max, excl) -> случайный существующий ID из [min, max], без excl (или null)
 *   reader.pickDistinct(n, excl)    -> n РАЗНЫХ случайных ID (меньше n, если партий не хватает)
 *   reader.freeIDs(busy)            -> все ID, кроме занятых
 *   reader.byCategory(cat)          -> ID партий категории 'historic' | 'miniature' | 'opening'
 *
 * Каждый ply (полуход) уже «разобран» под анимацию доски:
 *   { from:'e1', to:'g1', piece:'k', color:'w', capture:false,
 *     promo:null,            // 'q' | 'r' | 'b' | 'n' при превращении пешки
 *     castle:['h1','f1'],    // [откуда, куда] для ладьи при рокировке, иначе null
 *     enPassant:'e5' }       // поле взятой пешки при взятии на проходе, иначе null
 *
 * ID уникальны и стабильны, пока порядок партий в games.json не меняется — новые партии
 * дописывайте в КОНЕЦ файла.
 *
 * Если страница открыта прямо с диска (file://), fetch() блокируется браузером. Тогда читатель
 * берёт данные из window.CHESS_GAMES (файл games.js, см. ниже), если он подключён.
 */
(function (root) {
  'use strict';

  const FILES = 'abcdefgh';
  const sqName = (c, r) => FILES[c] + (r + 1);
  const colOf = sq => FILES.indexOf(sq[0]);
  const rowOf = sq => Number(sq[1]) - 1;

  function startPosition() {
    const map = {};
    const back = 'rnbqkbnr';
    for (let i = 0; i < 8; i++) {
      map[sqName(i, 0)] = { t: back[i], c: 'w' };
      map[sqName(i, 1)] = { t: 'p', c: 'w' };
      map[sqName(i, 6)] = { t: 'p', c: 'b' };
      map[sqName(i, 7)] = { t: back[i], c: 'b' };
    }
    return map;
  }

  /** 'e2e4 e7e5 …' или ['e2e4', …]  ->  массив ply-объектов (см. шапку файла). */
  function compileMoves(moves, label) {
    const list = Array.isArray(moves) ? moves : String(moves || '').trim().split(/\s+/).filter(Boolean);
    const board = startPosition();
    const plies = [];
    list.forEach((u, i) => {
      const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(u);
      if (!m) throw new Error(`${label}: ход №${i + 1} «${u}» не в формате UCI`);
      const [, from, to, promo] = m;
      const p = board[from];
      if (!p) throw new Error(`${label}: ход №${i + 1} «${u}» — на ${from} нет фигуры`);

      const ply = { from, to, piece: p.t, color: p.c, capture: !!board[to], promo: promo || null, castle: null, enPassant: null };

      // рокировка: король шагает на две клетки по горизонтали
      if (p.t === 'k' && Math.abs(colOf(to) - colOf(from)) === 2) {
        const r = rowOf(from), kingSide = colOf(to) > colOf(from);
        ply.castle = [sqName(kingSide ? 7 : 0, r), sqName(kingSide ? 5 : 3, r)];
      }
      // взятие на проходе: пешка уходит по диагонали на пустую клетку
      if (p.t === 'p' && from[0] !== to[0] && !board[to]) {
        ply.enPassant = to[0] + from[1];
        ply.capture = true;
      }

      // двигаем модель доски
      if (ply.castle) { board[ply.castle[1]] = board[ply.castle[0]]; delete board[ply.castle[0]]; }
      if (ply.enPassant) delete board[ply.enPassant];
      delete board[from];
      board[to] = promo ? { t: promo, c: p.c } : p;
      plies.push(ply);
    });
    return plies;
  }

  class GamesReader {
    constructor(rawGames) {
      this._byId = new Map();
      this._ids = [];
      rawGames.forEach((g, index) => {
        const id = index + 1;                                // уникальный ID = порядковый номер в файле
        const label = `партия #${id} «${g.title || '?'}»`;
        const uci = Array.isArray(g.moves) ? g.moves.slice() : String(g.moves || '').trim().split(/\s+/).filter(Boolean);
        this._byId.set(id, Object.freeze({
          id,
          title: g.title || `Game ${id}`,
          white: g.white || null,
          black: g.black || null,
          event: g.event || null,
          year: g.year || null,
          result: g.result || null,
          category: g.category || null,
          note: g.note || null,
          uci,
          plies: compileMoves(uci, label)
        }));
        this._ids.push(id);
      });
      this.IDs = Object.freeze(this._ids.slice());
    }

    /** Загружает games.json (или берёт window.CHESS_GAMES, если fetch недоступен). */
    static async load(url = 'games.json') {
      let data;
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        data = await res.json();
      } catch (err) {
        if (root.CHESS_GAMES) data = root.CHESS_GAMES;
        else throw new Error(`Не удалось загрузить ${url}: ${err.message}. ` +
          'Откройте сайт через http(s) (например, локальный сервер) или подключите games.js.');
      }
      return GamesReader.fromData(data);
    }

    static fromData(data) {
      const games = Array.isArray(data) ? data : data && data.games;
      if (!Array.isArray(games) || !games.length) throw new Error('В данных нет списка games');
      return new GamesReader(games);
    }

    get size() { return this._ids.length; }
    has(id) { return this._byId.has(Number(id)); }
    get(id) { return this._byId.get(Number(id)) || null; }

    byCategory(cat) { return this._ids.filter(id => this._byId.get(id).category === cat); }
    freeIDs(busy = []) { const b = new Set(busy.map(Number)); return this._ids.filter(id => !b.has(id)); }

    /** Случайный существующий ID в диапазоне [min, max], не входящий в exclude. null, если таких нет. */
    randomID(min = 1, max = this.size, exclude = []) {
      const ex = new Set(exclude.map(Number));
      const pool = this._ids.filter(id => id >= min && id <= max && !ex.has(id));
      return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    }

    /** n разных случайных ID (тасование Фишера—Йетса). */
    pickDistinct(n, exclude = []) {
      const pool = this.freeIDs(exclude);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return pool.slice(0, Math.max(0, n));
    }
  }

  GamesReader.compileMoves = compileMoves;
  root.GamesReader = GamesReader;
  if (typeof module !== 'undefined' && module.exports) module.exports = GamesReader;
})(typeof window !== 'undefined' ? window : globalThis);