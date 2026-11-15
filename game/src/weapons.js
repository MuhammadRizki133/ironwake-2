// weapons.js — the armoury and the firing model. Five guns with distinct jobs, three
// grenades, armour. Accuracy is a resource: spread blooms when you move, jump or hold the
// trigger, and settles when you stop and crouch — stopping to aim pays, by the numbers.
//
// Damage is hitscan against two body spheres and a head sphere per actor, checked against
// the world ray so walls always win. Headshots multiply; armour halves body damage and
// a helmet blunts headshots. Everything a shot does is reported through state events so
// HUD, audio and effects never reach into this file.

import { S, CFG, emit } from './state.js';
import { rayWorld } from './world.js';

export const WEAPONS = {
  sparrow: {
    name: 'Sparrow P9', slot: 'sidearm', price: 0, damage: 26, headMult: 3.4, rpm: 340,
    mag: 12, reserve: 48, reloadSec: 1.5, auto: false, pellets: 1,
    spread: 0.55, moveSpread: 2.6, recoil: 0.011, falloffAt: 22, moveFactor: 0.92,
  },
  breacher: {
    name: 'Breacher-12', slot: 'primary', price: 1100, damage: 13, headMult: 2.2, rpm: 68,
    mag: 6, reserve: 24, reloadSec: 2.6, auto: false, pellets: 8,
    spread: 3.4, moveSpread: 2.0, recoil: 0.05, falloffAt: 9, moveFactor: 0.88,
  },
  ripper: {
    name: 'Ripper-9', slot: 'primary', price: 1400, damage: 22, headMult: 3.0, rpm: 750,
    mag: 32, reserve: 96, reloadSec: 2.1, auto: true, pellets: 1,
    spread: 0.85, moveSpread: 3.4, recoil: 0.008, falloffAt: 18, moveFactor: 0.95,
  },
  longbow: {
    name: 'Longbow AR', slot: 'primary', price: 2700, damage: 34, headMult: 4.0, rpm: 600,
    mag: 30, reserve: 90, reloadSec: 2.4, auto: true, pellets: 1,
    spread: 0.5, moveSpread: 3.8, recoil: 0.013, falloffAt: 30, moveFactor: 0.9,
  },
  needle: {
    name: 'Needle DMR', slot: 'primary', price: 4300, damage: 96, headMult: 2.6, rpm: 52,
    mag: 5, reserve: 25, reloadSec: 2.9, auto: false, pellets: 1,
    spread: 0.12, moveSpread: 5.5, recoil: 0.06, falloffAt: 60, moveFactor: 0.84, scoped: true,
  },
};

export const GRENADES = {
  frag: { name: 'Frag charge', price: 300 },
  flash: { name: 'Flash charge', price: 200 },
  smoke: { name: 'Smoke canister', price: 300 },
};
export const ARMOR_PRICE = 650;

export function makeGun(id) {
  const def = WEAPONS[id];
  return { id, def, ammo: def.mag, reserve: def.reserve, reloadT: 0, coolT: 0, heat: 0 };
}

export function makeLoadout() {
  return {
    primary: null,
    sidearm: makeGun('sparrow'),
    current: 'sidearm',
    grenades: { frag: 0, flash: 0, smoke: 0 },
    armor: false,
    helmet: false,
  };
}

export function currentGun(actor) {
  return actor.loadout[actor.loadout.current];
}

export function eyeHeight(actor) {
  return actor.crouch ? 1.16 : 1.62;
}

export function eyePos(actor, out) {
  out.set(actor.pos.x, actor.pos.y + eyeHeight(actor), actor.pos.z);
  return out;
}

// Apply damage with armour rules; returns true when the target died.
export function damage(S2, target, amount, opts) {
  if (!target.alive) return false;
  if (S.shotMode && target.isPlayer) return false; // screenshot scenes pose a player who must stay in frame
  let dmg = amount;
  if (opts.head) dmg *= target.loadout.helmet ? 0.62 : 1;
  else if (target.loadout.armor) dmg *= 0.5;
  dmg = Math.max(1, Math.round(dmg));
  target.hp -= dmg;
  target.lastAttacker = opts.attacker;
  target.lastDamageT = S.time;
  emit('damage', { target, attacker: opts.attacker, dmg, head: !!opts.head });
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    // Kill bookkeeping happens here, synchronously — score, money and the dropped
    // Charge must be true the same tick the shot lands, not whenever an event queue
    // happens to drain. The 'kill' event below is presentation only (HUD, audio).
    target.deaths++;
    if (opts.attacker && opts.attacker !== target) {
      opts.attacker.kills++;
      opts.attacker.money = Math.min(CFG.maxMoney, opts.attacker.money + CFG.killReward);
    }
    if (target.hasBomb && S.bomb) {
      target.hasBomb = false;
      S.bomb.carrier = null;
      S.bomb.x = target.pos.x;
      S.bomb.z = target.pos.z;
      emit('bombdrop', { x: S.bomb.x, z: S.bomb.z });
    }
    emit('kill', {
      attacker: opts.attacker, victim: target,
      weapon: opts.weapon, head: !!opts.head,
    });
    S.killfeed.push({
      killer: opts.attacker ? opts.attacker.name : '—',
      killerTeam: opts.attacker ? opts.attacker.team : -1,
      victim: target.name, victimTeam: target.team,
      weapon: opts.weapon, head: !!opts.head, t: S.time,
    });
    if (S.killfeed.length > 6) S.killfeed.shift();
    return true;
  }
  return false;
}

// Sphere raycast helper: distance along the ray to a sphere, or Infinity.
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxT) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  const t = tca - Math.sqrt(r2 - d2);
  return t <= maxT ? t : Infinity;
}

// One trigger pull. Handles cooldown, ammo, spread, pellets, tracers and hit events.
// dirOut receives the shot direction for viewmodel/audio use. Returns true if it fired.
const _eye = { x: 0, y: 0, z: 0 };
const _hit = { x: 0, y: 0, z: 0 };
export function tryFire(actor, fx) {
  const gun = currentGun(actor);
  if (!gun || gun.reloadT > 0 || gun.coolT > 0) return false;
  if (gun.ammo <= 0) {
    emit('dryfire', { actor });
    gun.coolT = 0.32;
    return false;
  }
  const def = gun.def;
  gun.ammo--;
  gun.coolT = 60 / def.rpm;
  gun.heat = Math.min(1, gun.heat + 0.16);

  const speed = Math.hypot(actor.vel.x, actor.vel.z);
  let spreadDeg = def.spread + def.moveSpread * Math.min(1, speed / 4.4) + gun.heat * 1.1;
  if (actor.crouch) spreadDeg *= 0.62;
  if (!actor.grounded) spreadDeg *= 2.4;
  const spread = spreadDeg * Math.PI / 180;

  _eye.x = actor.pos.x; _eye.y = actor.pos.y + eyeHeight(actor) - 0.08; _eye.z = actor.pos.z;
  const cy = Math.cos(actor.pitch);
  const fxDir = -Math.sin(actor.yaw) * cy;
  const fyDir = Math.sin(actor.pitch);
  const fzDir = -Math.cos(actor.yaw) * cy;

  S.noises.push({ x: actor.pos.x, z: actor.pos.z, radius: 34, team: actor.team, t: S.time });
  emit('shot', { actor, gun });

  for (let p = 0; p < def.pellets; p++) {
    // random cone direction, built from two perpendicular axes — no allocation, fixed basis
    const a = S.rng() * Math.PI * 2;
    const rr = Math.sqrt(S.rng()) * spread;
    const rx = Math.cos(actor.yaw);
    const rz = -Math.sin(actor.yaw);
    let dx = fxDir + (rx * Math.cos(a) * rr) + (0 * Math.sin(a) * rr);
    let dy = fyDir + (Math.sin(a) * rr);
    let dz = fzDir + (rz * Math.cos(a) * rr);
    const il = 1 / Math.hypot(dx, dy, dz);
    dx *= il; dy *= il; dz *= il;

    const worldT = rayWorld(_eye.x, _eye.y, _eye.z, dx, dy, dz, 120);
    let bestT = worldT;
    let bestActor = null;
    let bestHead = false;
    for (const other of S.actors) {
      if (other === actor || !other.alive || other.team === actor.team) continue;
      const base = other.pos.y;
      const headY = base + (other.crouch ? 1.24 : 1.7);
      const chestY = base + (other.crouch ? 0.82 : 1.12);
      const hipY = base + 0.5;
      let t = raySphere(_eye.x, _eye.y, _eye.z, dx, dy, dz, other.pos.x, headY, other.pos.z, 0.21, bestT);
      if (t < bestT) { bestT = t; bestActor = other; bestHead = true; continue; }
      t = raySphere(_eye.x, _eye.y, _eye.z, dx, dy, dz, other.pos.x, chestY, other.pos.z, 0.44, bestT);
      if (t < bestT) { bestT = t; bestActor = other; bestHead = false; continue; }
      t = raySphere(_eye.x, _eye.y, _eye.z, dx, dy, dz, other.pos.x, hipY, other.pos.z, 0.4, bestT);
      if (t < bestT) { bestT = t; bestActor = other; bestHead = false; }
    }
    _hit.x = _eye.x + dx * bestT;
    _hit.y = _eye.y + dy * bestT;
    _hit.z = _eye.z + dz * bestT;
    if (fx) fx.tracer(_eye.x, _eye.y - 0.06, _eye.z, _hit.x, _hit.y, _hit.z, actor.team);
    if (bestActor) {
      let dmg = def.damage * (bestHead ? def.headMult : 1);
      if (bestT > def.falloffAt) dmg *= Math.max(0.45, 1 - (bestT - def.falloffAt) / 60);
      damage(S, bestActor, dmg, { attacker: actor, weapon: def.name, head: bestHead });
      if (fx) fx.impact(_hit.x, _hit.y, _hit.z, true);
      if (actor.isPlayer || bestActor.isPlayer) emit('hitmark', { head: bestHead, killed: !bestActor.alive });
    } else if (fx && bestT < 120) {
      fx.impact(_hit.x, _hit.y, _hit.z, false);
    }
  }
  // recoil: the shooter's view kicks; recovery happens in the controller/bot aim
  actor.recoilPitch = (actor.recoilPitch || 0) + def.recoil;
  if (gun.ammo === 0 && gun.reserve > 0) startReload(actor);
  return true;
}

export function startReload(actor) {
  const gun = currentGun(actor);
  if (!gun || gun.reloadT > 0 || gun.ammo >= gun.def.mag || gun.reserve <= 0) return;
  gun.reloadT = gun.def.reloadSec;
  emit('reload', { actor });
}

// Per-tick weapon bookkeeping: cooldowns, recoil recovery, reload completion.
export function updateWeapons(actor, dt) {
  for (const slot of ['primary', 'sidearm']) {
    const gun = actor.loadout[slot];
    if (!gun) continue;
    if (gun.coolT > 0) gun.coolT -= dt;
    if (gun.heat > 0) gun.heat = Math.max(0, gun.heat - dt * 1.4);
    if (gun.reloadT > 0) {
      gun.reloadT -= dt;
      if (gun.reloadT <= 0) {
        const need = gun.def.mag - gun.ammo;
        const take = Math.min(need, gun.reserve);
        gun.ammo += take;
        gun.reserve -= take;
      }
    }
  }
  if (actor.recoilPitch) {
    actor.pitch += 0; // pitch itself is owned by aim; recoil is a view offset that decays
    actor.recoilPitch = Math.max(0, actor.recoilPitch - dt * 0.09);
  }
}
