// Holdout — first-person weapons: authored AKS-74U and MK23 rigs (hands + gun + clips), ADS from the real sights.
import {
  Scene, TransformNode, Vector3, Quaternion, AnimationGroup, AbstractMesh, Mesh, LoadAssetContainerAsync, PointLight, Color3,
  MeshBuilder, StandardMaterial, Camera, Matrix, VertexBuffer, Axis, Space,
} from '@babylonjs/core';
import { sfx } from './audio';

export type WId = 'aks' | 'm23';
interface Spec {
  name: string; mag: number; auto: boolean; rof: number; dmg: number; head: number; spread: number; ammo: 'ammoR' | 'ammoP';
  eye: number[]; flip: boolean; gunMat: RegExp; idle: string; fire: string; fireTs: number; reloadT: string; reloadF: string; reloadTs: number;
  draw: string; drawTs: number; hide: string; hideTs: number; mode: string | null; hip: number[]; pivot: number[]; kick: number; snd: string;
}
export const WEPS: Record<WId, Spec> = {
  aks: { name: 'AKS-74U', mag: 30, auto: true, rof: 0.095, dmg: 34, head: 2.6, spread: 0.02, ammo: 'ammoR', eye: [-0.02, -0.011, 0.125], flip: false, gunMat: /^aks74u$/,
    idle: 'Fire_single', fire: 'Fire_single', fireTs: 2.6, reloadT: 'Reload_t', reloadF: 'Reload_f', reloadTs: 1.3, draw: 'Put_in', drawTs: 1.4, hide: 'Put_out', hideTs: 1.6, mode: 'Fire_mode_select',
    hip: [0.04, -0.035, 0.01], pivot: [0.03, -0.1, -0.32], kick: 0.011, snd: 'rifle' },
  m23: { name: 'MK23', mag: 12, auto: false, rof: 0.15, dmg: 42, head: 3, spread: 0.014, ammo: 'ammoP', eye: [0, 1.5, -0.45], flip: true, gunMat: /^Mark23_D$/,
    idle: 'Shoot', fire: 'Shoot', fireTs: 1.7, reloadT: 'Reload', reloadF: 'Reload', reloadTs: 1.4, draw: 'Draw', drawTs: 1.1, hide: 'Hide', hideTs: 1.2, mode: null,
    hip: [0.05, -0.06, 0.03], pivot: [0, -0.12, -0.3], kick: 0.02, snd: 'pistol' },
};

interface Gun {
  id: WId; spec: Spec; fx: TransformNode; inner: TransformNode; holder: TransformNode; align: TransformNode; groups: Record<string, AnimationGroup>;
  idle: AnimationGroup; cur: AnimationGroup | null; hipP: Vector3; adsP: Vector3; adsQ: Quaternion; muzzle: TransformNode; flash: Mesh; meshes: AbstractMesh[];
}

export class Weapons {
  root: TransformNode; guns: Partial<Record<WId, Gun>> = {}; cur: WId = 'aks'; state: 'draw' | 'ready' | 'busy' | 'hide' = 'draw'; stT = 0;
  mags: Record<WId, number> = { aks: 30, m23: 12 }; auto = true; semiLock = false; cd = 0;
  kick = 0; kickR = 0; swX = 0; swY = 0; adsK = 0; spK = 0; flashT = 0; light: PointLight; reloading = false;
  constructor(public scene: Scene, public cam: Camera) {
    this.root = new TransformNode('vm', scene); this.root.parent = cam;
    this.light = new PointLight('muzzleL', Vector3.Zero(), scene); this.light.diffuse = new Color3(1, 0.7, 0.35); this.light.intensity = 0; this.light.range = 14;
    scene.setRenderingAutoClearDepthStencil(1, true, true, false);
  }
  async load() {
    for (const id of ['aks', 'm23'] as WId[]) {
      const spec = WEPS[id];
      const c = await LoadAssetContainerAsync(`/assets/guns_${id}.glb`, this.scene, { pluginExtension: '.glb' });
      c.addAllToScene();
      const fx = new TransformNode(id + '_fx', this.scene), inner = new TransformNode(id + '_in', this.scene), holder = new TransformNode(id + '_h', this.scene), align = new TransformNode(id + '_a', this.scene);
      fx.parent = this.root; inner.parent = fx; holder.parent = inner; align.parent = holder;
      fx.rotationQuaternion = null; holder.rotationQuaternion = Quaternion.Identity();
      if (spec.flip) align.rotation.y = Math.PI;
      const e = new Vector3(spec.eye[0], spec.eye[1], spec.eye[2]); if (spec.flip) { e.x = -e.x; e.z = -e.z }
      align.position.copyFrom(e.negate());
      for (const r of c.rootNodes) r.parent = align;
      inner.position.set(-spec.pivot[0], -spec.pivot[1], -spec.pivot[2]); fx.position.set(spec.pivot[0], spec.pivot[1], spec.pivot[2]);
      holder.position.set(spec.hip[0], spec.hip[1], spec.hip[2]);
      const meshes = c.meshes.filter(m => m.getTotalVertices() > 0);
      for (const m of meshes) { m.renderingGroupId = 1; m.isPickable = false; m.alwaysSelectAsActiveMesh = true; m.receiveShadows = false }
      const groups: Record<string, AnimationGroup> = {}; for (const g of c.animationGroups) { g.stop(); groups[g.name] = g }
      const idle = groups[spec.idle];
      idle.start(false, 1, idle.from, idle.from); idle.goToFrame(idle.from); idle.pause();
      const flash = MeshBuilder.CreatePlane(id + '_flash', { size: 0.12 }, this.scene);
      const fm = new StandardMaterial('flashM', this.scene); fm.emissiveColor = new Color3(1, 0.75, 0.4); fm.disableLighting = true; fm.alpha = 0.9; fm.backFaceCulling = false;
      flash.material = fm; flash.renderingGroupId = 1; flash.isVisible = false; flash.isPickable = false;
      const g: Gun = { id, spec, fx, inner, holder, align, groups, idle, cur: null, hipP: holder.position.clone(), adsP: holder.position.clone(), adsQ: Quaternion.Identity(), muzzle: new TransformNode(id + '_mz', this.scene), flash, meshes };
      this.measure(g);
      this.guns[id] = g; fx.setEnabled(id === this.cur);
    }
    this.draw();
  }
  /** Find front/rear sight + muzzle on the skinned gun mesh in the idle pose → exact ADS pose (ported from the three.js build). */
  measure(g: Gun) {
    this.root.computeWorldMatrix(true);
    const gunMeshes = g.meshes.filter(m => g.spec.gunMat.test(m.material?.name || '')) as Mesh[];
    const inv = Matrix.Invert(this.root.computeWorldMatrix(true));
    let verts: Vector3[] = [];
    for (const m of gunMeshes) {
      m.computeWorldMatrix(true);
      const pos = m.getPositionData(true, true); if (!pos) continue;
      const wm = m.getWorldMatrix().multiply(inv);
      for (let i = 0; i < pos.length; i += 3) verts.push(Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], wm, new Vector3()));
    }
    // verts are in root (camera) space; undo the hip offset so they are relative to holder
    const hold = g.holder.position;
    verts = verts.map(v => v.subtract(hold));
    if (!verts.length) { g.muzzle.parent = g.align; g.flash.parent = g.muzzle; return }
    let zmin = 1e9, zmax = -1e9; for (const v of verts) { zmin = Math.min(zmin, v.z); zmax = Math.max(zmax, v.z) }
    const L = zmax - zmin;
    const top = (a: number, b: number) => { let best: Vector3 | null = null; for (const v of verts) { const f = (v.z - zmin) / L; if (f >= a && f <= b && (!best || v.y > best.y)) best = v } return best! };
    const front = g.id === 'aks' ? top(0, 0.3) : top(0, 0.22), rear = g.id === 'aks' ? top(0.33, 0.62) : top(0.72, 1);
    const tip = verts.filter(v => v.z < zmin + 0.015); const mz = tip.reduce((a, v) => a.addInPlace(v), new Vector3()).scaleInPlace(1 / tip.length);
    const dir = front.subtract(rear).normalize();
    const q = new Quaternion(); Quaternion.FromUnitVectorsToRef(dir, new Vector3(0, 0, -1), q);
    const up = front.subtract(mz); up.subtractInPlace(dir.scale(Vector3.Dot(up, dir))).normalize();
    const upR = up.applyRotationQuaternion(q);
    const roll = Quaternion.RotationAxis(new Vector3(0, 0, 1), Math.atan2(upR.x, upR.y));
    g.adsQ = roll.multiply(q);   // Hamilton product: q first, then roll
    const rr = rear.applyRotationQuaternion(g.adsQ);
    g.adsP = new Vector3(-rr.x, -rr.y - 0.0018, rr.z > -0.14 ? -0.14 - rr.z : 0);
    // muzzle anchor: follows the gun's animated body via the nearest animated node (align is close enough for flashes)
    g.muzzle.parent = g.holder; g.muzzle.position.copyFrom(mz);
    g.flash.parent = g.muzzle; g.flash.position.z = -0.04;
  }
  get gun() { return this.guns[this.cur]! }
  get spec() { return WEPS[this.cur] }
  play(g: Gun, name: string, ts: number) {
    const a = g.groups[name]; if (!a) return 0.5;
    if (g.cur && g.cur !== a) g.cur.stop();
    g.idle.pause();
    a.stop(); a.start(false, ts, a.from, a.to); g.cur = a;
    return (a.to - a.from) / 60 / ts;
  }
  dur(g: Gun, name: string, ts: number) { const a = g.groups[name]; return a ? (a.to - a.from) / 60 / ts : 0.5 }
  draw() { const g = this.gun; for (const k in this.guns) this.guns[k as WId]!.fx.setEnabled(k === this.cur); this.state = 'draw'; this.stT = this.play(g, g.spec.draw, g.spec.drawTs) }
  swap() { if (this.state !== 'ready') return; const g = this.gun; this.state = 'hide'; this.stT = this.play(g, g.spec.hide, g.spec.hideTs); sfx('bolt') }
  toggleMode() { if (this.state !== 'ready' || this.cur !== 'aks') return; this.auto = !this.auto; const g = this.gun; this.state = 'busy'; this.stT = this.play(g, g.spec.mode!, 1.4) * 0.7; sfx('dry'); return this.auto }
  /** reserve: rounds available in the pack. Returns rounds taken from it. */
  reload(reserve: number) {
    if (this.state !== 'ready') return 0;
    const g = this.gun, need = g.spec.mag - this.mags[this.cur]; if (need <= 0 || reserve <= 0) { if (reserve <= 0) sfx('dry'); return 0 }
    const empty = this.mags[this.cur] <= 0; const name = empty ? g.spec.reloadF : g.spec.reloadT;
    this.state = 'busy'; this.stT = this.play(g, name, g.spec.reloadTs); this.reloading = true;
    const take = Math.min(need, reserve); this.pending = take; sfx('mag');
    setTimeout(() => sfx('mag'), this.stT * 600); setTimeout(() => sfx('bolt'), this.stT * 900);
    return take;
  }
  pending = 0;
  /** Try to fire this frame. Returns true if a round left the barrel. */
  tryFire(trigger: boolean, pressed: boolean) {
    if (!trigger) this.semiLock = false;
    if (this.state !== 'ready' || this.cd > 0) return false;
    const auto = this.cur === 'aks' && this.auto;
    if (!trigger || (!auto && this.semiLock) || (!auto && !pressed && this.semiLock)) return false;
    if (this.mags[this.cur] <= 0) { if (pressed) sfx('dry'); this.semiLock = true; return false }
    this.semiLock = true; this.mags[this.cur]--; this.cd = this.spec.rof;
    this.kick = 1; this.kickR = 1; this.flashT = 0.05;
    this.play(this.gun, this.spec.fire, this.spec.fireTs);
    sfx(this.spec.snd);
    return true;
  }
  muzzleWorld() { return this.gun.muzzle.getAbsolutePosition().clone() }
  update(dt: number, st: { aim: boolean; sprint: boolean; bob: number; ph: number; land: number; lookDX: number; lookDY: number }) {
    const g = this.gun; if (!g) return;
    this.cd = Math.max(0, this.cd - dt);
    if (this.stT > 0) {
      this.stT -= dt;
      if (this.stT <= 0) {
        if (this.state === 'hide') { this.cur = this.cur === 'aks' ? 'm23' : 'aks'; this.draw(); return }
        if (this.reloading) { this.mags[this.cur] += this.pending; this.pending = 0; this.reloading = false }
        this.state = 'ready';
        if (g.cur) { g.cur.stop(); g.cur = null } g.idle.start(false, 1, g.idle.from, g.idle.from); g.idle.goToFrame(g.idle.from); g.idle.pause();
      }
    }
    // a fire clip that finished returns to idle
    if (this.state === 'ready' && g.cur && !g.cur.isPlaying) { g.cur = null; g.idle.start(false, 1, g.idle.from, g.idle.from); g.idle.goToFrame(g.idle.from); g.idle.pause() }
    const ready = this.state === 'ready' || (this.state === 'busy' && !this.reloading);
    this.adsK += ((st.aim && ready ? 1 : 0) - this.adsK) * Math.min(1, dt * 14);
    this.spK += ((st.sprint && this.state === 'ready' ? 1 : 0) - this.spK) * Math.min(1, dt * 9);
    const k = this.adsK, sp = this.spK;
    Vector3.LerpToRef(g.hipP, g.adsP, k, g.holder.position);
    Quaternion.SlerpToRef(Quaternion.Identity(), g.adsQ, k, g.holder.rotationQuaternion!);
    this.swX += (-st.lookDX * 0.0014 - this.swX) * Math.min(1, dt * 10); this.swY += (-st.lookDY * 0.0014 - this.swY) * Math.min(1, dt * 10);
    this.swX = Math.max(-0.08, Math.min(0.08, this.swX)); this.swY = Math.max(-0.08, Math.min(0.08, this.swY));
    this.kick = Math.max(0, this.kick - dt * 10); this.kickR = Math.max(0, this.kickR - dt * 8);
    const ph = st.ph * Math.PI, bk = st.bob * (1 - k * 0.85), ad = 1 - k * 0.8;
    g.fx.position.set(g.spec.pivot[0] + Math.sin(ph) * 0.011 * bk + this.swX * 0.35 * ad,
      g.spec.pivot[1] - Math.abs(Math.cos(ph)) * 0.011 * bk + this.swY * 0.25 * ad - st.land * 0.04 - sp * 0.04,
      g.spec.pivot[2] + this.kick * (k > 0.5 ? 0.02 : 0.035) + sp * 0.03);
    g.fx.rotation.set(-sp * 0.5 + this.kickR * (k > 0.5 ? 0.025 : 0.06) + this.swY * ad, sp * 0.6 + this.swX * ad, sp * 0.38 + Math.sin(ph) * 0.01 * bk);
    this.flashT -= dt;
    g.flash.isVisible = this.flashT > 0; if (this.flashT > 0) g.flash.rotation.z = Math.random() * 3;
    this.light.intensity = this.flashT > 0 ? 6 : 0; if (this.flashT > 0) this.light.position.copyFrom(this.muzzleWorld());
  }
  setVisible(v: boolean) { this.root.setEnabled(v) }
}
