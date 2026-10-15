// Holdout — a run into the Zone: insertion, objective, containers, actors, extraction, death.
import {
  Scene, Vector3, UniversalCamera, Mesh, MeshBuilder, StandardMaterial, Color3, Color4, ParticleSystem, TransformNode, PointLight,
  Matrix, Viewport, Engine, AbstractMesh, Ray,
} from '@babylonjs/core';
import { World, sampleCells, C_ROAD, C_WALK, C_GRASS, prop, loadKit } from './world';
import { Player } from './player';
import { Weapons, WEPS } from './weapons';
import { Actor, Ctx, loadActorAssets } from './actors';
import { I, hit, down, endFrame } from './input';
import { sfx, setListener, ambience } from './audio';
import { ItemId, ITEMS, PACK_KG } from './data';
import { softDot, Look } from './render';
import { Save, lvl, Mission } from './save';
import * as UI from './ui';

const rng = (seed: number) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 };

interface Container { node: TransformNode; pos: Vector3; kind: string; searched: boolean; time: number; loot: Partial<Record<ItemId, number>>; cache?: boolean; body?: Actor }
export interface RaidResult { loadout: Partial<Record<ItemId, number>>; extracted: boolean; pack: Partial<Record<ItemId, number>>; rescued: number; kills: number; time: number; objective: boolean; mission: Mission }

const LOOT: Record<string, [ItemId, number, number, number][]> = {   // item, chance, min, max
  crate: [['food', 0.5, 1, 2], ['water', 0.45, 1, 2], ['scrap', 0.5, 1, 2], ['ammoR', 0.3, 10, 30], ['parts', 0.2, 1, 1]],
  crate_big: [['scrap', 0.7, 1, 3], ['parts', 0.4, 1, 2], ['fuel', 0.3, 1, 1], ['food', 0.3, 1, 3]],
  chest: [['meds', 0.5, 1, 1], ['ammoR', 0.5, 15, 40], ['ammoP', 0.5, 8, 20], ['parts', 0.4, 1, 2], ['intel', 0.25, 1, 1]],
  dumpster: [['scrap', 0.7, 1, 3], ['food', 0.3, 1, 1], ['parts', 0.2, 1, 1]],
  barrel: [['fuel', 0.55, 1, 1], ['water', 0.4, 1, 2], ['scrap', 0.3, 1, 1]],
  car: [['fuel', 0.4, 1, 1], ['meds', 0.25, 1, 1], ['parts', 0.4, 1, 2], ['ammoP', 0.25, 6, 14], ['food', 0.3, 1, 2]],
  cache: [['ammoR', 1, 40, 90], ['ammoP', 0.8, 12, 30], ['meds', 0.9, 1, 3], ['parts', 1, 2, 5], ['food', 1, 3, 6], ['water', 1, 3, 6], ['intel', 0.7, 1, 2], ['fuel', 0.6, 1, 2]],
  body: [['ammoR', 0.7, 8, 25], ['meds', 0.25, 1, 1], ['food', 0.3, 1, 1]],
};

export class Raid {
  P: Player; Wp: Weapons; actors: Actor[] = []; conts: Container[] = []; pack: Partial<Record<ItemId, number>> = {};
  extracts: Vector3[] = []; objPos: Vector3; insert: Vector3; time = 0; kills = 0; done = false; extractT = 0; searchT = 0; searching: Container | null = null;
  objective = false; objText = ''; survivors: Actor[] = []; nodes: (TransformNode | Mesh | ParticleSystem | PointLight)[] = []; ctx: Ctx;
  tracers: { m: Mesh; t: number }[] = []; puff!: ParticleSystem; blood!: ParticleSystem; result: RaidResult | null = null; deathT = 0; healT = 0;
  onEnd: (r: RaidResult) => void = () => { }; loadout: Partial<Record<ItemId, number>> = {};
  constructor(public scene: Scene, public W: World, public cam: UniversalCamera, public look: Look, public save: Save, public mission: Mission, public engine: Engine) {
    this.P = new Player(scene, W, cam); this.P.sens = save.settings.sens; this.P.hp = save.hp;
    this.Wp = new Weapons(scene, cam);
    this.objPos = Vector3.Zero(); this.insert = Vector3.Zero();
    const self = this;
    this.ctx = {
      scene, W, csm: look.csm, danger: mission.danger, actors: this.actors,
      playerPos: () => self.P.pos, playerEye: () => self.cam.position, playerDead: () => self.P.dead, playerCrouch: () => self.P.crouch, playerSpeed: () => self.P.speed,
      playerHurt: (n, from) => { self.P.damage(n, from); UI.hurt(self.P.hp, self.dirTo(from)) },
      tracer: (a, b, enemy) => self.tracer(a, b, enemy),
      onKill: a => { if (a.kind !== 'survivor') { self.kills++; UI.feed(a.kind === 'raider' ? 'Raider down' : 'Infected down') } else UI.feed('A survivor was killed', true); if (a.kind === 'raider') self.addBody(a) },
    };
  }
  dirTo(p: Vector3) { const dx = p.x - this.P.pos.x, dz = p.z - this.P.pos.z; return Math.atan2(dx, -dz) + this.P.yaw }
  async start(loadout: Partial<Record<ItemId, number>>, progress: (t: string) => void) {
    const scene = this.scene, W = this.W, R = rng(this.mission.seed), M = this.mission;
    const kit = await loadKit(scene);
    progress('Gearing up…');
    await this.Wp.load();
    await loadActorAssets(scene, kit);
    this.pack = { ...loadout }; this.loadout = { ...loadout };
    this.Wp.mags.aks = Math.min(30, this.pack.ammoR || 0); this.pack.ammoR = (this.pack.ammoR || 0) - this.Wp.mags.aks;
    this.Wp.mags.m23 = Math.min(12, this.pack.ammoP || 0); this.pack.ammoP = (this.pack.ammoP || 0) - this.Wp.mags.m23;
    progress('Scouting the drop…');
    // insertion on the western avenues, objective deep in the map
    const roads = sampleCells(W, [C_ROAD], 80, R);
    roads.sort((a, b) => a.x - b.x);
    this.insert = roads[Math.floor(R() * 10)];
    const far = (p: Vector3, d: number) => Vector3.Distance(p, this.insert) > d;
    if (M.kind === 'raid') {
      this.objPos = sampleCells(W, [C_GRASS], 1, R, { x: this.insert.x, z: this.insert.z, r: 380, min: 180 })[0] || sampleCells(W, [C_GRASS], 1, R)[0];
    } else if (M.kind === 'rescue') {
      this.objPos = sampleCells(W, [C_WALK, C_GRASS], 1, R, { x: this.insert.x, z: this.insert.z, r: 330, min: 160 })[0];
    } else this.objPos = sampleCells(W, [C_WALK], 1, R, { x: this.insert.x, z: this.insert.z, r: 300, min: 120 })[0];
    if (!this.objPos) this.objPos = roads[roads.length - 1];
    // extraction(s): away from both insertion and objective
    const ex = roads.filter(p => far(p, 160) && Vector3.Distance(p, this.objPos) > 90);
    for (let i = 0; i < 1 + (lvl(this.save, 'radio') >= 2 ? 1 : 0) && ex.length; i++) this.extracts.push(ex.splice(Math.floor(R() * ex.length), 1)[0]);
    if (!this.extracts.length) this.extracts.push(roads[roads.length - 1]);
    for (const e of this.extracts) this.flare(e);
    // objective setup
    if (M.kind === 'loot') {
      for (const p of sampleCells(W, [C_WALK, C_ROAD], 10, R, { x: this.objPos.x, z: this.objPos.z, r: 45 })) this.container(p, ['crate', 'crate_big', 'chest', 'dumpster', 'barrel', 'car'][Math.floor(R() * 6)], R);
      this.objText = 'Search the supply blocks';
    } else if (M.kind === 'rescue') {
      const n = M.danger >= 3 ? 2 : 1;
      for (let i = 0; i < n; i++) { const a = new Actor(this.ctx, 'survivor', this.objPos.add(new Vector3(i * 1.5, 0, 0.5)), 1 + i); this.actors.push(a); this.survivors.push(a) }
      for (const p of sampleCells(W, [C_WALK, C_ROAD, C_GRASS], 6 + M.danger * 2, R, { x: this.objPos.x, z: this.objPos.z, r: 30, min: 8 })) this.actors.push(new Actor(this.ctx, 'infected', p));
      this.objText = n > 1 ? 'Find the survivors' : 'Find the survivor';
    } else {
      this.camp(this.objPos, R);
      this.objText = 'Clear the raider camp';
    }
    // scattered containers and infected across the map
    for (const p of sampleCells(W, [C_WALK, C_ROAD], 14, R)) if (far(p, 30)) this.container(p, ['crate', 'dumpster', 'barrel', 'car', 'chest'][Math.floor(R() * 5)], R);
    const nz = 14 + M.danger * 5;
    for (const p of sampleCells(W, [C_ROAD, C_WALK, C_GRASS], nz * 2, R)) { if (this.actors.filter(a => a.kind === 'infected').length >= nz + (M.kind === 'rescue' ? 10 : 0)) break; if (far(p, 45)) this.actors.push(new Actor(this.ctx, 'infected', p)) }
    // fx
    this.puff = this.burst('puff', new Color4(0.62, 0.6, 0.55, 0.8), 0.05, 0.18);
    this.blood = this.burst('blood', new Color4(0.35, 0.02, 0.02, 0.9), 0.03, 0.1);
    // spawn the player facing the objective
    const face = Math.atan2(-(this.objPos.x - this.insert.x), -(this.objPos.z - this.insert.z));
    this.P.spawn(this.insert, face);
    ambience('wind');
    UI.raidHud(true); UI.objective(this.objText, M.title);
    UI.feed(`Day ${this.save.day} · ${M.title}`);
  }
  container(p: Vector3, kind: string, R: () => number, cache = false) {
    const name = kind === 'car' ? ['car_sedan', 'car_hatch', 'car_suv', 'car_taxi', 'car_police'][Math.floor(R() * 5)] : kind;
    const g = this.W.ground(p.x, p.z, p.y + 3); const pos = new Vector3(p.x, g ? g.y : p.y, p.z);
    const node = prop(this.scene, name, pos, R() * Math.PI * 2, this.look.csm); if (!node) return;
    this.nodes.push(node);
    const table = LOOT[cache ? 'cache' : kind] || LOOT.crate; const loot: Partial<Record<ItemId, number>> = {};
    for (const [id, ch, a, b] of table) if (R() < ch) loot[id] = Math.round(a + R() * (b - a));
    this.conts.push({ node, pos, kind: cache ? 'cache' : kind, searched: false, time: kind === 'dumpster' || kind === 'car' ? 2.4 : cache ? 3 : 1.4, loot, cache });
  }
  camp(c: Vector3, R: () => number) {
    const parts = ['tent', 'tent', 'campfire', 'workbench', 'bedroll', 'bedroll', 'barrel', 'crate_big'];
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; const p = c.add(new Vector3(Math.cos(a) * 13, 0, Math.sin(a) * 13)); const g = this.W.ground(p.x, p.z, c.y + 6); if (g && Math.abs(g.y - c.y) < 3 && i % 3 !== 0) { const n = prop(this.scene, 'fence_fort', new Vector3(p.x, g.y, p.z), -a + Math.PI / 2, this.look.csm); if (n) this.nodes.push(n) } }
    parts.forEach((k, i) => { const a = R() * Math.PI * 2, r = 3 + R() * 7; const p = c.add(new Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); const g = this.W.ground(p.x, p.z, c.y + 6); if (g) { const n = prop(this.scene, k, new Vector3(p.x, g.y, p.z), R() * 6.28, this.look.csm, k !== 'bedroll' && k !== 'campfire'); if (n) this.nodes.push(n) } });
    const fire = new PointLight('campfire', c.add(new Vector3(0, 1, 0)), this.scene); fire.diffuse = new Color3(1, 0.55, 0.25); fire.intensity = 3; fire.range = 14; this.nodes.push(fire);
    this.container(c.add(new Vector3(1.5, 0, 1.5)), 'chest', R, true);
    this.container(c.add(new Vector3(-2, 0, 1)), 'crate_big', R, true);
    const n = 3 + Math.min(4, this.mission.danger);
    for (let i = 0; i < n; i++) { const a = R() * Math.PI * 2, r = 2 + R() * 9; const p = c.add(new Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); const g = this.W.ground(p.x, p.z, c.y + 6); if (g) { const x = new Actor(this.ctx, 'raider', new Vector3(p.x, g.y, p.z), i); x.state = 'guard'; this.actors.push(x) } }
  }
  addBody(a: Actor) {
    const loot: Partial<Record<ItemId, number>> = {}; for (const [id, ch, lo, hi] of LOOT.body) if (Math.random() < ch) loot[id] = Math.round(lo + Math.random() * (hi - lo));
    this.conts.push({ node: a.model, pos: a.pos, kind: 'body', searched: false, time: 1.2, loot, body: a });
  }
  flare(p: Vector3) {
    const g = this.W.ground(p.x, p.z, p.y + 3); const at = new Vector3(p.x, (g ? g.y : p.y) + 0.2, p.z);
    const ps = new ParticleSystem('flare', 300, this.scene); ps.particleTexture = softDot(this.scene, 'smoke', 64, 0.1);
    ps.emitter = at.clone(); ps.minEmitBox = new Vector3(-0.2, 0, -0.2); ps.maxEmitBox = new Vector3(0.2, 0.2, 0.2);
    ps.color1 = new Color4(0.85, 0.25, 0.2, 0.55); ps.color2 = new Color4(0.7, 0.3, 0.25, 0.4); ps.colorDead = new Color4(0.5, 0.45, 0.45, 0);
    ps.minSize = 1; ps.maxSize = 3.5; ps.minLifeTime = 6; ps.maxLifeTime = 10; ps.emitRate = 25; ps.direction1 = new Vector3(-0.3, 2.5, -0.3); ps.direction2 = new Vector3(0.4, 4, 0.3);
    ps.minEmitPower = 0.6; ps.maxEmitPower = 1.2; ps.gravity = new Vector3(0.25, 0.15, 0.1); ps.preWarmCycles = 200; ps.start(); this.nodes.push(ps);
    const l = new PointLight('flareL', at.add(new Vector3(0, 0.6, 0)), this.scene); l.diffuse = new Color3(1, 0.25, 0.15); l.intensity = 2.5; l.range = 10; this.nodes.push(l);
  }
  burst(name: string, col: Color4, s0: number, s1: number) {
    const ps = new ParticleSystem(name, 400, this.scene); ps.particleTexture = softDot(this.scene, name + 't', 32, 0.4);
    ps.emitter = Vector3.Zero(); ps.minEmitBox = ps.maxEmitBox = Vector3.Zero(); ps.color1 = col; ps.color2 = col; ps.colorDead = new Color4(col.r, col.g, col.b, 0);
    ps.minSize = s0; ps.maxSize = s1; ps.minLifeTime = 0.25; ps.maxLifeTime = 0.7; ps.emitRate = 0; ps.manualEmitCount = 0;
    ps.direction1 = new Vector3(-1, 1, -1); ps.direction2 = new Vector3(1, 2.5, 1); ps.minEmitPower = 0.5; ps.maxEmitPower = 2.2; ps.gravity = new Vector3(0, -6, 0); ps.start(); this.nodes.push(ps);
    return ps;
  }
  emit(ps: ParticleSystem, at: Vector3, n: number) { (ps.emitter as Vector3).copyFrom(at); ps.manualEmitCount = n }
  tracer(a: Vector3, b: Vector3, enemy: boolean) {
    const L = Vector3.Distance(a, b); if (L < 0.5) return;
    let t = this.tracers.find(x => x.t <= 0);
    if (!t) { const m = MeshBuilder.CreateBox('tr', { width: 0.012, height: 0.012, depth: 1 }, this.scene); const mt = new StandardMaterial('trm', this.scene); mt.disableLighting = true; mt.emissiveColor = new Color3(1, 0.8, 0.45); mt.alpha = 0.7; m.material = mt; m.isPickable = false; t = { m, t: 0 }; this.tracers.push(t) }
    t.m.setEnabled(true); t.t = enemy ? 0.08 : 0.05;
    t.m.position = Vector3.Lerp(a, b, 0.5); t.m.scaling.z = L * (enemy ? 0.6 : 0.85); t.m.lookAt(b);
  }
  shoot() {
    const spec = WEPS[this.Wp.cur], cam = this.cam;
    const spread = spec.spread * (1 - this.Wp.adsK * 0.85) * (1 + Math.min(1, this.P.speed / 4) * 1.5) * (this.P.crouch > 0.5 ? 0.7 : 1);
    const dir = cam.getForwardRay(1).direction.clone();
    dir.x += (Math.random() - 0.5) * spread; dir.y += (Math.random() - 0.5) * spread; dir.z += (Math.random() - 0.5) * spread; dir.normalize();
    const o = cam.globalPosition.clone();
    const h = this.scene.pickWithRay(new Ray(o, dir, 300), m => (m as any)._hx === true || ((m as any)._act && (m as any)._act.alive));
    const end = h?.hit ? h.pickedPoint! : o.add(dir.scale(300));
    this.tracer(this.Wp.muzzleWorld(), end, false);
    this.P.kick(spec.kick * (1 - this.Wp.adsK * 0.4) * (0.8 + Math.random() * 0.4), (Math.random() - 0.5) * spec.kick * 0.6);
    // noise: every shot is heard far away
    for (const a of this.actors) a.hear(this.P.pos, this.Wp.cur === 'aks' ? 85 : 60);
    if (!h?.hit) return;
    const act: Actor | undefined = (h.pickedMesh as any)._act;
    if (act) {
      const head = h.pickedPoint!.y > act.pos.y + act.height * 0.83;
      act.damage(spec.dmg * (head ? spec.head : 1) * (0.9 + Math.random() * 0.2), this.P.pos, head);
      this.emit(this.blood, h.pickedPoint!, head ? 30 : 16); sfx('flesh', [h.pickedPoint!.x, h.pickedPoint!.y, h.pickedPoint!.z]);
      sfx(head ? 'head' : 'hit'); UI.hitmark(head, !act.alive);
    } else { this.emit(this.puff, h.pickedPoint!, 10); sfx('impact', [h.pickedPoint!.x, h.pickedPoint!.y, h.pickedPoint!.z], 0.6) }
  }
  packKg() { let k = 0; for (const [id, n] of Object.entries(this.pack)) k += ITEMS[id as ItemId].kg * (n || 0); return k }
  take(loot: Partial<Record<ItemId, number>>) {
    const got: string[] = []; let full = false;
    for (const [id, n0] of Object.entries(loot)) {
      const def = ITEMS[id as ItemId]; let n = n0 || 0;
      const room = Math.floor((PACK_KG - this.packKg()) / def.kg + 1e-6); const t = Math.min(n, room);
      if (t > 0) { this.pack[id as ItemId] = (this.pack[id as ItemId] || 0) + t; got.push(`${def.icon} ${t} ${def.name}`); loot[id as ItemId] = n - t }
      if (t < n) full = true; else delete loot[id as ItemId];
    }
    return { got, full };
  }
  interactTarget() {
    const fwd = this.P.forward(); let best: { c?: Container; s?: Actor; d: number } | null = null;
    for (const c of this.conts) { if (c.searched && !Object.keys(c.loot).length) continue; const d = Vector3.Distance(c.pos, this.P.pos); if (d > 2.6) continue; const dx = (c.pos.x - this.P.pos.x) / (d || 1), dz = (c.pos.z - this.P.pos.z) / (d || 1); if (dx * fwd.x + dz * fwd.z < 0.35 && d > 1.2) continue; if (!best || d < best.d) best = { c, d } }
    for (const s of this.survivors) { if (!s.alive || s.following) continue; const d = s.dist(this.P.pos); if (d < 2.6 && (!best || d < best.d)) best = { s, d } }
    return best;
  }
  update(dt: number) {
    if (this.done) return;
    this.time += dt;
    const P = this.P, Wp = this.Wp;
    if (hit('Escape') || hit('KeyP')) { UI.pause(true); return }
    const busyWeapon = Wp.state !== 'ready';
    P.adsK = Wp.adsK;
    P.update(dt, busyWeapon);
    if (!P.dead) {
      if (hit('KeyR')) { const res = this.pack[Wp.spec.ammo] || 0; const t = Wp.reload(res); this.pack[Wp.spec.ammo] = res - t }
      if (hit('KeyQ') || hit('Digit1') && Wp.cur !== 'aks' || hit('Digit2') && Wp.cur !== 'm23') Wp.swap();
      if (hit('KeyB') || hit('KeyX')) { const a = Wp.toggleMode(); if (a !== undefined) UI.feed(a ? 'Full auto' : 'Semi auto') }
      if (hit('Digit4') && (this.pack.meds || 0) > 0 && P.hp < 100 && this.healT <= 0) { this.pack.meds!--; this.healT = 2.2; sfx('heal'); UI.feed('Patching up…') }
      if (this.healT > 0) { this.healT -= dt; if (this.healT <= 0) { P.hp = Math.min(100, P.hp + 60); UI.feed('+60 health') } }
      if (!P.sprinting && this.searchT <= 0 && Wp.tryFire(I.fire, I.firePressed)) this.shoot();
      // interact
      const tgt = this.interactTarget();
      if (tgt?.c) {
        const c = tgt.c;
        if (c.searched) { UI.prompt(`[E] Take — ${lootLine(c.loot)}`, 0); if (hit('KeyE')) { const r = this.take(c.loot); if (r.got.length) { sfx('pickup'); UI.feed(r.got.join('  ')) } if (r.full) UI.feed('Pack is full', true) } }
        else if (down('KeyE')) { if (this.searching !== c) { this.searching = c; this.searchT = 0; sfx('search', [c.pos.x, c.pos.y, c.pos.z]) } this.searchT += dt; UI.prompt(`Searching ${label(c.kind)}…`, this.searchT / c.time);
          if (this.searchT >= c.time) { c.searched = true; this.searchT = 0; this.searching = null; const r = this.take(c.loot); if (r.got.length) { sfx('pickup'); UI.feed(r.got.join('  ')) } else if (!Object.keys(c.loot).length) UI.feed('Nothing useful'); if (r.full) UI.feed('Pack is full', true); if (c.cache && this.mission.kind === 'raid') this.checkRaid() } }
        else { this.searching = null; this.searchT = 0; UI.prompt(`[E] Search ${label(c.kind)}`, 0) }
      } else if (tgt?.s) {
        UI.prompt('[E] "Stay close. We\'re getting out."', 0);
        if (hit('KeyE')) { for (const s of this.survivors) if (s.alive && s.dist(P.pos) < 12) { s.following = true; s.rescued = true } sfx('radio'); UI.feed('Survivor is following you'); this.objective = true; this.objText = 'Bring them to extraction'; UI.objective(this.objText, this.mission.title) }
      } else { this.searching = null; this.searchT = 0; UI.prompt('', 0) }
      // footsteps carry
      for (const a of this.actors) if (a.kind === 'infected') a.hear(P.pos, P.noise);
    }
    Wp.update(dt, { aim: I.aim && !P.sprinting, sprint: P.sprinting, bob: P.bob, ph: P.bobPh, land: P.land, lookDX: I.dx, lookDY: I.dy });
    // actors (far ones tick less often)
    for (const a of this.actors) { const d = a.dist(P.pos); a.lod += dt; if (d < 70 || a.state === 'chase' || a.following) { a.update(a.lod); a.lod = 0 } else if (a.lod > 0.25) { a.update(a.lod); a.lod = 0 } }
    for (const a of this.actors) if (!a.alive && a.deadT > 30 && a.kind === 'infected') { a.box.setEnabled(false) }
    for (const t of this.tracers) { if (t.t > 0) { t.t -= dt; if (t.t <= 0) t.m.setEnabled(false) } }
    // objectives
    if (this.mission.kind === 'loot' && !this.objective) { const n = this.conts.filter(c => c.searched && Vector3.Distance(c.pos, this.objPos) < 50).length; UI.objective(`${this.objText} (${Math.min(n, 4)}/4)`, this.mission.title); if (n >= 4) { this.objective = true; this.objText = 'Extract with your haul'; UI.objective(this.objText, this.mission.title); sfx('radio') } }
    if (this.mission.kind === 'raid' && !this.objective) this.checkRaid();
    if (this.mission.kind === 'rescue' && this.survivors.length && this.survivors.every(s => !s.alive) && this.objText !== 'Survivors lost — extract') { this.objText = 'Survivors lost — extract'; UI.objective(this.objText, this.mission.title) }
    // extraction
    const ex = this.extracts.find(e => Math.hypot(e.x - P.pos.x, e.z - P.pos.z) < 7);
    if (ex && !P.dead) { this.extractT += dt; UI.extract(this.extractT / 8); if (this.extractT >= 8) this.finish(true) }
    else { if (this.extractT > 0) UI.extract(0); this.extractT = 0 }
    if (P.dead) { this.deathT += dt; if (this.deathT > 3) this.finish(false) }
    // HUD
    const cf = this.cam.getForwardRay(1).direction; setListener(this.cam.position.x, this.cam.position.y, this.cam.position.z, cf.x, cf.z);
    UI.hud({ hp: P.hp, st: P.stamina, mag: Wp.mags[Wp.cur], res: this.pack[Wp.spec.ammo] || 0, wpn: Wp.spec.name + (Wp.cur === 'aks' ? (Wp.auto ? ' · AUTO' : ' · SEMI') : ''), kg: this.packKg(), max: PACK_KG, meds: this.pack.meds || 0, ads: Wp.adsK, reloading: Wp.reloading, heading: P.yaw });
    const marks = [...this.extracts.map(e => ({ p: e.add(new Vector3(0, 2, 0)), t: 'EXTRACT', c: 'ex' }))];
    if (!this.objective || this.mission.kind === 'rescue' && this.survivors.some(s => s.alive && !s.following)) marks.push({ p: this.objPos.add(new Vector3(0, 2.5, 0)), t: this.mission.kind === 'rescue' ? 'SIGNAL' : this.mission.kind === 'raid' ? 'CAMP' : 'BLOCKS', c: 'ob' });
    UI.markers(marks.map(m => ({ ...m, s: this.project(m.p), d: Vector3.Distance(m.p, P.pos) })), P.yaw, P.pos);
  }
  checkRaid() { const left = this.actors.filter(a => a.kind === 'raider' && a.alive).length; if (!left && !this.objective) { this.objective = true; this.objText = 'Camp cleared — loot the stockpile & extract'; UI.objective(this.objText, this.mission.title); sfx('radio') } else if (left && !this.objective) UI.objective(`${this.objText} (${left} left)`, this.mission.title) }
  project(p: Vector3) {
    const e = this.engine; const v = Vector3.Project(p, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), this.cam.viewport.toGlobal(e.getRenderWidth(), e.getRenderHeight()));
    const sx = e.getRenderWidth(), sy = e.getRenderHeight();
    return { x: v.x / sx, y: v.y / sy, front: v.z > 0 && v.z < 1 };
  }
  finish(extracted: boolean) {
    if (this.done) return; this.done = true;
    // bullets still in magazines go back in the pack
    this.pack.ammoR = (this.pack.ammoR || 0) + this.Wp.mags.aks; this.pack.ammoP = (this.pack.ammoP || 0) + this.Wp.mags.m23;
    const rescued = extracted ? this.survivors.filter(s => s.alive && s.following && s.dist(this.P.pos) < 25).length : 0;
    if (extracted) sfx('extract');
    this.result = { loadout: this.loadout, extracted, pack: extracted ? this.pack : {}, rescued, kills: this.kills, time: this.time, objective: this.objective, mission: this.mission };
    this.save.hp = extracted ? Math.max(20, Math.round(this.P.hp)) : 60;
    this.onEnd(this.result);
  }
  dispose() {
    for (const a of this.actors) a.dispose(); this.actors.length = 0;
    for (const n of this.nodes) n.dispose(); this.nodes = [];
    for (const t of this.tracers) t.m.dispose();
    for (const c of this.conts) if (!c.body) c.node.dispose();
    this.Wp.root.dispose(); this.Wp.light.dispose(); this.P.body.dispose();
    UI.raidHud(false);
  }
}
function lootLine(l: Partial<Record<ItemId, number>>) { return Object.entries(l).map(([k, n]) => `${ITEMS[k as ItemId].icon}${n}`).join(' ') || 'empty' }
function label(k: string) { return ({ crate: 'crate', crate_big: 'supply crate', chest: 'footlocker', dumpster: 'dumpster', barrel: 'drum', car: 'car', cache: 'stockpile', body: 'body' } as any)[k] || k }
