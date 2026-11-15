// main.js — bootstrap and the frame loop. It builds the renderer, the actor figures and
// the player's viewmodel, then runs the match on a fixed 60 Hz step (round.js) kept
// apart from rendering: the renderer only reads state and draws it. However fast or
// slow the display is, the simulation a screenshot or a replay sees is the same.
//
// It also stages the deterministic screenshot scenes (?shot=buy|play|plant|end&seed=n):
// real match states, set up with the seeded rng, played by the real simulation — the
// screenshots in the entry are frames of this game running, nothing composited.

import * as THREE from 'three';
import { S, PHASE, TICK, TEAM } from './state.js';
import { PAL } from './palette.js';
import { buildWorld } from './world.js';
import { initInput, keys, mouse, requestLock } from './input.js';
import { initFx, updateFx, explode, tracer, impact, throwGrenade, throwGrenadeAt } from './fx.js';

// the one effects handle every simulation module fires through
const FX = { tracer, impact, throwGrenade, throwGrenadeAt };
import { initAudio, updateAudio, bombBeeps } from './audio.js';
import { initHud, updateHud, showBanner } from './hud.js';
import { setupMatch, startRound, updateMatch } from './round.js';
import { currentGun, WEAPONS } from './weapons.js';

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot');
const seed = Number(params.get('seed') || 1337);

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(PAL.sky);
scene.fog = new THREE.Fog(PAL.fog, 34, 105);

const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.08, 220);

const hemi = new THREE.HemisphereLight(0xbcc8d8, 0x3c3830, 0.95);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffd9ae, 1.7);
sun.position.set(-38, 52, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -46; sun.shadow.camera.right = 46;
sun.shadow.camera.top = 46; sun.shadow.camera.bottom = -46;
sun.shadow.camera.far = 140;
sun.shadow.bias = -0.0006;
scene.add(sun);

buildWorld(scene);
initFx(scene);

// --- actor figures ---------------------------------------------------------------------

const matCache = new Map();
function mat(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return matCache.get(color);
}

function nameSprite(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 56;
  const g = c.getContext('2d');
  g.font = 'bold 30px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillStyle = color;
  g.strokeStyle = 'rgba(0,0,0,0.65)';
  g.lineWidth = 5;
  g.strokeText(name, 128, 38);
  g.fillText(name, 128, 38);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sp.scale.set(1.9, 0.42, 1);
  sp.position.y = 2.12;
  return sp;
}

const GUN_DIMS = {
  sparrow: [0.07, 0.13, 0.24], breacher: [0.09, 0.16, 0.78], ripper: [0.08, 0.18, 0.55],
  longbow: [0.08, 0.17, 0.72], needle: [0.07, 0.15, 0.95],
};

function buildFigure(actor) {
  const grp = new THREE.Group();
  const teamCol = actor.team === TEAM.BRK ? PAL.brk : PAL.wrd;
  const darkCol = actor.team === TEAM.BRK ? PAL.brkDark : PAL.wrdDark;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), mat(teamCol));
  torso.position.y = 1.12;
  torso.castShadow = true;
  grp.add(torso);
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.28), mat(darkCol));
  hips.position.y = 0.68;
  grp.add(hips);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.56, 0.22), mat(darkCol));
    leg.position.set(0.13 * side, 0.28, 0);
    grp.add(leg);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.16), mat(teamCol));
    arm.position.set(0.36 * side, 1.14, -0.08);
    arm.rotation.x = -0.5;
    grp.add(arm);
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mat(0xc9a184));
  head.position.y = 1.62;
  head.castShadow = true;
  grp.add(head);
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.36), mat(darkCol));
  helmet.position.y = 1.78;
  grp.add(helmet);
  const gunHolder = new THREE.Group();
  gunHolder.position.set(0.1, 1.28, -0.3);
  grp.add(gunHolder);
  grp.userData.gunHolder = gunHolder;
  grp.userData.torso = torso;
  grp.userData.head = head;
  grp.add(nameSprite(actor.name, actor.team === TEAM.BRK ? '#ffb37a' : '#a9cdf0'));
  scene.add(grp);
  return grp;
}

function refreshFigureGun(actor) {
  const holder = actor.mesh.userData.gunHolder;
  while (holder.children.length) holder.remove(holder.children[0]);
  const gun = currentGun(actor);
  if (!gun) return;
  const d = GUN_DIMS[gun.id] || GUN_DIMS.longbow;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(d[0], d[1], d[2]), mat(0x22262b));
  mesh.position.z = -d[2] / 2;
  holder.add(mesh);
  if (gun.id === 'needle') {
    const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.2), mat(0x111417));
    scope.position.set(0, 0.11, -0.3);
    holder.add(scope);
  }
}

// --- player viewmodel --------------------------------------------------------------------

const viewmodel = new THREE.Group();
const vmGunHolder = new THREE.Group();
viewmodel.add(vmGunHolder);
camera.add(viewmodel);
scene.add(camera);
let vmFlash = null;
{
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,240,200,1)');
  grad.addColorStop(1, 'rgba(255,150,50,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  vmFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0, depthWrite: false }));
  vmFlash.scale.set(0.34, 0.34, 1);
}

function refreshViewmodel() {
  while (vmGunHolder.children.length) vmGunHolder.remove(vmGunHolder.children[0]);
  const p = S.player;
  if (!p) return;
  const gun = currentGun(p);
  if (!gun) return;
  const d = GUN_DIMS[gun.id] || GUN_DIMS.longbow;
  const body = new THREE.Mesh(new THREE.BoxGeometry(d[0] * 1.15, d[1] * 1.15, d[2]), mat(0x2a2f36));
  body.position.set(0.23, -0.21, -0.42 - d[2] / 2);
  vmGunHolder.add(body);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.09), mat(0x1d2126));
  grip.position.set(0.23, -0.33, -0.52);
  grip.rotation.x = 0.4;
  vmGunHolder.add(grip);
  if (gun.id === 'needle') {
    const scope = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.08, 0.24), mat(0x14171a));
    scope.position.set(0.23, -0.1, -0.75);
    vmGunHolder.add(scope);
  }
  vmFlash.position.set(0.23, -0.17, -0.5 - d[2]);
  vmGunHolder.add(vmFlash);
}

// --- match lifecycle -----------------------------------------------------------------------

let started = false;
function beginMatch() {
  setupMatch((Math.random() * 1e9) | 0);
  for (const a of S.actors) {
    a.mesh = buildFigure(a);
    refreshFigureGun(a);
  }
  startRound();
  refreshViewmodel();
  started = true;
  document.getElementById('menu').style.display = 'none';
  document.getElementById('hud').style.display = 'block';
}

function stageShot(name) {
  setupMatch(seed);
  for (const a of S.actors) {
    a.mesh = buildFigure(a);
  }
  startRound();
  const p = S.player;
  const give = (a, gunId) => {
    if (gunId) {
      const def = WEAPONS[gunId];
      a.loadout.primary = { id: gunId, def, ammo: def.mag, reserve: def.reserve, reloadT: 0, coolT: 0, heat: 0 };
      a.loadout.current = 'primary';
    }
    a.loadout.armor = true;
    a.loadout.helmet = true;
    a.money = 4350;
    refreshFigureGun(a);
  };
  for (const a of S.actors) give(a, a.team === TEAM.WRD && a.id === 7 ? 'needle' : 'longbow');
  S.score = [5, 4];
  S.round = 10;
  S.events.length = 0; // drop startRound's roundstart event: it would overwrite a staged banner on frame one

  if (name === 'buy') {
    S.phase = PHASE.BUY;
    S.phaseT = 9;
    S.buyOpen = true;
    p.pos.x = 0; p.pos.z = 29;
    p.yaw = 0.5;
  } else if (name === 'play') {
    S.phase = PHASE.LIVE;
    S.phaseT = 47;
    p.pos.x = -1.2; p.pos.z = 3.2;
    p.yaw = 0.12; p.pitch = 0.01;
    p.hp = 78;
    const wrd = S.actors.filter((a) => a.team === TEAM.WRD);
    const brk = S.actors.filter((a) => a.team === TEAM.BRK && !a.isPlayer);
    place(wrd[0], 0.8, -5.5, Math.PI, true);
    place(wrd[1], -8.5, -1.5, Math.PI * 0.78, true);
    place(wrd[2], 10.5, -11, Math.PI * 1.15, false);
    place(wrd[3], 22, -18, Math.PI, false);
    place(wrd[4], -20, -20, Math.PI * 0.9, false);
    place(brk[0], -3.4, 5.5, -0.4, true);
    place(brk[1], 3.8, 7.5, 0.3, false);
    place(brk[2], -13, 12, -0.8, false);
    place(brk[3], 14, 16, 0.6, false);
    place(wrd[4], 2.5, -2.5, Math.PI, false);
    wrd[4].alive = false; wrd[4].hp = 0;
    brk[3].alive = false; brk[3].hp = 0;
    S.killfeed.push(
      { killer: 'YOU', killerTeam: 0, victim: 'KETT', victimTeam: 1, weapon: 'Longbow AR', head: true, t: 0 },
      { killer: 'MIRA', killerTeam: 1, victim: 'FABLE', victimTeam: 0, weapon: 'Needle DMR', head: false, t: 0 },
    );
    S.planSite = 'A';
  } else if (name === 'plant') {
    S.phase = PHASE.LIVE;
    S.phaseT = 31;
    keys['KeyE'] = true; // the staged player keeps the plant key held
    p.pos.x = -20.5; p.pos.z = -13.5;
    p.yaw = 2.6; p.pitch = -0.15;
    p.channel = 'plant';
    p.channelT = 2.0;
    const brk = S.actors.filter((a) => a.team === TEAM.BRK && !a.isPlayer);
    const wrd = S.actors.filter((a) => a.team === TEAM.WRD);
    place(brk[0], -16.5, -10.5, 2.4, true);
    place(brk[1], -24.5, -8, 2.9, false);
    place(brk[2], -14.8, -18, 1.8, false);
    place(brk[3], -9, 3, 2.8, false);
    place(wrd[0], -13.8, -4.5, -2.2, false);
    place(wrd[1], 0, -14, -1.6, false);
    place(wrd[2], 20, -20, 2.8, false);
    place(wrd[3], 23, -6, 2.4, false);
    wrd[4].alive = false; wrd[4].hp = 0;
    S.planSite = 'A';
  } else if (name === 'end') {
    S.phase = PHASE.END;
    S.phaseT = 999; // held for the photograph; the HUD hides the clock in this phase
    S.score = [6, 4];
    p.pos.x = -18; p.pos.z = -12;
    p.yaw = 2.2;
    for (const a of S.actors) if (a.team === TEAM.WRD) { a.alive = false; a.hp = 0; }
    showBanner('ROUND WON', 'The Charge detonated', 30);
    keys['Tab'] = true;
  }
  refreshViewmodel();
  document.getElementById('menu').style.display = 'none';
  document.getElementById('hud').style.display = 'block';
  started = true;
  S.shotMode = name;
}

function place(actor, x, z, yaw, crouch) {
  actor.pos.x = x;
  actor.pos.z = z;
  actor.yaw = yaw;
  actor.crouch = !!crouch;
  if (actor.ai) { actor.ai.state = 'hold'; actor.ai.holdYaw = yaw; actor.ai.path = []; }
}

// --- input wiring --------------------------------------------------------------------------

initInput(canvas, initAudio);
initHud();

canvas.addEventListener('click', () => {
  if (shotMode) return;
  if (!started) { initAudio(); beginMatch(); }
  if (!S.paused) requestLock(canvas);
  S.paused = false;
});
document.addEventListener('pointerlockchange', () => {
  if (!shotMode && started && !mouse.locked && S.phase !== PHASE.OVER) {
    S.paused = true;
    document.getElementById('paused').style.display = 'flex';
  } else {
    document.getElementById('paused').style.display = 'none';
  }
});
document.getElementById('paused').addEventListener('click', () => {
  S.paused = false;
  requestLock(canvas);
});
addEventListener('keydown', (e) => {
  if (e.code === 'KeyB' && S.phase === PHASE.BUY) S.buyOpen = !S.buyOpen;
  if (e.code === 'KeyR' && S.phase === PHASE.OVER) {
    for (const a of S.actors) if (a.mesh) { scene.remove(a.mesh); a.mesh = null; }
    beginMatch();
  }
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

if (shotMode) stageShot(shotMode);

// --- the loop ---------------------------------------------------------------------------------

let last = performance.now();
let acc = 0;
let menuAngle = 0;
let beepClock = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;

  if (started && !S.paused) {
    acc += dt;
    let steps = 0;
    while (acc >= TICK && steps < 5) {
      updateMatch(TICK, FX);
      updateFx(TICK);
      acc -= TICK;
      steps++;
    }
    if (steps === 5) acc = 0;
  }

  // consume the frame's events (explosion visuals, audio, HUD banners), then clear
  for (const e of S.events) {
    if (e.kind === 'explode') explode(e.x, e.z);
    if (e.kind === 'shot' && e.actor.isPlayer) vmFlash.material.opacity = 0.9;
  }
  updateAudio();
  bombBeeps();
  syncCamera(dt);
  syncFigures(dt);
  updateHud();
  S.events.length = 0;
  if (vmFlash.material.opacity > 0) vmFlash.material.opacity = Math.max(0, vmFlash.material.opacity - dt * 14);
  renderer.render(scene, camera);
}

let camShake = 0;
function syncCamera(dt) {
  const p = S.player;
  if (!started || S.phase === PHASE.MENU || !p) {
    // menu: a slow orbit over the foundry
    menuAngle += dt * 0.05;
    camera.position.set(Math.cos(menuAngle) * 30, 17, Math.sin(menuAngle) * 30);
    camera.lookAt(0, 1, -6);
    camera.fov = 60;
    camera.updateProjectionMatrix();
    return;
  }
  let view = p;
  if (!p.alive) {
    view = S.actors.find((a) => a.team === p.team && a.alive && !a.isPlayer) || p;
  }
  const eyeY = view.pos.y + (view.crouch ? 1.16 : 1.62);
  // landing/step bob for the player only
  let bob = 0;
  if (view.isPlayer && view.grounded) {
    const sp = Math.hypot(view.vel.x, view.vel.z);
    if (sp > 0.6) bob = Math.sin(S.time * 10.5) * 0.028 * Math.min(1, sp / 5);
  }
  for (const e of S.events) if (e.kind === 'shake') camShake = Math.max(camShake, e.amount);
  camShake = Math.max(0, camShake - dt * 1.4);
  const shake = (Math.random() - 0.5) * camShake * 0.05;
  camera.position.set(view.pos.x, eyeY + bob + shake, view.pos.z);
  const pitch = view.pitch + (view.isPlayer ? view.recoilPitch : 0);
  camera.rotation.set(0, 0, 0);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = view.yaw;
  camera.rotation.x = pitch + shake;
  // scope: the Needle's optic narrows the view and hides the viewmodel
  const gun = currentGun(p);
  const wantScope = !!(p.alive && p.scoped && gun && gun.def.scoped);
  const targetFov = wantScope ? 23 : 78;
  if (Math.abs(camera.fov - targetFov) > 0.4) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 11);
    camera.updateProjectionMatrix();
  }
  viewmodel.visible = p.alive && !wantScope;
  if (p.alive) {
    const g2 = currentGun(p);
    if (g2 && viewmodel.userData.gunId !== g2.id) {
      viewmodel.userData.gunId = g2.id;
      refreshViewmodel();
    }
    // viewmodel sway, recoil kick and reload dip
    const sp = Math.hypot(p.vel.x, p.vel.z);
    vmGunHolder.position.y = sp > 0.6 && p.grounded ? Math.sin(S.time * 10.5) * 0.012 : 0;
    vmGunHolder.position.z = (p.recoilPitch || 0) * 1.4;
    const gunNow = currentGun(p);
    vmGunHolder.rotation.x = gunNow && gunNow.reloadT > 0 ? -0.65 * Math.sin(Math.min(1, gunNow.reloadT / gunNow.def.reloadSec) * Math.PI) : 0;
  }
}

function syncFigures(dt) {
  for (const a of S.actors) {
    if (!a.mesh) continue;
    if (a.isPlayer && S.player.alive) { a.mesh.visible = false; continue; } // first-person: no own body
    a.mesh.visible = true;
    a.mesh.position.set(a.pos.x, a.pos.y, a.pos.z);
    a.mesh.rotation.y = a.yaw;
    const holder = a.mesh.userData.gunHolder;
    holder.rotation.x = -a.pitch;
    const gun = currentGun(a);
    if (gun && a.mesh.userData.gunId !== gun.id) {
      a.mesh.userData.gunId = gun.id;
      refreshFigureGun(a);
    }
    const targetTilt = a.alive ? 0 : Math.PI / 2.2;
    const cur = a.mesh.rotation.x || 0;
    a.mesh.rotation.x = cur + (targetTilt - cur) * Math.min(1, dt * 7);
    a.mesh.position.y = a.pos.y + (a.alive ? 0 : -0.55);
    const bodyScale = a.crouch && a.alive ? 0.82 : 1;
    a.mesh.scale.y += (bodyScale - a.mesh.scale.y) * Math.min(1, dt * 10);
  }
}

requestAnimationFrame(frame);
