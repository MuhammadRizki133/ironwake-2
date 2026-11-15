// hud.js — everything drawn over the 3D view: health, armour, ammunition, money, the
// round clock and score, killfeed, radar, buy menu, scoreboard, banners and the white-out
// of a flash. It only reads state (and asks round.js to buy things); text nodes are
// updated when their value changes so a frame costs almost nothing.

import { S, PHASE, TEAM, CFG, aliveCount } from './state.js';
import { WORLD } from './world.js';
// (blockers are part of WORLD, filled by buildWorld)
import { currentGun } from './weapons.js';
import { buyItem } from './round.js';
import { keys } from './input.js';

const $ = (id) => document.getElementById(id);
const cache = new Map();
function setText(id, value) {
  if (cache.get(id) === value) return;
  cache.set(id, value);
  const el = $(id);
  if (el) el.textContent = value;
}

const BUY_ITEMS = [
  { key: '1', item: 'breacher', label: 'Breacher-12', price: 1100 },
  { key: '2', item: 'ripper', label: 'Ripper-9', price: 1400 },
  { key: '3', item: 'longbow', label: 'Longbow AR', price: 2700 },
  { key: '4', item: 'needle', label: 'Needle DMR', price: 4300 },
  { key: '5', item: 'armor', label: 'Armour + helmet', price: 650 },
  { key: '6', item: 'frag', label: 'Frag charge', price: 300 },
  { key: '7', item: 'flash', label: 'Flash charge', price: 200 },
  { key: '8', item: 'smoke', label: 'Smoke canister', price: 300 },
];

let bannerUntil = 0;
let hitmarkUntil = 0;

export function initHud() {
  const wrap = $('buy-items');
  for (const b of BUY_ITEMS) {
    const div = document.createElement('button');
    div.className = 'buy-item';
    div.dataset.item = b.item;
    div.innerHTML = `<span class="buy-key">${b.key}</span><span class="buy-label">${b.label}</span><span class="buy-price">$${b.price}</span><span class="buy-state"></span>`;
    div.addEventListener('click', () => doBuy(b.item));
    wrap.appendChild(div);
  }
  addEventListener('keydown', (e) => {
    if (!S.buyOpen) return;
    const found = BUY_ITEMS.find((b) => 'Digit' + b.key === e.code);
    if (found) doBuy(found.item);
  });
}

function doBuy(item) {
  if (!S.player || S.phase !== PHASE.BUY) return;
  buyItem(S.player, item);
}

function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

export function showBanner(main, sub, seconds) {
  setText('banner', main);
  setText('banner-sub', sub || '');
  $('banner-wrap').style.opacity = 1;
  bannerUntil = performance.now() + seconds * 1000;
}

export function updateHud() {
  const p = S.player;
  if (!p) return;
  const now = performance.now();

  // top bar
  setText('score-brk', String(S.score[0]));
  setText('score-wrd', String(S.score[1]));
  setText('round-label', S.phase === PHASE.MENU ? '' : 'ROUND ' + S.round + ' / ' + CFG.maxRounds);
  const timerText = S.phase === PHASE.BUY ? 'BUY ' + fmtTime(S.phaseT)
    : S.bomb && S.bomb.planted ? 'CHARGE ' + fmtTime(S.bomb.fuse)
    : S.phase === PHASE.END ? ''
    : fmtTime(S.phaseT);
  setText('timer', S.phase === PHASE.MENU || S.phase === PHASE.OVER ? '' : timerText);
  setText('alive-brk', '●'.repeat(aliveCount(TEAM.BRK)));
  setText('alive-wrd', '●'.repeat(aliveCount(TEAM.WRD)));
  setText('plan-tag', S.phase === PHASE.BUY || (S.phase === PHASE.LIVE && !(S.bomb && S.bomb.planted))
    ? (p.hasBomb ? 'YOU HAVE THE CHARGE — PLANT AT ' + (S.planSite || 'A') : 'ATTACK SITE ' + (S.planSite || 'A')) : '');

  // bottom-left: health and armour
  setText('health-num', String(Math.max(0, Math.ceil(p.hp))));
  $('health-bar').style.width = Math.max(0, p.hp) + '%';
  $('health-bar').style.background = p.hp > 50 ? 'var(--ink)' : p.hp > 25 ? '#f0a830' : '#e2483a';
  setText('armor-tag', p.loadout.armor ? '▣ ARMOUR' : '');

  // bottom-right: weapon, ammunition, money, grenades
  const gun = currentGun(p);
  if (gun) {
    setText('weapon-name', gun.def.name + (gun.reloadT > 0 ? ' — RELOADING' : ''));
    setText('ammo-mag', String(gun.ammo));
    setText('ammo-reserve', '/ ' + gun.reserve);
  }
  setText('money', '$' + p.money);
  setText('grenades', `FRAG ${p.loadout.grenades.frag} · FLASH ${p.loadout.grenades.flash} · SMOKE ${p.loadout.grenades.smoke}`);

  // crosshair spread follows the gun's real accuracy state
  if (gun) {
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const px = 5 + gun.heat * 9 + Math.min(10, speed * 1.7) + (p.crouch ? -2 : 0);
    document.documentElement.style.setProperty('--spread', Math.max(3, px) + 'px');
  }
  $('scopeov').style.opacity = p.scoped ? 1 : 0;

  // killfeed
  const feed = S.killfeed.slice(-5).map((k) =>
    `<div><b class="${k.killerTeam === 0 ? 'kb' : 'kw'}">${k.killer}</b> [${k.weapon}${k.head ? ' ⌖' : ''}] <b class="${k.victimTeam === 0 ? 'kb' : 'kw'}">${k.victim}</b></div>`).join('');
  if (cache.get('killfeed') !== feed) { cache.set('killfeed', feed); $('killfeed').innerHTML = feed; }

  // banners from events
  for (const e of S.events) {
    if (e.kind === 'roundstart') showBanner('ROUND ' + e.round, S.player.team === TEAM.BRK ? 'Plant the Charge at site ' + e.site + ' — or eliminate the Wardens' : '', 2.6);
    if (e.kind === 'roundend') showBanner(e.winner === p.team ? 'ROUND WON' : 'ROUND LOST', e.reason, 3.4);
    if (e.kind === 'planted') showBanner('CHARGE PLANTED', 'Site ' + e.site + ' — ' + (p.team === TEAM.BRK ? 'defend it' : 'defuse it'), 2.4);
    if (e.kind === 'matchend') showBanner(e.winner === p.team ? 'MATCH WON' : 'MATCH LOST', S.score[0] + ' — ' + S.score[1] + ' · press R for a rematch', 30);
    if (e.kind === 'hitmark' && performance.now() > hitmarkUntil - 110) { $('hitmarker').style.opacity = 1; hitmarkUntil = now + 120; }
  }
  if (now > bannerUntil) $('banner-wrap').style.opacity = 0;
  if (now > hitmarkUntil) $('hitmarker').style.opacity = 0;

  // damage vignette and flash white-out
  const sinceHit = S.time - p.lastDamageT;
  $('dmgvin').style.opacity = p.alive ? Math.max(0, 0.55 - sinceHit * 0.5) * (p.hp < 35 ? 1.4 : 1) : 0.7;
  $('flashov').style.opacity = Math.min(0.96, Math.max(0, p.blindT) / 3.2);

  // channel bar (planting / defusing) and context prompt
  const ch = $('channel');
  if (p.channel) {
    ch.style.opacity = 1;
    setText('channel-label', p.channel === 'plant' ? 'PLANTING THE CHARGE' : 'DEFUSING');
    const total = p.channel === 'plant' ? CFG.plantSeconds : CFG.defuseSeconds;
    $('channel-fill').style.width = Math.min(100, p.channelT / total * 100) + '%';
  } else {
    ch.style.opacity = 0;
  }
  let prompt = '';
  if (S.phase === PHASE.BUY) prompt = 'B — buy menu · round starts soon';
  else if (S.phase === PHASE.LIVE && p.hasBomb && p.alive) prompt = 'Reach a site ring and HOLD E to plant';
  else if (S.phase === PHASE.LIVE && !p.alive) prompt = 'You are down — watching your team';
  setText('prompt', prompt);

  // buy menu
  const buy = $('buymenu');
  const showBuy = S.buyOpen && S.phase === PHASE.BUY;
  buy.style.display = showBuy ? 'block' : 'none';
  if (showBuy) {
    setText('buy-money', 'FUNDS $' + p.money);
    for (const el of buy.querySelectorAll('.buy-item')) {
      const item = BUY_ITEMS.find((b) => b.item === el.dataset.item);
      let state = '';
      if (item.item === 'armor' && p.loadout.armor) state = 'OWNED';
      else if (p.loadout.primary && p.loadout.primary.id === item.item) state = 'OWNED';
      else if ((item.item === 'frag' || item.item === 'flash' || item.item === 'smoke') && p.loadout.grenades[item.item] >= 2) state = 'FULL';
      else if (p.money < item.price) state = '—';
      el.querySelector('.buy-state').textContent = state;
      el.classList.toggle('cant', state === '—');
    }
  }

  // scoreboard on Tab
  const sb = $('scoreboard');
  if (keys['Tab']) {
    sb.style.display = 'block';
    const rows = (team) => S.actors.filter((a) => a.team === team)
      .slice().sort((a, b) => b.kills - a.kills)
      .map((a) => `<tr class="${a.alive ? '' : 'dead'}"><td>${a.isPlayer ? '★ ' : ''}${a.name}</td><td>${a.kills}</td><td>${a.deaths}</td><td>$${a.money}</td></tr>`).join('');
    const html = `<h3>BREAKERS ${S.score[0]}</h3><table>${rows(0)}</table><h3>WARDENS ${S.score[1]}</h3><table>${rows(1)}</table>`;
    if (cache.get('sb') !== html) { cache.set('sb', html); sb.innerHTML = html; }
  } else {
    sb.style.display = 'none';
  }

  drawRadar();
}

let radarG = null;
function drawRadar() {
  const cv = $('radar');
  if (!cv) return;
  if (!radarG) radarG = cv.getContext('2d');
  const g = radarG;
  const W = cv.width;
  const px = (x) => (x + 38) / 76 * W;
  const pz = (z) => (z + 38) / 76 * W;
  g.clearRect(0, 0, W, W);
  g.fillStyle = 'rgba(16,20,24,0.72)';
  g.fillRect(0, 0, W, W);
  // sight blockers as faint blocks
  g.fillStyle = 'rgba(200,205,210,0.20)';
  for (const c of WORLD.blockers) {
    g.fillRect(px(c.minX), pz(c.minZ), (c.maxX - c.minX) / 76 * W, (c.maxZ - c.minZ) / 76 * W);
  }
  for (const siteKey of ['A', 'B']) {
    const site = WORLD.sites[siteKey];
    g.strokeStyle = siteKey === 'A' ? '#ff8c3a' : '#53b7e8';
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(px(site.x), pz(site.z), site.r / 76 * W, 0, Math.PI * 2); g.stroke();
    g.fillStyle = g.strokeStyle;
    g.font = 'bold 10px system-ui';
    g.textAlign = 'center';
    g.fillText(siteKey, px(site.x), pz(site.z) + 3);
  }
  // enemy gunfire heard recently shows as a fading blip — sound has a position here
  for (const n of S.noises) {
    if (n.team === S.player.team) continue;
    const age = S.time - n.t;
    if (age > 1.4) continue;
    g.fillStyle = `rgba(232,72,58,${0.75 * (1 - age / 1.4)})`;
    g.beginPath(); g.arc(px(n.x), pz(n.z), 3, 0, Math.PI * 2); g.fill();
  }
  // the Charge
  if (S.bomb) {
    const bx = S.bomb.carrier ? S.bomb.carrier.pos.x : S.bomb.x;
    const bz = S.bomb.carrier ? S.bomb.carrier.pos.z : S.bomb.z;
    if (S.bomb.carrier !== S.player || S.bomb.planted) {
      g.fillStyle = '#ffd34d';
      g.fillRect(px(bx) - 2.5, pz(bz) - 2.5, 5, 5);
    }
  }
  for (const a of S.actors) {
    if (!a.alive || a.team !== S.player.team) continue;
    g.fillStyle = a.isPlayer ? '#ffffff' : '#ffb37a';
    g.beginPath(); g.arc(px(a.pos.x), pz(a.pos.z), a.isPlayer ? 3.4 : 2.6, 0, Math.PI * 2); g.fill();
    if (a.isPlayer) {
      g.strokeStyle = '#ffffff';
      g.beginPath();
      g.moveTo(px(a.pos.x), pz(a.pos.z));
      g.lineTo(px(a.pos.x) - Math.sin(a.yaw) * 9, pz(a.pos.z) - Math.cos(a.yaw) * 9);
      g.stroke();
    }
  }
}
