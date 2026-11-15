// round.js — the match itself: phases, the team plan, the charge (bomb), channels,
// economy and win checks. It owns the clock. Player and bot updates are called from
// here so the whole simulation advances in one place, one fixed step at a time.
//
// Round shape (Counter-Strike's, renamed): 12 s buy/freeze, 105 s live, first to 7 of
// 12 rounds. The Breakers carry the Charge to a site and plant it (3.5 s channel);
// it blows in 40 s unless a Warden defuses it (6 s channel). Elimination ends a round
// only while the Charge is unplanted — after a plant, the round is the Charge's.

import { S, PHASE, CFG, TEAM, aliveCount, emit, resetMatch } from './state.js';
import { WORLD, inSite } from './world.js';
import { keys } from './input.js';
import { makeLoadout, WEAPONS } from './weapons.js';
import { createBot, botBuy, assignGoal, holdHere, BOT_NAMES } from './bots.js';
import { updatePlayer } from './player.js';
import { updateBot } from './bots.js';
import { updateWeapons } from './weapons.js';

export function createPlayer() {
  return {
    isPlayer: true, team: TEAM.BRK, name: 'YOU', id: 0,
    pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
    yaw: 0, pitch: 0, recoilPitch: 0, crouch: false, grounded: true,
    hp: 100, alive: true, loadout: makeLoadout(), money: CFG.startMoney,
    kills: 0, deaths: 0, hasBomb: false, channel: null, channelT: 0,
    blindT: 0, grenadeCoolT: 0, lastAttacker: null, lastDamageT: -9, mesh: null,
    ai: null, scoped: false,
  };
}

export function setupMatch(seed) {
  resetMatch(seed);
  const player = createPlayer();
  S.actors.push(player);
  S.player = player;
  let id = 1;
  for (const team of [TEAM.BRK, TEAM.WRD]) {
    const count = team === TEAM.BRK ? 4 : 5;
    for (let i = 0; i < count; i++) {
      const bot = createBot(team, BOT_NAMES[team][i]);
      bot.id = id++;
      bot.money = CFG.startMoney;
      S.actors.push(bot);
    }
  }
}

function placeAtSpawns() {
  const used = { 0: 0, 1: 0 };
  for (const a of S.actors) {
    const list = WORLD.spawns[a.team];
    const p = list[used[a.team]++ % list.length];
    a.pos.x = p[0]; a.pos.z = p[1]; a.pos.y = 0;
    a.vel.x = 0; a.vel.y = 0; a.vel.z = 0;
    a.yaw = a.team === TEAM.BRK ? 0 : Math.PI;
    a.pitch = 0;
  }
}

// The team plan for one round, written into bot goals. Attackers pick a site, send the
// carrier's group through its main road, one through mid, one on the long flank.
// Wardens hold both sites and mid, facing the lanes they expect company from.
function planRound() {
  const siteKey = S.rng() < 0.55 ? 'A' : 'B';
  const site = WORLD.sites[siteKey];
  const other = WORLD.sites[siteKey === 'A' ? 'B' : 'A'];
  const brk = S.actors.filter((a) => a.team === TEAM.BRK && !a.isPlayer);
  const wrd = S.actors.filter((a) => a.team === TEAM.WRD);
  const face = (a, x, z) => Math.atan2(-(x - a.pos.x), -(z - a.pos.z));

  let role = 0;
  for (const bot of brk) {
    bot.ai.site = siteKey;
    bot.ai.usedGrenade = false;
    bot.ai.recover = false;
    if (bot.hasBomb || role === 0) {
      assignGoal(bot, site.x + (S.rng() - 0.5) * 5, site.z + (S.rng() - 0.5) * 5);
    } else if (role === 1) {
      assignGoal(bot, 0, -2, (b) => assignGoal(b, site.x, site.z)); // through the mid doors
    } else if (role === 2) {
      assignGoal(bot, other.x, other.z + 6, (b) => assignGoal(b, site.x, site.z)); // the long flank
    } else {
      assignGoal(bot, site.x - (S.rng() - 0.5) * 8, site.z + 7);
    }
    role++;
  }
  // the player is told the plan through the HUD; their bot teammates run it either way
  const holds = [
    { site: WORLD.sites.A, x: -16, z: -11, tx: -24, tz: 8 },
    { site: WORLD.sites.A, x: -19, z: -21, tx: -9, tz: 3 },
    { site: WORLD.sites.B, x: 17, z: -8, tx: 25, tz: 6 },
    { site: WORLD.sites.B, x: 20, z: -22, tx: 9, tz: -3 },
    { site: null, x: 0, z: -14, tx: 0, tz: 0 },
  ];
  wrd.forEach((bot, i) => {
    const h = holds[i % holds.length];
    bot.ai.site = siteKey;
    bot.ai.usedGrenade = false;
    assignGoal(bot, h.x, h.z, (b) => holdHere(b, face(b, h.tx, h.tz)));
  });
  S.planSite = siteKey;
}

export function startRound() {
  S.round++;
  S.phase = PHASE.BUY;
  S.phaseT = CFG.buySeconds;
  S.buyOpen = false;
  S.noises.length = 0;
  S.smokes.length = 0;
  S.flashes.length = 0;
  for (const a of S.actors) {
    const wasDead = !a.alive;
    a.alive = true;
    a.hp = 100;
    a.channel = null;
    a.channelT = 0;
    a.blindT = 0;
    a.hasBomb = false;
    if (wasDead) { // death costs the guns, not the armour or the sidearm
      a.loadout.primary = null;
      a.loadout.grenades = { frag: 0, flash: 0, smoke: 0 };
      if (a.loadout.current === 'primary') a.loadout.current = 'sidearm';
    }
    for (const slot of ['primary', 'sidearm']) {
      const g = a.loadout[slot];
      if (g) { g.ammo = g.def.mag; g.reserve = g.def.reserve; g.reloadT = 0; g.coolT = 0; }
    }
  }
  placeAtSpawns();
  // the player carries the Charge: planting is the attacker's key decision, and the
  // human should be the one making it. Their bot carrier covers them.
  S.player.hasBomb = true;
  S.bomb = { carrier: S.player, planted: false, site: null, x: 0, z: 0, fuse: 0, defuser: null };
  planRound();
  for (const a of S.actors) if (!a.isPlayer) botBuy(a);
  emit('roundstart', { round: S.round, site: S.planSite });
}

function endRound(winner, reason) {
  S.phase = PHASE.END;
  S.phaseT = CFG.endSeconds;
  S.roundWinner = winner;
  S.roundReason = reason;
  S.score[winner]++;
  for (const a of S.actors) {
    a.channel = null;
    a.money = Math.min(CFG.maxMoney, a.money + (a.team === winner ? CFG.winReward : CFG.lossReward));
  }
  emit('roundend', { winner, reason });
  if (S.score[winner] >= CFG.roundsToWin || S.round >= CFG.maxRounds) {
    S.matchWinner = S.score[0] === S.score[1] ? winner : (S.score[0] > S.score[1] ? TEAM.BRK : TEAM.WRD);
  }
}

// Buy one item for an actor (the player, from the HUD menu). Returns a status string.
export function buyItem(actor, item) {
  const lo = actor.loadout;
  const pay = (p) => { if (actor.money >= p) { actor.money -= p; return true; } return false; };
  if (item === 'armor') {
    if (lo.armor) return 'owned';
    if (!pay(650)) return 'poor';
    lo.armor = true; lo.helmet = true;
    return 'ok';
  }
  if (item === 'frag' || item === 'flash' || item === 'smoke') {
    const price = { frag: 300, flash: 200, smoke: 300 }[item];
    if (lo.grenades[item] >= 2) return 'full';
    if (!pay(price)) return 'poor';
    lo.grenades[item]++;
    return 'ok';
  }
  const prices = { breacher: 1100, ripper: 1400, longbow: 2700, needle: 4300 };
  if (item in prices) {
    if (lo.primary && lo.primary.id === item) return 'owned';
    if (!pay(prices[item])) return 'poor';
    const def = WEAPONS[item];
    lo.primary = { id: item, def, ammo: def.mag, reserve: def.reserve, reloadT: 0, coolT: 0, heat: 0 };
    lo.current = 'primary';
    return 'ok';
  }
  return 'unknown';
}

function updateChannels(dt) {
  const bomb = S.bomb;
  for (const a of S.actors) {
    if (!a.channel || !a.alive) continue;
    if (a.channel === 'plant') {
      const site = inSite(WORLD.sites.A, a.pos.x, a.pos.z) ? 'A'
        : inSite(WORLD.sites.B, a.pos.x, a.pos.z) ? 'B' : null;
      const held = a.isPlayer ? !!keys['KeyE'] : true;
      if (!a.hasBomb || !site || !held || bomb.planted) { a.channel = null; a.channelT = 0; continue; }
      a.channelT += dt;
      if (a.channelT >= CFG.plantSeconds) {
        a.channel = null; a.channelT = 0; a.hasBomb = false;
        bomb.planted = true;
        bomb.site = site;
        bomb.x = a.pos.x; bomb.z = a.pos.z;
        bomb.fuse = CFG.bombFuseSeconds;
        bomb.carrier = null;
        a.money = Math.min(CFG.maxMoney, a.money + CFG.plantReward);
        emit('planted', { site, by: a });
      }
    } else if (a.channel === 'defuse') {
      if (!bomb.planted) { a.channel = null; a.channelT = 0; continue; }
      const d = Math.hypot(a.pos.x - bomb.x, a.pos.z - bomb.z);
      if (d > 2.4) { a.channel = null; a.channelT = 0; continue; }
      a.channelT += dt;
      if (a.channelT >= CFG.defuseSeconds) {
        a.channel = null; a.channelT = 0;
        bomb.planted = false;
        endRound(TEAM.WRD, 'The Charge was defused');
        return;
      }
    }
  }
  // the player starts a plant by holding E on a site with the Charge
  const p = S.player;
  if (S.phase === PHASE.LIVE && p.alive && p.hasBomb && !p.channel && keys['KeyE'] &&
      (inSite(WORLD.sites.A, p.pos.x, p.pos.z) || inSite(WORLD.sites.B, p.pos.x, p.pos.z))) {
    p.channel = 'plant';
    p.channelT = 0;
  }
  // bomb pickup: a Breaker walking over a dropped Charge takes it
  if (bomb && !bomb.planted && !bomb.carrier && S.phase === PHASE.LIVE) {
    for (const a of S.actors) {
      if (a.team !== TEAM.BRK || !a.alive) continue;
      if (Math.hypot(a.pos.x - bomb.x, a.pos.z - bomb.z) < 1.3) {
        bomb.carrier = a;
        a.hasBomb = true;
        emit('bombpickup', { by: a });
        break;
      }
    }
  }
}

export function updateMatch(dt, fx) {
  S.time += dt;
  for (const a of S.actors) {
    if (a.grenadeCoolT > 0) a.grenadeCoolT -= dt;
    if (a.isPlayer && a.blindT > 0) a.blindT -= dt; // bots decay their own in bots.js
  }

  if (S.phase === PHASE.BUY || S.phase === PHASE.LIVE) {
    S.phaseT -= dt;
    updatePlayer(S.player, dt, fx);
    for (const a of S.actors) if (!a.isPlayer) updateBot(a, dt, fx);
    for (const a of S.actors) updateWeapons(a, dt);
    updateChannels(dt);
    // dropped-Charge recovery: nearest Breaker bot goes for it
    if (S.bomb && !S.bomb.planted && !S.bomb.carrier && S.phase === PHASE.LIVE) {
      let best = null;
      let bd = Infinity;
      for (const a of S.actors) {
        if (a.isPlayer || a.team !== TEAM.BRK || !a.alive) continue;
        const d = Math.hypot(a.pos.x - S.bomb.x, a.pos.z - S.bomb.z);
        if (d < bd) { bd = d; best = a; }
      }
      if (best && !best.ai.recover) {
        best.ai.recover = true;
        // pick it up, then carry on to the planned site — the recovery is a detour,
        // not the mission
        assignGoal(best, S.bomb.x, S.bomb.z, (b) => {
          b.ai.recover = false;
          const site = WORLD.sites[b.ai.site];
          assignGoal(b, site.x, site.z);
        });
      }
    }
    if (S.bomb && S.bomb.planted) {
      S.bomb.fuse -= dt;
      if (S.bomb.fuse <= 0) {
        emit('explode', { x: S.bomb.x, z: S.bomb.z });
        endRound(TEAM.BRK, 'The Charge detonated');
        return;
      }
    }
    if (S.phase === PHASE.BUY && S.phaseT <= 0) {
      S.phase = PHASE.LIVE;
      S.phaseT = CFG.roundSeconds;
      S.buyOpen = false;
      emit('golive', {});
    } else if (S.phase === PHASE.LIVE) {
      const brkAlive = aliveCount(TEAM.BRK);
      const wrdAlive = aliveCount(TEAM.WRD);
      if (!S.bomb.planted) {
        if (wrdAlive === 0) { endRound(TEAM.BRK, 'Wardens eliminated'); return; }
        if (brkAlive === 0) { endRound(TEAM.WRD, 'Breakers eliminated'); return; }
        if (S.phaseT <= 0) { endRound(TEAM.WRD, 'Time expired — the plant holds'); return; }
      } else if (wrdAlive === 0) {
        // no one left to defuse: fast-forward the fuse
        S.bomb.fuse = Math.min(S.bomb.fuse, 1.2);
      }
    }
  } else if (S.phase === PHASE.END) {
    S.phaseT -= dt;
    for (const a of S.actors) updateWeapons(a, dt);
    if (S.phaseT <= 0) {
      if (S.matchWinner >= 0 || S.round >= CFG.maxRounds) {
        S.phase = PHASE.OVER;
        emit('matchend', { winner: S.matchWinner });
      } else {
        startRound();
      }
    }
  }
}
