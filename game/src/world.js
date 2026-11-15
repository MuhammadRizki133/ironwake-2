// world.js — the Ironwake Foundry: one original map, defined as data. The same box list
// builds the three.js meshes, the movement colliders, the sight blockers and the bots'
// navigation graph, so what you see is exactly what the simulation collides with.
//
// Layout, read from the Wardens' end: two plant yards — the Furnace hall (site A, west)
// and the Depot (site B, east) — a walled mid corridor between them, a main road to each
// site from the Breaker spawn in the south, and a short connector off mid to each site.
// Every lane has a corner or a crate stack on it; there is no free sightline spawn to site.

import * as THREE from 'three';
import { PAL } from './palette.js';

export const WORLD = {
  colliders: [],   // { minX, maxX, minZ, maxZ, top } — movement and bullets
  blockers: [],    // colliders tall enough to break a standing sightline
  navNodes: [],    // { x, z }
  navEdges: [],    // adjacency: array of arrays of node indices
  sites: {
    A: { x: -22, z: -16, r: 7.5, name: 'Furnace' },
    B: { x: 23, z: -13, r: 7.5, name: 'Depot' },
  },
  spawns: { 0: [], 1: [] }, // by TEAM: Breakers south, Wardens north
  bounds: 35,
};

const BOXES = [];
function box(x, z, w, d, h, mat, name) {
  BOXES.push({ x, z, w, d, h, mat, name: name || '' });
}

// --- perimeter and plant shell -------------------------------------------------------
box(0, -37.5, 79, 3, 6, 'wallDark'); box(0, 37.5, 79, 3, 6, 'wallDark');
box(-37.5, 0, 3, 79, 6, 'wallDark'); box(37.5, 0, 3, 79, 6, 'wallDark');
box(-30, -30, 10, 4, 5, 'wall');            // north-west plant block
box(30, -30, 10, 4, 5, 'wall');             // north-east plant block
box(0, -33, 14, 3, 5, 'wall');              // Warden spawn back wall

// --- mid corridor: two long walls with a double door at z=0 and gaps at both ends ----
box(-5.2, -15, 2.4, 18, 4.2, 'wall'); box(5.2, -15, 2.4, 18, 4.2, 'wall');
box(-5.2, 13, 2.4, 20, 4.2, 'wall'); box(5.2, 13, 2.4, 20, 4.2, 'wall');
box(-5.2, 0.5, 2.4, 5, 4.2, 'wall'); box(5.2, 0.5, 2.4, 5, 4.2, 'wall'); // door jambs
box(-1.8, 6, 4.4, 1.6, 4.2, 'wall'); box(1.8, -6, 4.4, 1.6, 4.2, 'wall'); // the S-bend: no spawn-to-spawn sightline
box(0, -8, 2.2, 2.2, 1.15, 'crate', 'mid box');
box(0, 8, 2.2, 2.2, 1.15, 'crate', 'mid box');

// --- site A, the Furnace hall ---------------------------------------------------------
box(-26, -20, 7, 7, 7.5, 'furnace', 'furnace');          // the furnace block itself
box(-14.5, -22, 1.6, 10, 4, 'wall');                     // hall east wall, north half
box(-14.5, -6, 1.6, 6, 4, 'wall');                       // hall east wall, south half (door between)
box(-17.25, -25.5, 5.5, 1.6, 4, 'wall');                 // hall north wall (door gap west of it, by the furnace)
box(-24, -10, 2.2, 2.2, 1.15, 'crate');
box(-21, -19, 1.1, 4.4, 2.3, 'metal', 'pipes');
box(-29, -9, 4.4, 2.2, 1.15, 'crate');

// --- A lanes: main road west, short connector off mid ---------------------------------
box(-16, 14, 2.2, 2.2, 1.15, 'crate');
box(-24, 6, 2.2, 2.2, 1.15, 'crate');
box(-9, 2, 2.2, 2.2, 1.15, 'crate', 'A short box');
box(-19, -1, 6, 1.6, 3.4, 'wall');                       // A short corner wall
box(-31, 20, 2.2, 4.4, 2.3, 'containerA');

// --- site B, the Depot -----------------------------------------------------------------
box(20, -20, 6.4, 2.6, 2.6, 'containerA');
box(27, -18, 2.6, 6.4, 2.6, 'containerB');
box(23, -7, 6.4, 2.6, 2.6, 'containerB');
box(17, -12, 2.2, 2.2, 1.15, 'crate');
box(26, -11, 2.2, 2.2, 2.3, 'crate', 'double stack');
box(30, -26, 8, 1.6, 4, 'wall');
box(14.5, -21, 1.6, 8, 4, 'wall');                       // depot west wall

// --- B lanes: main road east, short connector off mid ----------------------------------
box(16, 14, 2.2, 2.2, 1.15, 'crate');
box(25, 5, 2.2, 2.2, 1.15, 'crate');
box(11.5, -0.5, 2.2, 2.2, 1.15, 'crate', 'B short box');
box(19, -3.5, 6, 1.6, 3.4, 'wall');                      // B short corner wall
box(31, 19, 2.2, 4.4, 2.3, 'containerB');

// --- spawn yards -----------------------------------------------------------------------
box(-8, 33, 4.4, 2.2, 1.15, 'crate'); box(8, 33, 4.4, 2.2, 1.15, 'crate');
box(-8, -33, 2.2, 2.2, 1.15, 'crate'); box(9, -30, 2.2, 2.2, 1.15, 'crate');
box(-20, 28, 2.2, 2.2, 1.15, 'crate'); box(20, 28, 2.2, 2.2, 1.15, 'crate');

const NAV = [
  [0, 30], [-4, 26], [4, 26], [-13, 22], [13, 22],                       // Breaker yard and lane mouths
  [-22, 16], [22, 15], [0, 18], [0, 12],                                // main roads, mid south
  [-9, -4], [9, -4], [0, 0],                                            // connectors, mid doors
  [0, -10], [0, -20], [-9, -12], [10, -13],                             // mid north, site approaches
  [-16, -11], [-22, -6], [-27, -13], [-19, -21],                        // site A and inside
  [17, -8], [24, -1], [29, -13], [21, -23],                             // site B and inside
  [-10, -27], [15, -26], [0, -28], [-4, -29.5], [4, -29.5],             // Warden yard
  [-27, 3], [28, 2],                                                    // long flanks
  [-32, -26], [-32, -14], [19, -16], [20, -2], [30, -6],                // gap connectors: hall west strip, depot pockets
  [-22, -25.3],                                                          // the notch between furnace and hall north wall
  [2.6, 8], [-2.6, 8], [2.6, -8], [-2.6, -8],                            // gutters flanking the two mid crates
  [-5.2, -4], [5.2, -4],                                                 // the mid wall gaps themselves (one each side)
  [2.2, 6], [-2.2, -6],                                                  // the S-bend gaps: east door south, west door north
];

function buildColliders() {
  for (const b of BOXES) {
    const c = {
      minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
      minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2,
      top: b.h,
    };
    WORLD.colliders.push(c);
    if (b.h >= 1.35) WORLD.blockers.push(c);
  }
}

function buildNav() {
  WORLD.navNodes = NAV.map(([x, z]) => ({ x, z }));
  WORLD.navEdges = WORLD.navNodes.map(() => []);
  for (let i = 0; i < NAV.length; i++) {
    for (let j = i + 1; j < NAV.length; j++) {
      const a = WORLD.navNodes[i];
      const b = WORLD.navNodes[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      if (dx * dx + dz * dz > 15 * 15) continue;
      if (segmentBlocked(a.x, a.z, b.x, b.z, 0.42)) continue;
      WORLD.navEdges[i].push(j);
      WORLD.navEdges[j].push(i);
    }
  }
}

// Does the 2D segment pass through any collider inflated by r? Nav edges are tested
// against every collider — not just the tall sight blockers — because movement collides
// with crates too: a path the graph calls clear must be clear to walk.
function segmentBlocked(ax, az, bx, bz, r) {
  for (const c of WORLD.colliders) {
    if (segmentHitsBox(ax, az, bx, bz, c.minX - r, c.maxX + r, c.minZ - r, c.maxZ + r)) return true;
  }
  return false;
}

function segmentHitsBox(ax, az, bx, bz, minX, maxX, minZ, maxZ) {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  if (Math.abs(dx) < 1e-9) { if (ax < minX || ax > maxX) return false; }
  else {
    let ta = (minX - ax) / dx;
    let tb = (maxX - ax) / dx;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) { if (az < minZ || az > maxZ) return false; }
  else {
    let ta = (minZ - az) / dz;
    let tb = (maxZ - az) / dz;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

// 3D sightline between two eye points: blocked by any collider whose top reaches the
// lower of the two eyes (a 1.15 m crate hides a crouched target, not a standing one).
export function losClear(ax, ay, az, bx, by, bz) {
  const minTop = Math.min(ay, by) - 0.12;
  for (const c of WORLD.colliders) {
    if (c.top < minTop) continue;
    if (segmentHitsBox(ax, az, bx, bz, c.minX, c.maxX, c.minZ, c.maxZ)) {
      // The segment crosses the footprint; check the height where it crosses is covered.
      return false;
    }
  }
  return true;
}

// Ray vs the world for bullets: nearest hit distance along the ray, or Infinity.
// Slab test per box plus the ground plane; boxes are few, so no acceleration structure.
const _inv = { x: 0, y: 0, z: 0 };
export function rayWorld(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  if (dy < -1e-6) {
    const t = -oy / dy;
    if (t > 0 && t < best) best = t;
  }
  _inv.x = 1 / (dx || 1e-9); _inv.y = 1 / (dy || 1e-9); _inv.z = 1 / (dz || 1e-9);
  for (const c of WORLD.colliders) {
    let tmin = 0;
    let tmax = best;
    let t1 = (c.minX - ox) * _inv.x;
    let t2 = (c.maxX - ox) * _inv.x;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) continue;
    t1 = (0 - oy) * _inv.y; t2 = (c.top - oy) * _inv.y;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) continue;
    t1 = (c.minZ - oz) * _inv.z;
    t2 = (c.maxZ - oz) * _inv.z;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) continue;
    if (tmin < best) best = tmin;
  }
  return best;
}

// Circle vs colliders in the ground plane, resolved axis by axis; pos is mutated.
export function moveCollide(pos, radius) {
  const b = WORLD.bounds;
  if (pos.x < -b) pos.x = -b; else if (pos.x > b) pos.x = b;
  if (pos.z < -b) pos.z = -b; else if (pos.z > b) pos.z = b;
  for (const c of WORLD.colliders) {
    if (pos.x > c.minX - radius && pos.x < c.maxX + radius &&
        pos.z > c.minZ - radius && pos.z < c.maxZ + radius) {
      const pushL = pos.x - (c.minX - radius);
      const pushR = (c.maxX + radius) - pos.x;
      const pushD = pos.z - (c.minZ - radius);
      const pushU = (c.maxZ + radius) - pos.z;
      const m = Math.min(pushL, pushR, pushD, pushU);
      if (m === pushL) pos.x = c.minX - radius;
      else if (m === pushR) pos.x = c.maxX + radius;
      else if (m === pushD) pos.z = c.minZ - radius;
      else pos.z = c.maxZ + radius;
    }
  }
}

export function nearestNode(x, z) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < WORLD.navNodes.length; i++) {
    const n = WORLD.navNodes[i];
    const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// A* over the nav graph; returns a list of node indices from near `from` to near `to`.
const _open = [];
const _came = new Map();
const _cost = new Map();
export function findPath(fx, fz, tx, tz) {
  const start = nearestNode(fx, fz);
  const goal = nearestNode(tx, tz);
  if (start === goal) return [goal];
  _open.length = 0;
  _came.clear();
  _cost.clear();
  _open.push(start);
  _cost.set(start, 0);
  const h = (i) => {
    const n = WORLD.navNodes[i];
    const g = WORLD.navNodes[goal];
    return Math.hypot(n.x - g.x, n.z - g.z);
  };
  const fScore = new Map([[start, h(start)]]);
  while (_open.length) {
    let bi = 0;
    for (let i = 1; i < _open.length; i++) {
      if ((fScore.get(_open[i]) ?? Infinity) < (fScore.get(_open[bi]) ?? Infinity)) bi = i;
    }
    const cur = _open.splice(bi, 1)[0];
    if (cur === goal) {
      const path = [cur];
      let c = cur;
      while (_came.has(c)) { c = _came.get(c); path.push(c); }
      return path.reverse();
    }
    for (const nb of WORLD.navEdges[cur]) {
      const a = WORLD.navNodes[cur];
      const b = WORLD.navNodes[nb];
      const tentative = (_cost.get(cur) ?? Infinity) + Math.hypot(a.x - b.x, a.z - b.z);
      if (tentative < (_cost.get(nb) ?? Infinity)) {
        _came.set(nb, cur);
        _cost.set(nb, tentative);
        fScore.set(nb, tentative + h(nb));
        if (!_open.includes(nb)) _open.push(nb);
      }
    }
  }
  return [start];
}

export function inSite(site, x, z) {
  const dx = x - site.x;
  const dz = z - site.z;
  return dx * dx + dz * dz <= site.r * site.r;
}

// --- meshes ----------------------------------------------------------------------------

const MATS = {};
function mat(color) {
  if (!MATS[color]) MATS[color] = new THREE.MeshLambertMaterial({ color });
  return MATS[color];
}

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#565a5e'; g.fillRect(0, 0, 1024, 1024);
  // concrete noise
  for (let i = 0; i < 5200; i++) {
    g.fillStyle = `rgba(${30 + Math.random() * 40 | 0},${30 + Math.random() * 40 | 0},${32 + Math.random() * 40 | 0},0.12)`;
    g.fillRect(Math.random() * 1024, Math.random() * 1024, 3, 3);
  }
  // expansion joints
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 1024); g.stroke();
    g.beginPath(); g.moveTo(0, i * 128); g.lineTo(1024, i * 128); g.stroke();
  }
  const toPx = (v) => (v + 38) / 76 * 1024;
  // painted site rings and letters
  for (const [site, color] of [[WORLD.sites.A, '#ff8c3a'], [WORLD.sites.B, '#53b7e8']]) {
    g.strokeStyle = color; g.lineWidth = 7;
    g.beginPath(); g.arc(toPx(site.x), toPx(site.z), site.r / 76 * 1024, 0, Math.PI * 2); g.stroke();
    g.fillStyle = color;
    g.font = 'bold 92px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(site === WORLD.sites.A ? 'A' : 'B', toPx(site.x), toPx(site.z));
  }
  // lane centre dashes
  g.fillStyle = 'rgba(240,220,160,0.5)';
  for (let z = -30; z < 32; z += 6) g.fillRect(toPx(0) - 2, toPx(z), 4, 26);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function buildWorld(scene) {
  buildColliders();
  buildNav();
  WORLD.spawns[0] = [[-4, 31], [-2, 32.5], [0, 31], [2, 32.5], [4, 31]];
  WORLD.spawns[1] = [[-4, -31], [-2, -29.5], [0, -31], [2, -29.5], [4, -31]];

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(79, 79),
    new THREE.MeshLambertMaterial({ map: groundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const geoCache = new Map();
  const geoFor = (w, h, d) => {
    const key = w + 'x' + h + 'x' + d;
    if (!geoCache.has(key)) geoCache.set(key, new THREE.BoxGeometry(w, h, d));
    return geoCache.get(key);
  };
  for (const b of BOXES) {
    const mesh = new THREE.Mesh(geoFor(b.w, b.h, b.d), mat(PAL[b.mat]));
    mesh.position.set(b.x, b.h / 2, b.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (b.name === 'furnace') {
      const glow = new THREE.Mesh(
        new THREE.BoxGeometry(5.4, 0.5, 5.4),
        new THREE.MeshBasicMaterial({ color: PAL.furnaceGlow }),
      );
      glow.position.set(b.x, b.h + 0.2, b.z);
      scene.add(glow);
      const light = new THREE.PointLight(PAL.furnaceGlow, 60, 26, 1.8);
      light.position.set(b.x, b.h + 2.2, b.z);
      scene.add(light);
    }
  }
}
