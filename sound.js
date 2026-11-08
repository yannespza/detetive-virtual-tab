// Música ambiente e efeitos sonoros, criados direto no navegador (sem arquivos de áudio).
let ctx = null, master, musicBus, fxBus, reverb, noiseBuf, musicNodes = null, musicTimer = null;
const pref = (() => { try { return JSON.parse(localStorage.getItem('dvt-sound') || '{}'); } catch { return {}; } })();
const state = { music: pref.music !== false, fx: pref.fx !== false };

function init() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  musicBus = ctx.createGain(); musicBus.gain.value = state.music ? 0.32 : 0; musicBus.connect(master);
  fxBus = ctx.createGain(); fxBus.gain.value = state.fx ? 0.7 : 0; fxBus.connect(master);
  // reverberação simples (eco de salão)
  reverb = ctx.createConvolver();
  const len = ctx.sampleRate * 2.6, ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
  reverb.buffer = ir; const rg = ctx.createGain(); rg.gain.value = 0.35; reverb.connect(rg); rg.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  if (state.music) startMusic();
}
['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, init, { passive: true }));
document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.visibilityState === 'hidden') ctx.suspend(); else ctx.resume();
});

// ---------- blocos de som ----------
const T = () => ctx.currentTime;
function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function tone(freq, t, dur, { type = 'sine', gain = 0.3, attack = 0.005, bus = fxBus, rev = 0.3, glide } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
  env(g, t, attack, gain, dur); o.connect(g); g.connect(bus);
  if (rev) { const s = ctx.createGain(); s.gain.value = rev; g.connect(s); s.connect(reverb); }
  o.start(t); o.stop(t + attack + dur + 0.05); return o;
}
function noise(t, dur, { type = 'bandpass', freq = 1000, q = 1, gain = 0.3, attack = 0.005, bus = fxBus, rev = 0.2, sweep } = {}) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  const g = ctx.createGain(); env(g, t, attack, gain, dur);
  src.connect(f); f.connect(g); g.connect(bus);
  if (rev) { const s = ctx.createGain(); s.gain.value = rev; g.connect(s); s.connect(reverb); }
  src.start(t, Math.random()); src.stop(t + attack + dur + 0.05);
}
const bell = (f, t, d = 1.2, gain = 0.25) => { tone(f, t, d, { gain }); tone(f * 2.76, t, d * 0.5, { gain: gain * 0.35 }); tone(f * 5.4, t, d * 0.25, { gain: gain * 0.15 }); };

// ---------- efeitos de cada local ----------
const FX = {
  bar(t) { noise(t, 1.6, { freq: 500, q: 0.7, gain: 0.08, attack: 0.3 }); [0, 0.16].forEach((d) => { tone(2350, t + d, 0.35, { gain: 0.18 }); tone(3480, t + d, 0.25, { gain: 0.1 }); }); },
  farmacia(t) { bell(1760, t, 1.1, 0.22); bell(2093, t + 0.12, 1.1, 0.16); bell(1760, t + 0.3, 0.9, 0.12); },
  banco(t) { for (let i = 0; i < 9; i++) { const d = i * 0.07 + Math.random() * 0.04; tone(3000 + Math.random() * 2500, t + d, 0.18, { gain: 0.12, type: 'triangle' }); } },
  docas(t) { noise(t, 2.2, { type: 'lowpass', freq: 300, sweep: 900, gain: 0.25, attack: 0.8 }); const o = tone(98, t + 0.3, 1.4, { type: 'sawtooth', gain: 0.12, attack: 0.15, rev: 0.5 }); },
  hotel(t) { bell(2637, t, 1.6, 0.25); },
  chaveiro(t) { for (let i = 0; i < 12; i++) tone(4200 + Math.random() * 3200, t + Math.random() * 0.55, 0.12, { gain: 0.08, type: 'triangle', rev: 0.1 }); },
  museu(t) { [0, 0.45, 0.9].forEach((d) => noise(t + d, 0.12, { type: 'lowpass', freq: 220, gain: 0.5, rev: 0.9 })); tone(196, t, 2, { gain: 0.04, attack: 0.6, rev: 0.6 }); },
  charutaria(t) { noise(t, 0.22, { type: 'highpass', freq: 2500, gain: 0.3, sweep: 6000 }); noise(t + 0.2, 0.9, { type: 'bandpass', freq: 1200, q: 0.5, gain: 0.07, attack: 0.05 }); },
  parque(t) { for (let i = 0; i < 5; i++) { const d = i * 0.18 + Math.random() * 0.08; tone(2600 + Math.random() * 700, t + d, 0.09, { gain: 0.12, glide: 4200, rev: 0.2 }); } },
  teatro(t) { for (let i = 0; i < 60; i++) noise(t + Math.random() * 1.6, 0.03, { type: 'bandpass', freq: 1500 + Math.random() * 1500, q: 1.5, gain: 0.12 + Math.random() * 0.08, rev: 0.3 }); },
  livraria(t) { noise(t, 0.28, { type: 'bandpass', freq: 3000, q: 0.6, gain: 0.18, attack: 0.08, sweep: 1200 }); noise(t + 0.4, 0.28, { type: 'bandpass', freq: 3200, q: 0.6, gain: 0.14, attack: 0.08, sweep: 1300 }); },
  penhores(t) { [0, 0.06, 0.12].forEach((d) => noise(t + d, 0.03, { type: 'highpass', freq: 3000, gain: 0.25 })); bell(2349, t + 0.25, 1.2, 0.22); },
  estacao(t) { for (let i = 0; i < 6; i++) { const d = i * 0.22 + (i % 2) * 0.08; noise(t + d, 0.06, { type: 'bandpass', freq: 700 + (i % 2) * 300, q: 3, gain: 0.45, rev: 0.15 }); } },
  scotland(t) { [0, 0.45].forEach((d) => { const o = tone(2800, t + d, 0.35, { gain: 0.12, attack: 0.02 }); const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 28; lg.gain.value = 120; l.connect(lg); lg.connect(o.frequency); l.start(t + d); l.stop(t + d + 0.4); }); },
  sherlock(t) { [[587, 0], [698, 0.35], [880, 0.7]].forEach(([f, d]) => { const o = tone(f, t + d, 0.5, { type: 'sawtooth', gain: 0.05, attack: 0.08, rev: 0.6 }); }); },
  dice(t) { for (let i = 0; i < 6; i++) noise(t + i * 0.09 + Math.random() * 0.03, 0.04, { type: 'bandpass', freq: 1800 + Math.random() * 1500, q: 2, gain: 0.3, rev: 0.05 }); },
  turn(t) { bell(1318, t, 0.9, 0.25); bell(1760, t + 0.18, 1.2, 0.25); },
};

// ---------- música ambiente ----------
const SCALE = [146.8, 174.6, 196, 220, 233.1, 277.2, 293.7, 349.2]; // ré menor harmônica
function startMusic() {
  if (!ctx || musicNodes) return;
  const t = T();
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 2;
  const lfo = ctx.createOscillator(), lfoG = ctx.createGain(); lfo.frequency.value = 0.07; lfoG.gain.value = 160; lfo.connect(lfoG); lfoG.connect(lp.frequency);
  const dg = ctx.createGain(); dg.gain.setValueAtTime(0.0001, t); dg.gain.exponentialRampToValueAtTime(0.35, t + 4);
  const oscs = [[73.4, 'sawtooth', -6], [73.4, 'sawtooth', 6], [110, 'triangle', 0], [36.7, 'sine', 0]].map(([f, type, det]) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det; o.connect(lp); o.start(); return o;
  });
  lp.connect(dg); dg.connect(musicBus);
  const rs = ctx.createGain(); rs.gain.value = 0.3; dg.connect(rs); rs.connect(reverb);
  // chuva fina de Londres
  const rain = ctx.createBufferSource(); rain.buffer = noiseBuf; rain.loop = true;
  const rf = ctx.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 3500;
  const rg = ctx.createGain(); rg.gain.value = 0.025; rain.connect(rf); rf.connect(rg); rg.connect(musicBus); rain.start();
  lfo.start();
  musicNodes = { oscs, lfo, rain, dg };
  const phrase = () => {
    if (!musicNodes) return;
    const now = T() + 0.1, n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const f = SCALE[Math.floor(Math.random() * SCALE.length)] * (Math.random() < 0.3 ? 2 : 1);
      tone(f, now + i * 0.9, 3.2, { gain: 0.07, attack: 0.4, bus: musicBus, rev: 0.8, type: 'triangle' });
    }
    if (Math.random() < 0.25) tone(1174.7, now + 2, 4, { gain: 0.015, attack: 1.5, bus: musicBus, rev: 1 }); // nota fantasma
    musicTimer = setTimeout(phrase, 4500 + Math.random() * 5000);
  };
  musicTimer = setTimeout(phrase, 2500);
}
function stopMusic() {
  if (!musicNodes) return;
  clearTimeout(musicTimer);
  const { oscs, lfo, rain, dg } = musicNodes, t = T();
  dg.gain.cancelScheduledValues(t); dg.gain.setValueAtTime(dg.gain.value, t); dg.gain.exponentialRampToValueAtTime(0.0001, t + 1);
  setTimeout(() => { oscs.forEach((o) => o.stop()); lfo.stop(); rain.stop(); }, 1100);
  musicNodes = null;
}

export default {
  get music() { return state.music; },
  get fx() { return state.fx; },
  icon() { return state.music || state.fx ? '🔊' : '🔇'; },
  set(music, fx) {
    state.music = music; state.fx = fx;
    try { localStorage.setItem('dvt-sound', JSON.stringify(state)); } catch {}
    init(); if (!ctx) return;
    musicBus.gain.setTargetAtTime(music ? 0.32 : 0, T(), 0.3);
    fxBus.gain.setTargetAtTime(fx ? 0.7 : 0, T(), 0.05);
    if (music) startMusic(); else stopMusic();
  },
  sfx(name) {
    try { if (!ctx || !state.fx || ctx.state !== 'running' || !FX[name]) return; FX[name](T() + 0.02); } catch {}
  },
};
