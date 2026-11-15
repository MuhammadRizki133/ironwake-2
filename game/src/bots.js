// bots.js — the other nine combatants. Each bot perceives the world on a staggered
// think tick: vision through a facing cone and real sightlines (smoke included), hearing
// from the noise list the guns and footsteps write into state. What a bot knows is only
// what it saw or heard — lastSeen and heard positions, never the truth.
//
// Behaviour is a small state machine over a team plan written each round by round.js:
// push a site, hold a lane, plant, defend the planted charge, retake and defuse. In a
// fight a bot stops to shoot (its own spread maths rewards it), fires bursts, strafes
// between them, and aims with an error that shrinks the longer it tracks a target.

import { S, TEAM, emit } from './state.js';
import { WORLD, findPath, losClear, moveCollide, inSite } from './world.js';
import { makeLoadout, currentGun, tryFire, startReload, eyeHeight, WEAPONS } from './weapons.js';

export const BOT_NAMES = {
  0: ['RAZE', 'DUKE', 'ONYX', 'FABLE'],
  1: ['VOSS', 'HALE', 'MIRA', 'JUNO', 'KETT'],
};

export function createBot(team, name) {
  return {
    isPlayer: false, team, name,
    pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
    yaw: team === TEAM.BRK ? 0 : Math.PI, pitch: 0, recoilPitch: 0,
    crouch: false, grounded: true, hp: 100, alive: true,
    loadout: makeLoadout(), money: 0, kills: 0, deaths: 0,
    hasBomb: false, channel: null, channelT: 0, blindT: 0, grenadeCoolT: 0,
    lastAttacker: null, lastDamageT: -9, mesh: null, muzzle: null,
    ai: {
      state: 'route', path: [], pathI: 0, goal: null, holdYaw: 0,
      thinkT: Math.random() * 0.12, visibleFor: 0, target: null,
      lastSeen: null, heard: null, burstT: 0, pauseT: 0.4, strafeT: 0, strafeDir: 1,
      aimErr: 0.05, role: 'push', site: 'A', usedGrenade: false, repathT: 0,
    },
  };
}

// Round-start shopping for bots: armour first, then the best gun the money reaches,
// then a grenade or two. Mirrors what a sensible player buys, with a little variance.
export function botBuy(bot) {
  const lo = bot.loadout;
  const buy = (price) => { if (bot.money >= price) { bot.money -= price; return true; } return false; };
  if (!lo.armor && bot.money >= 1400 && buy(650)) { lo.armor = true; lo.helmet = true; }
  if (!lo.primary) {
    const roll = S.rng();
    if (bot.money >= 4300 && roll < 0.14 && buy(4300)) lo.primary = gunOf('needle');
    else if (buy(2700)) lo.primary = gunOf('longbow');
    else if (buy(1400)) lo.primary = gunOf('ripper');
    else if (buy(1100)) lo.primary = gunOf('breacher');
    if (lo.primary) lo.current = 'primary';
  }
  if (bot.money >= 900 && S.rng() < 0.6 && buy(200)) lo.grenades.flash++;
  if (bot.money >= 900 && S.rng() < 0.4 && buy(300)) lo.grenades.frag++;
  if (bot.team === TEAM.WRD && bot.money >= 900 && S.rng() < 0.4 && buy(300)) lo.grenades.smoke++;
}

function gunOf(id) {
  const def = WEAPONS[id];
  return { id, def, ammo: def.mag, reserve: def.reserve, reloadT: 0, coolT: 0, heat: 0 };
}

// --- perception -------------------------------------------------------------------------

function segmentSmokeBlocked(ax, az, bx, bz) {
  for (const sm of S.smokes) {
    // distance from the smoke centre to the sight segment, in the ground plane
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    let t = ((sm.x - ax) * dx + (sm.z - az) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t - sm.x;
    const pz = az + dz * t - sm.z;
    if (px * px + pz * pz < sm.r * sm.r) return true;
  }
  return false;
}

function perceive(bot) {
  const ai = bot.ai;
  ai.target = null;
  const eyeY = bot.pos.y + eyeHeight(bot);
  for (const e of S.actors) {
    if (!e.alive || e.team === bot.team) continue;
    const dx = e.pos.x - bot.pos.x;
    const dz = e.pos.z - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 58) continue;
    // facing cone: 100 degrees around the bot's yaw
    const fx = -Math.sin(bot.yaw);
    const fz = -Math.cos(bot.yaw);
    const dot = (dx * fx + dz * fz) / (dist || 1);
    if (dot < 0.17 && dist > 3.5) continue;
    if (!losClear(bot.pos.x, eyeY, bot.pos.z, e.pos.x, e.pos.y + eyeHeight(e), e.pos.z)) continue;
    if (segmentSmokeBlocked(bot.pos.x, bot.pos.z, e.pos.x, e.pos.z)) continue;
    ai.target = e;
    ai.lastSeen = { x: e.pos.x, z: e.pos.z, t: S.time };
  }
  for (const n of S.noises) {
    if (n.team === bot.team) continue;
    const dx = n.x - bot.pos.x;
    const dz = n.z - bot.pos.z;
    if (dx * dx + dz * dz < n.radius * n.radius) ai.heard = { x: n.x, z: n.z, t: S.time };
  }
}

// --- movement ---------------------------------------------------------------------------

function steer(bot, tx, tz, speed, dt) {
  const dx = tx - bot.pos.x;
  const dz = tz - bot.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.35) return true;
  const k = Math.min(1, 14 * dt);
  bot.vel.x += (dx / dist * speed - bot.vel.x) * k;
  bot.vel.z += (dz / dist * speed - bot.vel.z) * k;
  faceToward(bot, Math.atan2(-dx, -dz), dt, 8);
  return false;
}

function faceToward(bot, yaw, dt, rate) {
  let d = yaw - bot.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  bot.yaw += d * Math.min(1, rate * dt);
}

function followPath(bot, speed, dt) {
  const ai = bot.ai;
  if (!ai.path.length) return true;
  const node = WORLD.navNodes[ai.path[ai.pathI]];
  if (!node) return true;
  if (steer(bot, node.x, node.z, speed, dt)) {
    ai.pathI++;
    ai.stuckClock = 0;
    if (ai.pathI >= ai.path.length) { ai.path = []; return true; }
    return false;
  }
  // stuck detection: barely moved for over half a second against a corner — skip the
  // waypoint rather than face-plant forever (the graph is honest, corners are tight)
  ai.stuckClock = (ai.stuckClock || 0) + dt;
  if (ai.stuckClock > 0.55) {
    const moved = Math.hypot(bot.pos.x - (ai.stuckX ?? bot.pos.x), bot.pos.z - (ai.stuckZ ?? bot.pos.z));
    ai.stuckX = bot.pos.x;
    ai.stuckZ = bot.pos.z;
    ai.stuckClock = 0;
    if (moved < 0.06) {
      ai.pathI++;
      if (ai.pathI >= ai.path.length) { ai.path = []; return true; }
    }
  }
  return false;
}

function setGoal(bot, x, z, force) {
  const ai = bot.ai;
  // Re-issuing the goal a bot is already walking to must not restart its path —
  // decide() thinks several times a second, and a reset pathI pins the bot to the
  // node nearest itself. assignGoal() forces; plain setGoal() dedupes.
  if (!force && ai.goal && ai.path.length &&
      Math.abs(ai.goal.x - x) < 0.01 && Math.abs(ai.goal.z - z) < 0.01) return;
  ai.goal = { x, z };
  ai.path = findPath(bot.pos.x, bot.pos.z, x, z);
  ai.pathI = 0;
}

// --- the state machine --------------------------------------------------------------------

export function updateBot(bot, dt, fx) {
  const ai = bot.ai;
  if (!bot.alive) return;
  if (S.phase !== 'live') { bot.vel.x = 0; bot.vel.z = 0; return; } // frozen in buy/end phases

  ai.thinkT -= dt;
  if (ai.thinkT <= 0) {
    ai.thinkT = 0.12;
    if (bot.blindT <= 0) perceive(bot);
    decide(bot);
  }
  if (bot.blindT > 0) { bot.blindT -= dt; ai.target = null; }

  const gun = currentGun(bot);
  if (gun && gun.ammo === 0 && gun.reloadT <= 0) startReload(bot);

  // default: friction when no steering this tick
  let steering = false;

  if (bot.channel) {
    // a planter who sees a threat drops the channel and fights; a defuser holds on
    if (bot.channel === 'plant' && ai.target) { bot.channel = null; bot.channelT = 0; }
    else {
      bot.vel.x = 0; bot.vel.z = 0;
      return; // round.js runs the channel; the bot just holds still
    }
  }

  if (ai.target && ai.target.alive) {
    steering = engage(bot, dt, fx);
  } else if (ai.state === 'plant') {
    bot.channel = 'plant';
    bot.vel.x = 0; bot.vel.z = 0;
  } else if (ai.state === 'defuse') {
    if (steer(bot, S.bomb.x, S.bomb.z, 4.6, dt)) bot.channel = 'defuse';
    steering = true;
  } else if (ai.state === 'hold') {
    // a bot that chased a fight away from its post walks back to it before holding again
    if (ai.post) {
      const pd = Math.hypot(ai.post.x - bot.pos.x, ai.post.z - bot.pos.z);
      if (pd > 4 && !ai.target) {
        ai.state = 'route';
        setGoal(bot, ai.post.x, ai.post.z);
        ai.onArrive = (b) => holdHere(b, b.ai.holdYaw);
      }
    }
    ai.holdYaw += Math.sin(S.time * 0.6 + bot.pos.x) * 0.12 * dt;
    faceToward(bot, ai.holdYaw, dt, 5);
    bot.crouch = ai.crouchHold;
    bot.vel.x *= 0.8; bot.vel.z *= 0.8;
  } else {
    // route toward the goal; investigate a fresh sound on the way if defending
    let speed = 4.7;
    if (ai.heard && S.time - ai.heard.t < 2.2 && bot.team === TEAM.WRD) speed = 2.9;
    if (ai.lastSeen && S.time - ai.lastSeen.t < 3) speed = 3.4; // contact expected: slow, ready
    if (followPath(bot, speed, dt)) {
      if (ai.onArrive) { ai.onArrive(bot); ai.onArrive = null; }
      else { ai.state = 'hold'; ai.holdYaw = bot.yaw; }
    }
    steering = true;
    maybeGrenade(bot, fx);
  }

  if (!steering) { bot.vel.x *= 0.86; bot.vel.z *= 0.86; }
  bot.pos.x += bot.vel.x * dt;
  bot.pos.z += bot.vel.z * dt;
  moveCollide(bot.pos, 0.38);
}

function decide(bot) {
  const ai = bot.ai;
  const bomb = S.bomb;
  if (bomb && bomb.planted) {
    if (bot.team === TEAM.WRD) {
      if (ai.state !== 'defuse') {
        ai.state = 'route';
        setGoal(bot, bomb.x, bomb.z);
        ai.onArrive = (b) => { b.ai.state = 'defuse'; };
        // one retaking Warden smokes the charge and defuses inside it
        if (bot.loadout.grenades.smoke > 0 && !ai.usedGrenade) ai.smokeBomb = true;
      }
    } else if (ai.state !== 'hold' || !inSite({ x: bomb.x, z: bomb.z, r: 13 }, bot.pos.x, bot.pos.z)) {
      ai.state = 'route';
      const a = (bot.id * 2.1) % (Math.PI * 2);
      setGoal(bot, bomb.x + Math.cos(a) * 6.5, bomb.z + Math.sin(a) * 6.5);
      ai.onArrive = (b) => holdHere(b, Math.atan2(-(bomb.x - b.pos.x), -(bomb.z - b.pos.z)));
    }
    return;
  }
  if (bot.hasBomb && inSite(WORLD.sites[ai.site], bot.pos.x, bot.pos.z)) {
    ai.state = 'plant';
    return;
  }
  if (bot.hasBomb && ai.state === 'hold') {
    // a carrier holding short of the site (a recovered Charge, a lost route) re-commits
    const site = WORLD.sites[ai.site];
    ai.state = 'route';
    setGoal(bot, site.x, site.z);
    return;
  }
  if (ai.state === 'plant' && !bot.hasBomb) ai.state = 'route';
  if (ai.target) return; // engage is handled in updateBot
  // heard something fresh while holding a lane: face it
  if (ai.state === 'hold' && ai.heard && S.time - ai.heard.t < 2.5) {
    ai.holdYaw = Math.atan2(-(ai.heard.x - bot.pos.x), -(ai.heard.z - bot.pos.z));
  }
}

// Combat: track the target, stop to shoot in bursts, strafe between bursts.
function engage(bot, dt, fx) {
  const ai = bot.ai;
  const t = ai.target;
  ai.visibleFor += dt;
  const dx = t.pos.x - bot.pos.x;
  const dz = t.pos.z - bot.pos.z;
  const dist = Math.hypot(dx, dz);
  const wantYaw = Math.atan2(-dx, -dz);
  const eyeY = bot.pos.y + eyeHeight(bot);
  const chestY = t.pos.y + (t.crouch ? 0.85 : 1.15);
  const wantPitch = Math.atan2(chestY - eyeY, dist);

  // aim error shrinks while the target stays visible; snap-turns are capped
  ai.aimErr = Math.max(0.011, ai.aimErr - dt * 0.05);
  const errYaw = (S.rng() - 0.5) * 2 * ai.aimErr;
  const errPitch = (S.rng() - 0.5) * 2 * ai.aimErr * 0.7;
  faceToward(bot, wantYaw + errYaw, dt, 9);
  bot.pitch += ((wantPitch + errPitch) - bot.pitch) * Math.min(1, 10 * dt);

  let steering = false;
  ai.strafeT -= dt;
  if (dist > 24) {
    steering = !steer(bot, t.pos.x, t.pos.z, 4.2, dt); // close the distance
  } else if (ai.strafeT <= 0) {
    ai.strafeT = 0.7 + S.rng() * 0.8;
    ai.strafeDir = S.rng() < 0.5 ? -1 : 1;
  }
  if (dist <= 24 && ai.pauseT <= 0) {
    // strafe sideways between bursts, gun down
    const px = Math.cos(bot.yaw) * ai.strafeDir;
    const pz = -Math.sin(bot.yaw) * ai.strafeDir;
    bot.vel.x += (px * 2.3 - bot.vel.x) * Math.min(1, 10 * dt);
    bot.vel.z += (pz * 2.3 - bot.vel.z) * Math.min(1, 10 * dt);
    steering = true;
  } else {
    bot.vel.x *= 0.8; bot.vel.z *= 0.8; // planted feet: the accurate stance
  }

  // firing discipline: react, burst, breathe
  const gun = currentGun(bot);
  if (gun && ai.visibleFor > 0.27) {
    if (ai.pauseT > 0) {
      ai.pauseT -= dt;
    } else if (ai.burstT > 0) {
      ai.burstT -= dt;
      const aligned = Math.abs(((wantYaw - bot.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.09;
      if (aligned) tryFire(bot, fx);
      if (ai.burstT <= 0) ai.pauseT = gun.def.scoped ? 0.85 : 0.3 + S.rng() * 0.35;
    } else {
      ai.burstT = gun.def.scoped ? 0.05 : 0.32 + S.rng() * 0.4;
    }
  }
  bot.crouch = dist > 14 && ai.pauseT > 0.1 && S.rng() < 0.02 ? true : (dist <= 14 ? false : bot.crouch);
  return steering;
}

// Occasional, purposeful grenades: flash into a site before entering it, frag a
// last-seen position the bot can no longer see, smoke the planted charge on a retake.
function maybeGrenade(bot, fx) {
  const ai = bot.ai;
  if (!fx || bot.grenadeCoolT > 0 || ai.usedGrenade) return;
  const throwIt = (kind, tx, tz) => {
    bot.loadout.grenades[kind]--;
    bot.grenadeCoolT = 1.2;
    ai.usedGrenade = true;
    fx.throwGrenadeAt(bot, kind, tx, tz);
  };
  if (ai.smokeBomb && S.bomb && S.bomb.planted) {
    const d = Math.hypot(S.bomb.x - bot.pos.x, S.bomb.z - bot.pos.z);
    if (d < 13 && bot.loadout.grenades.smoke > 0) { ai.smokeBomb = false; throwIt('smoke', S.bomb.x, S.bomb.z); }
    return;
  }
  if (bot.team === TEAM.BRK && bot.loadout.grenades.flash > 0 && ai.goal) {
    const site = WORLD.sites[ai.site];
    const dSite = Math.hypot(site.x - bot.pos.x, site.z - bot.pos.z);
    if (dSite < 15 && dSite > 6 && S.rng() < 0.3) { throwIt('flash', site.x, site.z); return; }
  }
  if (bot.loadout.grenades.frag > 0 && ai.lastSeen && S.time - ai.lastSeen.t < 1.2 && !ai.target) {
    if (S.rng() < 0.25) throwIt('frag', ai.lastSeen.x, ai.lastSeen.z);
  }
}

// round.js calls this when a round goes live: give the bot its route for the round.
export function assignGoal(bot, x, z, onArrive) {
  setGoal(bot, x, z, true);
  bot.ai.state = 'route';
  bot.ai.onArrive = onArrive || null;
}

export function holdHere(bot, yaw) {
  bot.ai.state = 'hold';
  bot.ai.holdYaw = yaw;
  bot.ai.crouchHold = S.rng() < 0.35;
  bot.ai.path = [];
  bot.ai.post = { x: bot.pos.x, z: bot.pos.z };
}
