import { COLS, ROWS, RIVER_ROW, LOCS, DECOR, CLUE_LOCS, UNSEALABLE, key, isPath, isBridge, locAt, doorDir, doorId, reachable } from './board.js';
import Sound from './sound.js';

const api = window.__API__ || (await import('./api.js')).default;

const COLORS = [
  { id: '#d64545', name: 'Vermelho' }, { id: '#3b6fd6', name: 'Azul' }, { id: '#3fa45b', name: 'Verde' },
  { id: '#e3b52b', name: 'Amarelo' }, { id: '#8a4fd1', name: 'Roxo' }, { id: '#e07a2e', name: 'Laranja' },
];
const S = {
  uid: null, room: null, cases: [], nb: null, unsub: null,
  seenMove: null, seenRoll: null, animating: new Set(), rolling: null,
  reach: null, reachVer: null, cs: 22, solutionShown: false, busy: false,
};
const $ = (s, el = document) => el.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));
const rnd6 = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return (a[0] % 6) + 1; };

// ---------- utilidades de estado ----------
const st = () => S.room?.state || {};
const players = () => st().players || [];
const player = (id) => players().find((p) => p.id === id);
const nameOf = (id) => player(id)?.name || '?';
const colorOf = (id) => player(id)?.color || '#999';
const caseOf = (id) => S.cases.find((c) => c.id === id);
const currentId = () => (st().order ? st().order[st().turn.idx] : null);
const isHost = () => S.room?.host === S.uid;
const myTurn = () => S.room?.status === 'playing' && currentId() === S.uid;
const locName = (l) => LOCS[l]?.name || l;

function log(s, msg) { s.log = s.log || []; s.log.push({ t: Date.now(), msg }); if (s.log.length > 40) s.log.shift(); }

function toast(msg, ms = 2600) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

// ---------- modais ----------
function modal({ title, html = '', buttons = [], cls = '', dismiss = true }) {
  closeModal();
  const wrap = document.createElement('div'); wrap.className = 'modal-wrap'; wrap.id = 'modal';
  wrap.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">
    ${title ? `<h2>${title}</h2>` : ''}<div class="modal-body">${html}</div>
    <div class="modal-actions"></div></div>`;
  const act = $('.modal-actions', wrap);
  buttons.forEach((b) => {
    const btn = document.createElement('button'); btn.className = 'btn ' + (b.cls || ''); btn.textContent = b.label;
    btn.onclick = async () => { if (b.close !== false) closeModal(); await b.onClick?.(); };
    act.appendChild(btn);
  });
  if (dismiss) wrap.addEventListener('click', (e) => { if (e.target === wrap) closeModal(); });
  document.body.appendChild(wrap);
  return wrap;
}
function closeModal() { $('#modal')?.remove(); }
function ask(title, text, ok = 'Confirmar', cancel = 'Cancelar') {
  return new Promise((res) => modal({ title, html: `<p>${text}</p>`, dismiss: false,
    buttons: [{ label: cancel, cls: 'ghost', onClick: () => res(false) }, { label: ok, cls: 'primary', onClick: () => res(true) }] }));
}

// ---------- gravação ----------
async function commit(mutate, extra = {}) {
  if (S.busy) return false;
  S.busy = true;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const s = clone(st());
      const ok = mutate(s);
      if (ok === false) return false;
      const res = await api.update(S.room, { state: s, ...extra });
      if (res) { applyRoom(res); return true; }
      applyRoom(await api.getRoom(S.room.id)); // conflito: recarrega e tenta de novo
    }
    toast('Outra jogada aconteceu ao mesmo tempo. Tente de novo.');
    return false;
  } catch (e) { toast('Erro: ' + e.message); return false; }
  finally { S.busy = false; render(); }
}

// ---------- início ----------
async function boot() {
  app.innerHTML = `<div class="center"><div class="spinner"></div><p>Carregando...</p></div>`;
  let step = 'login';
  try {
    S.uid = await api.init();
    step = 'casos';
    S.cases = await api.listCases();
    if (!S.cases.length) throw new Error('Nenhum caso encontrado no banco de dados (o SQL foi rodado?)');
  } catch (e) {
    let hint = '';
    if (/anonymous/i.test(e.message)) hint = 'No Supabase, ative: Authentication → Sign In / Providers → <b>Allow anonymous sign-ins</b> → Save.';
    else if (/relation|does not exist|schema cache/i.test(e.message)) hint = 'As tabelas do jogo não existem. Rode o arquivo SQL no SQL Editor do Supabase.';
    else if (/fetch|network/i.test(e.message)) hint = 'Sem conexão com o Supabase. Confira a internet ou o endereço do projeto.';
    app.innerHTML = `<div class="center card"><h2>Não foi possível conectar</h2><p>Etapa: <b>${step}</b></p><p>${esc(e.message)}</p>${hint ? `<p class="err">${hint}</p>` : ''}
      <button class="btn primary" onclick="location.reload()">Tentar de novo</button></div>`;
    return;
  }
  const params = new URLSearchParams(location.search);
  const code = params.get('sala');
  if (code) {
    const room = await api.findRoom(code).catch(() => null);
    if (!room) { renderHome('Sala não encontrada. Confira o link.'); return; }
    if ((room.state.players || []).some((p) => p.id === S.uid)) return openRoom(room);
    return renderJoin(room);
  }
  const saved = localStorage.getItem('dvt-room');
  if (saved) {
    const room = await api.getRoom(saved).catch(() => null);
    if (room && (room.state.players || []).some((p) => p.id === S.uid) && room.status !== 'finished') return openRoom(room);
    localStorage.removeItem('dvt-room');
  }
  renderHome();
}

function colorPicker(taken = [], selected) {
  const first = COLORS.find((c) => !taken.includes(c.id))?.id;
  const sel = selected && !taken.includes(selected) ? selected : first;
  return `<div class="colors">${COLORS.map((c) => `<label class="color ${taken.includes(c.id) ? 'taken' : ''}" title="${c.name}">
    <input type="radio" name="color" value="${c.id}" ${c.id === sel ? 'checked' : ''} ${taken.includes(c.id) ? 'disabled' : ''}>
    <span style="background:${c.id}"></span></label>`).join('')}</div>`;
}
const logo = `<div class="logo"><div class="logo-badge">🔍</div><h1>Detetive<br><span>Virtual Tab</span></h1><p class="tagline">Investigações em Londres · 2 a 6 detetives</p></div>`;

function renderHome(errMsg) {
  const name = localStorage.getItem('dvt-name') || '';
  app.innerHTML = `<div class="home">${logo}
    <div class="card">
      ${errMsg ? `<p class="err">${esc(errMsg)}</p>` : ''}
      <label class="field"><span>Seu nome</span><input id="name" maxlength="20" value="${esc(name)}" placeholder="Ex.: Watson"></label>
      <div class="field"><span>Cor do seu peão</span>${colorPicker([], localStorage.getItem('dvt-color'))}</div>
      <label class="field"><span>Caso a investigar</span><select id="case">
        <option value="0">🎲 Sortear um caso</option>
        ${S.cases.map((c) => `<option value="${c.id}">Caso ${c.id} · ${esc(c.title)}</option>`).join('')}
      </select></label>
      <button class="btn primary big" id="create">Criar sala</button>
    </div>
    <div class="card small">
      <p>Recebeu um código de sala?</p>
      <div class="row"><input id="code" maxlength="5" placeholder="Código" style="text-transform:uppercase"><button class="btn" id="go">Entrar</button></div>
    </div>
    <button class="link" id="rules">Como jogar</button>
  </div>`;
  $('#rules').onclick = showRules;
  $('#go').onclick = () => { const c = $('#code').value.trim(); if (c) location.search = '?sala=' + c.toUpperCase(); };
  $('#create').onclick = async () => {
    const n = $('#name').value.trim(); if (!n) return toast('Digite seu nome');
    const color = $('input[name=color]:checked').value;
    let cid = +$('#case').value; if (!cid) cid = S.cases[Math.floor(Math.random() * S.cases.length)].id;
    localStorage.setItem('dvt-name', n); localStorage.setItem('dvt-color', color);
    $('#create').disabled = true;
    try { openRoom(await api.createRoom(n, color, cid)); } catch (e) { toast(e.message); $('#create').disabled = false; }
  };
}

function renderJoin(room, errMsg) {
  const taken = room.state.players.map((p) => p.color);
  const name = localStorage.getItem('dvt-name') || '';
  app.innerHTML = `<div class="home">${logo}
    <div class="card">
      <p class="invite">Você foi convidado para a sala <b>${esc(room.code)}</b></p>
      <p class="muted">Já estão na sala: ${room.state.players.map((p) => `<b style="color:${p.color}">${esc(p.name)}</b>`).join(', ')}</p>
      ${errMsg ? `<p class="err">${esc(errMsg)}</p>` : ''}
      ${room.status !== 'lobby' ? `<p class="err">Esta partida já começou.</p>` : `
      <label class="field"><span>Seu nome</span><input id="name" maxlength="20" value="${esc(name)}" placeholder="Ex.: Watson"></label>
      <div class="field"><span>Cor do seu peão</span>${colorPicker(taken, localStorage.getItem('dvt-color'))}</div>
      <button class="btn primary big" id="join">Entrar na sala</button>`}
    </div><button class="link" id="home">Voltar ao início</button></div>`;
  $('#home').onclick = () => { location.href = location.pathname; };
  const j = $('#join'); if (!j) return;
  j.onclick = async () => {
    const n = $('#name').value.trim(); if (!n) return toast('Digite seu nome');
    const color = $('input[name=color]:checked')?.value; if (!color) return toast('Escolha uma cor');
    localStorage.setItem('dvt-name', n); localStorage.setItem('dvt-color', color);
    j.disabled = true;
    try { openRoom(await api.joinRoom(room.code, n, color)); }
    catch (e) { const fresh = await api.findRoom(room.code).catch(() => room); renderJoin(fresh || room, e.message); }
  };
}

async function openRoom(room) {
  localStorage.setItem('dvt-room', room.id);
  if (location.search) history.replaceState(null, '', location.pathname);
  S.room = room; S.seenMove = room.state.lastMove?.id ?? null; S.seenRoll = room.state.turn?.rollId ?? null;
  S.unsub?.(); S.unsub = api.subscribe(room.id, (r) => applyRoom(r));
  if (room.status !== 'lobby') S.nb = await api.getNotebook(room.id).catch(() => null);
  app.innerHTML = ''; render();
}
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && S.room) { const r = await api.getRoom(S.room.id).catch(() => null); if (r) applyRoom(r); }
});
setInterval(async () => { // segurança extra caso o tempo real caia
  if (S.room && document.visibilityState === 'visible' && !S.busy) { const r = await api.getRoom(S.room.id).catch(() => null); if (r) applyRoom(r); }
}, 8000);

function applyRoom(r) {
  if (!r || !S.room || r.id !== S.room.id) return;
  if (r.version < S.room.version) return;
  const same = r.version === S.room.version;
  const prevStatus = S.room.status;
  const prevTurnKey = S.room.state?.order ? `${S.room.state.turn.idx}:${S.room.state.order[S.room.state.turn.idx]}:${S.room.state.turn.phase}` : null;
  S.room = r;
  if (same) return;
  if (prevStatus === 'lobby' && r.status === 'playing') {
    api.getNotebook(r.id).then((nb) => { S.nb = nb; }).catch(() => {});
    app.innerHTML = '';
  }
  const s = r.state;
  if (s.turn && s.turn.rollId !== S.seenRoll) { S.seenRoll = s.turn.rollId; if (s.turn.dice && s.order[s.turn.idx] !== S.uid) animateDiceRemote(s.turn.dice); }
  const curNow = s.order ? s.order[s.turn.idx] : null;
  if (r.status === 'playing' && curNow === S.uid && s.turn.phase === 'start' && prevTurnKey !== `${s.turn.idx}:${curNow}:start`) notifyTurn();
  if (s.lastMove && s.lastMove.id !== S.seenMove) { S.seenMove = s.lastMove.id; if (s.lastMove.player !== S.uid || !S.selfAnimated) animateMove(s.lastMove); S.selfAnimated = false; }
  render();
}

// ---------- render geral ----------
function render() {
  if (!S.room) return;
  if (S.room.status === 'lobby') return renderLobby();
  renderGame();
}

function renderLobby() {
  const r = S.room, s = r.state, c = caseOf(r.case_id);
  const link = `${location.origin}${location.pathname}?sala=${r.code}`;
  const msg = `Bora investigar comigo no Detetive Virtual Tab! 🔍 Entre na minha sala: ${link}`;
  app.innerHTML = `<div class="home lobby">${logo}
    <div class="card">
      <p class="muted">Código da sala</p><div class="code">${esc(r.code)}</div>
      <div class="share">
        <a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">WhatsApp</a>
        <button class="btn" id="copy">Copiar link</button>
        ${navigator.share ? '<button class="btn" id="share">Compartilhar</button>' : ''}
      </div>
    </div>
    <div class="card">
      <h3>Detetives (${s.players.length}/6)</h3>
      <ul class="plist">${s.players.map((p) => `<li><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${p.id === r.host ? ' <em>anfitrião</em>' : ''}${p.id === S.uid ? ' <em>(você)</em>' : ''}</li>`).join('')}</ul>
      <p class="muted small">${s.players.length < 3 ? 'Com até 2 jogadores, as chaves mestras começam no Chaveiro.' : 'Com 3 ou mais jogadores, cada um começa com uma chave mestra.'}</p>
    </div>
    <div class="card">
      <h3>Caso</h3>
      ${isHost() ? `<select id="case">${S.cases.map((x) => `<option value="${x.id}" ${x.id === r.case_id ? 'selected' : ''}>Caso ${x.id} · ${esc(x.title)}</option>`).join('')}</select>`
        : `<p><b>Caso ${c?.id} · ${esc(c?.title)}</b></p>`}
      ${isHost() ? `<button class="btn primary big" id="start">${s.players.length < 2 ? 'Começar sozinho (modo treino)' : 'Começar a partida'}</button>`
        : `<p class="waiting">Aguardando o anfitrião começar a partida...</p>`}
    </div>
    <button class="link" id="rules">Como jogar</button> <button class="link" id="leave">Sair da sala</button>
  </div>`;
  $('#rules').onclick = showRules;
  $('#leave').onclick = leaveRoom;
  $('#copy').onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Link copiado!'); } catch { prompt('Copie o link:', link); } };
  $('#share') && ($('#share').onclick = () => navigator.share({ title: 'Detetive Virtual Tab', text: msg, url: link }).catch(() => {}));
  if (isHost()) {
    $('#case').onchange = (e) => commit(() => true, { case_id: +e.target.value });
    $('#start').onclick = startGame;
  }
}

function leaveRoom() { S.unsub?.(); S.room = null; localStorage.removeItem('dvt-room'); location.href = location.pathname; }

async function startGame() {
  await commit((s) => {
    const ids = s.players.map((p) => p.id);
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    const many = ids.length >= 3;
    s.order = ids;
    s.turn = { idx: 0, phase: 'start', dice: null, rollId: 0 };
    s.pos = {}; s.hasKey = {}; s.hasBadge = {}; s.hasLeft = {}; s.teleport = {}; s.eliminated = {};
    ids.forEach((id) => { s.pos[id] = { loc: 'sherlock', cell: null }; s.hasKey[id] = many; s.hasBadge[id] = true; });
    s.keysAtChaveiro = many ? 0 : ids.length;
    s.seals = {}; s.badgesAtSY = []; s.accuser = null; s.winner = null; s.moveSeq = 0; s.lastMove = null; s.log = [];
    log(s, `A investigação começou! Ordem: ${ids.map((id) => s.players.find((p) => p.id === id).name).join(' → ')}.`);
  }, { status: 'playing' });
}

// ---------- jogo ----------
function renderGame() {
  if (!$('#game')) buildGame();
  updatePlayers(); updateBoard(); updatePanel(); updateLog();
  if (S.room.status === 'finished' && !S.solutionShown) { S.solutionShown = true; showEnd(); }
}

function buildGame() {
  const c = caseOf(S.room.case_id);
  app.innerHTML = `<div id="game">
    <header class="topbar">
      <button class="tb-case" id="b-case"><small>Caso ${c?.id}</small><span>${esc(c?.title)}</span></button>
      <button class="icon-btn" id="b-snd" title="Som">${Sound.icon()}</button>
      <button class="icon-btn" id="b-nb" title="Caderneta">📒<i id="nb-count"></i></button>
      <button class="icon-btn" id="b-menu" title="Menu">☰</button>
    </header>
    <div id="players" class="players"></div>
    <div id="board-wrap"><div id="board"></div></div>
    <div id="log" class="log"></div>
    <div id="panel" class="panel"></div>
  </div>`;
  $('#b-case').onclick = showCase; $('#b-nb').onclick = showNotebook; $('#b-menu').onclick = showMenu;
  $('#b-snd').onclick = showSound;
  buildBoard();
  if (!S.introShown && (st().log || []).length <= 2) { S.introShown = true; showCase(); }
}

function cellSize() { return Math.floor(Math.min(window.innerWidth - 12, 560) / COLS); }
function buildBoard() {
  const cs = S.cs = cellSize();
  const b = $('#board'); b.style.width = cs * COLS + 'px'; b.style.height = cs * ROWS + 'px'; b.style.setProperty('--cs', cs + 'px');
  let h = '';
  // rio
  h += `<div class="river" style="left:0;top:${RIVER_ROW * cs}px;width:${COLS * cs}px;height:${cs}px"><span>~ Rio Tâmisa ~</span></div>`;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (!isPath(x, y)) continue;
    h += `<div class="cell${isBridge(x, y) ? ' bridge' : ''}" data-k="${x},${y}" style="left:${x * cs}px;top:${y * cs}px">${isBridge(x, y) ? '<i>Ponte</i>' : ''}</div>`;
  }
  DECOR.forEach((d) => {
    const [rx, ry, rw, rh] = d.rect;
    h += `<div class="decor" style="left:${rx * cs + 2}px;top:${ry * cs + 2}px;width:${rw * cs - 4}px;height:${rh * cs - 4}px">${d.icon || ''}</div>`;
  });
  for (const [id, l] of Object.entries(LOCS)) {
    const [rx, ry, rw, rh] = l.rect;
    h += `<div class="loc loc-${id}" data-loc="${id}" style="left:${rx * cs + 2}px;top:${ry * cs + 2}px;width:${rw * cs - 4}px;height:${rh * cs - 4}px;--hue:${l.hue}">
      <span class="loc-icon">${l.icon}</span><span class="loc-name">${esc(l.short || l.name)}</span><span class="loc-extra"></span></div>`;
    l.doors.forEach(([dx, dy], i) => {
      h += `<div class="door door-${doorDir(id, i)}" data-door="${id}:${i}" style="left:${dx * cs}px;top:${dy * cs}px"></div>`;
    });
  }
  h += `<div id="pawns"></div>`;
  b.innerHTML = h;
  b.onclick = onBoardClick;
}
window.addEventListener('resize', () => { if ($('#board') && cellSize() !== S.cs) { buildBoard(); updateBoard(); } });

function pawnXY(id) {
  const s = st(), cs = S.cs, p = s.pos?.[id];
  if (!p || p.loc === 'out') return null;
  if (p.cell) return [p.cell[0] * cs + cs / 2, p.cell[1] * cs + cs / 2];
  const [rx, ry, rw, rh] = LOCS[p.loc].rect;
  const here = s.order.filter((o) => s.pos[o]?.loc === p.loc);
  const i = here.indexOf(id), col = i % 3, row = Math.floor(i / 3);
  const top = (ry + rh) * cs - cs * (row === 0 ? (here.length > 3 ? 1.3 : 0.65) : 0.6);
  return [rx * cs + (rw * cs) * (0.2 + col * 0.3), top];
}

function updateBoard() {
  const s = st(), cs = S.cs; if (!s.order) return;
  const layer = $('#pawns');
  s.order.forEach((id) => {
    let el = $(`#pawn-${CSS.escape(id)}`);
    if (!el) {
      el = document.createElement('div'); el.className = 'pawn'; el.id = 'pawn-' + id;
      el.style.setProperty('--c', colorOf(id)); el.textContent = nameOf(id)[0]?.toUpperCase() || '?';
      layer.appendChild(el);
    }
    el.classList.toggle('turn', id === currentId() && S.room.status === 'playing');
    el.classList.toggle('me', id === S.uid);
    if (S.animating.has(id)) return;
    const xy = pawnXY(id);
    if (!xy) { el.style.display = 'none'; return; }
    el.style.display = ''; el.style.left = xy[0] + 'px'; el.style.top = xy[1] + 'px';
  });
  // lacres
  document.querySelectorAll('.door').forEach((d) => {
    const owner = s.seals?.[d.dataset.door];
    d.classList.toggle('sealed', !!owner);
    d.style.setProperty('--seal', owner ? colorOf(owner) : 'transparent');
    d.innerHTML = owner ? '<b>🛡️</b>' : '';
  });
  const extras = { chaveiro: s.keysAtChaveiro ? `🔑×${s.keysAtChaveiro}` : '', scotland: (s.badgesAtSY || []).map((o) => `<i style="color:${colorOf(o)}">🛡️</i>`).join('') };
  document.querySelectorAll('.loc').forEach((l) => { $('.loc-extra', l).innerHTML = extras[l.dataset.loc] || ''; });
  // destaques
  document.querySelectorAll('.hl').forEach((e) => e.classList.remove('hl'));
  const tgt = targets();
  if (tgt) {
    tgt.cells.forEach((_, k) => $(`.cell[data-k="${k}"]`)?.classList.add('hl'));
    tgt.locs.forEach((v, id) => $(`.loc[data-loc="${id}"]`)?.classList.add('hl'));
  }
}

function occupiedByOthers() {
  const s = st(), occ = new Set();
  s.order.forEach((id) => { if (id !== S.uid && s.pos[id]?.cell) occ.add(key(...s.pos[id].cell)); });
  return occ;
}
// alvos clicáveis neste momento
function targets() {
  if (!myTurn() || S.busy || S.animating.size || S.rolling) return null;
  const s = st(), ph = s.turn.phase;
  if (ph === 'move') {
    const v = S.room.version;
    if (S.reachVer !== v) {
      S.reachVer = v;
      S.reach = reachable({ from: s.pos[S.uid], steps: s.turn.dice[0] + s.turn.dice[1], occupied: occupiedByOthers(), me: S.uid, seals: s.seals, hasKey: s.hasKey[S.uid] });
    }
    return S.reach;
  }
  if ((ph === 'start' && s.teleport[S.uid]) || S.choosingCarriage) {
    return { cells: new Map(), locs: carriageTargets() };
  }
  return null;
}
function carriageTargets() {
  const s = st(), m = new Map(), cur = s.pos[S.uid]?.loc;
  for (const [id, l] of Object.entries(LOCS)) {
    if (id === cur || id === 'estacao') continue;
    const free = l.doors.findIndex((_, i) => !s.seals[doorId(id, i)] || s.seals[doorId(id, i)] === S.uid);
    if (free >= 0) m.set(id, { door: free, useKey: false, path: [] });
    else if (s.hasKey[S.uid]) m.set(id, { door: 0, useKey: true, path: [] });
  }
  return m;
}

function onBoardClick(e) {
  const tgt = targets(); if (!tgt) return;
  const cell = e.target.closest('.cell'), loc = e.target.closest('.loc'), door = e.target.closest('.door');
  if (loc && tgt.locs.has(loc.dataset.loc)) return choose({ loc: loc.dataset.loc });
  const k = cell?.dataset.k || (door && `${parseInt(door.style.left) / S.cs},${parseInt(door.style.top) / S.cs}`);
  if (k && tgt.cells.has(k)) return choose({ cell: k.split(',').map(Number) });
  if (door) { const l = door.dataset.door.split(':')[0]; if (tgt.locs.has(l)) return choose({ loc: l }); }
}

async function choose(t) {
  const s = st();
  if (s.turn.phase === 'move') return doWalk(t);
  if (t.loc) return doCarriage(t.loc);
}

async function doWalk(t) {
  const s0 = st(), me = S.uid, r = S.reach;
  let path, entry = null;
  if (t.cell) path = r.cells.get(key(...t.cell)).path;
  else {
    entry = r.locs.get(t.loc); path = entry.path;
    if (entry.useKey && !(await ask('Entrada lacrada', `Usar sua chave mestra para abrir a entrada de <b>${locName(t.loc)}</b>? O distintivo vai para a Scotland Yard e sua chave volta para o Chaveiro.`, 'Usar a chave'))) return;
  }
  const fromCell = !!s0.pos[me].cell;
  const lastMove = { player: me, path, kind: 'walk', to: t.loc ? { loc: t.loc } : { cell: t.cell } };
  S.selfAnimated = true;
  const animP = animateMove(lastMove, s0);
  const ok = await commit((s) => {
    if (s.turn.phase !== 'move' || s.order[s.turn.idx] !== me) return false;
    if (s.pos[me].loc === 'sherlock') s.hasLeft[me] = true;
    s.moveSeq = (s.moveSeq || 0) + 1; s.lastMove = { ...lastMove, id: s.moveSeq };
    const n = path.length - (fromCell ? 1 : 0);
    if (t.cell) { s.pos[me] = { loc: null, cell: t.cell }; log(s, `${nameOf(me)} andou ${n} casa${n === 1 ? '' : 's'}.`); endTurn(s); }
    else { enterLoc(s, me, t.loc, entry.door, entry.useKey); s.turn.phase = t.loc === 'estacao' ? 'station' : 'after'; }
  });
  if (!ok) { S.selfAnimated = false; S.animating.delete(me); updateBoard(); return; }
  S.seenMove = st().lastMove?.id;
  await animP;
  if (t.loc) afterEnter(t.loc);
}

async function doCarriage(loc) {
  const s0 = st(), me = S.uid, m = carriageTargets(), entry = m.get(loc);
  if (!entry) return;
  if (entry.useKey && !(await ask('Local lacrado', `Usar sua chave mestra para abrir <b>${locName(loc)}</b>?`, 'Usar a chave'))) return;
  const from = s0.pos[me].loc;
  S.choosingCarriage = false;
  const lastMove = { player: me, path: [], kind: 'carriage', to: { loc } };
  S.selfAnimated = true;
  const animP = animateMove(lastMove, s0);
  const ok = await commit((s) => {
    if (s.order[s.turn.idx] !== me) return false;
    if (from === 'sherlock') s.hasLeft[me] = true;
    s.teleport[me] = false;
    s.moveSeq = (s.moveSeq || 0) + 1; s.lastMove = { ...lastMove, id: s.moveSeq };
    log(s, `${nameOf(me)} pegou uma carruagem 🐎`);
    enterLoc(s, me, loc, entry.door, entry.useKey);
    s.turn.phase = 'after';
  });
  if (!ok) { S.selfAnimated = false; S.animating.delete(me); updateBoard(); return; }
  S.seenMove = st().lastMove?.id;
  await animP;
  afterEnter(loc);
}

function enterLoc(s, id, loc, door, useKey) {
  const n = nameOf(id);
  if (useKey) {
    const did = doorId(loc, door), owner = s.seals[did];
    delete s.seals[did]; s.badgesAtSY.push(owner); s.hasKey[id] = false; s.keysAtChaveiro++;
    log(s, `${n} usou a chave mestra e abriu ${locName(loc)}. O distintivo de ${nameOf(owner)} foi para a Scotland Yard e a chave voltou ao Chaveiro.`);
  }
  s.pos[id] = { loc, cell: null };
  log(s, `${n} entrou em ${locName(loc)}.`);
}

function endTurn(s) {
  const n = s.order.length; let idx = s.turn.idx;
  for (let i = 0; i < n; i++) { idx = (idx + 1) % n; if (!s.eliminated[s.order[idx]]) break; }
  s.turn = { idx, phase: 'start', dice: null, rollId: s.turn.rollId };
}

async function afterEnter(loc) {
  if (loc === 'sherlock' || loc === 'estacao') { render(); return; }
  await fetchClue(loc, true);
}
async function fetchClue(loc, show) {
  try {
    const txt = await api.readClue(S.room.id, loc);
    S.nb = S.nb || { clues: {}, answers: {}, notes: '' }; S.nb.clues[loc] = txt;
    if (show) showClue(loc, txt);
    updatePlayersBadge();
  } catch (e) { toast('Erro ao ler a pista: ' + e.message); }
}
function notifyTurn() {
  if (S.room.state.order.length < 2) return;
  Sound.sfx('turn');
  try { navigator.vibrate?.([120, 80, 120]); } catch {}
  document.querySelector('.turn-pop')?.remove();
  const pop = document.createElement('div'); pop.className = 'turn-pop';
  pop.innerHTML = `<div class="tp-card"><div class="tp-ico">🔔</div><b>É a sua vez!</b>
    <div class="tp-act"><button class="btn ghost" data-a="stay">Continuar lendo</button><button class="btn primary" data-a="go">Jogar agora</button></div></div>`;
  pop.querySelector('[data-a=go]').onclick = () => { if (S.nb && $('#modal .notebook')) flushNotebook(); closeModal(); pop.remove(); };
  pop.querySelector('[data-a=stay]').onclick = () => pop.remove();
  document.body.appendChild(pop);
}

function showClue(loc, txt) {
  const l = LOCS[loc], none = /^\(Sem pista/.test(txt);
  modal({ cls: 'clue', title: `${l.icon} ${esc(l.name)}`,
    html: `<div class="parchment ${none ? 'none' : ''}">${esc(txt).replace(/\n/g, '<br>')}</div>
      <p class="muted small">🔒 Só você está vendo esta pista. Ela já foi anotada na sua caderneta.</p>`,
    buttons: [{ label: 'Abrir caderneta', cls: 'ghost', onClick: showNotebook }, { label: 'Entendi', cls: 'primary' }] });
}

// ---------- dados ----------
function dieSVG(n) {
  const P = { 1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[28, 28], [50, 50], [72, 72]], 4: [[28, 28], [72, 28], [28, 72], [72, 72]],
    5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]], 6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]] };
  return `<svg viewBox="0 0 100 100" class="die"><rect x="4" y="4" width="92" height="92" rx="18"/>${P[n].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9"/>`).join('')}</svg>`;
}
async function spinDice(final) {
  S.rolling = { a: 1, b: 1 }; const end = Date.now() + 750; Sound.sfx('dice');
  while (Date.now() < end) { S.rolling = { a: rnd6(), b: rnd6() }; updatePanel(); await sleep(80); }
  S.rolling = null; updatePanel(); updateBoard();
}
async function animateDiceRemote(d) { await spinDice(d); }

async function rollDice() {
  const a = rnd6(), b = rnd6();
  await spinDice();
  await commit((s) => {
    if (s.order[s.turn.idx] !== S.uid || s.turn.phase !== 'start') return false;
    s.turn.dice = [a, b]; s.turn.phase = 'move'; s.turn.rollId = (s.turn.rollId || 0) + 1;
    log(s, `${nameOf(S.uid)} tirou ${a} + ${b} = ${a + b} 🎲`);
  });
  S.seenRoll = st().turn.rollId;
}

// ---------- animação dos peões ----------
async function animateMove(m, sBefore) {
  const id = m.player, el = $(`#pawn-${CSS.escape(id)}`); if (!el) return;
  S.animating.add(id); updateBoard();
  const cs = S.cs;
  try {
    if (m.kind === 'carriage') {
      Sound.sfx('estacao');
      el.classList.add('fly'); await sleep(350);
      S.animating.delete(id); updateBoard(); await sleep(50);
      el.classList.remove('fly'); return;
    }
    el.classList.add('walking');
    for (const [x, y] of m.path) {
      el.style.left = x * cs + cs / 2 + 'px'; el.style.top = y * cs + cs / 2 + 'px';
      await sleep(170);
    }
    el.classList.remove('walking');
  } finally {
    S.animating.delete(id);
    updateBoard(); updatePanel();
    if (m.to?.loc) Sound.sfx(m.to.loc);
  }
}

// ---------- painéis ----------
function updatePlayers() {
  const s = st(); if (!s.order) return;
  $('#players').innerHTML = s.order.map((id) => {
    const p = player(id), cur = id === currentId() && S.room.status === 'playing', el = s.eliminated[id];
    const where = s.pos[id]?.loc && s.pos[id].loc !== 'out' ? LOCS[s.pos[id].loc].icon : '';
    return `<div class="pchip ${cur ? 'cur' : ''} ${el ? 'out' : ''} ${id === S.uid ? 'me' : ''}" style="--c:${p.color}">
      <span class="dot"></span><span class="pn">${esc(p.name)}</span>
      <span class="pi">${where}${s.hasBadge[id] ? '🛡️' : ''}${s.hasKey[id] ? '🔑' : ''}${s.teleport[id] ? '🐎' : ''}${el ? '❌' : ''}${s.winner === id ? '🏆' : ''}</span></div>`;
  }).join('');
  updatePlayersBadge();
}
function updatePlayersBadge() {
  const n = Object.keys(S.nb?.clues || {}).length; const b = $('#nb-count'); if (b) b.textContent = n ? n : '';
}
function updateLog() {
  const l = (st().log || []).slice(-4).reverse();
  $('#log').innerHTML = l.map((x, i) => `<div class="${i === 0 ? 'new' : ''}">${esc(x.msg)}</div>`).join('');
}

function diceRow(d) {
  if (S.rolling) return `<div class="dice rolling">${dieSVG(S.rolling.a)}${dieSVG(S.rolling.b)}</div>`;
  if (!d) return '';
  return `<div class="dice">${dieSVG(d[0])}${dieSVG(d[1])}<b>= ${d[0] + d[1]}</b></div>`;
}

function updatePanel() {
  const p = $('#panel'); if (!p) return;
  const s = st(), me = S.uid, cid = currentId();
  if (S.room.status === 'finished') {
    p.innerHTML = `<div class="pmsg">${s.winner ? `🏆 <b>${esc(nameOf(s.winner))}</b> resolveu o caso!` : 'Ninguém resolveu o caso.'}</div>
      <div class="actions"><button class="btn primary" id="a-sol">Ver solução</button><button class="btn" id="a-new">Nova partida</button></div>`;
    $('#a-sol').onclick = showEnd; $('#a-new').onclick = leaveRoom; return;
  }
  if (s.eliminated[me] && cid !== me) {
    p.innerHTML = `<div class="pmsg">❌ Você errou a acusação e está fora. Guarde segredo e acompanhe os outros detetives!<br><small>Vez de <b style="color:${colorOf(cid)}">${esc(nameOf(cid))}</b></small></div>${diceRow(s.turn.dice)}`;
    return;
  }
  if (cid !== me) {
    const ph = s.turn.phase;
    const what = ph === 'move' ? 'está andando...' : ph === 'after' || ph === 'station' ? 'está investigando...' : 'vai jogar os dados';
    p.innerHTML = `<div class="pmsg"><span class="dot" style="background:${colorOf(cid)}"></span> <b>${esc(nameOf(cid))}</b> ${what}</div>${diceRow(s.turn.dice)}`;
    return;
  }
  // minha vez
  if (S.rolling || S.animating.size) { p.innerHTML = `<div class="pmsg">Sua vez</div>${diceRow(s.turn.dice)}`; return; }
  const loc = s.pos[me]?.loc;
  const ph = s.turn.phase;
  const btns = [];
  let msg = '';
  if (ph === 'start') {
    if (s.teleport[me]) {
      msg = '🐎 <b>Sua carruagem está pronta!</b> Toque num local do tabuleiro (ou na lista) para ir até ele, sem jogar os dados.';
      btns.push(['🗺️ Escolher na lista', 'ghost', pickCarriageList]);
    } else {
      msg = '<b>Sua vez!</b>' + (loc ? ` Você está em ${esc(locName(loc))}.` : '');
      btns.push(['🎲 Jogar os dados', 'primary', rollDice]);
    }
    pickupButtons(btns, loc);
    if (loc && !UNSEALABLE.includes(loc) && s.hasBadge[me]) btns.push(['🛡️ Lacrar entrada', '', sealDoor]);
    if (loc === 'sherlock' && s.hasLeft[me]) btns.push(['🕵️ Apresentar solução', 'gold', accuse]);
  } else if (ph === 'move') {
    const t = targets();
    const nothing = t && !t.cells.size && !t.locs.size;
    msg = nothing ? 'Nenhum movimento possível. Passe a vez.' : 'Toque numa casa iluminada ou num local para entrar.';
    if (nothing) btns.push(['Passar a vez', 'primary', passTurn]);
  } else if (ph === 'station') {
    msg = '🐎 <b>Estação de Carruagens.</b> Escolha:';
    btns.push(['📜 Ler a pista daqui', '', stationRead]);
    btns.push(['🐎 Ir de carruagem agora', 'primary', stationGo]);
  } else if (ph === 'after') {
    msg = loc ? `Você está em <b>${esc(locName(loc))}</b>.` : '';
    if (loc && CLUE_LOCS.includes(loc) && S.nb?.clues?.[loc]) btns.push(['📜 Ver pista', 'ghost', () => showClue(loc, S.nb.clues[loc])]);
    pickupButtons(btns, loc);
    if (loc === 'sherlock' && s.hasLeft[me]) btns.push(['🕵️ Apresentar solução', 'gold', accuse]);
    btns.push(['✅ Terminar a vez', 'primary', finishTurn]);
  }
  if (S.choosingCarriage) { msg = '🐎 Toque no local de destino no tabuleiro.'; btns.length = 0; btns.push(['🗺️ Escolher na lista', 'ghost', pickCarriageList], ['Voltar', 'ghost', () => { S.choosingCarriage = false; render(); }]); }
  p.innerHTML = `<div class="pmsg">${msg}</div>${ph === 'move' ? diceRow(s.turn.dice) : ''}<div class="actions"></div>`;
  const a = $('.actions', p);
  btns.forEach(([label, cls, fn]) => { const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = label; b.disabled = S.busy; b.onclick = fn; a.appendChild(b); });
}

function pickupButtons(btns, loc) {
  const s = st(), me = S.uid;
  if (loc === 'chaveiro' && !s.hasKey[me] && s.keysAtChaveiro > 0) btns.push(['🔑 Pegar chave mestra', 'gold', pickKey]);
  if (loc === 'scotland' && (s.badgesAtSY || []).includes(me)) btns.push(['🛡️ Pegar meu distintivo', 'gold', pickBadge]);
}
async function pickKey() {
  const ok = await commit((s) => {
    const me = S.uid;
    if (s.order[s.turn.idx] !== me || s.pos[me]?.loc !== 'chaveiro' || s.hasKey[me] || s.keysAtChaveiro <= 0) return false;
    s.keysAtChaveiro--; s.hasKey[me] = true; log(s, `${nameOf(me)} pegou uma chave mestra 🔑`);
  });
  if (ok) Sound.sfx('chaveiro');
}
async function pickBadge() {
  const ok = await commit((s) => {
    const me = S.uid;
    if (s.order[s.turn.idx] !== me || s.pos[me]?.loc !== 'scotland' || !s.badgesAtSY.includes(me)) return false;
    s.badgesAtSY = s.badgesAtSY.filter((b) => b !== me); s.hasBadge[me] = true; log(s, `${nameOf(me)} recuperou seu distintivo 🛡️`);
  });
  if (ok) Sound.sfx('scotland');
}

async function passTurn() { await commit((s) => { if (s.order[s.turn.idx] !== S.uid) return false; log(s, `${nameOf(S.uid)} passou a vez.`); endTurn(s); }); }
async function finishTurn() { await commit((s) => { if (s.order[s.turn.idx] !== S.uid) return false; endTurn(s); }); }

async function stationRead() {
  const ok = await commit((s) => { if (s.order[s.turn.idx] !== S.uid) return false; s.teleport[S.uid] = true; s.turn.phase = 'after'; log(s, `${nameOf(S.uid)} leu a pista da Estação. Na próxima vez, vai de carruagem 🐎`); });
  if (ok) fetchClue('estacao', true);
}
function stationGo() { S.choosingCarriage = true; render(); }
function pickCarriageList() {
  const m = carriageTargets();
  const wrap = modal({ title: '🐎 Para onde?', html: `<div class="loclist">${[...m.keys()].map((id) => `<button class="btn" data-l="${id}">${LOCS[id].icon} ${esc(LOCS[id].name)}${m.get(id).useKey ? ' 🔑' : ''}</button>`).join('')}</div>`,
    buttons: [{ label: 'Cancelar', cls: 'ghost' }] });
  wrap.querySelectorAll('[data-l]').forEach((b) => (b.onclick = () => { closeModal(); doCarriage(b.dataset.l); }));
}

async function sealDoor() {
  const s = st(), loc = s.pos[S.uid].loc, l = LOCS[loc];
  const free = l.doors.map((_, i) => i).filter((i) => !s.seals[doorId(loc, i)]);
  if (!free.length) return toast('As entradas deste local já estão lacradas.');
  const dirName = { up: 'de baixo', down: 'de cima', left: 'da direita', right: 'da esquerda' };
  const go = (i) => commit((s) => {
    if (s.order[s.turn.idx] !== S.uid || !s.hasBadge[S.uid]) return false;
    s.seals[doorId(loc, i)] = S.uid; s.hasBadge[S.uid] = false;
    log(s, `${nameOf(S.uid)} lacrou ${l.doors.length > 1 ? 'uma entrada' : 'a entrada'} de ${l.name} com seu distintivo 🛡️`);
  });
  if (free.length === 1 && l.doors.length === 1) {
    if (await ask('Lacrar entrada', `Deixar seu distintivo na entrada de <b>${esc(l.name)}</b>? Os outros só poderão entrar usando uma chave mestra. Para recuperar o distintivo depois, vá à Scotland Yard se ele for parar lá.`, 'Lacrar')) go(free[0]);
    return;
  }
  const wrap = modal({ title: '🛡️ Qual entrada?', html: `<p>Escolha a entrada de <b>${esc(l.name)}</b> que vai lacrar. A outra continua aberta.</p><div class="loclist">${free.map((i) => `<button class="btn" data-i="${i}">Entrada ${dirName[doorDir(loc, i)]}</button>`).join('')}</div>`,
    buttons: [{ label: 'Cancelar', cls: 'ghost' }] });
  wrap.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => { closeModal(); go(+b.dataset.i); }));
}

// ---------- acusação ----------
// ---------- conferência automática das respostas ----------
const normTxt = (t) => ' ' + String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
const hasKey = (txt, k) => txt.includes(' ' + normTxt(k).trim());
function grade(answer, item) {
  const txt = normTxt(answer);
  if (!txt.trim()) return { st: 'wrong', msg: 'Sem resposta.' };
  if (!item.need) return { st: 'manual' };
  if ((item.deny || []).some((k) => hasKey(txt, k))) return { st: 'wrong', msg: 'Resposta errada ou com mais de uma opção.' };
  const hits = item.need.filter((g) => g.some((k) => hasKey(txt, k))).length;
  if (hits === item.need.length) return { st: 'ok', msg: 'Correta!' };
  if (hits > 0) return { st: 'partial', msg: 'Incompleta: faltou alguma coisa importante.' };
  return { st: 'wrong', msg: 'Errada.' };
}

async function accuse() {
  if (!S.nb) S.nb = await api.getNotebook(S.room.id).catch(() => ({ clues: {}, answers: {}, notes: '' }));
  const c = caseOf(S.room.case_id), ans = S.nb.answers || {};
  const wrap = modal({ title: '🕵️ Sua solução', cls: 'wide', dismiss: false,
    html: `<p class="muted small">Revise suas respostas. Elas não precisam ser iguais às do jogo, mas precisam ter as informações certas. <b>Se alguma estiver errada ou incompleta, você sai do jogo.</b></p>
      ${c.questions.map((q) => `<label class="field"><span>${q.key}) ${esc(q.label)} <small>${esc(q.ask)}</small></span><input data-a="${q.key}" value="${esc(ans[q.key] || '')}"></label>`).join('')}`,
    buttons: [{ label: 'Voltar', cls: 'ghost' }, { label: '🔍 Conferir respostas', cls: 'primary', close: false, onClick: () => submitAccusation(wrap) }] });
}
async function submitAccusation(wrap) {
  const c = caseOf(S.room.case_id);
  const answers = { ...(S.nb.answers || {}) };
  wrap.querySelectorAll('[data-a]').forEach((i) => (answers[i.dataset.a] = i.value.trim()));
  const empty = c.questions.filter((q) => !answers[q.key]);
  if (empty.length && !(await ask('Respostas em branco', `Você deixou ${empty.length} item(ns) em branco. Item em branco conta como errado. Conferir mesmo assim?`, 'Conferir'))) { accuse(); return; }
  closeModal();
  S.nb.answers = answers; flushNotebook();
  const ok = await commit((s) => { if (s.order[s.turn.idx] !== S.uid) return false; s.accuser = S.uid; s.turn.phase = 'after'; log(s, `🕵️ ${nameOf(S.uid)} está conferindo a solução...`); });
  if (!ok) return;
  let sol;
  try { sol = await api.revealSolution(S.room.id); } catch (e) { return toast(e.message); }
  const res = c.questions.map((q) => { const off = sol.solution.find((x) => x.key === q.key) || {}; return { q, off, g: grade(answers[q.key], off) }; });
  const manual = res.some((r) => r.g.st === 'manual');
  const allOk = res.every((r) => r.g.st === 'ok');
  const icon = { ok: '✅', partial: '⚠️', wrong: '❌', manual: '❔' };
  modal({ title: allOk ? '🎉 Todas corretas!' : '🔒 Resultado (só você está vendo)', cls: 'wide', dismiss: false,
    html: `${res.map(({ q, off, g }) => `<div class="cmp g-${g.st}"><div class="q">${icon[g.st]} ${q.key}) ${esc(q.label)} <em>${esc(g.msg || '')}</em></div>
        <div class="mine"><small>Sua resposta</small>${esc(answers[q.key] || '—')}</div>
        <div class="off"><small>Solução oficial</small>${esc(off.answer)}</div></div>`).join('')}
      <details><summary>Como tudo aconteceu</summary><div class="story">${esc(sol.text).split('\n\n').map((p) => `<p>${p}</p>`).join('')}</div></details>`,
    buttons: manual ? [{ label: '❌ Errei', cls: 'danger', onClick: () => accuseResult(false) }, { label: '✔️ Acertei', cls: 'primary', onClick: () => accuseResult(true) }]
      : allOk ? [{ label: '🏆 Confirmar acerto', cls: 'primary', onClick: () => accuseResult(true) }]
      : [{ label: '❌ Errei, sair do jogo', cls: 'danger', onClick: () => accuseResult(false) }] });
}
async function accuseResult(right) {
  if (right) {
    const answers = { ...(S.nb?.answers || {}) };
    await commit((s) => { s.winner = S.uid; s.winnerAnswers = answers; s.accuser = null; log(s, `🏆 ${nameOf(S.uid)} resolveu o caso!`); }, { status: 'finished' });
  } else {
    let finished = false;
    await commit((s) => {
      s.eliminated[S.uid] = true; s.accuser = null; s.pos[S.uid] = { loc: 'out', cell: null };
      log(s, `❌ ${nameOf(S.uid)} errou a solução e saiu do jogo.`);
      finished = s.order.every((id) => s.eliminated[id]);
      if (finished) log(s, 'Todos erraram. O culpado escapou!'); else endTurn(s);
    }, {});
    if (st().order.every((id) => st().eliminated[id])) await commit(() => true, { status: 'finished' });
  }
}
async function showEnd() {
  let sol = null;
  try { sol = await api.revealSolution(S.room.id); } catch {}
  const s = st(), c = caseOf(S.room.case_id);
  modal({ cls: 'wide', title: s.winner ? `🏆 ${esc(nameOf(s.winner))} resolveu o caso!` : '🕯️ O culpado escapou...',
    html: `<p><b>Caso ${c.id} · ${esc(c.title)}</b></p>
      ${sol ? sol.solution.map((x) => `<div class="cmp"><div class="q">${x.key}) ${esc(x.label)}</div>
        ${s.winner ? `<div class="mine"><small>Resposta de ${esc(nameOf(s.winner))}</small>${esc(s.winnerAnswers?.[x.key] || '—')}</div>` : ''}
        <div class="off"><small>Solução oficial</small>${esc(x.answer)}</div></div>`).join('')
        + `<h4 class="sol-h">Como tudo aconteceu</h4><div class="story">${esc(sol.text).split('\n\n').map((p) => `<p>${p}</p>`).join('')}</div>` : '<p>Não foi possível carregar a solução.</p>'}`,
    buttons: [{ label: 'Fechar', cls: 'ghost' }, { label: 'Nova partida', cls: 'primary', onClick: leaveRoom }] });
}

// ---------- caso, caderneta, menu ----------
function showCase() {
  const c = caseOf(S.room.case_id);
  modal({ cls: 'wide', title: `📜 Caso ${c.id}`, html: `<h3 class="case-title">${esc(c.title)}</h3>
    <div class="story">${esc(c.story).split('\n\n').map((p) => `<p>${p}</p>`).join('')}</div>
    <p><b>Holmes precisa descobrir:</b></p><ul class="qs">${c.questions.map((q) => `<li><b>${q.key})</b> ${esc(q.ask)}</li>`).join('')}</ul>`,
    buttons: [{ label: 'Fechar', cls: 'primary' }] });
}

let saveTimer = null;
async function showNotebook() {
  if (!S.nb) S.nb = await api.getNotebook(S.room.id).catch(() => ({ clues: {}, answers: {}, notes: '' }));
  const c = caseOf(S.room.case_id), nb = S.nb;
  const riddles = groupRiddles(nb.clues);
  const wrap = modal({ cls: 'wide notebook', title: '📒 Caderneta do Detetive', html: `
    ${riddles.length ? `<h4>🧩 Charadas</h4><div class="riddles">${riddles.map((g) => `<div class="riddle">
      <div class="rh">${esc(g.label)} <small>${g.found}/${g.total} partes</small></div>
      ${g.parts.map((p) => `<div class="rp ${p.text ? '' : 'missing'}"><b>${p.roman})</b> ${p.text ? `${esc(p.text)} <i>${LOCS[p.loc].icon}</i>` : 'ainda não encontrada'}</div>`).join('')}
    </div>`).join('')}</div>` : ''}
    <h4>Pistas</h4>
    <div class="clues">${CLUE_LOCS.map((l) => `<div class="crow ${nb.clues[l] ? '' : 'empty'}"><div class="cl">${LOCS[l].icon} ${esc(LOCS[l].name)}</div>
      <div class="ct">${nb.clues[l] ? esc(nb.clues[l]).replace(/\n/g, '<br>') : '—'}</div></div>`).join('')}</div>
    <h4>Soluções</h4>
    ${c.questions.map((q) => `<label class="field"><span>${q.key}) ${esc(q.label)} <small>${esc(q.ask)}</small></span><input data-a="${q.key}" value="${esc(nb.answers?.[q.key] || '')}"></label>`).join('')}
    <h4>Anotações gerais</h4>
    <textarea id="notes" rows="5" placeholder="Suspeitas, ligações entre as pistas...">${esc(nb.notes || '')}</textarea>
    <p class="muted small" id="saved">Salvo automaticamente · só você vê.</p>`,
    buttons: [{ label: 'Fechar', cls: 'primary', onClick: flushNotebook }] });
  const onInput = () => {
    nb.answers = nb.answers || {};
    wrap.querySelectorAll('[data-a]').forEach((i) => (nb.answers[i.dataset.a] = i.value));
    nb.notes = $('#notes', wrap).value;
    $('#saved', wrap).textContent = 'Salvando...';
    clearTimeout(saveTimer); saveTimer = setTimeout(flushNotebook, 700);
  };
  wrap.querySelectorAll('input,textarea').forEach((i) => i.addEventListener('input', onInput));
}
// junta as partes das charadas ("Pista do X (N partes): I) ...") encontradas em locais diferentes
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
function groupRiddles(clues = {}) {
  const groups = {};
  for (const [loc, txt] of Object.entries(clues)) {
    const m = /^(.+?)\s*\((\d+)\s*partes?\)\s*:?\s*\n([\s\S]*)$/.exec(txt || '');
    if (!m) continue;
    const label = m[1].trim(), total = +m[2];
    const g = groups[label] || (groups[label] = { label, total, parts: {} });
    for (const line of m[3].split('\n')) {
      const p = /^\s*([IVX]+)\)\s*(.*)$/.exec(line);
      if (p) g.parts[p[1]] = { text: p[2].trim(), loc };
      else if (line.trim()) { const last = Object.keys(g.parts).pop(); if (last) g.parts[last].text += ' ' + line.trim(); }
    }
  }
  return Object.values(groups).map((g) => {
    const parts = ROMAN.slice(0, g.total).map((r) => ({ roman: r, ...(g.parts[r] || {}) }));
    return { label: g.label, total: g.total, found: parts.filter((p) => p.text).length, parts };
  });
}

async function flushNotebook() {
  clearTimeout(saveTimer);
  try { await api.saveNotebook(S.room.id, S.nb.answers || {}, S.nb.notes || ''); const el = $('#saved'); if (el) el.textContent = 'Salvo ✓ · só você vê.'; }
  catch (e) { toast('Erro ao salvar a caderneta'); }
}

function showMenu() {
  const s = st(), cid = currentId();
  const btns = [
    { label: '📖 Como jogar', onClick: showRules },
    { label: '🧾 Histórico da partida', onClick: showHistory },
  ];
  if (isHost() && S.room.status === 'playing' && cid !== S.uid) btns.push({ label: `⏭️ Pular a vez de ${nameOf(cid)}`, onClick: async () => {
    if (await ask('Pular a vez', `Pular a vez de <b>${esc(nameOf(cid))}</b>? Use se a pessoa saiu ou travou.`, 'Pular')) commit((s) => { log(s, `O anfitrião pulou a vez de ${nameOf(cid)}.`); s.accuser = null; endTurn(s); });
  } });
  btns.push({ label: '🚪 Sair da partida', onClick: async () => { if (await ask('Sair', 'Sair desta partida neste aparelho? Você pode voltar pelo link da sala.', 'Sair')) leaveRoom(); } });
  const wrap = modal({ title: `Sala ${esc(S.room.code)}`, html: `<div class="loclist" id="mb"></div>`, buttons: [{ label: 'Fechar', cls: 'ghost' }] });
  btns.forEach((b) => { const e = document.createElement('button'); e.className = 'btn'; e.textContent = b.label; e.onclick = () => { closeModal(); b.onClick(); }; $('#mb', wrap).appendChild(e); });
}
function showSound() {
  const wrap = modal({ title: '🔊 Som', html: `<label class="switch"><input type="checkbox" id="sw-m" ${Sound.music ? 'checked' : ''}><span>Música ambiente</span></label>
    <label class="switch"><input type="checkbox" id="sw-f" ${Sound.fx ? 'checked' : ''}><span>Sons dos locais e dos dados</span></label>
    <button class="btn" id="sw-t" style="width:100%;margin-top:12px">🔔 Testar som</button>
    <p class="muted small">No iPhone, confira se o volume está alto. Se ainda assim não tocar, toque em "Testar som".</p>`, buttons: [{ label: 'Pronto', cls: 'primary' }] });
  $('#sw-t', wrap).onclick = () => Sound.test(['hotel', 'docas', 'teatro', 'parque', 'estacao', 'scotland'][Math.floor(Math.random() * 6)]);
  const upd = () => { Sound.set($('#sw-m', wrap).checked, $('#sw-f', wrap).checked); $('#b-snd').textContent = Sound.icon(); };
  $('#sw-m', wrap).onchange = upd; $('#sw-f', wrap).onchange = upd;
}
function showHistory() {
  modal({ title: '🧾 Histórico', html: `<div class="history">${(st().log || []).slice().reverse().map((x) => `<div>${esc(x.msg)}</div>`).join('')}</div>`, buttons: [{ label: 'Fechar', cls: 'primary' }] });
}
function showRules() {
  modal({ cls: 'wide', title: '📖 Como jogar', html: `<div class="rules">
    <p><b>Objetivo:</b> ser o primeiro detetive a responder corretamente todos os itens do caso.</p>
    <p><b>Início:</b> todos começam na Casa de Sherlock Holmes. Leia o caso (botão no topo).</p>
    <p><b>Na sua vez:</b> jogue os dois dados e ande até a soma dos pontos, na horizontal ou vertical. Você pode passar por cima de outros peões, mas não parar na mesma casa. Ao chegar à seta de um local, você entra nele.</p>
    <p><b>Pistas:</b> ao entrar num local, você recebe a pista dele só na sua tela, e ela vai direto para a sua caderneta. Algumas são frases; outras são charadas em partes (I, II, III) espalhadas por vários locais. Alguns locais não têm pista.</p>
    <p><b>Duas entradas:</b> Parque, Museu e Hotel têm duas entradas.</p>
    <p><b>Distintivo 🛡️:</b> antes de sair de um local, você pode lacrar uma entrada dele. Ninguém entra por ela, a não ser você. Não vale lacrar a Scotland Yard, o Chaveiro nem a Casa de Sherlock Holmes.</p>
    <p><b>Chave mestra 🔑:</b> abre uma entrada lacrada. O distintivo vai para a Scotland Yard e a chave volta ao Chaveiro. Para recuperar, vá até lá. Com 2 jogadores, as chaves começam no Chaveiro; com 3 ou mais, cada um começa com a sua.</p>
    <p><b>Estação de Carruagens 🐎:</b> ao entrar, escolha: ler a pista dela (e na próxima vez ir de carruagem a qualquer local, sem dados) ou ir de carruagem agora para outro local e ler a pista de lá.</p>
    <p><b>Ponte:</b> o rio só pode ser atravessado pelas pontes.</p>
    <p><b>Solução:</b> quando achar que sabe tudo, volte à Casa de Sherlock Holmes e toque em "Apresentar solução". Só você vê a solução oficial. Se acertou tudo, confirme e todos verão. Se errou, você sai do jogo e guarda segredo.</p>
  </div>`, buttons: [{ label: 'Fechar', cls: 'primary' }] });
}

boot();
