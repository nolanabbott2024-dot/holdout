// Holdout — first-person body: capsule (ellipsoid) collisions with step-up, gravity, sprint/crouch/jump, stamina.
import { Scene, Mesh, MeshBuilder, Vector3, UniversalCamera } from '@babylonjs/core';
import { I, down, hit } from './input';
import { World, C_VOID } from './world';
import { sfx } from './audio';

export class Player {
  body: Mesh; cam: UniversalCamera;
  yaw = 0; pitch = 0; vy = 0; grounded = false; crouch = 0; eye = 1.62;
  hp = 100; stamina = 1; sprinting = false; moving = false; speed = 0;
  bobPh = 0; bob = 0; land = 0; stepAcc = 0; hurtT = 0; dead = false; recoilP = 0; recoilY = 0; fallFrom = 0;
  safe = new Vector3(); sens = 1; adsK = 0; noise = 0;   // noise: how loud the player is (for infected hearing)
  constructor(public scene: Scene, public W: World, cam: UniversalCamera) {
    this.cam = cam;
    this.body = MeshBuilder.CreateBox('player', { size: 0.1 }, scene);
    this.body.isVisible = false; this.body.isPickable = false; this.body.checkCollisions = false;
    this.body.ellipsoid = new Vector3(0.32, 0.88, 0.32); this.body.ellipsoidOffset = new Vector3(0, 0.88, 0);
  }
  spawn(p: Vector3, yaw: number) {
    const g = this.W.ground(p.x, p.z, p.y + 3);
    this.body.position.set(p.x, (g ? g.y : p.y) + 0.05, p.z); this.yaw = yaw; this.pitch = 0; this.vy = 0; this.grounded = true; this.dead = false; this.safe.copyFrom(this.body.position);
    this.hp = Math.max(1, this.hp);
  }
  forward() { return new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)) }   // RH: yaw 0 looks down -z
  right() { return new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)) }
  update(dt: number, busy: boolean) {
    if (this.dead) return;
    // look
    const s = 0.0022 * this.sens * (1 - this.adsK * 0.45);
    this.yaw -= I.dx * s; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - I.dy * s));
    // recoil recovers toward zero
    const rp = this.recoilP * Math.min(1, dt * 9), ry = this.recoilY * Math.min(1, dt * 9);
    this.recoilP -= rp; this.recoilY -= ry;
    // move intent
    let f = 0, r = 0;
    if (down('KeyW')) f += 1; if (down('KeyS')) f -= 1; if (down('KeyD')) r += 1; if (down('KeyA')) r -= 1;
    f -= I.my; r += I.mx;
    const len = Math.hypot(f, r); if (len > 1) { f /= len; r /= len }
    this.moving = len > 0.1;
    const wantCrouch = down('KeyC') || down('ControlLeft');
    this.crouch += ((wantCrouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 10);
    this.sprinting = down('ShiftLeft') && f > 0.3 && this.stamina > 0.05 && !wantCrouch && !I.aim && !busy;
    this.stamina = Math.max(0, Math.min(1, this.stamina + (this.sprinting ? -dt * 0.14 : dt * (this.moving ? 0.12 : 0.22))));
    const base = this.sprinting ? 6.2 : wantCrouch ? 1.7 : I.aim ? 2.3 : 3.6;
    const target = base * Math.min(1, len) * (this.hp < 30 ? 0.8 : 1);
    this.speed += (target - this.speed) * Math.min(1, dt * (this.grounded ? 12 : 2));
    const dir = this.forward().scale(f).addInPlace(this.right().scale(r)); if (dir.lengthSquared() > 0) dir.normalize();
    // jump
    if (hit('Space') && this.grounded && this.stamina > 0.1) { this.vy = 4.6; this.grounded = false; this.stamina -= 0.08 }
    if (!this.grounded) { this.vy -= 15 * dt; if (this.vy < -40) this.vy = -40 }
    const b = this.body, ox = b.position.x, oz = b.position.z;
    const h = dir.scale(this.speed * dt);
    const wasG = this.grounded, vyIn = this.vy;
    const res = this.W.move(b.position, h.x, h.z, this.vy, dt, 0.3, this.grounded);
    if (res.grounded) {
      if (!wasG) { const fall = this.fallFrom - b.position.y; this.land = Math.min(1, -vyIn / 10); if (fall > 0.6) sfx('land'); if (fall > 4.5) this.damage((fall - 4.5) * 14, null) }
      this.grounded = true; this.vy = 0;
    } else { if (wasG) { this.fallFrom = b.position.y; if (this.vy < 0) this.vy = 0 } this.grounded = false; this.vy = res.vy }
    if (!this.grounded && this.vy > 0) this.fallFrom = Math.max(this.fallFrom, b.position.y);
    // keep inside the playable land: never step off the edge of the map or into the river
    if (this.grounded) { const c = this.W.cellAt(b.position.x, b.position.z); if (c.c !== C_VOID) this.safe.copyFrom(b.position) }
    else if (b.position.y < this.safe.y - 2) {
      const g = this.W.ground(b.position.x, b.position.z, b.position.y + 1);
      if (!g || g.y < -30 || this.W.cellAt(b.position.x, b.position.z).c === C_VOID) { b.position.copyFrom(this.safe); this.vy = 0; this.grounded = true }
    }
    if (b.position.y < -36) this.damage(999, null);
    // bob, steps, noise
    const hs = Math.hypot(b.position.x - ox, b.position.z - oz) / Math.max(dt, 1e-4);
    this.bob += ((this.grounded && hs > 0.5 ? Math.min(1, hs / 5) : 0) - this.bob) * Math.min(1, dt * 8);
    this.bobPh += dt * hs * 0.32;
    this.stepAcc += hs * dt; const stride = this.sprinting ? 2.4 : 1.9;
    if (this.grounded && this.stepAcc > stride) { this.stepAcc = 0; sfx('step', undefined, wantCrouch ? 0.35 : this.sprinting ? 1.3 : 0.8) }
    this.noise = this.grounded ? (wantCrouch ? 4 : this.sprinting ? 22 : hs > 0.5 ? 11 : 2) : 6;
    this.land = Math.max(0, this.land - dt * 3);
    this.hurtT = Math.max(0, this.hurtT - dt);
    // camera
    this.eye = 1.62 - this.crouch * 0.55;
    const c = this.cam;
    c.position.set(b.position.x, b.position.y + this.eye - this.land * 0.12 + Math.abs(Math.cos(this.bobPh * Math.PI)) * 0.03 * this.bob, b.position.z);
    c.rotation.set(this.pitch + this.recoilP, this.yaw + this.recoilY, Math.sin(this.bobPh * Math.PI) * 0.004 * this.bob - r * 0.01);
  }
  kick(p: number, y: number) { this.recoilP += p; this.recoilY += y; this.pitch += p * 0.35 }
  damage(n: number, from: Vector3 | null) {
    if (this.dead) return;
    this.hp -= n; this.hurtT = 0.4; sfx('hurt');
    if (this.hp <= 0) { this.hp = 0; this.dead = true }
  }
  get pos() { return this.body.position }
}
// moveWithCollisions reads the cached world matrix: refresh it so several moves per frame chain correctly
function mwc(m: any, v: Vector3) { m.computeWorldMatrix(true); m.moveWithCollisions(v) }
