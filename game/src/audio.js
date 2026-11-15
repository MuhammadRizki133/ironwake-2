// audio.js — every sound is synthesized with WebAudio: no audio files, nothing to load.
// Gunshots are filtered noise bursts shaped per weapon, the bomb beeps from the state
// clock, a flash leaves a ringing tone that fades with the player's blindT. Sounds are
// driven by the same state events the HUD reads, positioned by distance to the player.

import { S } from './state.js';

let ctx = null;
let master = null;
let noiseBuf = null;
let ringOsc = null;
let ringGain = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch { return; }
  master = ctx.createGain();
  master.gain.value = 0.42;
  master.connect(ctx.destination);
  const len = ctx.sampleRate * 1;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  // flash ringing: a quiet high sine whose gain follows blindT in updateAudio
  ringOsc = ctx.createOscillator();
  ringOsc.frequency.value = 3400;
  ringGain = ctx.createGain();
  ringGain.gain.value = 0;
  ringOsc.connect(ringGain).connect(master);
  ringOsc.start();
}

function noise(dur, freq, gain, type) {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const filter = ctx.createBiquadFilter();
  filter.type = type || 'lowpass';
  filter.frequency.value = freq;
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(master);
  src.start();
  src.stop(t + dur + 0.02);
}

function tone(freq, dur, gain, type, slideTo) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  o.type = type || 'sine';
  const g = ctx.createGain();
  const t = ctx.currentTime;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start();
  o.stop(t + dur + 0.02);
}

function distGain(x, z, max) {
  const p = S.player;
  if (!p) return 0;
  const d = Math.hypot(x - p.pos.x, z - p.pos.z);
  return Math.max(0, 1 - d / max);
}

const SHOT_SOUNDS = {
  sparrow: [0.09, 2600, 0.20],
  breacher: [0.22, 900, 0.34],
  ripper: [0.07, 2100, 0.20],
  longbow: [0.12, 1700, 0.26],
  needle: [0.3, 700, 0.4],
};

export function updateAudio() {
  if (!ctx) return;
  for (const e of S.events) {
    switch (e.kind) {
      case 'shot': {
        const s = SHOT_SOUNDS[e.gun.id] || SHOT_SOUNDS.longbow;
        const own = e.actor.isPlayer;
        const v = own ? 1 : distGain(e.actor.pos.x, e.actor.pos.z, 46);
        if (v > 0.02) noise(s[0], s[1], s[2] * (own ? 1 : v), 'lowpass');
        break;
      }
      case 'reload': if (e.actor.isPlayer) { tone(1200, 0.04, 0.1, 'square'); setTimeout(() => tone(800, 0.05, 0.12, 'square'), 130); } break;
      case 'dryfire': if (e.actor.isPlayer) tone(1900, 0.03, 0.08, 'square'); break;
      case 'hitmark': tone(e.head ? 2100 : 1500, 0.05, 0.14, 'sine'); break;
      case 'damage': if (e.target.isPlayer) noise(0.14, 300, 0.3); break;
      case 'kill': if (e.attacker && e.attacker.isPlayer) { tone(660, 0.07, 0.12, 'sine'); setTimeout(() => tone(990, 0.09, 0.12, 'sine'), 70); } break;
      case 'fragboom': { const v = distGain(e.x, e.z, 55); if (v > 0.02) { noise(0.5, 220, 0.5 * v); tone(70, 0.4, 0.3 * v, 'sine', 38); } break; }
      case 'explode': noise(1.1, 160, 0.8); tone(55, 0.9, 0.5, 'sine', 30); break;
      case 'flashpop': { const v = distGain(e.x, e.z, 40); if (v > 0.02) noise(0.1, 4000, 0.2 * v, 'highpass'); break; }
      case 'planted': tone(1180, 0.1, 0.16, 'square'); setTimeout(() => tone(1180, 0.1, 0.16, 'square'), 160); break;
      case 'roundend': tone(e.winner === (S.player ? S.player.team : 0) ? 523 : 392, 0.16, 0.14, 'triangle'); setTimeout(() => tone(e.winner === (S.player ? S.player.team : 0) ? 784 : 330, 0.3, 0.14, 'triangle'), 170); break;
      case 'golive': tone(880, 0.07, 0.1, 'triangle'); break;
      case 'bombpickup': if (e.by.isPlayer) tone(700, 0.06, 0.1, 'sine'); break;
    }
  }
  if (ringGain && S.player) {
    const target = S.player.blindT > 0 ? Math.min(0.06, S.player.blindT * 0.02) : 0;
    ringGain.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
  }
}

// The planted Charge beeps faster as the fuse burns; main.js calls this on its clock.
let lastBeep = 0;
export function bombBeeps() {
  if (!ctx || !S.bomb || !S.bomb.planted) return;
  const fuse = S.bomb.fuse;
  const interval = fuse > 20 ? 1 : fuse > 10 ? 0.5 : 0.25;
  if (S.time - lastBeep >= interval) {
    lastBeep = S.time;
    const v = distGain(S.bomb.x, S.bomb.z, 40);
    if (v > 0.02) tone(1560, 0.05, 0.13 * v, 'square');
  }
}
