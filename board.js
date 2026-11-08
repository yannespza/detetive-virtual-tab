// Tabuleiro: grade de 16 x 26 casas. Locais ocupam blocos 4x4.
export const COLS = 16, ROWS = 26;
export const RIVER_ROW = 16;
export const BRIDGES = [[3, 16], [10, 16]];

// Locais: rect = [x, y, largura, altura]; doors = casas de entrada (com seta)
export const LOCS = {
  sherlock:   { name: 'Casa de Sherlock Holmes', short: 'Sherlock', icon: '🔍', rect: [0, 0, 4, 3], doors: [[2, 3]], hue: '#5b4636' },
  bar:        { name: 'Bar',             icon: '🍺', rect: [5, 0, 4, 3],  doors: [[4, 1]],            hue: '#8a4b2a' },
  farmacia:   { name: 'Farmácia',        icon: '💊', rect: [10, 1, 3, 4], doors: [[9, 3]],            hue: '#2f7a6d' },
  scotland:   { name: 'Scotland Yard',   icon: '👮', rect: [13, 0, 3, 3], doors: [[14, 3]],           hue: '#2a3f6b' },
  museu:      { name: 'Museu',           icon: '🏛️', rect: [0, 5, 4, 5],  doors: [[4, 7], [2, 10]],   hue: '#6a5a8c' },
  penhores:   { name: 'Casa de Penhores', short: 'Penhores', icon: '💍', rect: [6, 5, 3, 3], doors: [[7, 8]], hue: '#9a6b2f' },
  teatro:     { name: 'Teatro',          icon: '🎭', rect: [11, 6, 5, 4], doors: [[10, 8]],           hue: '#8c2f3f' },
  parque:     { name: 'Parque',          icon: '🌳', rect: [5, 10, 4, 4], doors: [[4, 11], [9, 12]],  hue: '#3d7a3a' },
  livraria:   { name: 'Livraria',        icon: '📚', rect: [0, 12, 3, 4], doors: [[3, 14]],           hue: '#4a6a8c' },
  banco:      { name: 'Banco',           icon: '🏦', rect: [11, 11, 5, 3], doors: [[13, 14]],         hue: '#7a6a2a' },
  docas:      { name: 'Docas',           icon: '⚓', rect: [5, 17, 5, 4], doors: [[4, 19]],           hue: '#2f5a7a' },
  charutaria: { name: 'Charutaria',      icon: '🚬', rect: [11, 17, 3, 3], doors: [[10, 18]],         hue: '#6b3f2a' },
  chaveiro:   { name: 'Chaveiro',        icon: '🔑', rect: [0, 18, 3, 3], doors: [[1, 17]],           hue: '#8c6a2f' },
  hotel:      { name: 'Hotel',           icon: '🏨', rect: [5, 22, 5, 3], doors: [[4, 23], [10, 23]], hue: '#7a2f5a' },
  estacao:    { name: 'Estação de Carruagens', short: 'Estação', icon: '🐎', rect: [12, 21, 4, 4], doors: [[13, 20]], hue: '#5a6b2a' },
};
// áreas decorativas onde não se anda (telhados, jardins, cais)
export const DECOR = [
  { rect: [0, 22, 3, 3], icon: '🏚️' },
  { rect: [14, 17, 2, 3], icon: '🌫️' },
  { rect: [6, 3, 2, 1], icon: '' },
  { rect: [5, 15, 4, 1], icon: '' },
  { rect: [12, 15, 4, 1], icon: '' },
  { rect: [15, 4, 1, 2], icon: '' },
];

// os 14 locais com pista (na ordem da caderneta)
export const CLUE_LOCS = ['farmacia', 'banco', 'docas', 'hotel', 'chaveiro', 'museu', 'charutaria',
  'parque', 'teatro', 'bar', 'livraria', 'penhores', 'estacao', 'scotland'];
export const UNSEALABLE = ['sherlock', 'scotland', 'chaveiro'];

export const key = (x, y) => x + ',' + y;
const inRect = (x, y, [rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh;

export function locAt(x, y) {
  for (const [id, l] of Object.entries(LOCS)) if (inRect(x, y, l.rect)) return id;
  return null;
}
export function isBridge(x, y) { return BRIDGES.some(([bx, by]) => bx === x && by === y); }
export function decorAt(x, y) { return DECOR.find((d) => inRect(x, y, d.rect)); }
export function isPath(x, y) {
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return false;
  if (y === RIVER_ROW) return isBridge(x, y);
  return !locAt(x, y) && !decorAt(x, y);
}
export function doorDir(loc, i) { // direção da seta (para dentro do local)
  const [dx, dy] = LOCS[loc].doors[i];
  const [rx, ry, rw, rh] = LOCS[loc].rect;
  if (dy === ry - 1) return 'down';
  if (dy === ry + rh) return 'up';
  if (dx === rx - 1) return 'right';
  return 'left';
}
export const doorId = (loc, i) => loc + ':' + i;

// Calcula os destinos possíveis com até `steps` passos.
// from: {loc} ou {cell:[x,y]}; occupied: Set de casas ocupadas por outros peões
export function reachable({ from, steps, occupied, me, seals, hasKey }) {
  const dist = new Map(), parent = new Map();
  const queue = [];
  const sealedByOther = (loc, i) => { const o = seals[doorId(loc, i)]; return o && o !== me; };
  if (from.loc) {
    LOCS[from.loc].doors.forEach(([x, y], i) => {
      if (sealedByOther(from.loc, i)) return;
      const k = key(x, y);
      if (!dist.has(k) && steps >= 1) { dist.set(k, 1); parent.set(k, null); queue.push([x, y]); }
    });
  } else {
    const [x, y] = from.cell; const k = key(x, y);
    dist.set(k, 0); parent.set(k, null); queue.push([x, y]);
  }
  while (queue.length) {
    const [x, y] = queue.shift(); const d = dist.get(key(x, y));
    if (d >= steps) continue;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (!isPath(nx, ny)) continue;
      const k = key(nx, ny);
      if (dist.has(k)) continue;
      dist.set(k, d + 1); parent.set(k, key(x, y)); queue.push([nx, ny]);
    }
  }
  const pathTo = (k) => { const p = []; while (k) { p.unshift(k.split(',').map(Number)); k = parent.get(k); } return p; };
  const cells = new Map();
  for (const [k, d] of dist) if (d >= 1 && !occupied.has(k)) cells.set(k, { dist: d, path: pathTo(k) });
  const locs = new Map();
  for (const [id, l] of Object.entries(LOCS)) {
    if (from.loc === id) continue;
    let best = null;
    l.doors.forEach(([x, y], i) => {
      const k = key(x, y); if (!dist.has(k)) return;
      const blocked = sealedByOther(id, i);
      if (blocked && !hasKey) return;
      const cand = { door: i, useKey: !!blocked, dist: dist.get(k), path: pathTo(k) };
      if (!best || (best.useKey && !cand.useKey) || (best.useKey === cand.useKey && cand.dist < best.dist)) best = cand;
    });
    if (best) locs.set(id, best);
  }
  return { cells, locs };
}
