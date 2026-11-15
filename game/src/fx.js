// fx.js — everything the eye and the grenades do: tracers, impact puffs, muzzle flashes,
// thrown charges (frag, flash, smoke) and the bomb explosion. Effects are pooled —
// fixed-size arrays recycled in place, so a firefight allocates nothing per frame.
//
// Grenades are simulation, not decoration: a frag really damages through weapons.js
// rules, a flash really sets blindT by view angle and distance, and a smoke cloud is
// written into state where bot perception reads it. This module is stepped from the
// fixed-step loop alongside the match, never from the render loop.

import * as THREE from 'three';
import { S, emit } from './state.js';
import { PAL } from './palette.js';
import { rayWorld } from './world.js';
import { damage, eyeHeight } from './weapons.js';

const MAX_TRACERS = 72;
const MAX_PARTICLES = 700;
const MAX_GRENADES = 24;

let scene = null;
let tracerGeo, tracerPos, tracerCol;
const tracers = []; // { life, i }
let points, pPos, pCol;
const particles = []; // { life, vx, vy, vz }
let flashTex;
const flashes = []; // { sprite, light, life }
const grenades = []; // { mesh, kind, vx, vy, vz, fuse, thrower, active }
const smokeMeshes = new Map();

function radialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

export function initFx(s) {
  scene = s;
  // tracers: one LineSegments, every tracer is a vertex pair with a colour
  tracerPos = new Float32Array(MAX_TRACERS * 6);
  tracerCol = new Float32Array(MAX_TRACERS * 6);
  tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3));
  tracerGeo.setAttribute('color', new THREE.BufferAttribute(tracerCol, 3));
  const lines = new THREE.LineSegments(tracerGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }));
  lines.frustumCulled = false;
  scene.add(lines);
  for (let i = 0; i < MAX_TRACERS; i++) tracers.push({ life: 0, i });

  // particles: one Points cloud
  pPos = new Float32Array(MAX_PARTICLES * 3);
  pCol = new Float32Array(MAX_PARTICLES * 3);
  for (let i = 0; i < MAX_PARTICLES; i++) { pPos[i * 3 + 1] = -60; particles.push({ life: 0, vx: 0, vy: 0, vz: 0 }); }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.14, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
  points.frustumCulled = false;
  scene.add(points);

  flashTex = radialTexture('rgba(255,230,170,1)', 'rgba(255,140,40,0)');
  for (let i = 0; i < 6; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: 0xffcf8a, transparent: true, opacity: 0, depthWrite: false }));
    sprite.scale.set(0.7, 0.7, 1);
    scene.add(sprite);
    const light = new THREE.PointLight(0xffb45e, 0, 9, 2);
    scene.add(light);
    flashes.push({ sprite, light, life: 0 });
  }
  const gGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const gMats = {
    frag: new THREE.MeshLambertMaterial({ color: 0x3d4a35 }),
    flash: new THREE.MeshLambertMaterial({ color: 0xc8cdd2 }),
    smoke: new THREE.MeshLambertMaterial({ color: 0x777d82 }),
  };
  for (let i = 0; i < MAX_GRENADES; i++) {
    const mesh = new THREE.Mesh(gGeo, gMats.frag);
    mesh.visible = false;
    scene.add(mesh);
    grenades.push({ mesh, mat: gMats, kind: 'frag', vx: 0, vy: 0, vz: 0, fuse: 0, thrower: null, active: false });
  }
}

let tracerCursor = 0;
export function tracer(x1, y1, z1, x2, y2, z2, team) {
  const t = tracers[tracerCursor];
  tracerCursor = (tracerCursor + 1) % MAX_TRACERS;
  t.life = 0.055;
  const i6 = t.i * 6;
  tracerPos[i6] = x1; tracerPos[i6 + 1] = y1; tracerPos[i6 + 2] = z1;
  tracerPos[i6 + 3] = x2; tracerPos[i6 + 4] = y2; tracerPos[i6 + 5] = z2;
  const c = new THREE.Color(team === 0 ? PAL.tracerBrk : PAL.tracerWrd);
  tracerCol[i6] = c.r; tracerCol[i6 + 1] = c.g; tracerCol[i6 + 2] = c.b;
  tracerCol[i6 + 3] = c.r * 0.4; tracerCol[i6 + 4] = c.g * 0.4; tracerCol[i6 + 5] = c.b * 0.4;
  tracerGeo.attributes.position.needsUpdate = true;
  tracerGeo.attributes.color.needsUpdate = true;
  muzzle(x1, y1, z1);
}

let flashCursor = 0;
export function muzzle(x, y, z) {
  const f = flashes[flashCursor];
  flashCursor = (flashCursor + 1) % flashes.length;
  f.life = 0.045;
  f.sprite.position.set(x, y, z);
  f.sprite.material.opacity = 0.95;
  f.light.position.set(x, y, z);
  f.light.intensity = 14;
}

let particleCursor = 0;
function puff(x, y, z, n, color, speed, up) {
  const c = new THREE.Color(color);
  for (let k = 0; k < n; k++) {
    const p = particles[particleCursor];
    const i3 = particleCursor * 3;
    particleCursor = (particleCursor + 1) % MAX_PARTICLES;
    p.life = 0.3 + S.rng() * 0.35;
    pPos[i3] = x; pPos[i3 + 1] = y; pPos[i3 + 2] = z;
    pCol[i3] = c.r; pCol[i3 + 1] = c.g; pCol[i3 + 2] = c.b;
    p.vx = (S.rng() - 0.5) * speed;
    p.vy = S.rng() * up;
    p.vz = (S.rng() - 0.5) * speed;
  }
  points.geometry.attributes.color.needsUpdate = true;
}

export function impact(x, y, z, flesh) {
  puff(x, y, z, flesh ? 7 : 5, flesh ? 0x7e2a22 : 0x9a958c, 1.6, 1.2);
}

// --- grenades -----------------------------------------------------------------------------

function spawnGrenade(actor, kind, vx, vy, vz) {
  const g = grenades.find((x) => !x.active) || grenades[0];
  g.active = true;
  g.kind = kind;
  g.thrower = actor;
  g.mesh.material = g.mat[kind];
  g.mesh.visible = true;
  g.mesh.position.set(actor.pos.x, actor.pos.y + eyeHeight(actor), actor.pos.z);
  g.vx = vx; g.vy = vy; g.vz = vz;
  g.fuse = kind === 'frag' ? 1.6 : kind === 'flash' ? 1.25 : 0.9;
  emit('throw', { actor, kind });
}

// Thrown by the player (and by shot scenes): straight along the aim.
export function throwGrenade(actor, kind) {
  const cy = Math.cos(actor.pitch + 0.18);
  const sp = 16.5;
  spawnGrenade(
    actor, kind,
    -Math.sin(actor.yaw) * cy * sp,
    Math.sin(actor.pitch + 0.18) * sp,
    -Math.cos(actor.yaw) * cy * sp,
  );
}

// Thrown by bots at a ground point: fixed 0.95 s of flight, solved velocity.
export function throwGrenadeAt(actor, kind, tx, tz) {
  const sx = actor.pos.x;
  const sy = actor.pos.y + eyeHeight(actor);
  const sz = actor.pos.z;
  const T = 0.95;
  const vx = (tx - sx) / T;
  const vz = (tz - sz) / T;
  const vy = (0.3 - sy) / T + 0.5 * 13.5 * T;
  spawnGrenade(actor, kind, vx, vy, vz);
}

function detonate(g) {
  const p = g.mesh.position;
  if (g.kind === 'frag') {
    puff(p.x, p.y + 0.3, p.z, 26, 0xd88a4a, 5, 4);
    muzzle(p.x, p.y + 0.4, p.z);
    emit('fragboom', { x: p.x, z: p.z });
    for (const a of S.actors) {
      if (!a.alive) continue;
      const dx = a.pos.x - p.x;
      const dz = a.pos.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 6.5) continue;
      const chestY = a.pos.y + 1.0;
      const blocked = rayWorld(p.x, p.y + 0.25, p.z, dx / (dist || 1), (chestY - p.y) / (dist || 1), dz / (dist || 1), dist) < dist - 0.3;
      const dmg = (95 * (1 - dist / 7.5)) * (blocked ? 0.25 : 1);
      if (dmg > 2) damage(S, a, dmg, { attacker: g.thrower, weapon: 'Frag charge', head: false });
    }
  } else if (g.kind === 'flash') {
    puff(p.x, p.y + 0.3, p.z, 10, 0xf2f4f6, 2, 2);
    emit('flashpop', { x: p.x, z: p.z });
    for (const a of S.actors) {
      if (!a.alive) continue;
      const dx = p.x - a.pos.x;
      const dz = p.z - a.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 26) continue;
      const eyeY = a.pos.y + eyeHeight(a);
      if (rayWorld(a.pos.x, eyeY, a.pos.z, dx / (dist || 1), 0, dz / (dist || 1), dist) < dist - 0.2) continue;
      const fx2 = -Math.sin(a.yaw);
      const fz2 = -Math.cos(a.yaw);
      const dot = (dx * fx2 + dz * fz2) / (dist || 1);
      let strength = 0;
      if (dot > 0.55) strength = 1;
      else if (dot > 0) strength = 0.45;
      else if (dot > -0.5) strength = 0.18;
      strength *= Math.max(0.15, 1 - dist / 30);
      if (strength > 0.05) {
        a.blindT = Math.max(a.blindT, strength * 4.2);
        if (a.isPlayer) emit('flashed', { strength });
      }
    }
  } else if (g.kind === 'smoke') {
    const entry = { x: p.x, z: p.z, r: 3.1, t: 9 };
    S.smokes.push(entry);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(3.1, 18, 12),
      new THREE.MeshLambertMaterial({ color: PAL.smoke, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    mesh.position.set(p.x, 1.5, p.z);
    scene.add(mesh);
    smokeMeshes.set(entry, mesh);
    emit('smokepop', { x: p.x, z: p.z });
  }
  g.active = false;
  g.mesh.visible = false;
}

export function explode(x, z) {
  puff(x, 1, z, 60, 0xff9a3c, 9, 8);
  puff(x, 1, z, 30, 0x555a5e, 6, 5);
  muzzle(x, 1.2, z);
  emit('shake', { amount: 0.5 });
}

// Stepped from the fixed-step loop: grenade physics, smoke lifetimes, pool lifetimes.
export function updateFx(dt) {
  for (const t of tracers) {
    if (t.life <= 0) continue;
    t.life -= dt;
    if (t.life <= 0) {
      const i6 = t.i * 6;
      tracerPos[i6 + 3] = tracerPos[i6];
      tracerPos[i6 + 4] = tracerPos[i6 + 1];
      tracerPos[i6 + 5] = tracerPos[i6 + 2];
      tracerGeo.attributes.position.needsUpdate = true;
    }
  }
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const p = particles[i];
    if (p.life <= 0) continue;
    p.life -= dt;
    const i3 = i * 3;
    if (p.life <= 0) { pPos[i3 + 1] = -60; continue; }
    p.vy -= 5.5 * dt;
    pPos[i3] += p.vx * dt;
    pPos[i3 + 1] += p.vy * dt;
    pPos[i3 + 2] += p.vz * dt;
    if (pPos[i3 + 1] < 0.03) pPos[i3 + 1] = 0.03;
  }
  points.geometry.attributes.position.needsUpdate = true;
  for (const f of flashes) {
    if (f.life <= 0) continue;
    f.life -= dt;
    if (f.life <= 0) { f.sprite.material.opacity = 0; f.light.intensity = 0; }
  }
  for (const g of grenades) {
    if (!g.active) continue;
    g.fuse -= dt;
    g.vy -= 13.5 * dt;
    const p = g.mesh.position;
    p.x += g.vx * dt;
    p.y += g.vy * dt;
    p.z += g.vz * dt;
    if (p.y < 0.1) {
      p.y = 0.1;
      g.vy = Math.abs(g.vy) > 1.6 ? -g.vy * 0.35 : 0;
      g.vx *= 0.7; g.vz *= 0.7;
    }
    if (g.fuse <= 0) detonate(g);
  }
  for (let i = S.smokes.length - 1; i >= 0; i--) {
    const sm = S.smokes[i];
    sm.t -= dt;
    const mesh = smokeMeshes.get(sm);
    if (mesh && sm.t < 1.2) mesh.material.opacity = 0.55 * Math.max(0, sm.t / 1.2);
    if (sm.t <= 0) {
      if (mesh) { scene.remove(mesh); smokeMeshes.delete(sm); }
      S.smokes.splice(i, 1);
    }
  }
}
