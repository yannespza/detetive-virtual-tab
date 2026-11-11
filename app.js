import { COLS, ROWS, RIVER_ROW, LOCS, DECOR, CLUE_LOCS, UNSEALABLE, key, isPath, isBridge, locAt, doorDir, doorId, reachable } from './board.js';
import Sound from './sound.js';
import { grade } from './grade.js';

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
const stars = (c) => c?.level ? '★'.repeat(c.level) + '☆'.repeat(5 - c.level) : '';
const PLAYED_KEY = 'dvt-played-v2';
// guarda o título (o número do caso pode mudar quando os casos são reorganizados)
const playedSet = () => { try { return new Set(JSON.parse(localStorage.getItem(PLAYED_KEY) || '[]').map((t) => String(t).replace(/^\d+:/, ''))); } catch { return new Set(); } };
const playedTag = (c) => c.title;
function markPlayed(c) { if (!c) return; try { const p = playedSet(); p.add(playedTag(c)); localStorage.setItem(PLAYED_KEY, JSON.stringify([...p])); } catch {} }
// seletor compacto de caso: ‹ Caso › e toque no meio abre a lista
function casePicker(el, value, allowRandom, onChange) {
  const opts = [...(allowRandom ? [0] : []), ...S.cases.map((c) => c.id)];
  let v = value;
  const draw = () => {
    const c = caseOf(v), played = c && playedSet().has(playedTag(c));
    el.innerHTML = `<div class="cpick">
      <button type="button" class="cp-arr" data-d="-1" aria-label="Caso anterior">‹</button>
      <button type="button" class="cp-mid" id="cp-open">${c
        ? `<small>Caso ${c.id} · <span class="stars">${'★'.repeat(c.level || 0)}</span>${played ? ' · <span class="cp-done">✔ jogado</span>' : ''}</small><b>${esc(c.title.replace(/^O Caso d[aoe]s? /, ''))}</b>`
        : `<small>${S.cases.length} casos</small><b>🎲 Sortear um caso</b>`}<i>▾</i></button>
      <button type="button" class="cp-arr" data-d="1" aria-label="Próximo caso">›</button></div>
      ${c ? caseInfo(c) : `<p class="muted small cp-hint">O caso será sorteado entre os ${S.cases.length} disponíveis.</p>`}
      <input type="hidden" id="case" value="${v}">`;
    el.querySelectorAll('.cp-arr').forEach((b) => (b.onclick = () => set(opts[(opts.indexOf(v) + +b.dataset.d + opts.length) % opts.length])));
    $('#cp-open', el).onclick = openList;
  };
  const set = (nv) => { if (nv === v) return; v = nv; draw(); onChange?.(v); };
  const openList = () => {
    const p = playedSet();
    const wrap = modal({ cls: 'cases-modal', title: 'Escolha o caso', html: `<div class="clist">
      ${allowRandom ? `<button class="crow2 ${v === 0 ? 'on' : ''}" data-id="0"><span class="cn">🎲</span><span class="ct2">Sortear um caso</span></button>` : ''}
      ${S.cases.map((c) => `<button class="crow2 ${c.id === v ? 'on' : ''}" data-id="${c.id}"><span class="cn">${c.id}</span>
        <span class="ct2">${esc(c.title.replace(/^O Caso d[aoe]s? /, ''))}</span><span class="stars">${'★'.repeat(c.level || 0)}</span>${p.has(playedTag(c)) ? '<span class="cp-done">✔</span>' : '<span class="cp-done"></span>'}</button>`).join('')}
    </div>`, buttons: [{ label: 'Fechar', cls: 'ghost' }] });
    wrap.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => { closeModal(); set(+b.dataset.id); }));
    wrap.querySelector('.crow2.on')?.scrollIntoView({ block: 'center' });
  };
  draw();
}
const caseInfo = (c) => c ? `<div class="case-info"><span class="stars" title="Dificuldade">${stars(c)}</span><p>${esc(c.summary || '')}</p></div>` : '';

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
  await loadAccess();
  const params = new URLSearchParams(location.search);
  const invite = params.get('convite');
  if (invite) {
    history.replaceState(null, '', location.pathname);
    if (S.access && !S.access.has) {
      try { S.access = await api.redeemCode(invite, localStorage.getItem('dvt-name') || ''); toast(`🎉 Convite aceito! Você tem ${S.access.games_left} partidas.`, 4000); }
      catch (e) { renderHome(/usado/i.test(e.message) ? 'Este convite já foi usado por outra pessoa. Peça um convite novo.' : 'Convite inválido. Peça um convite novo.'); return; }
    } else if (S.access?.has) toast('Você já tem acesso ao jogo.');
  }
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

// ---------- acesso: partidas, convites e administrador ----------
// S.access = null quando o controle de acesso ainda não foi instalado no Supabase (aí não há limites)
async function loadAccess() {
  try { S.access = await api.myAccess(); } catch (e) { S.access = null; }
}
const adminOff = () => { try { return localStorage.getItem('dvt-admin-off') === '1'; } catch { return false; } };
const isAdmin = () => !adminOff() && (S.access ? !!S.access.is_admin : (() => { try { return localStorage.getItem('dvt-admin') === '1'; } catch { return false; } })());
function accessBar() {
  const a = S.access; if (!a) return '';
  if (a.is_admin) return `<p class="acc admin">👑 Administrador · sem limites</p>`;
  if (!a.has) return '';
  return `<p class="acc">🎟️ <b>${a.games_left}</b> partida${a.games_left === 1 ? '' : 's'} para criar · 📨 <b>${a.invites_left}</b> convite${a.invites_left === 1 ? '' : 's'}</p>`;
}
async function requestMore(kind) {
  let phone = ''; try { phone = await api.adminPhone(); } catch {}
  const name = localStorage.getItem('dvt-name') || 'um jogador';
  const msg = kind === 'access'
    ? `Olá! Sou ${name} e quero jogar o Detetive Virtual Tab. Pode me mandar um convite ou um código de liberação?`
    : `Olá! Sou ${name} no Detetive Virtual Tab (código do jogador: ${S.access?.code || '?'}). Usei as minhas partidas. Pode me mandar um código de liberação?`;
  location.href = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}
function noAccessCard() {
  const a = S.access;
  const none = a && !a.has, empty = a && a.has && !a.is_admin && a.games_left <= 0;
  if (!none && !empty) return '';
  return `<div class="card gate">
    ${none ? `<p><b>🔒 Você ainda não tem acesso para criar salas.</b></p><p class="small muted">Você pode entrar na sala de um amigo pelo código, mais abaixo. Para criar as suas partidas, use um convite ou um código de liberação.</p>`
      : `<p><b>🎟️ Você já usou as suas partidas.</b></p><p class="small muted">Para jogar mais, peça um código de liberação ao administrador. Entrar na sala de um amigo continua liberado.</p>`}
    <div class="row"><input id="rel-code" maxlength="12" placeholder="Código" style="text-transform:uppercase"><button class="btn" id="rel-go">Usar código</button></div>
    <button class="btn wa" id="rel-ask" style="width:100%;margin-top:8px">💬 ${none ? 'Pedir acesso' : 'Pedir mais partidas'} pelo WhatsApp</button>
  </div>`;
}
function bindNoAccess() {
  if (!$('#rel-go')) return;
  $('#rel-go').onclick = async () => {
    const c = $('#rel-code').value.trim(); if (!c) return;
    try { S.access = await api.redeemCode(c, localStorage.getItem('dvt-name') || ''); toast(`✅ Código aceito! Você tem ${S.access.games_left} partidas.`, 3500); renderHome(); }
    catch (e) { toast(/usado/i.test(e.message) ? 'Este código já foi usado.' : 'Código inválido.'); }
  };
  $('#rel-ask').onclick = () => requestMore(S.access?.has ? 'more' : 'access');
}

function colorPicker(taken = [], selected) {
  const first = COLORS.find((c) => !taken.includes(c.id))?.id;
  const sel = selected && !taken.includes(selected) ? selected : first;
  return `<div class="colors">${COLORS.map((c) => `<label class="color ${taken.includes(c.id) ? 'taken' : ''}" title="${c.name}">
    <input type="radio" name="color" value="${c.id}" ${c.id === sel ? 'checked' : ''} ${taken.includes(c.id) ? 'disabled' : ''}>
    <span style="background:${c.id}"></span></label>`).join('')}</div>`;
}
const logo = `<div class="logo"><div class="logo-badge">🔍</div><h1>Detetive<br><span>Virtual Tab</span></h1><p class="tagline">Investigações em Londres · 1 a 6 detetives</p></div>`;

function renderHome(errMsg) {
  const name = localStorage.getItem('dvt-name') || '';
  app.innerHTML = `<div class="home">${logo}
    <div class="card">
      ${errMsg ? `<p class="err">${esc(errMsg)}</p>` : ''}
      <label class="field"><span>Seu nome</span><input id="name" maxlength="20" value="${esc(name)}" placeholder="Ex.: Watson"></label>
      <div class="field"><span>Cor do seu peão</span>${colorPicker([], localStorage.getItem('dvt-color'))}</div>
      <div class="field"><span>Caso a investigar</span><div id="case-pick"></div></div>
      ${accessBar()}
      <button class="btn primary big" id="create" ${S.access && !S.access.is_admin && (!S.access.has || S.access.games_left <= 0) ? 'disabled' : ''}>Criar sala</button>
    </div>
    ${noAccessCard()}
    <div class="card small">
      <p>Recebeu um código de sala?</p>
      <div class="row"><input id="code" maxlength="5" placeholder="Código" style="text-transform:uppercase"><button class="btn" id="go">Entrar</button></div>
    </div>
    <button class="link" id="rules">Como jogar</button>
    <button class="btn share-app" id="share-app">📲 Compartilhar o jogo</button>
    <button class="link" id="rank">🏆 Ranking</button>
    ${isAdmin() ? '<button class="link small muted" id="imp">👑 Administração</button>' : ''}
  </div>`;
  // acesso escondido do administrador: 5 toques seguidos na lupa do logo
  let taps = 0, tapT = 0;
  $('.logo-badge').onclick = () => { const now = Date.now(); taps = now - tapT < 800 ? taps + 1 : 1; tapT = now; if (taps >= 5) { taps = 0; if (isAdmin()) showAdmin(); else showAdminLogin(); } };
  $('#rank').onclick = showRanking;
  $('#share-app').onclick = shareApp;
  $('#rules').onclick = showRules;
  $('#imp') && ($('#imp').onclick = showAdmin);
  bindNoAccess();
  casePicker($('#case-pick'), 0, true);
  $('#go').onclick = () => { const c = $('#code').value.trim(); if (c) location.search = '?sala=' + c.toUpperCase(); };
  $('#create').onclick = async () => {
    const n = $('#name').value.trim(); if (!n) return toast('Digite seu nome');
    const color = $('input[name=color]:checked').value;
    let cid = +$('#case').value; if (!cid) cid = S.cases[Math.floor(Math.random() * S.cases.length)].id;
    localStorage.setItem('dvt-name', n); localStorage.setItem('dvt-color', color);
    $('#create').disabled = true;
    try { const r = await api.createRoom(n, color, cid); if (S.access && !S.access.is_admin) S.access.games_left--; openRoom(r); }
    catch (e) {
      if (/SEM_ACESSO|SEM_PARTIDAS/.test(e.message)) { await loadAccess(); renderHome(); toast(/SEM_ACESSO/.test(e.message) ? 'Você ainda não tem acesso para criar salas.' : 'Você já usou as suas partidas.'); return; }
      toast(e.message); $('#create').disabled = false;
    }
  };
}

// ---------- atualizar casos (arquivo cifrado no site + senha) ----------
const b64 = (t) => Uint8Array.from(atob(t), (ch) => ch.charCodeAt(0));
async function decryptCases(pw) {
  const f = await (await fetch('cases.enc?v=' + Date.now(), { cache: 'no-store' })).json();
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(f.salt), iterations: f.iter, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(f.iv) }, key, b64(f.data));
  return JSON.parse(new TextDecoder().decode(plain));
}
const normPw = (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-');
function showAdminLogin() {
  const wrap = modal({ title: '🔐 Acesso do administrador', html: `<label class="field"><span>Senha dos casos</span><input id="adm-pw" autocomplete="off" autocapitalize="characters" spellcheck="false"></label><p class="small" id="adm-msg"></p>`,
    buttons: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Entrar', cls: 'primary', close: false, onClick: async () => {
      const pw = normPw($('#adm-pw', wrap).value); if (!pw) return;
      $('#adm-msg', wrap).textContent = 'Conferindo...';
      try { await api.claimAdmin(pw); }
      catch (e) {
        if (/Senha incorreta/.test(e.message)) { $('#adm-msg', wrap).textContent = '❌ Senha incorreta.'; return; }
        // controle de acesso ainda não instalado: confere a senha pelo arquivo dos casos
        try { await decryptCases(pw); } catch { $('#adm-msg', wrap).textContent = '❌ Senha incorreta.'; return; }
      }
      try { localStorage.setItem('dvt-admin', '1'); localStorage.removeItem('dvt-admin-off'); } catch {}
      await loadAccess();
      closeModal(); toast('Modo administrador ativado neste aparelho.'); renderHome();
    } }] });
}
function showAdmin() {
  const wrap = modal({ title: '👑 Administração', html: `<div class="loclist">
      <button class="btn" id="ad-imp">⚙️ Atualizar casos</button>
      <button class="btn" id="ad-rel">🎟️ Gerar código de liberação</button>
      <button class="btn" id="ad-inv">📨 Gerar convite para o jogo</button>
      <button class="btn" id="ad-pl">👥 Jogadores</button>
      <button class="btn" id="ad-ph">📱 Meu WhatsApp (para os pedidos)</button>
    </div>
    <p class="small muted">Os jogadores comuns têm 5 partidas e 5 convites. Você não tem limites.</p>
    <button class="link small" id="ad-out">Sair do modo administrador neste aparelho</button>`, buttons: [{ label: 'Fechar', cls: 'primary' }] });
  $('#ad-imp', wrap).onclick = showImport;
  $('#ad-inv', wrap).onclick = shareApp;
  $('#ad-rel', wrap).onclick = async () => {
    const n = +(prompt('Quantas partidas este código libera?', '5') || 0); if (!n) return;
    try {
      const code = await api.createRelease(n);
      const msg = `Seu código de liberação do Detetive Virtual Tab: ${code} (vale ${n} partidas). Na tela inicial, digite em "Usar código". ${location.origin + location.pathname}`;
      modal({ title: '🎟️ Código de liberação', html: `<div class="code">${esc(code)}</div><p class="small muted">Vale ${n} partida${n > 1 ? 's' : ''} e pode ser usado por uma pessoa só.</p>
        <div class="share"><a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">WhatsApp</a><button class="btn" id="rc-copy">Copiar</button></div>`,
        buttons: [{ label: 'Fechar', cls: 'primary' }] });
      $('#rc-copy').onclick = async () => { try { await navigator.clipboard.writeText(msg); toast('Copiado!'); } catch { prompt('Copie:', msg); } };
    } catch (e) { toast(adminErr(e)); }
  };
  $('#ad-ph', wrap).onclick = async () => {
    let cur = ''; try { cur = await api.adminPhone(); } catch {}
    const v = prompt('Seu WhatsApp com DDI e DDD (ex.: 5511999990000). Os pedidos de partidas chegam nele:', cur); if (v === null) return;
    try { await api.setAdminPhone(v); toast('WhatsApp salvo!'); } catch (e) { toast(adminErr(e)); }
  };
  $('#ad-pl', wrap).onclick = async () => {
    try {
      const list = await api.adminPlayers();
      modal({ cls: 'wide', title: '👥 Jogadores', html: list.length ? `<table class="rank"><thead><tr><th>Nome</th><th>Código</th><th title="Partidas">🎟️</th><th title="Convites">📨</th><th>Convidado por</th></tr></thead><tbody>
        ${list.map((p) => `<tr><td>${p.is_admin ? '👑 ' : ''}${esc(p.name || '—')}</td><td><code>${esc(p.code)}</code></td><td>${p.is_admin ? '∞' : p.games_left}</td><td>${p.is_admin ? '∞' : p.invites_left}</td><td>${esc(p.by || '—')}</td></tr>`).join('')}</tbody></table>`
        : '<p>Nenhum jogador ainda.</p>', buttons: [{ label: 'Fechar', cls: 'primary' }] });
    } catch (e) { toast(adminErr(e)); }
  };
  $('#ad-out', wrap).onclick = () => { try { localStorage.setItem('dvt-admin-off', '1'); localStorage.removeItem('dvt-admin'); } catch {} closeModal(); renderHome(); };
}
const adminErr = (e) => /function|schema cache/i.test(e.message) ? 'Falta rodar no Supabase o SQL do controle de acesso.' : e.message;
function showImport() {
  const wrap = modal({ title: '⚙️ Atualizar casos', html: `<p class="muted small">Carrega no servidor os casos mais novos do jogo. Só quem tem a senha dos casos consegue fazer isso.</p>
    <label class="field"><span>Senha dos casos</span><input id="imp-pw" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX"></label>
    <p class="small" id="imp-msg"></p>
`, buttons: [{ label: 'Fechar', cls: 'ghost' }, { label: 'Atualizar', cls: 'primary', close: false, onClick: async () => {
      const pw = normPw($('#imp-pw', wrap).value);
      const msg = $('#imp-msg', wrap); if (!pw) return;
      msg.textContent = 'Abrindo os casos...';
      let cases; try { cases = await decryptCases(pw); } catch { msg.textContent = '❌ Senha incorreta.'; return; }
      msg.textContent = `Enviando ${cases.length} casos ao servidor...`;
      try { const n = await api.importCases(pw, cases); S.cases = await api.listCases(); msg.textContent = `✅ ${n} casos atualizados!`; setTimeout(() => { closeModal(); renderHome(); }, 1500); }
      catch (e) { msg.textContent = /import_cases|function/i.test(e.message) ? '❌ Falta rodar no Supabase o SQL de atualização (passo 1).' : '❌ ' + e.message; }
    } }] });

}

// compartilhar o jogo em si (não uma sala): quem recebe pode criar as próprias partidas
async function shareApp() {
  const a = S.access;
  if (a && !a.has) return toast('Você ainda não tem acesso ao jogo para convidar alguém.');
  if (a && !a.is_admin && a.invites_left <= 0) return modal({ title: '📨 Convites', html: '<p>Você já usou os seus 5 convites.</p>', buttons: [{ label: 'Fechar', cls: 'primary' }] });
  if (a && !a.is_admin && !(await ask('Convidar alguém', `Cada convite vale para <b>uma pessoa</b>. Você tem <b>${a.invites_left}</b> convite${a.invites_left > 1 ? 's' : ''}. Gerar um convite agora?`, 'Gerar convite'))) return;
  let url = location.origin + location.pathname;
  if (a) {
    try { const t = await api.createInvite(); url += '?convite=' + t; if (!a.is_admin) a.invites_left--; }
    catch (e) { return toast(e.message); }
  }
  shareAppModal(url, a);
}
function shareAppModal(url, a) {
  const msg = `Conheça o Detetive Virtual Tab 🔍: um jogo de investigação para jogar com os amigos, cada um no seu celular. Abra no navegador ou instale na tela inicial: ${url}`;
  modal({ title: '📲 Compartilhar o jogo', html: `<p>${a ? 'Este convite vale para <b>uma pessoa</b>. Ela ganha 5 partidas e 5 convites.' : 'Envie o jogo para quem você quiser.'}</p>
    ${a && !a.is_admin ? `<p class="small muted">Convites restantes: ${a.invites_left}.</p>` : ''}
    <p class="muted small">Para chamar alguém para <b>uma partida</b>, use o link da sala, que aparece na tela da sala.</p>
    <div class="share">
      <a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">WhatsApp</a>
      <button class="btn" id="sa-copy">Copiar link</button>
      ${navigator.share ? '<button class="btn" id="sa-share">Compartilhar</button>' : ''}
    </div>`, buttons: [{ label: 'Fechar', cls: 'primary' }] });
  $('#sa-copy').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Link do jogo copiado!'); } catch { prompt('Copie o link:', url); } };
  $('#sa-share') && ($('#sa-share').onclick = () => navigator.share({ title: 'Detetive Virtual Tab', text: msg, url }).catch(() => {}));
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
  S.room = room; S.seenReact = room.state.react?.id ?? null; S.seenMove = room.state.lastMove?.id ?? null; S.seenRoll = room.state.turn?.rollId ?? null;
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
  if (s.react && s.react.id !== S.seenReact) { S.seenReact = s.react.id; if (Date.now() - s.react.t < 15000) showReaction(s.react); }
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
      ${isHost() ? `<div id="case-pick"></div>`
        : `<p><b>Caso ${c?.id} · ${esc(c?.title)}</b></p>${caseInfo(c)}`}
      <div class="dice-opt"><span>Dados</span>${isHost()
        ? `<div class="seg"><button data-dn="1" class="${(s.diceCount || 2) === 1 ? 'on' : ''}">🎲 1 dado</button><button data-dn="2" class="${(s.diceCount || 2) === 2 ? 'on' : ''}">🎲🎲 2 dados</button></div>`
        : `<b>${(s.diceCount || 2) === 1 ? '🎲 1 dado' : '🎲🎲 2 dados'}</b>`}</div>
      <p class="muted small">${(s.diceCount || 2) === 1 ? 'Com 1 dado, anda-se de 1 a 6 casas: a partida fica mais longa e estratégica.' : 'Com 2 dados, anda-se de 2 a 12 casas: a partida fica mais rápida.'}</p>
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
    casePicker($('#case-pick'), r.case_id, false, (id) => commit(() => true, { case_id: id }));
    $('#start').onclick = startGame;
    document.querySelectorAll('[data-dn]').forEach((b) => (b.onclick = () => commit((st2) => { st2.diceCount = +b.dataset.dn; })));
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
    s.startedAt = Date.now();
    const cc = caseOf(S.room.case_id); s.caseTitle = cc?.title; s.caseLevel = cc?.level;
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
  markPlayed(c); Sound.forCase(c?.id);
  app.innerHTML = `<div id="game">
    <header class="topbar">
      <button class="tb-case" id="b-case"><small>Caso ${c?.id}</small><span>${esc(c?.title)}</span></button>
      <button class="icon-btn" id="b-react" title="Reagir">😀</button>
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
  $('#b-react').onclick = toggleReactBar;
  buildBoard();
  if (!S.nb) api.getNotebook(S.room.id).then((nb) => { S.nb = S.nb || nb; updateBoard(); updatePlayersBadge(); }).catch(() => {});
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
  const seen = S.nb?.clues || {};
  document.querySelectorAll('.loc').forEach((l) => {
    $('.loc-extra', l).innerHTML = extras[l.dataset.loc] || '';
    l.classList.toggle('visited', !!seen[l.dataset.loc]);
  });
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
      S.reach = reachable({ from: s.pos[S.uid], steps: s.turn.dice.reduce((x, y) => x + y, 0), occupied: occupiedByOthers(), me: S.uid, seals: s.seals, hasKey: s.hasKey[S.uid] });
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
    updatePlayersBadge(); updateBoard();
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
const diceN = () => (st().diceCount === 1 ? 1 : 2);
async function spinDice(final) {
  const n = diceN();
  S.rolling = Array(n).fill(1); const end = Date.now() + 750; Sound.sfx('dice');
  while (Date.now() < end) { S.rolling = Array.from({ length: n }, rnd6); updatePanel(); await sleep(80); }
  S.rolling = null; updatePanel(); updateBoard();
}
async function animateDiceRemote(d) { await spinDice(d); }

async function rollDice() {
  const dice = Array.from({ length: diceN() }, rnd6), total = dice.reduce((x, y) => x + y, 0);
  await spinDice();
  await commit((s) => {
    if (s.order[s.turn.idx] !== S.uid || s.turn.phase !== 'start') return false;
    s.turn.dice = dice; s.turn.phase = 'move'; s.turn.rollId = (s.turn.rollId || 0) + 1;
    log(s, `${nameOf(S.uid)} tirou ${dice.length > 1 ? dice.join(' + ') + ' = ' : ''}${total} 🎲`);
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
  if (S.rolling) return `<div class="dice rolling">${S.rolling.map(dieSVG).join('')}</div>`;
  if (!d) return '';
  return `<div class="dice">${d.map(dieSVG).join('')}${d.length > 1 ? `<b>= ${d.reduce((x, y) => x + y, 0)}</b>` : ''}</div>`;
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
      btns.push([diceN() === 1 ? '🎲 Jogar o dado' : '🎲 Jogar os dados', 'primary', rollDice]);
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

// ---------- suspeitos, vítima e campos de resposta ----------
const suspectsOf = (c) => (c?.suspects || []).filter((p) => !p.victim);
const victimsOf = (c) => (c?.suspects || []).filter((p) => p.victim);
// pergunta "Quem...?": seletor ‹ nome › com os suspeitos não riscados; se houver ⭐, só os ⭐
const isWho = (q) => !!q.who;
function whoList(c, nb) {
  const st = nb?.answers?._sus || {};
  const list = suspectsOf(c).filter((p) => st[p.name] !== 'x');
  const starred = list.filter((p) => st[p.name] === 'star');
  return starred.length ? starred : list;
}
const answerField = (c, q, nb) => {
  const val = nb?.answers?.[q.key] || '';
  return `<label class="field"><span>${q.key}) ${esc(q.label)} <small>${esc(q.ask)}</small></span>${isWho(q)
    ? `<div class="who-pick" data-who="${q.key}"><input type="hidden" data-a="${q.key}" value="${esc(val)}"></div>`
    : `<input data-a="${q.key}" value="${esc(val)}">`}</label>`;
};
function drawWho(box, c, nb) {
  const inp = box.querySelector('input'), list = whoList(c, nb), st = nb?.answers?._sus || {};
  let i = list.findIndex((p) => p.name === inp.value);
  if (i < 0 && inp.value) { inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true })); }
  const p = list[i];
  [...box.children].forEach((ch) => ch !== inp && ch.remove());
  box.insertAdjacentHTML('afterbegin', `<div class="cpick">
    <button type="button" class="cp-arr" data-d="-1" aria-label="Suspeito anterior"${list.length ? '' : ' disabled'}>‹</button>
    <div class="cp-mid wp-mid">${p
      ? `<small>${st[p.name] === 'star' ? '⭐ ' : ''}${esc(p.role)} · ${i + 1}/${list.length}</small><b>${esc(p.name)}</b>`
      : `<small>${list.length ? `${list.length} suspeito${list.length > 1 ? 's' : ''}${list.some((x) => st[x.name] === 'star') ? ' com ⭐' : ''}` : 'todos riscados'}</small><b class="muted">${list.length ? 'Use as setas para escolher' : 'Nenhum suspeito disponível'}</b>`}</div>
    <button type="button" class="cp-arr" data-d="1" aria-label="Próximo suspeito"${list.length ? '' : ' disabled'}>›</button></div>`);
  box.querySelectorAll('.cp-arr').forEach((bt) => (bt.onclick = (e) => {
    e.preventDefault();
    const d = +bt.dataset.d, n = list.length; if (!n) return;
    const ni = i < 0 ? (d > 0 ? 0 : n - 1) : (i + d + n) % n;
    inp.value = list[ni].name; inp.dispatchEvent(new Event('input', { bubbles: true }));
    drawWho(box, c, nb);
  }));
}
function refreshWho(wrap, c, nb) { wrap.querySelectorAll('.who-pick').forEach((box) => drawWho(box, c, nb)); }

// ---------- acusação ----------
// ---------- conferência automática das respostas ----------
async function accuse() {
  if (!S.nb) S.nb = await api.getNotebook(S.room.id).catch(() => ({ clues: {}, answers: {}, notes: '' }));
  const c = caseOf(S.room.case_id), ans = S.nb.answers || {};
  const wrap = modal({ title: '🕵️ Sua solução', cls: 'wide', dismiss: false,
    html: `<p class="muted small">Revise suas respostas. Elas não precisam ser iguais às do jogo, mas precisam ter as informações certas. <b>Se alguma estiver errada ou incompleta, você sai do jogo.</b></p>
      ${c.questions.map((q) => answerField(c, q, S.nb)).join('')}`,
    buttons: [{ label: 'Voltar', cls: 'ghost' }, { label: '🔍 Conferir respostas', cls: 'primary', close: false, onClick: () => submitAccusation(wrap) }] });
  refreshWho(wrap, c, S.nb);
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
        <div class="off"><small>Solução oficial</small>${esc(off.answer)}</div>${whyBox(off)}</div>`).join('')}
      <details><summary>Como tudo aconteceu</summary><div class="story">${esc(sol.text).split('\n\n').map((p) => `<p>${p}</p>`).join('')}</div></details>`,
    buttons: manual ? [{ label: '❌ Errei', cls: 'danger', onClick: () => accuseResult(false) }, { label: '✔️ Acertei', cls: 'primary', onClick: () => accuseResult(true) }]
      : allOk ? [{ label: '🏆 Confirmar acerto', cls: 'primary', onClick: () => accuseResult(true) }]
      : [{ label: '❌ Errei, sair do jogo', cls: 'danger', onClick: () => accuseResult(false) }] });
}
const whyBox = (x) => x?.why ? `<details class="why"><summary>🔎 Como chegar a esta resposta</summary><p>${esc(x.why)}</p></details>` : '';
async function accuseResult(right) {
  if (right) {
    const answers = { ...(S.nb?.answers || {}) };
    await commit((s) => { s.winner = S.uid; s.winnerAnswers = answers; s.accuser = null; s.endedAt = Date.now(); log(s, `🏆 ${nameOf(S.uid)} resolveu o caso!`); }, { status: 'finished' });
  } else {
    let finished = false;
    await commit((s) => {
      s.eliminated[S.uid] = true; s.accuser = null; s.pos[S.uid] = { loc: 'out', cell: null };
      log(s, `❌ ${nameOf(S.uid)} errou a solução e saiu do jogo.`);
      finished = s.order.every((id) => s.eliminated[id]);
      if (finished) { log(s, 'Todos erraram. O culpado escapou!'); s.endedAt = Date.now(); } else endTurn(s);
    }, {});
    if (st().order.every((id) => st().eliminated[id])) await commit(() => true, { status: 'finished' });
  }
}
async function showEnd() {
  let sol = null;
  try { sol = await api.revealSolution(S.room.id); } catch {}
  const s = st(), c = caseOf(S.room.case_id);
  const dur = s.startedAt && s.endedAt ? fmtMin(s.endedAt - s.startedAt) : null;
  const wrap = modal({ cls: 'wide', title: s.winner ? `🏆 ${esc(nameOf(s.winner))} resolveu o caso!` : '🕯️ O culpado escapou...',
    html: `<p><b>Caso ${c.id} · ${esc(c.title)}</b>${dur ? `<br><span class="muted small">⏱️ Tempo da partida: <b>${dur}</b> · ${s.order.length} detetive${s.order.length > 1 ? 's' : ''}</span>` : ''}</p>
      <div id="rate-box"></div>
      ${sol ? sol.solution.map((x) => `<div class="cmp"><div class="q">${x.key}) ${esc(x.label)}</div>
        ${s.winner ? `<div class="mine"><small>Resposta de ${esc(nameOf(s.winner))}</small>${esc(s.winnerAnswers?.[x.key] || '—')}</div>` : ''}
        <div class="off"><small>Solução oficial</small>${esc(x.answer)}</div>${whyBox(x)}</div>`).join('')
        + `<h4 class="sol-h">Como tudo aconteceu</h4><div class="story">${esc(sol.text).split('\n\n').map((p) => `<p>${p}</p>`).join('')}</div>` : '<p>Não foi possível carregar a solução.</p>'}`,
    buttons: [{ label: 'Fechar', cls: 'ghost' }, { label: 'Nova partida', cls: 'primary', onClick: leaveRoom }] });
  drawRating($('#rate-box', wrap));
}

// ---------- avaliação do caso (no fim da partida) ----------
const DIFF = { facil: '😌 Fácil', justo: '👌 Na medida', dificil: '🤯 Difícil demais' };
function drawRating(box) {
  if (!box) return;
  const mine = st().ratings?.[S.uid];
  if (mine) {
    box.innerHTML = `<div class="rate done">Sua avaliação: <span class="stars">${'★'.repeat(mine.stars)}${'☆'.repeat(5 - mine.stars)}</span> · ${DIFF[mine.diff] || ''} <button class="link small" id="rate-edit">alterar</button></div>`;
    $('#rate-edit', box).onclick = () => { box.dataset.edit = '1'; drawRatingForm(box, mine); };
    return;
  }
  drawRatingForm(box, {});
}
function drawRatingForm(box, cur) {
  let stars = cur.stars || 0, diff = cur.diff || '';
  box.innerHTML = `<div class="rate"><b>O que achou deste caso?</b>
    <div class="rate-stars">${[1, 2, 3, 4, 5].map((n) => `<button data-s="${n}" aria-label="${n} estrelas">☆</button>`).join('')}</div>
    <div class="rate-diff">${Object.entries(DIFF).map(([k, v]) => `<button data-d="${k}">${v}</button>`).join('')}</div>
    <textarea id="rate-c" rows="2" maxlength="300" placeholder="Comentário (opcional): o que achou da história, das pistas, das charadas?">${esc(cur.comment || '')}</textarea>
    <button class="btn primary" id="rate-send" disabled>Enviar avaliação</button></div>`;
  const upd = () => {
    box.querySelectorAll('[data-s]').forEach((b) => { b.textContent = +b.dataset.s <= stars ? '★' : '☆'; b.classList.toggle('on', +b.dataset.s <= stars); });
    box.querySelectorAll('[data-d]').forEach((b) => b.classList.toggle('on', b.dataset.d === diff));
    $('#rate-send', box).disabled = !(stars && diff);
  };
  box.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => { stars = +b.dataset.s; upd(); }));
  box.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { diff = b.dataset.d; upd(); }));
  $('#rate-send', box).onclick = async () => {
    const comment = $('#rate-c', box).value.trim().slice(0, 300);
    $('#rate-send', box).disabled = true;
    const ok = await commit((s) => { s.ratings = s.ratings || {}; s.ratings[S.uid] = { stars, diff, comment, name: nameOf(S.uid), t: Date.now() }; });
    if (ok) { toast('Obrigado pela avaliação!'); drawRating(box); } else $('#rate-send', box).disabled = false;
  };
  upd();
}

// ---------- caso, caderneta, menu ----------
function showCase() {
  const c = caseOf(S.room.case_id);
  modal({ cls: 'wide', title: `📜 Caso ${c.id} <span class="stars">${stars(c)}</span>`, html: `<h3 class="case-title">${esc(c.title)}</h3>
    <div class="story">${esc(c.story).split('\n\n').map((p) => `<p>${p}</p>`).join('')}</div>
    ${victimsOf(c).length ? `<p class="small"><b>⚰️ Vítima:</b> ${victimsOf(c).map((p) => `${esc(p.name)} <i>(${esc(p.role)})</i>`).join(', ')}</p>` : ''}
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
    ${victimsOf(c).length ? `<h4>⚰️ Vítima${victimsOf(c).length > 1 ? 's' : ''}</h4><ul class="victims">${victimsOf(c).map((p) => `<li><b>${esc(p.name)}</b> <span>${esc(p.role)}</span></li>`).join('')}</ul>` : ''}
    ${suspectsOf(c).length ? `<h4>🕵️ Suspeitos <small class="muted">toque para riscar ou destacar</small></h4><ul class="suspects">${suspectsOf(c).map((p, i) => `<li data-sus="${i}" class="sus-${(nb.answers?._sus || {})[p.name] || 'none'}"><i class="sus-ico"></i><b>${esc(p.name)}</b> <span>${esc(p.role)}</span></li>`).join('')}</ul>` : ''}
    <h4>Pistas</h4>
    <div class="clues">${CLUE_LOCS.map((l) => `<div class="crow ${nb.clues[l] ? '' : 'empty'}"><div class="cl">${LOCS[l].icon} ${esc(LOCS[l].name)}</div>
      <div class="ct">${nb.clues[l] ? esc(nb.clues[l]).replace(/\n/g, '<br>') : '—'}</div></div>`).join('')}</div>
    <h4>Soluções</h4>
    ${c.questions.map((q) => answerField(c, q, nb)).join('')}
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
  refreshWho(wrap, c, nb);
  // suspeitos: normal → riscado → principal → normal
  const NEXT = { none: 'x', x: 'star', star: 'none' };
  wrap.querySelectorAll('[data-sus]').forEach((li) => (li.onclick = () => {
    const name = suspectsOf(c)[+li.dataset.sus].name;
    nb.answers = nb.answers || {}; const m = (nb.answers._sus = { ...(nb.answers._sus || {}) });
    const nv = NEXT[m[name] || 'none']; if (nv === 'none') delete m[name]; else m[name] = nv;
    li.className = 'sus-' + nv;
    refreshWho(wrap, c, nb);
    wrap.querySelectorAll('[data-a]').forEach((i) => (nb.answers[i.dataset.a] = i.value));
    $('#saved', wrap).textContent = 'Salvando...'; clearTimeout(saveTimer); saveTimer = setTimeout(flushNotebook, 500);
  }));
}
// junta as partes das charadas ("Pista do X (N partes): I) ...") encontradas em locais diferentes
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
function groupRiddles(clues = {}) {
  const groups = {};
  for (const [loc, txt] of Object.entries(clues)) {
    let g = null;   // um local pode ter várias charadas, em qualquer ordem, separadas por linha em branco
    for (const line of String(txt || '').split('\n')) {
      const h = /^(.+?)\s*\((\d+)\s*partes?\)\s*:?\s*$/.exec(line.trim());
      if (h) { const label = h[1].trim(); g = groups[label] || (groups[label] = { label, total: +h[2], parts: {} }); continue; }
      if (!line.trim()) { g = null; continue; }
      if (!g) continue;
      const p = /^\s*([IVX]+)\)\s*(.*)$/.exec(line);
      if (p) g.parts[p[1]] = { text: p[2].trim(), loc };
      else { const last = Object.keys(g.parts).pop(); if (last) g.parts[last].text += ' ' + line.trim(); }
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
    { label: '🏆 Ranking', onClick: showRanking },
    { label: '📲 Compartilhar o jogo', onClick: shareApp },
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
    <p class="muted small">🎵 Trilha deste caso: <b>${esc(Sound.track)}</b>. São 4 trilhas, que mudam sozinhas a cada caso.</p>
    <label class="switch"><input type="checkbox" id="sw-f" ${Sound.fx ? 'checked' : ''}><span>Sons dos locais e dos dados</span></label>
    <button class="btn" id="sw-t" style="width:100%;margin-top:12px">🔔 Testar som</button>
    <p class="muted small">No iPhone, confira se o volume está alto. Se ainda assim não tocar, toque em "Testar som".</p>`, buttons: [{ label: 'Pronto', cls: 'primary' }] });
  $('#sw-t', wrap).onclick = () => Sound.test(['hotel', 'docas', 'teatro', 'parque', 'estacao', 'scotland'][Math.floor(Math.random() * 6)]);
  const upd = () => { Sound.set($('#sw-m', wrap).checked, $('#sw-f', wrap).checked); $('#b-snd').textContent = Sound.icon(); };
  $('#sw-m', wrap).onchange = upd; $('#sw-f', wrap).onchange = upd;
}
// ---------- reações rápidas ----------
const EMOJIS = ['🤔', '😱', '👏', '😂', '🕵️', '🙄', '🔥', '🤫'];
function toggleReactBar() {
  const old = $('.react-bar'); if (old) { old.remove(); return; }
  const bar = document.createElement('div'); bar.className = 'react-bar';
  bar.innerHTML = EMOJIS.map((e) => `<button data-e="${e}">${e}</button>`).join('');
  bar.onclick = async (ev) => {
    const e = ev.target.closest('[data-e]')?.dataset.e; if (!e) return;
    bar.remove();
    if (Date.now() - (S.lastReact || 0) < 2500) return toast('Calma, detetive! Espere um instante.');
    S.lastReact = Date.now();
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    S.seenReact = id; showReaction({ by: S.uid, e, id, t: Date.now() });
    await commit((s) => { s.react = { by: S.uid, e, id, t: Date.now() }; });
  };
  document.body.appendChild(bar);
  setTimeout(() => bar.remove(), 6000);
}
function showReaction(r) {
  const el = document.createElement('div'); el.className = 'react-pop';
  el.style.left = 12 + Math.random() * 55 + '%';
  el.innerHTML = `<span class="re">${esc(r.e)}</span><span class="rn" style="background:${colorOf(r.by)}">${esc(nameOf(r.by))}</span>`;
  document.body.appendChild(el); setTimeout(() => el.remove(), 3200);
}

// ---------- ranking (só partidas com 2 ou mais jogadores) ----------
const nkey = (n) => String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const fmtMin = (ms) => { const m = Math.round(ms / 60000); if (m < 1) return "menos de 1 min"; return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`; };
async function showRanking() {
  const wrap = modal({ cls: 'wide', title: '🏆 Ranking', html: '<div class="center"><div class="spinner"></div></div>', buttons: [{ label: 'Fechar', cls: 'primary' }] });
  let rooms = [];
  try { rooms = await api.listFinished(); } catch (e) { $('.modal-body', wrap).innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const body = $('.modal-body', wrap);
  body.innerHTML = `<div class="tabs"><button data-t="p" class="on">🕵️ Detetives</button><button data-t="c">📊 Casos</button></div><div id="tab-p"></div><div id="tab-c" hidden></div>`;
  body.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => {
    body.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('on', x === b));
    $('#tab-p', body).hidden = b.dataset.t !== 'p'; $('#tab-c', body).hidden = b.dataset.t !== 'c';
  }));
  $('#tab-c', body).innerHTML = caseStatsHTML(rooms);
  const P = {}, recent = [];
  for (const r of rooms) {
    const s = r.state || {}; if ((s.order || []).length < 2) continue;   // sozinho não conta
    for (const id of s.order) {
      const pl = (s.players || []).find((x) => x.id === id); if (!pl) continue;
      const k = nkey(pl.name); const p = P[k] || (P[k] = { name: pl.name, color: pl.color, games: 0, wins: 0, wrong: 0, times: [] });
      p.games++; if (s.eliminated?.[id]) p.wrong++;
      if (s.winner === id) { p.wins++; if (s.startedAt && s.endedAt) p.times.push(s.endedAt - s.startedAt); }
    }
    if (s.winner) recent.push({ who: (s.players || []).find((x) => x.id === s.winner)?.name, c: s.caseTitle ? { title: s.caseTitle, level: s.caseLevel } : caseOf(r.case_id), t: s.startedAt && s.endedAt ? s.endedAt - s.startedAt : null, n: s.order.length });
  }
  const list = Object.values(P).sort((a, b) => b.wins - a.wins || b.wins / b.games - a.wins / a.games || a.wrong - b.wrong);
  const medal = ['🥇', '🥈', '🥉'];
  $('#tab-p', body).innerHTML = list.length ? `<table class="rank"><thead><tr><th></th><th>Detetive</th><th title="Casos resolvidos">🏆</th><th title="Partidas">Jogos</th><th title="Acusações erradas">❌</th><th title="Tempo médio para resolver">⏱️</th></tr></thead><tbody>
      ${list.map((p, i) => `<tr><td>${medal[i] || i + 1}</td><td><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</td><td><b>${p.wins}</b></td><td>${p.games}</td><td>${p.wrong}</td><td>${p.times.length ? fmtMin(p.times.reduce((a, b) => a + b, 0) / p.times.length) : '—'}</td></tr>`).join('')}
    </tbody></table>
    ${recent.length ? `<h4>Últimos casos resolvidos</h4><ul class="recent">${recent.slice(0, 8).map((x) => `<li><b>${esc(x.who)}</b> resolveu <i>${esc(x.c?.title || 'um caso')}</i> ${x.c?.level ? `<span class="stars">${'★'.repeat(x.c.level)}</span>` : ''}<small>${x.n} jogadores${x.t ? ' · ' + fmtMin(x.t) : ''}</small></li>`).join('')}</ul>` : ''}
    <p class="muted small">Contam só partidas terminadas com 2 ou mais detetives. Partidas sozinho (modo treino) ficam de fora. Quem usa o mesmo nome é contado como a mesma pessoa.</p>`
    : '<p>Nenhuma partida com 2 ou mais detetives terminou ainda. Partidas sozinho não contam para o ranking.</p>';
}

// estatísticas por caso: partidas, tempo e avaliações (aqui contam também as partidas sozinho)
function caseStatsHTML(rooms) {
  const C = {};
  for (const r of rooms) {
    const s = r.state || {}; if (!s.order) continue;
    const title = s.caseTitle || caseOf(r.case_id)?.title || `Caso ${r.case_id}`;
    const k = title; const c = C[k] || (C[k] = { title, level: s.caseLevel || caseOf(r.case_id)?.level, games: 0, solved: 0, times: [], rates: [], diff: { facil: 0, justo: 0, dificil: 0 }, comments: [], last: 0 });
    c.games++; if (s.winner) c.solved++;
    if (s.startedAt && s.endedAt) c.times.push({ ms: s.endedAt - s.startedAt, n: s.order.length });
    c.last = Math.max(c.last, s.endedAt || 0);
    Object.values(s.ratings || {}).forEach((x) => { c.rates.push(x.stars); if (c.diff[x.diff] !== undefined) c.diff[x.diff]++; if (x.comment) c.comments.push(`${x.name}: ${x.comment}`); });
  }
  const list = Object.values(C).sort((a, b) => (caseByTitle(a.title)?.id || 99) - (caseByTitle(b.title)?.id || 99));
  if (!list.length) return '<p>Nenhuma partida terminou ainda.</p>';
  return `<div class="cstats">${list.map((c) => {
    const avg = c.rates.length ? c.rates.reduce((a, b) => a + b, 0) / c.rates.length : 0;
    const tm = c.times.length ? fmtMin(c.times.reduce((a, b) => a + b.ms, 0) / c.times.length) : '—';
    const id = caseByTitle(c.title)?.id;
    return `<div class="cs"><div class="cs-h"><b>${id ? id + '. ' : ''}${esc(c.title.replace(/^O Caso d[aoe]s? /, ''))}</b> <span class="stars">${'★'.repeat(c.level || 0)}</span></div>
      <div class="cs-n">🎲 ${c.games} partida${c.games > 1 ? 's' : ''} · 🏆 ${c.solved} resolvida${c.solved !== 1 ? 's' : ''} · ⏱️ média ${tm}</div>
      ${c.times.length ? `<div class="cs-t">Tempos: ${c.times.map((t) => `${fmtMin(t.ms)} (${t.n}👤)`).join(' · ')}</div>` : ''}
      <div class="cs-n">${c.rates.length ? `Nota <span class="stars">${'★'.repeat(Math.round(avg))}${'☆'.repeat(5 - Math.round(avg))}</span> ${avg.toFixed(1)} (${c.rates.length} voto${c.rates.length > 1 ? 's' : ''}) · 😌 ${c.diff.facil} · 👌 ${c.diff.justo} · 🤯 ${c.diff.dificil}` : '<span class="muted">Sem avaliações ainda</span>'}</div>
      ${c.comments.length ? `<details><summary>💬 ${c.comments.length} comentário${c.comments.length > 1 ? 's' : ''}</summary>${c.comments.map((x) => `<p class="cs-c">${esc(x)}</p>`).join('')}</details>` : ''}</div>`;
  }).join('')}</div><p class="muted small">Aqui contam todas as partidas terminadas, inclusive as jogadas sozinho. 😌 fácil · 👌 na medida · 🤯 difícil demais.</p>`;
}
const caseByTitle = (t) => S.cases.find((c) => c.title === t);

function showHistory() {
  modal({ title: '🧾 Histórico', html: `<div class="history">${(st().log || []).slice().reverse().map((x) => `<div>${esc(x.msg)}</div>`).join('')}</div>`, buttons: [{ label: 'Fechar', cls: 'primary' }] });
}
function showRules() {
  modal({ cls: 'wide', title: '📖 Como jogar', html: `<div class="rules">
    <p><b>Objetivo:</b> ser o primeiro detetive a responder corretamente todos os itens do caso.</p>
    <p><b>Início:</b> todos começam na Casa de Sherlock Holmes. Leia o caso (botão no topo).</p>
    <p><b>Na sua vez:</b> jogue os dados e ande até a soma dos pontos (o anfitrião escolhe, antes de começar, se a partida usa 1 ou 2 dados), na horizontal ou vertical. Você pode passar por cima de outros peões, mas não parar na mesma casa. Ao chegar à seta de um local, você entra nele.</p>
    <p><b>Pistas:</b> ao entrar num local, você recebe a pista dele só na sua tela, e ela vai direto para a sua caderneta. Algumas são frases; outras são charadas em partes (I, II, III) espalhadas por vários locais. Alguns locais não têm pista.</p>
    <p><b>Duas entradas:</b> Parque, Museu e Hotel têm duas entradas.</p>
    <p><b>Distintivo 🛡️:</b> antes de sair de um local, você pode lacrar uma entrada dele. Ninguém entra por ela, a não ser você. Não vale lacrar a Scotland Yard, o Chaveiro nem a Casa de Sherlock Holmes.</p>
    <p><b>Chave mestra 🔑:</b> abre uma entrada lacrada. O distintivo vai para a Scotland Yard e a chave volta ao Chaveiro. Para recuperar, vá até lá. Com 2 jogadores, as chaves começam no Chaveiro; com 3 ou mais, cada um começa com a sua.</p>
    <p><b>Estação de Carruagens 🐎:</b> ao entrar, escolha: ler a pista dela (e na próxima vez ir de carruagem a qualquer local, sem dados) ou ir de carruagem agora para outro local e ler a pista de lá.</p>
    <p><b>Ponte:</b> o rio só pode ser atravessado pelas pontes.</p>
    <p><b>Charadas:</b> as partes de uma charada ficam em locais diferentes, e um mesmo local pode guardar partes de charadas diferentes. A caderneta junta as partes sozinha, na seção 🧩 Charadas.</p>
    <p><b>Locais visitados ✔:</b> no tabuleiro, os locais cuja pista você já leu ganham um ✔. Só você vê os seus.</p>
    <p><b>Caderneta 📒:</b> traz a vítima, as pistas, as charadas e a lista de suspeitos. Toque num suspeito para riscá-lo; toque de novo para marcá-lo como principal suspeito ⭐; mais um toque volta ao normal. Nas perguntas "Quem...?", você escolhe o nome numa lista: os riscados somem dela e os ⭐ aparecem primeiro. Só você vê.</p>
    <p><b>Solução:</b> quando achar que sabe tudo, volte à Casa de Sherlock Holmes e toque em "Apresentar solução". Antes de conferir, dá para revisar e corrigir as respostas. Só você vê a solução oficial.</p>
    <p><b>Conferência:</b> as respostas não precisam ser iguais às do jogo. Basta a palavra certa: um nome (só o primeiro nome já vale), um lugar ou um objeto. Erros de digitação leves são aceitos. Verde = certa, amarelo = incompleta, vermelho = errada. Responder mais de um suspeito na mesma pergunta conta como errado. Só com tudo verde aparece o botão de acerto; se errar, você sai do jogo e guarda segredo.</p>
    <p><b>Fim do caso:</b> todos veem as respostas de quem acertou ao lado da solução oficial, com "🔎 Como chegar a esta resposta", que mostra quais pistas levavam a cada conclusão.</p>
    <p><b>Som 🔊:</b> música ambiente e um som característico ao entrar em cada local. São 4 trilhas de música, que trocam sozinhas a cada caso. Dá para ligar e desligar no 🔊 do topo.</p>
    <p><b>Reações 😀:</b> durante a partida, toque no 😀 do topo e mande um emoji que aparece para todos por alguns segundos.</p>
    <p><b>Acesso:</b> cada jogador recebe 5 partidas para criar e 5 convites para chamar outras pessoas para o jogo. Só criar uma sala gasta partida: entrar na sala de um amigo pelo link ou código é sempre livre. Quando acabarem as partidas, toque em "Pedir mais partidas" e o administrador manda um código de liberação.</p>
    <p><b>Convites:</b> o link da sala chama alguém para aquela partida, e qualquer jogador que já está na sala pode repassá-lo. Só o anfitrião (quem criou a sala) escolhe o caso e começa a partida. Para mandar o jogo a alguém, para que a pessoa crie as próprias salas, use "📲 Compartilhar o jogo", na tela inicial ou no menu ☰. Cada link de convite vale para uma pessoa.</p>
    <p><b>Avaliação ⭐:</b> no fim de cada partida, cada detetive dá uma nota ao caso e diz se foi fácil, na medida ou difícil demais. O tempo da partida fica registrado. Tudo aparece no Ranking, na aba 📊 Casos.</p>
    <p><b>Ranking 🏆:</b> conta vitórias, partidas, acusações erradas e tempo médio para resolver. Só valem partidas com 2 ou mais detetives: partidas sozinho (modo treino) não contam. Use sempre o mesmo nome para somar os pontos.</p>
    <p><b>Casos jogados ✔:</b> na escolha do caso, os que você já jogou neste aparelho aparecem com ✔.</p>
  </div>`, buttons: [{ label: 'Fechar', cls: 'primary' }] });
}

boot();
