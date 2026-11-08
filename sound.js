// Música ambiente e efeitos sonoros criados direto no navegador (sem arquivos de áudio).
let ctx = null, master, musicBus, fxBus, reverb, noiseBuf, musicOn = false, musicTimer = null, melodyTimer = null, silentEl = null;
const pref = (() => { try { return JSON.parse(localStorage.getItem('dvt-sound') || '{}'); } catch { return {}; } })();
const state = { music: pref.music !== false, fx: pref.fx !== false };
const MUSIC_VOL = 0.5, FX_VOL = 0.75;

// arquivo de áudio mudo: no iPhone, tocar um <audio> faz o som funcionar mesmo com a chave de silêncio ligada
function silentWav() {
  const sr = 8000, n = sr / 2, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  let bin = ''; new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
  return 'data:audio/wav;base64,' + btoa(bin);
}

function unlock() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
  if (!silentEl) {
    silentEl = document.createElement('audio');
    silentEl.src = silentWav(); silentEl.loop = true; silentEl.setAttribute('playsinline', ''); silentEl.volume = 0.01;
  }
  silentEl.play().catch(() => {});
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = state.music ? MUSIC_VOL : 0; musicBus.connect(master);
    fxBus = ctx.createGain(); fxBus.gain.value = state.fx ? FX_VOL : 0; fxBus.connect(master);
    reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.4, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    reverb.buffer = ir; const rg = ctx.createGain(); rg.gain.value = 0.32; reverb.connect(rg); rg.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    // "acorda" o áudio do iPhone com um som vazio dentro do toque
    const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0);
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  if (state.music && !musicOn) startMusic();
}
// eventos que o iPhone aceita como "toque do usuário"
['touchend', 'click', 'pointerup', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock, { passive: true }));
document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.visibilityState === 'hidden') { ctx.suspend(); silentEl?.pause(); }
  else { ctx.resume().catch(() => {}); if (silentEl && (state.music || state.fx)) silentEl.play().catch(() => {}); }
});

// ---------- blocos de som ----------
const T = () => ctx.currentTime;
function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function tone(freq, t, dur, { type = 'sine', gain = 0.3, attack = 0.005, bus = fxBus, rev = 0.25, glide, vib, lp } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
  if (vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = vib[0]; lg.gain.value = vib[1]; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + attack + dur + 0.1); }
  let out = o;
  if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); out = f; }
  env(g, t, attack, gain, dur); out.connect(g); g.connect(bus);
  if (rev) { const s = ctx.createGain(); s.gain.value = rev; g.connect(s); s.connect(reverb); }
  o.start(t); o.stop(t + attack + dur + 0.1); return o;
}
function noise(t, dur, { type = 'bandpass', freq = 1000, q = 1, gain = 0.3, attack = 0.005, bus = fxBus, rev = 0.2, sweep, am } = {}) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  const g = ctx.createGain(); env(g, t, attack, gain, dur);
  let last = g;
  if (am) { const a = ctx.createGain(), l = ctx.createOscillator(), lg = ctx.createGain(); a.gain.value = 0.6; l.frequency.value = am; lg.gain.value = 0.4; l.connect(lg); lg.connect(a.gain); l.start(t); l.stop(t + attack + dur + 0.1); g.connect(a); last = a; }
  src.connect(f); f.connect(g); last.connect(bus);
  if (rev) { const s = ctx.createGain(); s.gain.value = rev; last.connect(s); s.connect(reverb); }
  src.start(t, Math.random()); src.stop(t + attack + dur + 0.1);
}
// sino / metal: parciais inarmônicos
const metal = (f, t, d, gain, rev = 0.25) => { [[1, 1], [2.76, 0.4], [5.4, 0.18], [8.9, 0.08]].forEach(([m, a]) => tone(f * m, t, d / m ** 0.3, { gain: gain * a, rev })); };
const knock = (f, t, gain = 0.4) => { tone(f, t, 0.07, { gain, rev: 0.12 }); tone(f * 1.5, t, 0.05, { gain: gain * 0.5, rev: 0.1 }); noise(t, 0.02, { type: 'highpass', freq: 3000, gain: gain * 0.4, rev: 0 }); };

// ---------- efeitos de cada local ----------
const FX = {
  bar(t) { // conversa de bar + brinde de copos
    noise(t, 1.8, { freq: 420, q: 0.8, gain: 0.12, attack: 0.4, am: 5, rev: 0.3 });
    noise(t + 0.2, 1.4, { freq: 900, q: 1.2, gain: 0.05, attack: 0.3, am: 7, rev: 0.3 });
    metal(2300, t + 0.5, 0.6, 0.14); metal(2650, t + 0.62, 0.6, 0.11);
  },
  farmacia(t) { metal(1568, t, 1.1, 0.16); metal(1975, t + 0.14, 1.1, 0.12); metal(1568, t + 0.32, 0.8, 0.08); },
  banco(t) { for (let i = 0; i < 8; i++) metal(2400 + Math.random() * 1600, t + i * 0.075 + Math.random() * 0.04, 0.35, 0.07, 0.1); },
  docas(t) { // ondas, gaivota e apito de navio distante
    noise(t, 2.6, { type: 'lowpass', freq: 380, sweep: 1100, gain: 0.22, attack: 1.1, rev: 0.3 });
    [0.3, 0.75].forEach((d) => tone(1500, t + d, 0.32, { gain: 0.05, glide: 1050, vib: [14, 40], rev: 0.4, type: 'triangle' }));
    [110, 111.5].forEach((f) => tone(f, t + 1, 1.6, { type: 'sawtooth', gain: 0.07, attack: 0.25, lp: 420, rev: 0.6 }));
  },
  hotel(t) { metal(2637, t, 1.8, 0.2); },
  chaveiro(t) { for (let i = 0; i < 14; i++) metal(3600 + Math.random() * 2600, t + Math.random() * 0.6, 0.18, 0.045, 0.08); },
  museu(t) { // passos que ecoam num salão vazio
    [0, 0.5, 1.0].forEach((d) => { noise(t + d, 0.09, { type: 'lowpass', freq: 260, gain: 0.55, rev: 1 }); noise(t + d, 0.02, { type: 'highpass', freq: 2500, gain: 0.08, rev: 0.8 }); });
  },
  charutaria(t) { // fósforo riscado e chama
    noise(t, 0.2, { type: 'highpass', freq: 2200, gain: 0.32, sweep: 6500 });
    noise(t + 0.18, 1.1, { type: 'bandpass', freq: 700, q: 0.6, gain: 0.08, attack: 0.1, am: 9 });
  },
  parque(t) { // passarinhos
    const chirp = (d, base) => { for (let k = 0; k < 3; k++) tone(base, t + d + k * 0.09, 0.06, { gain: 0.07, glide: base * 1.6, rev: 0.25 }); };
    chirp(0, 3000); chirp(0.45, 3600); chirp(0.95, 3100); chirp(1.3, 3800);
  },
  teatro(t) { // aplausos que crescem e somem
    for (let i = 0; i < 140; i++) {
      const d = Math.random() * 2.2, vol = Math.sin(Math.PI * Math.min(1, d / 2.2)) * 0.13 + 0.02;
      noise(t + d, 0.025, { type: 'bandpass', freq: 900 + Math.random() * 1800, q: 1.2, gain: vol, rev: 0.35 });
    }
  },
  livraria(t) { [0, 0.45].forEach((d) => noise(t + d, 0.3, { type: 'bandpass', freq: 3200, q: 0.7, gain: 0.16, attack: 0.08, sweep: 1400 })); },
  penhores(t) { [0, 0.07, 0.14, 0.21].forEach((d) => knock(1800, t + d, 0.12)); metal(2093, t + 0.35, 1.2, 0.17); },
  estacao(t) { // trote de cavalo nas pedras
    const pat = [0, 0.13, 0.26, 0.55, 0.68, 0.81, 1.1, 1.23, 1.36];
    pat.forEach((d, i) => knock(i % 3 === 1 ? 640 : 520, t + d, 0.32));
  },
  scotland(t) { // apito de guarda
    [0, 0.5].forEach((d) => [2900, 3150].forEach((f) => tone(f, t + d, d ? 0.55 : 0.3, { gain: 0.05, attack: 0.02, vib: [24, 90], rev: 0.15 })));
  },
  sherlock(t) { // violino
    [[587.3, 0, 0.5], [698.5, 0.42, 0.5], [880, 0.84, 0.9]].forEach(([f, d, len]) => tone(f, t + d, len, { type: 'sawtooth', gain: 0.045, attack: 0.15, vib: [5.5, 5], lp: 2600, rev: 0.6 }));
  },
  dice(t) { for (let i = 0; i < 6; i++) knock(1300 + Math.random() * 900, t + i * 0.085 + Math.random() * 0.03, 0.16); },
  turn(t) { metal(1318.5, t, 0.9, 0.18); metal(1760, t + 0.18, 1.3, 0.18); },
};

// ---------- música ambiente: 4 trilhas, uma para cada caso (troca automática) ----------
const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);   // nota MIDI → frequência
const ch = (...n) => n.map(hz);
const THEMES = [
  { name: 'Neblina em Baker Street',   // piano elétrico suave + chuva leve
    chords: [ch(50, 57, 60, 64, 65), ch(46, 58, 62, 65, 69), ch(43, 58, 62, 65, 69), ch(45, 57, 62, 64, 67)],
    scale: ch(74, 76, 77, 79, 81, 84, 86), every: 7000, style: 'piano', amb: 'rain' },
  { name: 'Lareira acesa',            // acordes quentes, caixinha de música e estalos de lenha
    chords: [ch(41, 57, 60, 64, 69), ch(40, 55, 59, 62, 67), ch(38, 57, 60, 65, 69), ch(43, 55, 59, 64, 67)],
    scale: ch(76, 79, 81, 83, 84, 86, 88), every: 8000, style: 'musicbox', amb: 'fire' },
  { name: 'Rio Tâmisa à noite',       // violoncelo grave, pizzicato e água batendo no cais
    chords: [ch(45, 52, 60, 64, 71), ch(41, 53, 57, 64, 71), ch(40, 52, 55, 62, 66), ch(38, 50, 57, 62, 64)],
    scale: ch(69, 71, 72, 74, 76, 79, 81), every: 7500, style: 'pizz', amb: 'water' },
  { name: 'Relógio do escritório',     // harpa em arpejos e o tique-taque de um relógio antigo
    chords: [ch(48, 55, 62, 63, 67), ch(44, 56, 60, 63, 67), ch(39, 55, 58, 62, 67), ch(43, 55, 60, 62, 65)],
    scale: null, every: 6500, style: 'harp', amb: 'clock' },
];
let theme = 0, chordIdx = 0, ambNode = null, ambTimer = null;
function padChord() {
  if (!musicOn) return;
  const th = THEMES[theme], t = T() + 0.05, c = th.chords[chordIdx % th.chords.length]; chordIdx++;
  c.forEach((f, i) => {
    if (th.style === 'pizz' && i === 0) { // baixo de violoncelo
      tone(f, t, th.every / 1000 - 0.5, { type: 'sawtooth', gain: 0.05, attack: 1.2, bus: musicBus, rev: 0.45, lp: 520, vib: [5, 1.2] });
      return;
    }
    tone(f, t + i * 0.06, th.every / 1000 - 0.5, { type: i === 0 ? 'sine' : 'triangle', gain: i === 0 ? 0.1 : 0.03, attack: 1.4, bus: musicBus, rev: 0.5, lp: th.style === 'musicbox' ? 1200 : 1500 });
  });
  musicTimer = setTimeout(padChord, th.every);
}
function melodyNote() {
  if (!musicOn) return;
  const th = THEMES[theme], t = T() + 0.05, pick = (a) => a[Math.floor(Math.random() * a.length)];
  if (th.style === 'harp') { // arpejo subindo nas notas do acorde atual
    if (Math.random() < 0.6) {
      const c = th.chords[(chordIdx - 1 + th.chords.length) % th.chords.length].slice(1);
      c.forEach((f, i) => { tone(f * 2, t + i * 0.16, 1.6, { type: 'triangle', gain: 0.032, attack: 0.005, bus: musicBus, rev: 0.6, lp: 3000 }); });
    }
    melodyTimer = setTimeout(melodyNote, 2600 + Math.random() * 2400); return;
  }
  if (Math.random() < 0.55) {
    const f = pick(th.scale);
    if (th.style === 'musicbox') {
      [[1, 0.035], [4, 0.006], [5.4, 0.003]].forEach(([m, g]) => tone(f * m, t, 1.4 / m ** 0.4, { gain: g, attack: 0.003, bus: musicBus, rev: 0.6 }));
    } else if (th.style === 'pizz') {
      tone(f / 2, t, 0.5, { type: 'triangle', gain: 0.05, attack: 0.004, bus: musicBus, rev: 0.55, lp: 1800 });
    } else {
      tone(f, t, 1.8, { gain: 0.04, attack: 0.01, bus: musicBus, rev: 0.7 });
      tone(f * 4, t, 0.35, { gain: 0.006, attack: 0.01, bus: musicBus, rev: 0.5 });
    }
    if (Math.random() < 0.4) {
      const f2 = pick(th.scale), d = th.style === 'pizz' ? 0.3 : 0.45;
      tone(th.style === 'pizz' ? f2 / 2 : f2, t + d, th.style === 'pizz' ? 0.5 : 1.6, { type: th.style === 'pizz' ? 'triangle' : 'sine', gain: 0.03, attack: 0.005, bus: musicBus, rev: 0.7 });
    }
  }
  melodyTimer = setTimeout(melodyNote, 1750 + Math.random() * 1750);
}
// som de fundo de cada trilha
function startAmbience() {
  const amb = THEMES[theme].amb;
  if (amb === 'rain' || amb === 'water') {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter();
    if (amb === 'rain') { f.type = 'bandpass'; f.frequency.value = 5000; f.Q.value = 0.4; }
    else { f.type = 'lowpass'; f.frequency.value = 500; }
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, T()); g.gain.exponentialRampToValueAtTime(amb === 'rain' ? 0.018 : 0.03, T() + 3);
    let last = g;
    if (amb === 'water') { // ondas lentas
      const a = ctx.createGain(), l = ctx.createOscillator(), lg = ctx.createGain(); a.gain.value = 0.55; l.frequency.value = 0.18; lg.gain.value = 0.45;
      l.connect(lg); lg.connect(a.gain); l.start(); g.connect(a); last = a; ambNode = { src, g, l };
    } else ambNode = { src, g };
    src.connect(f); f.connect(g); last.connect(musicBus); src.start();
  } else if (amb === 'fire') {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 350;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, T()); g.gain.exponentialRampToValueAtTime(0.02, T() + 3);
    src.connect(f); f.connect(g); g.connect(musicBus); src.start(); ambNode = { src, g };
    const crackle = () => { if (!musicOn) return;
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) noise(T() + Math.random() * 0.3, 0.015, { type: 'highpass', freq: 2500 + Math.random() * 3000, gain: 0.03 + Math.random() * 0.04, bus: musicBus, rev: 0.1 });
      ambTimer = setTimeout(crackle, 300 + Math.random() * 1400); };
    crackle();
  } else if (amb === 'clock') {
    let k = 0;
    const tick = () => { if (!musicOn) return;
      const t = T() + 0.02, f = k++ % 2 ? 1900 : 1650;
      tone(f, t, 0.03, { gain: 0.012, bus: musicBus, rev: 0.15 }); noise(t, 0.012, { type: 'highpass', freq: 4000, gain: 0.01, bus: musicBus, rev: 0.1 });
      ambTimer = setTimeout(tick, 1000); };
    tick();
  }
}
function stopAmbience() {
  clearTimeout(ambTimer);
  if (ambNode) { const { src, g, l } = ambNode; g.gain.setTargetAtTime(0.0001, T(), 0.3); setTimeout(() => { try { src.stop(); l?.stop(); } catch {} }, 1500); ambNode = null; }
}
function startMusic() {
  if (!ctx || musicOn) return;
  musicOn = true; chordIdx = 0;
  startAmbience();
  padChord(); melodyTimer = setTimeout(melodyNote, 2500);
}
function stopMusic() {
  if (!musicOn) return;
  musicOn = false; clearTimeout(musicTimer); clearTimeout(melodyTimer);
  stopAmbience();
}

export default {
  get music() { return state.music; },
  get fx() { return state.fx; },
  icon() { return state.music || state.fx ? '🔊' : '🔇'; },
  set(music, fx) {
    state.music = music; state.fx = fx;
    try { localStorage.setItem('dvt-sound', JSON.stringify(state)); } catch {}
    unlock(); if (!ctx) return;
    musicBus.gain.setTargetAtTime(music ? MUSIC_VOL : 0, T(), 0.3);
    fxBus.gain.setTargetAtTime(fx ? FX_VOL : 0, T(), 0.05);
    if (music) startMusic(); else stopMusic();
  },
  sfx(name) {
    try {
      if (!ctx || !state.fx || !FX[name]) return;
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      FX[name](T() + 0.03);
    } catch {}
  },
  test(name) { unlock(); this.sfx(name); },
  // escolhe a trilha pelo número do caso: casos 1, 5, 9... = trilha 1; 2, 6, 10... = trilha 2 etc.
  forCase(caseId) {
    const nt = ((Math.max(1, +caseId || 1) - 1) % THEMES.length);
    if (nt === theme) return;
    theme = nt;
    if (musicOn) { stopMusic(); setTimeout(() => { if (state.music && ctx) startMusic(); }, 1200); }
  },
  get track() { return THEMES[theme].name; },
};
