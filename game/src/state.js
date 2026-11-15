// state.js — the single game-state store. Every module reads and writes the match through
// this one object, so a round can be staged, saved or reset by touching S alone. Nothing in
// here knows about three.js or the DOM: it is plain data plus the seeded random source the
// deterministic screenshot scenes rely on.

export const TICK = 1 / 60;            // fixed simulation step, seconds
export const TEAM = { BRK: 0, WRD: 1 }; // Breakers attack, Wardens defend
export const TEAM_NAME = ['Breakers', 'Wardens'];

export const PHASE = { MENU: 'menu', BUY: 'buy', LIVE: 'live', END: 'end', OVER: 'over' };

export const CFG = {
  roundsToWin: 7,
  maxRounds: 12,
  buySeconds: 12,
  roundSeconds: 105,
  endSeconds: 5,
  bombFuseSeconds: 40,
  plantSeconds: 3.5,
  defuseSeconds: 6,
  startMoney: 800,
  maxMoney: 9000,
  winReward: 2700,
  lossReward: 1900,
  plantReward: 300,
  killReward: 300,
};

// mulberry32: small, fast, seedable. The match simulation and the ?shot= scenes share it,
// so a staged scene is the same on every machine that opens it.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const S = {
  time: 0,                 // simulated seconds since boot
  phase: PHASE.MENU,
  phaseT: 0,               // seconds left in the current phase
  round: 0,
  score: [0, 0],           // rounds won, indexed by TEAM
  actors: [],              // every combatant, player first
  player: null,
  bomb: null,              // { carrier, planted, site, x, z, fuse, defuser, defuseT }
  noises: [],              // { x, z, radius, team, t } — gunfire and footsteps bots can hear
  smokes: [],              // { x, z, r, t } — active smoke clouds, they block sight
  flashes: [],             // pending flash effects resolved by perception
  events: [],              // one-frame facts for HUD/audio: { kind, ... }
  killfeed: [],            // { killer, victim, weapon, headshot, t }
  roundWinner: -1,
  roundReason: '',
  matchWinner: -1,
  buyOpen: false,
  paused: false,
  shotMode: null,          // name of a staged screenshot scene, or null in a real match
  rng: makeRng(1337),
};

export function resetMatch(seed) {
  S.time = 0;
  S.phase = PHASE.MENU;
  S.phaseT = 0;
  S.round = 0;
  S.score = [0, 0];
  S.actors.length = 0;
  S.player = null;
  S.bomb = null;
  S.noises.length = 0;
  S.smokes.length = 0;
  S.flashes.length = 0;
  S.events.length = 0;
  S.killfeed.length = 0;
  S.roundWinner = -1;
  S.roundReason = '';
  S.matchWinner = -1;
  S.buyOpen = false;
  S.paused = false;
  S.rng = makeRng(seed);
}

export function aliveCount(team) {
  let n = 0;
  for (const a of S.actors) if (a.team === team && a.alive) n++;
  return n;
}

export function emit(kind, data) {
  S.events.push(Object.assign({ kind }, data));
}
