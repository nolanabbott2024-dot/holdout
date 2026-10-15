// Holdout — characters: infected, raiders, survivors. Skinned clones, simple senses, capsule movement on the proxies.
import {
  Scene, Mesh, MeshBuilder, Vector3, AnimationGroup, AssetContainer, LoadAssetContainerAsync, TransformNode, AbstractMesh,
  CascadedShadowGenerator, PBRMaterial, Color3, StandardMaterial, Quaternion, Matrix,
} from '@babylonjs/core';
import { World } from './world';
import { sfx } from './audio';

export interface Ctx {
  scene: Scene; W: World; csm: CascadedShadowGenerator | null; danger: number;
  playerPos(): Vector3; playerEye(): Vector3; playerHurt(n: number, from: Vector3): void; playerDead(): boolean; playerCrouch(): number; playerSpeed(): number;
  tracer(a: Vector3, b: Vector3, enemy: boolean): void; onKill(a: Actor): void; actors: Actor[];
}
export type Kind = 'infected' | 'raider' | 'survivor';

// source containers per scene (instantiateModelsToScene clones into the container's own scene)
const SRC = new WeakMap<Scene, Promise<{ z: AssetContainer; o: AssetContainer; kit: AssetContainer }>>();
export function loadActorAssets(scene: Scene, kit: AssetContainer) {
  if (!SRC.has(scene)) SRC.set(scene, (async () => {
    const [z, o] = await Promise.all([LoadAssetContainerAsync('/assets/zombie.glb', scene, { pluginExtension: '.glb' }), LoadAssetContainerAsync('/assets/ops.glb', scene, { pluginExtension: '.glb' })]);
    const r = { z, o, kit }; (scene as any)._actsrc = r; return r;
  })());
  return SRC.get(scene)!;
}

const HIT_MAT = (scene: Scene) => { let m = scene.getMaterialByName('hitbox') as StandardMaterial; if (!m) { m = new StandardMaterial('hitbox', scene); m.alpha = 0 } return m };

export class Actor {
  kind: Kind; hp: number; maxHp: number; alive = true; box: Mesh; model: TransformNode; groups: Record<string, AnimationGroup> = {};
  anim = ''; height = 1.75; yaw = 0; state = 'idle'; t = 0; target: Vector3 | null = null; vy = 0;
  speed = 0; seeT = 0; lastSeen: Vector3 | null = null; stuckT = 0; sideT = 0; side = 1; atkT = 0; atkHit = false; fireT = 0; burst = 0;
  home: Vector3; wanderT = 0; alertT = 0; deadT = 0; runner = false; following = false; rescued = false; meshes: AbstractMesh[] = []; gun: TransformNode | null = null;
  faceOff = 0; onGround = true; groanT = Math.random() * 8; lod = 0; id = Math.random();
  constructor(public ctx: Ctx, kind: Kind, pos: Vector3, variant = 0) {
    const scene = ctx.scene; this.kind = kind;
    this.maxHp = this.hp = kind === 'infected' ? 100 + ctx.danger * 10 : kind === 'raider' ? 90 + ctx.danger * 8 : 100;
    this.box = MeshBuilder.CreateBox('act', { width: 0.6, depth: 0.6, height: 1.8 }, scene);
    this.box.bakeTransformIntoVertices(Matrix.Translation(0, 0.9, 0));   // origin at the feet
    this.box.material = HIT_MAT(scene); this.box.isVisible = true; this.box.visibility = 0; this.box.isPickable = true; (this.box as any)._act = this;
    this.box.ellipsoid = new Vector3(0.3, 0.85, 0.3); this.box.ellipsoidOffset = new Vector3(0, 0.85, 0); this.box.checkCollisions = false;
    this.box.position.copyFrom(pos); this.home = pos.clone();
    const S = (scene as any)._actsrc; const src: AssetContainer = kind === 'infected' ? S.z : S.o;
    const inst = src.instantiateModelsToScene(n => n, false, { doNotInstantiate: true });
    this.model = new TransformNode('mdl', scene); this.model.parent = this.box; this.model.rotationQuaternion = null;
    for (const r of inst.rootNodes) r.parent = this.model;
    for (const g of inst.animationGroups) { g.stop(); g.enableBlending = true; g.blendingSpeed = 0.06; this.groups[g.name] = g }
    this.meshes = this.model.getChildMeshes(false).filter(m => m.getTotalVertices() > 0);
    if (kind !== 'infected') {
      // ops.glb holds 4 outfits on one skeleton: keep one
      const keep = 'V' + (1 + (variant % 4));
      for (const m of this.model.getChildMeshes(false)) { const vn = m.name.match(/V[1-4]$/)?.[0]; if (vn && vn !== keep) m.isVisible = false }
    }
    for (const m of this.meshes) { m.isPickable = false; m.receiveShadows = true; if (ctx.csm && m.isVisible) ctx.csm.addShadowCaster(m, false); if (m.material instanceof PBRMaterial) m.material.maxSimultaneousLights = 3 }
    // normalize height to ~1.75 m with feet on the box bottom
    this.box.computeWorldMatrix(true); this.model.computeWorldMatrix(true);
    const bb = this.model.getHierarchyBoundingVectors(true, (m: any) => m.isVisible && m.getTotalVertices?.() > 0);
    const h = bb.max.y - bb.min.y; const s = h > 0.2 ? (kind === 'infected' ? 1.78 : 1.8) / h : 1;
    this.model.scaling.setAll(s); this.height = h * s;
    this.model.computeWorldMatrix(true);
    const bb2 = this.model.getHierarchyBoundingVectors(true, (m: any) => m.isVisible && m.getTotalVertices?.() > 0);
    this.model.position.y = this.box.position.y - bb2.min.y;
    if (kind === 'raider') this.attachGun();
    this.yaw = Math.random() * Math.PI * 2; this.faceOff = Math.PI;  // both rigs face +z
    this.runner = kind === 'infected' && Math.random() < 0.15 + ctx.danger * 0.08;
    this.play(kind === 'infected' ? 'idle' : kind === 'raider' ? 'Idle_Loop' : 'Crouch_Idle_Loop');
  }
  handR: TransformNode | null = null; handL: TransformNode | null = null; gunLen = 0.7;
  attachGun() {
    const d = this.model.getDescendants(false);
    this.handR = d.find(n => n.name === 'hand_r') as TransformNode || null; this.handL = d.find(n => n.name === 'hand_l') as TransformNode || null;
    const KITGUN: AssetContainer = (this.ctx.scene as any)._actsrc.kit;
    if (!this.handR || !this.handL || !KITGUN) return;
    const src = KITGUN.rootNodes.flatMap(n => [n, ...n.getDescendants(false)]).find(n => n.name === 'kit_gun_ar1');
    if (!src) return;
    const inst = KITGUN.instantiateModelsToScene(n => n, false, { doNotInstantiate: true, predicate: (e: any) => e === src || (typeof e.isDescendantOf === "function" ? (e.isDescendantOf(src) || src.isDescendantOf(e)) : true) });
    const g = new TransformNode('rgun', this.ctx.scene); g.rotationQuaternion = null;
    const cl = inst.rootNodes.flatMap(n => [n, ...n.getDescendants(false)]).find(n => n.name === 'kit_gun_ar1') as TransformNode;
    if (cl) { cl.parent = g; cl.position.setAll(0); cl.rotationQuaternion = null; cl.rotation.setAll(0); for (const r of inst.rootNodes) if (r !== cl) r.dispose() }
    // centre the rifle on its own origin; the pack's muzzles point down -z
    g.computeWorldMatrix(true); for (const m of g.getChildMeshes(false)) m.computeWorldMatrix(true);
    const bb = g.getHierarchyBoundingVectors(true); const c = bb.min.add(bb.max).scale(0.5); if (cl) cl.position.subtractInPlace(c);
    this.gunLen = bb.max.z - bb.min.z;
    for (const m of g.getChildMeshes(false)) { m.isPickable = false; m.receiveShadows = true; if (this.ctx.csm) this.ctx.csm.addShadowCaster(m, false); if (m.material instanceof PBRMaterial) { m.material.albedoColor.scaleInPlace(0.45); m.material.roughness = 0.55; m.material.metallic = 0.4 } }
    this.gun = g;
  }
  /** Rifle carried in the right hand, muzzle along the body's facing (raised when engaging). */
  poseGun() {
    if (!this.gun || !this.handR) return;
    const r = this.handR.getAbsolutePosition();
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const up = this.state === 'engage' ? 0.0 : 0.45;
    this.gun.position.set(r.x + fx * this.gunLen * 0.25, r.y + 0.03, r.z + fz * this.gunLen * 0.25);
    this.gun.rotation.set(up, this.yaw, 0);
    if (!this.alive && this.deadT > 0.6) { this.gun.position.y = Math.max(this.pos.y + 0.05, r.y - 0.1); this.gun.rotation.set(0, this.yaw + 1.2, Math.PI / 2) }
  }
  play(name: string, loop = true, speed = 1) {
    if (this.anim === name) return; const g = this.groups[name]; if (!g) return;
    for (const k in this.groups) if (k !== name && this.groups[k].isPlaying) this.groups[k].stop();
    g.start(loop, speed, g.from, g.to); this.anim = name;
  }
  get pos() { return this.box.position }
  dist(p: Vector3) { return Math.hypot(p.x - this.pos.x, p.z - this.pos.z) }
  hear(at: Vector3, radius: number) {
    if (!this.alive || this.kind === 'survivor') return;
    if (this.dist(at) < radius) { this.lastSeen = at.clone(); if (this.state !== 'chase' && this.state !== 'attack' && this.state !== 'engage') { this.state = 'alert'; this.alertT = 12 } }
  }
  canSee(p: Vector3, eye: Vector3, range: number) {
    const d = this.dist(p); if (d > range) return false;
    const o = this.pos.add(new Vector3(0, this.height * 0.9, 0)); const dir = eye.subtract(o); const L = dir.length(); dir.scaleInPlace(1 / L);
    // facing cone (wide when close)
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw); const dot = (dir.x * fx + dir.z * fz) / (Math.hypot(dir.x, dir.z) || 1);
    if (d > 6 && dot < -0.1) return false;
    const h = this.ctx.W.ray(o, dir, L - 0.3); return !h;
  }
  damage(n: number, from: Vector3 | null, head = false) {
    if (!this.alive) return;
    this.hp -= n;
    if (from) { this.lastSeen = from.clone(); if (this.kind === 'infected') this.state = 'chase'; else if (this.kind === 'raider') this.state = 'engage' }
    if (this.hp <= 0) this.die();
    else if (this.kind === 'raider' && Math.random() < 0.4) { this.play('Hit_Chest', false); this.t = 0.35 }
  }
  die() {
    this.alive = false; this.state = 'dead'; this.deadT = 0; this.box.isPickable = false;
    if (this.kind === 'infected') { this.play(Math.random() < 0.5 ? 'death' : 'dying', false); sfx('zdie', [this.pos.x, this.pos.y + 1.5, this.pos.z]) }
    else this.play('Death01', false);
    this.ctx.onKill(this);
  }
  face(p: Vector3, dt: number, rate = 6) {
    const want = Math.atan2(-(p.x - this.pos.x), -(p.z - this.pos.z));
    let d = want - this.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * rate); return Math.abs(d);
  }
  /** Walk toward p at speed, sliding along walls; sidestep when stuck. */
  moveTo(p: Vector3, spd: number, dt: number, stop = 0.3) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < stop) { this.speed = 0; return true }
    let vx = dx / d, vz = dz / d;
    if (this.sideT > 0) { this.sideT -= dt; const sx = -vz * this.side, sz = vx * this.side; vx = vx * 0.3 + sx; vz = vz * 0.3 + sz; const l = Math.hypot(vx, vz); vx /= l; vz /= l }
    // separation from neighbours
    for (const o of this.ctx.actors) { if (o === this || !o.alive) continue; const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z, od = ox * ox + oz * oz; if (od < 0.8 && od > 1e-4) { vx += ox / od * 0.15; vz += oz / od * 0.15 } }
    this.face(this.pos.add(new Vector3(vx, 0, vz)), dt, 8);
    const step = Math.min(d, spd * dt);
    const before = this.pos.clone();
    if (this.vy !== 0 || !this.onGround) this.vy -= 15 * dt;
    const res = this.ctx.W.move(this.box.position, vx * step, vz * step, this.onGround ? 0 : this.vy, dt, 0.28, this.onGround, true);
    this.onGround = res.grounded; this.vy = res.grounded ? 0 : res.vy;
    const moved = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    this.speed = moved / Math.max(dt, 1e-4);
    if (moved < step * 0.3) { this.stuckT += dt; if (this.stuckT > 0.4) { this.stuckT = 0; this.sideT = 0.9; this.side = Math.random() < 0.5 ? 1 : -1 } } else this.stuckT = Math.max(0, this.stuckT - dt);
    return false;
  }
  update(dt: number) {
    this.model.rotation.y = this.yaw + this.faceOff;  // yaw 0 looks -z
    this.poseGun();
    if (!this.alive) { this.deadT += dt; return }
    const P = this.ctx.playerPos(), E = this.ctx.playerEye();
    if (this.kind === 'infected') this.updInfected(dt, P, E);
    else if (this.kind === 'raider') this.updRaider(dt, P, E);
    else this.updSurvivor(dt, P);
  }
  nearestTarget(P: Vector3): { p: Vector3; who: Actor | null } {
    let best = { p: P, who: null as Actor | null }, bd = this.dist(P) + (this.ctx.playerDead() ? 1e9 : 0);
    for (const a of this.ctx.actors) if (a.kind === 'survivor' && a.alive && a.following) { const d = this.dist(a.pos); if (d < bd - 2) { bd = d; best = { p: a.pos, who: a } } }
    return best;
  }
  updInfected(dt: number, P: Vector3, E: Vector3) {
    this.t -= dt; this.seeT -= dt; this.groanT -= dt;
    if (this.groanT < 0) { this.groanT = 4 + Math.random() * 9; if (this.dist(P) < 45) sfx(this.state === 'chase' ? 'scream' : 'groan', [this.pos.x, this.pos.y + 1.6, this.pos.z], this.state === 'chase' ? 0.8 : 0.6) }
    const tgt = this.nearestTarget(P); const td = this.dist(tgt.p);
    if (this.seeT <= 0) {
      this.seeT = 0.35 + Math.random() * 0.2;
      const range = 26 + this.ctx.danger * 3 - this.ctx.playerCrouch() * 10;
      if (!this.ctx.playerDead() && this.canSee(P, E, range)) { if (this.state !== 'chase' && this.state !== 'attack') { sfx('scream', [this.pos.x, this.pos.y + 1.6, this.pos.z], 0.9) } this.state = this.state === 'attack' ? 'attack' : 'chase'; this.lastSeen = P.clone() }
      else if (tgt.who && td < 20) { this.state = this.state === 'attack' ? 'attack' : 'chase' }
    }
    switch (this.state) {
      case 'idle': {
        this.wanderT -= dt;
        if (this.wanderT < 0) { this.wanderT = 6 + Math.random() * 10; this.target = Math.random() < 0.5 ? null : this.home.add(new Vector3((Math.random() - 0.5) * 14, 0, (Math.random() - 0.5) * 14)) }
        if (this.target && !this.moveTo(this.target, 0.7, dt, 0.6)) this.play('walk', true, 0.75); else { this.play('idle'); this.target = null }
        break;
      }
      case 'alert': {
        this.alertT -= dt;
        if (!this.lastSeen || this.alertT < 0) { this.state = 'idle'; break }
        if (this.moveTo(this.lastSeen, 1.5, dt, 1.5)) { this.state = 'idle'; this.home = this.pos.clone() } else this.play('walk', true, 1.1);
        break;
      }
      case 'chase': {
        const goal = tgt.who ? tgt.p : (this.lastSeen || P);
        if (td < 1.45) { this.state = 'attack'; this.atkT = 0; this.atkHit = false; break }
        const spd = this.runner ? 4.4 + this.ctx.danger * 0.15 : 3.1 + this.ctx.danger * 0.15;
        if (this.moveTo(goal, spd, dt, 1.2)) { if (!tgt.who && this.lastSeen && this.dist(P) > 3) { this.state = 'alert'; this.alertT = 8 } }
        this.play('run', true, this.runner ? 1.15 : 0.95);
        break;
      }
      case 'attack': {
        this.face(tgt.p, dt, 10); this.play('attack', false, 1.2); this.atkT += dt;
        if (!this.atkHit && this.atkT > 0.55) { this.atkHit = true; sfx('swipe', [this.pos.x, this.pos.y + 1.4, this.pos.z]); if (this.dist(tgt.p) < 1.9) { const dmg = 11 + this.ctx.danger * 2.5 + Math.random() * 5; if (tgt.who) tgt.who.damage(dmg, null); else this.ctx.playerHurt(dmg, this.pos) } }
        if (this.atkT > 1.15) { this.state = 'chase'; this.anim = '' }
        break;
      }
    }
  }
  updRaider(dt: number, P: Vector3, E: Vector3) {
    this.t -= dt; this.seeT -= dt; this.fireT -= dt;
    const dP = this.dist(P);
    if (this.seeT <= 0) {
      this.seeT = 0.25;
      const sees = !this.ctx.playerDead() && this.canSee(P, E, this.state === 'engage' ? 70 : 42 - this.ctx.playerCrouch() * 12);
      if (sees) { if (this.state !== 'engage') { this.fireT = 1.1 + Math.random() * 1.1; alertNearby(this, P) } this.state = 'engage'; this.lastSeen = P.clone(); this.alertT = 0 }
      else if (this.state === 'engage') { this.alertT += 0.25; if (this.alertT > 6) { this.state = 'alert'; this.alertT = 10 } }
    }
    if (this.t > 0) return; // flinch
    switch (this.state) {
      case 'idle': case 'guard': {
        this.wanderT -= dt;
        if (this.wanderT < 0) { this.wanderT = 5 + Math.random() * 8; this.target = this.home.add(new Vector3((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10)) }
        if (this.target && !this.moveTo(this.target, 1.2, dt, 0.6)) this.play('Walk_Loop'); else { this.play('Idle_Loop'); this.target = null }
        break;
      }
      case 'alert': {
        this.alertT -= dt; if (!this.lastSeen || this.alertT < 0) { this.state = 'idle'; break }
        if (this.moveTo(this.lastSeen, 2.6, dt, 3)) { this.play('R_idle_aim'); this.face(this.lastSeen, dt) } else this.play('Jog_Fwd_Loop');
        break;
      }
      case 'engage': {
        const seen = this.alertT === 0;
        this.face(seen ? P : (this.lastSeen || P), dt, 7);
        // strafe a little between bursts, close in if far
        if (dP > 38) { this.moveTo(P, 2.6, dt, 30); this.play('Jog_Fwd_Loop') }
        else { this.play('R_idle_aim') }
        if (seen && this.fireT <= 0) {
          if (this.burst <= 0) this.burst = 2 + Math.floor(Math.random() * 3);
          this.burst--; this.fireT = this.burst > 0 ? 0.14 : 1.4 + Math.random() * 1.6;
          const mz = this.pos.add(new Vector3(0, this.height * 0.82, 0)).add(new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).scale(0.6));
          sfx('enemyShot', [mz.x, mz.y, mz.z]);
          // hit chance falls with distance, your crouch, and the first shots of an engagement
          const acc = Math.max(0.08, 0.42 - dP / 90 - this.ctx.playerCrouch() * 0.12 - Math.min(0.15, this.ctx.playerSpeed() * 0.03) + this.ctx.danger * 0.03);
          const hitP = Math.random() < acc;
          const aim = E.add(new Vector3((Math.random() - 0.5) * (hitP ? 0.2 : 2.4), (hitP ? -0.4 : (Math.random() - 0.3) * 1.6), (Math.random() - 0.5) * (hitP ? 0.2 : 2.4)));
          this.ctx.tracer(mz, aim, true);
          if (hitP) this.ctx.playerHurt(6 + Math.random() * 5 + this.ctx.danger * 0.8, this.pos);
        }
        break;
      }
    }
  }
  updSurvivor(dt: number, P: Vector3) {
    if (!this.following) { this.face(P, dt, 2); this.play(this.rescued ? 'Idle_Talking_Loop' : 'Crouch_Idle_Loop'); return }
    const d = this.dist(P);
    if (d > 40) { // got separated: catch up out of sight
      const back = P.add(new Vector3(Math.sin(this.id * 99) * 3, 0, Math.cos(this.id * 99) * 3)); const g = this.ctx.W.ground(back.x, back.z, P.y + 2); if (g) this.box.position.set(back.x, g.y, back.z)
    }
    if (d > 3) { const run = d > 7; this.moveTo(P, run ? 5.2 : 3.2, dt, 2.6); this.play(run ? 'Jog_Fwd_Loop' : 'Walk_Loop') }
    else { this.face(P, dt, 3); this.play('Idle_Loop') }
  }
  dispose() { this.box.dispose(false, false); this.model.dispose(false, false); for (const g of Object.values(this.groups)) g.dispose() }
}
function alertNearby(a: Actor, P: Vector3) { for (const o of a.ctx.actors) if (o !== a && o.kind === 'raider' && o.alive && o.dist(a.pos) < 30 && o.state !== 'engage') { o.state = 'alert'; o.lastSeen = P.clone(); o.alertT = 15 } }
// moveWithCollisions reads the cached world matrix: refresh it so several moves per frame chain correctly
function mwc(m: any, v: Vector3) { m.computeWorldMatrix(true); m.moveWithCollisions(v) }
