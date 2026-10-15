// Holdout — synthesized audio (no sound files): guns, infected, steps, wind, UI. Positional via PannerNode.
let ctx: AudioContext | null = null, master: GainNode, noiseBuf: AudioBuffer, amb: { g: GainNode; src: AudioBufferSourceNode } | null = null;
let vol = 0.8;
export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return }
  try { ctx = new AudioContext() } catch { return }
  master = ctx.createGain(); master.gain.value = vol; master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
export function setVolume(v: number) { vol = v; if (ctx) master.gain.value = v }
export function setListener(x: number, y: number, z: number, fx: number, fz: number) {
  if (!ctx) return; const l = ctx.listener as any;
  if (l.positionX) { l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z; l.forwardX.value = fx; l.forwardY.value = 0; l.forwardZ.value = fz; l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0 }
  else { l.setPosition(x, y, z); l.setOrientation(fx, 0, fz, 0, 1, 0) }
}
function out(pos?: number[]) {
  if (!pos) return master;
  const p = ctx!.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 4; p.maxDistance = 300; p.rolloffFactor = 1.1;
  p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; p.connect(master); return p;
}
function noise(t: number, dur: number, f: number, q: number, g: number, dst: AudioNode, type: BiquadFilterType = 'lowpass') {
  const s = ctx!.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const fl = ctx!.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
  const gn = ctx!.createGain(); gn.gain.setValueAtTime(g, t); gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(fl).connect(gn).connect(dst); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
function tone(t: number, dur: number, f0: number, f1: number, g: number, dst: AudioNode, type: OscillatorType = 'sine') {
  const o = ctx!.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const gn = ctx!.createGain(); gn.gain.setValueAtTime(g, t); gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(gn).connect(dst); o.start(t); o.stop(t + dur + 0.05);
}
export function sfx(name: string, pos?: number[], gain = 1) {
  if (!ctx) return; const t = ctx.currentTime, o = out(pos);
  switch (name) {
    case 'rifle': noise(t, 0.28, 2400, 0.7, 0.9 * gain, o); noise(t, 0.6, 500, 0.5, 0.5 * gain, o); tone(t, 0.12, 140, 50, 0.7 * gain, o); noise(t + 0.03, 0.9, 900, 0.3, 0.12 * gain, o, 'bandpass'); break;
    case 'pistol': noise(t, 0.22, 3200, 0.8, 0.7 * gain, o); tone(t, 0.09, 180, 60, 0.5 * gain, o); noise(t + 0.02, 0.6, 1100, 0.3, 0.1 * gain, o, 'bandpass'); break;
    case 'enemyShot': noise(t, 0.3, 1800, 0.6, 0.6 * gain, o); tone(t, 0.12, 120, 45, 0.4 * gain, o); break;
    case 'dry': tone(t, 0.04, 2400, 1800, 0.15, o, 'square'); break;
    case 'mag': noise(t, 0.05, 3000, 2, 0.25, o, 'bandpass'); tone(t + 0.02, 0.05, 900, 600, 0.12, o, 'square'); break;
    case 'bolt': noise(t, 0.04, 4000, 3, 0.3, o, 'bandpass'); noise(t + 0.09, 0.05, 2500, 3, 0.3, o, 'bandpass'); break;
    case 'hit': tone(t, 0.06, 1400, 900, 0.18, master, 'triangle'); break;
    case 'head': tone(t, 0.08, 2200, 1600, 0.22, master, 'triangle'); tone(t + 0.02, 0.08, 3300, 2600, 0.12, master); break;
    case 'flesh': noise(t, 0.12, 700, 1.5, 0.5 * gain, o, 'bandpass'); break;
    case 'impact': noise(t, 0.08, 2500, 1.2, 0.25 * gain, o, 'bandpass'); break;
    case 'step': noise(t, 0.09, 380 + Math.random() * 160, 1, 0.16 * gain, o); break;
    case 'land': noise(t, 0.15, 260, 1, 0.4 * gain, o); break;
    case 'hurt': tone(t, 0.25, 220, 110, 0.3, master, 'sawtooth'); noise(t, 0.2, 600, 1, 0.3, master); break;
    case 'groan': groan(t, o, gain, 0.9 + Math.random() * 0.8); break;
    case 'scream': groan(t, o, gain * 1.3, 1.4, 260); break;
    case 'zdie': groan(t, o, gain, 1.2, 70); break;
    case 'swipe': noise(t, 0.18, 1500, 0.8, 0.35 * gain, o, 'bandpass'); break;
    case 'pickup': tone(t, 0.07, 660, 990, 0.12, master, 'triangle'); tone(t + 0.07, 0.08, 990, 1320, 0.1, master, 'triangle'); break;
    case 'search': noise(t, 0.25, 1800, 1.5, 0.12, o, 'bandpass'); break;
    case 'ui': tone(t, 0.05, 880, 760, 0.08, master, 'square'); break;
    case 'deny': tone(t, 0.12, 220, 180, 0.12, master, 'square'); break;
    case 'radio': noise(t, 0.4, 2400, 4, 0.12, master, 'bandpass'); tone(t + 0.05, 0.3, 1000, 1000, 0.05, master, 'square'); break;
    case 'extract': tone(t, 0.6, 330, 330, 0.12, master, 'triangle'); tone(t + 0.15, 0.6, 440, 440, 0.12, master, 'triangle'); tone(t + 0.3, 0.9, 660, 660, 0.12, master, 'triangle'); break;
    case 'heal': tone(t, 0.3, 500, 800, 0.1, master); break;
    case 'door': tone(t, 1.2, 60, 40, 0.5, master, 'sawtooth'); noise(t, 1.2, 300, 1, 0.3, master); break;
  }
}
function groan(t: number, dst: AudioNode, g: number, dur: number, f = 95) {
  const o = ctx!.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * (0.8 + Math.random() * 0.4), t);
  o.frequency.linearRampToValueAtTime(f * (0.6 + Math.random() * 0.5), t + dur);
  const lfo = ctx!.createOscillator(); lfo.frequency.value = 6 + Math.random() * 6; const lg = ctx!.createGain(); lg.gain.value = f * 0.15; lfo.connect(lg).connect(o.frequency);
  const f1 = ctx!.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 500 + Math.random() * 300; f1.Q.value = 4;
  const f2 = ctx!.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1100 + Math.random() * 400; f2.Q.value = 6;
  const gn = ctx!.createGain(); gn.gain.setValueAtTime(0.001, t); gn.gain.linearRampToValueAtTime(0.5 * g, t + 0.12); gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(f1).connect(gn); o.connect(f2).connect(gn); gn.connect(dst);
  noise(t, dur, 900, 1, 0.08 * g, dst, 'bandpass');
  o.start(t); lfo.start(t); o.stop(t + dur + 0.1); lfo.stop(t + dur + 0.1);
}
/** Looping bed: 'wind' outdoors, 'hum' in the bunker, null to stop. */
export function ambience(kind: 'wind' | 'hum' | null) {
  if (!ctx) return;
  if (amb) { const a = amb; a.g.gain.setTargetAtTime(0, ctx.currentTime, 0.4); setTimeout(() => a.src.stop(), 2000); amb = null }
  if (!kind) return;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = kind === 'wind' ? 'bandpass' : 'lowpass'; f.frequency.value = kind === 'wind' ? 420 : 120; f.Q.value = kind === 'wind' ? 0.6 : 0.8;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08; const lg = ctx.createGain(); lg.gain.value = kind === 'wind' ? 220 : 20; lfo.connect(lg).connect(f.frequency); lfo.start();
  const g = ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(kind === 'wind' ? 0.16 : 0.22, ctx.currentTime, 1);
  src.connect(f).connect(g).connect(master); src.start();
  if (kind === 'hum') { const o = ctx.createOscillator(); o.frequency.value = 60; const og = ctx.createGain(); og.gain.value = 0.025; o.connect(og).connect(g); o.start() }
  amb = { g, src };
}
