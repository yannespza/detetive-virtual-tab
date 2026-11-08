// Música ambiente e efeitos sonoros criados direto no navegador (sem arquivos de áudio).
let ctx = null, master, musicBus, fxBus, reverb, noiseBuf, musicOn = false, musicTimer = null, melodyTimer = null, rainNode = null, silentEl = null;
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

// ---------- música ambiente: piano elétrico suave + chuva leve ----------
// progressão Dm9 → B♭maj7 → Gm9 → A7sus4 (misteriosa, mas tranquila)
const CHORDS = [
  [146.83, 220.0, 261.63, 329.63, 349.23],
  [116.54, 233.08, 293.66, 349.23, 440.0],
  [98.0, 233.08, 293.66, 349.23, 440.0],
  [110.0, 220.0, 293.66, 329.63, 392.0],
];
const MELODY = [587.33, 659.25, 698.46, 783.99, 880.0, 1046.5, 1174.66];
let chordIdx = 0;
function padChord() {
  if (!musicOn) return;
  const t = T() + 0.05, ch = CHORDS[chordIdx % CHORDS.length]; chordIdx++;
  ch.forEach((f, i) => {
    tone(f, t + i * 0.06, 6.5, { type: i === 0 ? 'sine' : 'triangle', gain: i === 0 ? 0.11 : 0.035, attack: 1.4, bus: musicBus, rev: 0.5, lp: 1500 });
  });
  musicTimer = setTimeout(padChord, 7000);
}
function melodyNote() {
  if (!musicOn) return;
  if (Math.random() < 0.55) {
    const t = T() + 0.05, f = MELODY[Math.floor(Math.random() * MELODY.length)];
    tone(f, t, 1.8, { gain: 0.04, attack: 0.01, bus: musicBus, rev: 0.7 });
    tone(f * 4, t, 0.35, { gain: 0.006, attack: 0.01, bus: musicBus, rev: 0.5 });
    if (Math.random() < 0.4) tone(MELODY[Math.floor(Math.random() * MELODY.length)], t + 0.45, 1.6, { gain: 0.03, attack: 0.01, bus: musicBus, rev: 0.7 });
  }
  melodyTimer = setTimeout(melodyNote, 1750 + Math.random() * 1750);
}
function startMusic() {
  if (!ctx || musicOn) return;
  musicOn = true;
  const rain = ctx.createBufferSource(); rain.buffer = noiseBuf; rain.loop = true;
  const rf = ctx.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 5000; rf.Q.value = 0.4;
  const rg = ctx.createGain(); rg.gain.setValueAtTime(0.0001, T()); rg.gain.exponentialRampToValueAtTime(0.018, T() + 3);
  rain.connect(rf); rf.connect(rg); rg.connect(musicBus); rain.start();
  rainNode = { rain, rg };
  padChord(); melodyTimer = setTimeout(melodyNote, 2500);
}
function stopMusic() {
  if (!musicOn) return;
  musicOn = false; clearTimeout(musicTimer); clearTimeout(melodyTimer);
  if (rainNode) { const { rain, rg } = rainNode; rg.gain.setTargetAtTime(0.0001, T(), 0.3); setTimeout(() => rain.stop(), 1500); rainNode = null; }
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
};
