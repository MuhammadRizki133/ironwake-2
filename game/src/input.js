// input.js — raw keyboard and mouse state. Other modules poll this; nothing here knows
// what a key means. Mouse look works two ways: pointer lock during play, and a drag
// fallback so the game (and its screenshot scenes) still works where lock is refused.

export const keys = Object.create(null);
export const mouse = { dx: 0, dy: 0, down: false, rightDown: false, locked: false };

let dragLook = false;
let lastX = 0;
let lastY = 0;

export function initInput(canvas, onFirstGesture) {
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys[e.code] = true;
    if (['Tab', 'Space', 'KeyB'].includes(e.code)) e.preventDefault();
    if (onFirstGesture) onFirstGesture();
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.down = false; });

  canvas.addEventListener('mousedown', (e) => {
    if (onFirstGesture) onFirstGesture();
    if (e.button === 0) mouse.down = true;
    if (e.button === 2) mouse.rightDown = true;
    if (!mouse.locked) { dragLook = true; lastX = e.clientX; lastY = e.clientY; }
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) mouse.down = false;
    if (e.button === 2) mouse.rightDown = false;
    dragLook = false;
  });
  addEventListener('mousemove', (e) => {
    if (mouse.locked) {
      mouse.dx += e.movementX || 0;
      mouse.dy += e.movementY || 0;
    } else if (dragLook) {
      mouse.dx += (e.clientX - lastX) * 2.2;
      mouse.dy += (e.clientY - lastY) * 2.2;
      lastX = e.clientX; lastY = e.clientY;
    }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    mouse.locked = document.pointerLockElement === canvas;
  });
}

export function requestLock(canvas) {
  if (!mouse.locked && canvas.requestPointerLock) {
    const p = canvas.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => { try { canvas.requestPointerLock(); } catch { /* drag fallback stays */ } });
  }
}

// Consume the look delta accumulated since the last call; the player controller calls
// this once per tick so look speed is frame-rate independent.
export function takeLook() {
  const dx = mouse.dx;
  const dy = mouse.dy;
  mouse.dx = 0;
  mouse.dy = 0;
  return { dx, dy };
}

export function pressed(code) {
  return !!keys[code];
}
