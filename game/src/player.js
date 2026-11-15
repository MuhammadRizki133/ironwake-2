// player.js — the human's body: mouse look, acceleration-based movement, crouch, jump,
// footsteps that bots can hear, and the trigger. Combat maths lives in weapons.js; this
// file only turns input into an actor the simulation understands.

import * as THREE from 'three';
import { S, PHASE, emit } from './state.js';
import { keys, mouse, takeLook } from './input.js';
import { moveCollide } from './world.js';
import { currentGun, tryFire, startReload } from './weapons.js';

const WALK_SPEED = 2.6;
const RUN_SPEED = 5.3;
const ACCEL = 42;
const AIR_ACCEL = 5;
const GRAVITY = 14.5;
const JUMP_VEL = 4.9;
const RADIUS = 0.38;

let prevMouseDown = false;
let stepT = 0;

export function updatePlayer(actor, dt, fx) {
  if (!actor.alive) return;
  const look = takeLook();
  actor.yaw -= look.dx * 0.0021;
  actor.pitch -= look.dy * 0.0021;
  if (actor.pitch > 1.45) actor.pitch = 1.45;
  if (actor.pitch < -1.45) actor.pitch = -1.45;

  const canMove = S.phase === PHASE.LIVE;
  const walking = keys['ShiftLeft'] || keys['ShiftRight'];
  actor.crouch = !!(keys['ControlLeft'] || keys['KeyC']);

  let fwd = 0;
  let strafe = 0;
  if (canMove) {
    if (keys['KeyW'] || keys['ArrowUp']) fwd += 1;
    if (keys['KeyS'] || keys['ArrowDown']) fwd -= 1;
    if (keys['KeyA'] || keys['ArrowLeft']) strafe -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) strafe += 1;
  }
  const gun = currentGun(actor);
  let speed = (walking ? WALK_SPEED : RUN_SPEED) * (gun ? gun.def.moveFactor : 1);
  if (actor.crouch) speed *= 0.55;
  if (actor.channel) speed = 0;

  const sin = Math.sin(actor.yaw);
  const cos = Math.cos(actor.yaw);
  const wishX = (-sin * fwd + -cos * strafe);
  const wishZ = (-cos * fwd + sin * strafe);
  const wl = Math.hypot(wishX, wishZ) || 1;
  const accel = actor.grounded ? ACCEL : AIR_ACCEL;
  actor.vel.x += (wishX / wl * speed * (fwd || strafe ? 1 : 0) - actor.vel.x) * Math.min(1, accel * dt) * (fwd || strafe ? 1 : 1.6);
  actor.vel.z += (wishZ / wl * speed * (fwd || strafe ? 1 : 0) - actor.vel.z) * Math.min(1, accel * dt) * (fwd || strafe ? 1 : 1.6);

  if (actor.grounded && canMove && keys['Space'] && !actor.crouch) {
    actor.vel.y = JUMP_VEL;
    actor.grounded = false;
  }
  actor.vel.y -= GRAVITY * dt;
  actor.pos.x += actor.vel.x * dt;
  actor.pos.z += actor.vel.z * dt;
  actor.pos.y += actor.vel.y * dt;
  if (actor.pos.y <= 0) { actor.pos.y = 0; actor.vel.y = 0; actor.grounded = true; }
  moveCollide(actor.pos, RADIUS);

  // footsteps: running is loud, walking and crouching are silent
  const hSpeed = Math.hypot(actor.vel.x, actor.vel.z);
  if (actor.grounded && hSpeed > 3.4 && !walking) {
    stepT -= dt;
    if (stepT <= 0) {
      stepT = 0.36;
      S.noises.push({ x: actor.pos.x, z: actor.pos.z, radius: 11, team: actor.team, t: S.time });
      emit('step', { actor });
    }
  }

  // weapons: trigger, reload, slots, grenade quick-throw (3/4/5)
  const gunAim = currentGun(actor);
  actor.scoped = !!(mouse.rightDown && gunAim && gunAim.def.scoped);
  if (S.phase === PHASE.LIVE && !S.buyOpen && !actor.channel) {
    const gunNow = currentGun(actor);
    if (mouse.down && gunNow) {
      if (gunNow.def.auto || !prevMouseDown) tryFire(actor, fx);
    }
    if (keys['KeyR']) startReload(actor);
    if (keys['Digit1'] && actor.loadout.primary) actor.loadout.current = 'primary';
    if (keys['Digit2']) actor.loadout.current = 'sidearm';
    if (keys['Digit3']) throwGrenadeKey(actor, 'frag', fx);
    if (keys['Digit4']) throwGrenadeKey(actor, 'flash', fx);
    if (keys['Digit5']) throwGrenadeKey(actor, 'smoke', fx);
  }
  prevMouseDown = mouse.down;
}

function throwGrenadeKey(actor, kind, fx) {
  if (actor.loadout.grenades[kind] <= 0) return;
  if (actor.grenadeCoolT > 0) return;
  actor.loadout.grenades[kind]--;
  actor.grenadeCoolT = 0.7;
  if (fx) fx.throwGrenade(actor, kind);
  keys['Digit3'] = keys['Digit4'] = keys['Digit5'] = false;
}
