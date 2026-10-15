// Holdout — input: keyboard/mouse with pointer lock, plus on-screen touch controls.
import { mobile } from './render';

export const I = {
  keys: new Set<string>(), pressed: new Set<string>(), // pressed = edge this frame
  dx: 0, dy: 0, fire: false, aim: false, firePressed: false,
  mx: 0, my: 0,      // touch move stick (-1..1)
  touch: mobile, locked: false, enabled: false,
};
let canvas: HTMLCanvasElement;
export function initInput(c: HTMLCanvasElement) {
  canvas = c;
  addEventListener('keydown', e => {
    if (!I.enabled) return;
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    if (!I.keys.has(e.code)) I.pressed.add(e.code); I.keys.add(e.code);
  });
  addEventListener('keyup', e => I.keys.delete(e.code));
  addEventListener('blur', () => { I.keys.clear(); I.fire = false; I.aim = false });
  c.addEventListener('mousedown', e => {
    if (!I.enabled) return;
    if (!I.locked && !I.touch) { lock(); return }
    if (e.button === 0) { I.fire = true; I.firePressed = true }
    if (e.button === 2) I.aim = true;
  });
  addEventListener('mouseup', e => { if (e.button === 0) I.fire = false; if (e.button === 2) I.aim = false });
  c.addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('mousemove', e => { if (I.locked) { I.dx += e.movementX; I.dy += e.movementY } });
  document.addEventListener('pointerlockchange', () => { I.locked = document.pointerLockElement === canvas; onLockChange?.(I.locked) });
  if (I.touch) touchUI();
}
export let onLockChange: ((l: boolean) => void) | null = null;
export function setLockHandler(f: (l: boolean) => void) { onLockChange = f }
export function lock() { if (!I.touch) canvas.requestPointerLock?.() }
export function unlock() { if (document.pointerLockElement) document.exitPointerLock() }
export function endFrame() { I.pressed.clear(); I.dx = 0; I.dy = 0; I.firePressed = false }
export const down = (c: string) => I.keys.has(c);
export const hit = (c: string) => I.pressed.has(c);

// ── touch: left half = move stick, right half = look; buttons on the right ──
function touchUI() {
    const stick = document.getElementById('stick')!, knob = document.getElementById('knob')!;
  let moveId: number | null = null, lookId: number | null = null, sx = 0, sy = 0, lx = 0, ly = 0;
  canvas.addEventListener('touchstart', e => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < innerWidth * 0.45 && moveId === null) { moveId = t.identifier; sx = t.clientX; sy = t.clientY; stick.style.left = sx - 60 + 'px'; stick.style.top = sy - 60 + 'px'; stick.style.opacity = '1' }
      else if (lookId === null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY }
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === moveId) { const dx = t.clientX - sx, dy = t.clientY - sy, d = Math.min(50, Math.hypot(dx, dy)), a = Math.atan2(dy, dx); I.mx = Math.cos(a) * d / 50; I.my = Math.sin(a) * d / 50; knob.style.transform = `translate(${I.mx * 40}px,${I.my * 40}px)` }
      if (t.identifier === lookId) { I.dx += (t.clientX - lx) * 2.2; I.dy += (t.clientY - ly) * 2.2; lx = t.clientX; ly = t.clientY }
    }
    e.preventDefault();
  }, { passive: false });
  const end = (e: TouchEvent) => { for (const t of Array.from(e.changedTouches)) { if (t.identifier === moveId) { moveId = null; I.mx = I.my = 0; knob.style.transform = ''; stick.style.opacity = '.35' } if (t.identifier === lookId) lookId = null } };
  canvas.addEventListener('touchend', end); canvas.addEventListener('touchcancel', end);
  const btn = (id: string, on: () => void, off?: () => void) => { const b = document.getElementById(id)!; b.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); on() }, { passive: false }); b.addEventListener('touchend', e => { e.preventDefault(); off?.() }, { passive: false }) };
  btn('tFire', () => { I.fire = true; I.firePressed = true }, () => I.fire = false);
  btn('tAim', () => I.aim = !I.aim);
  btn('tReload', () => I.pressed.add('KeyR'));
  btn('tUse', () => { I.pressed.add('KeyE'); I.keys.add('KeyE') }, () => I.keys.delete('KeyE'));
  btn('tJump', () => I.pressed.add('Space'));
  btn('tSwap', () => I.pressed.add('KeyQ'));
  btn('tMed', () => I.pressed.add('Digit4'));
  btn('tSprint', () => { if (I.keys.has('ShiftLeft')) I.keys.delete('ShiftLeft'); else I.keys.add('ShiftLeft') });
}
