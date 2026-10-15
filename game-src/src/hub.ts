// Holdout — the shelter: a warm-lit underground room (3D backdrop) + the management UI.
import {
  Scene, Engine, Vector3, Color3, Color4, MeshBuilder, PBRMaterial, Texture, PointLight, HemisphericLight, UniversalCamera,
  ShadowGenerator, Mesh, TransformNode, SpotLight, ParticleSystem,
} from '@babylonjs/core';
import { post, Q, softDot } from './render';
import { loadKit, prop } from './world';
import { Actor, loadActorAssets, Ctx } from './actors';
import { Save, store, UPGRADES, lvl, canAfford, pay, Mission } from './save';
import { ITEMS, ItemId, MISSION_TEXT } from './data';
import { el } from './ui';
import { sfx } from './audio';

export class Hub {
  scene: Scene; cam: UniversalCamera; actors: Actor[] = []; t = 0; bulbs: PointLight[] = [];
  constructor(public engine: Engine, public q: Q) {
    const scene = this.scene = new Scene(engine); scene.useRightHandedSystem = true;
    scene.clearColor = new Color4(0.02, 0.018, 0.015, 1);
    scene.ambientColor = new Color3(0.05, 0.04, 0.03);
    this.cam = new UniversalCamera('hc', new Vector3(-2.4, 1.55, 1.9), scene); this.cam.fov = 0.85; this.cam.minZ = 0.05; this.cam.inputs.clear(); this.cam.setTarget(new Vector3(-0.56, 1.2, -2.07));
    scene.fogMode = Scene.FOGMODE_EXP2; scene.fogDensity = 0.035; scene.fogColor = new Color3(0.08, 0.06, 0.045);
  }
  async build() {
    const s = this.scene;
    const mat = (name: string, u: number, v: number, tint = 1, rough = 0.9) => {
      const m = new PBRMaterial(name, s); const c = new Texture(`/assets/tex/${name}_c.jpg`, s); c.uScale = u; c.vScale = v; m.albedoTexture = c;
      const n = new Texture(`/assets/tex/${name}_n.jpg`, s); n.uScale = u; n.vScale = v; m.bumpTexture = n; m.metallic = 0; m.roughness = rough;
      m.albedoColor = new Color3(tint, tint * 0.97, tint * 0.93); m.maxSimultaneousLights = 6; return m;
    };
    // room: 14 × 4.2 × 18, arched concrete, tiled floor
    const floor = MeshBuilder.CreateGround('floor', { width: 14, height: 18 }, s); floor.material = mat('concrete', 4, 5, 0.55, 0.75); floor.receiveShadows = true;
    const wallM = mat('concrete', 5, 1.5, 0.7);
    const wall = (w: number, h: number, x: number, z: number, ry: number) => { const p = MeshBuilder.CreatePlane('w', { width: w, height: h }, s); p.position.set(x, h / 2, z); p.rotation.y = ry; p.material = wallM; p.receiveShadows = true; return p };
    wall(14, 4.2, 0, -9, 0); wall(14, 4.2, 0, 9, Math.PI); wall(18, 4.2, -7, 0, -Math.PI / 2); wall(18, 4.2, 7, 0, Math.PI / 2);
    const ceil = MeshBuilder.CreatePlane('ceil', { width: 14, height: 18 }, s); ceil.rotation.x = -Math.PI / 2; ceil.position.y = 4.2; ceil.material = wallM;
    const beamM = mat('wood', 1, 4, 0.5);
    for (let z = -8; z <= 8; z += 4) { const b = MeshBuilder.CreateBox('beam', { width: 14, height: 0.35, depth: 0.3 }, s); b.position.set(0, 4.0, z); b.material = beamM }
    // blast door at the far end
    const door = MeshBuilder.CreateCylinder('door', { diameter: 3.2, height: 0.4, tessellation: 40 }, s); door.rotation.x = Math.PI / 2; door.position.set(0, 1.7, -8.75);
    const dm = new PBRMaterial('doorM', s); dm.albedoColor = new Color3(0.25, 0.27, 0.25); dm.metallic = 0.8; dm.roughness = 0.45; door.material = dm;
    // lights: warm bulbs on cables
    const bulbM = new PBRMaterial('bulb', s); bulbM.emissiveColor = new Color3(1, 0.7, 0.35); bulbM.emissiveIntensity = 4; bulbM.albedoColor = Color3.Black();
    const shadow: ShadowGenerator[] = [];
    for (const [x, z] of [[-3, -5], [3, -1], [-2.5, 4], [2.5, 6.5]]) {
      const l = new PointLight('bulbL', new Vector3(x, 3.3, z), s); l.diffuse = new Color3(1, 0.68, 0.38); l.intensity = 16; l.range = 12; this.bulbs.push(l);
      const b = MeshBuilder.CreateSphere('bulb', { diameter: 0.12 }, s); b.position.copyFrom(l.position); b.material = bulbM;
      const cab = MeshBuilder.CreateCylinder('cab', { diameter: 0.01, height: 0.8 }, s); cab.position.set(x, 3.75, z);
      if (shadow.length < 2) { const sg = new ShadowGenerator(1024, l); sg.usePoissonSampling = true; sg.darkness = 0.2; shadow.push(sg) }
    }
    const hemi = new HemisphericLight('h', new Vector3(0, 1, 0), s); hemi.intensity = 0.16; hemi.diffuse = new Color3(0.6, 0.5, 0.4); hemi.groundColor = new Color3(0.1, 0.08, 0.06);
    // props (keep the kit's own colours indoors)
    s.metadata = { weather: false };
    const kit = await loadKit(s);
    const put = (n: string, x: number, z: number, ry: number) => { const t = prop(s, n, new Vector3(x, 0, z), ry, null, false); if (t) for (const m of t.getChildMeshes()) { m.isPickable = false; for (const g of shadow) g.addShadowCaster(m); m.receiveShadows = true; if (m.material instanceof PBRMaterial) m.material.maxSimultaneousLights = 6 } return t };
    put('workbench', 4.6, -2, -Math.PI / 2); put('crate_big', 5.4, 2.2, 0.2); put('crate', 5.3, 3.6, 0.6); put('crate', 4.4, 2.4, 1.2);
    put('barrel', -5.6, -6.5, 0); put('barrel', -5.0, -7.2, 0); put('chest', -5.5, 2.8, Math.PI / 2);
    put('bedroll', -4.6, 5.5, 0.1); put('bedroll', -2.6, 6.2, -0.2); put('bedroll', -4.8, 7.6, 0.3); put('tent', 4.2, 7, Math.PI);
    put('gun_ar1', 4.5, -2.2, 0)?.position.set(4.5, 0.95, -2.1);
    // people: you + residents
    await loadActorAssets(s, kit);
    const ctx: Ctx = { scene: s, W: null as any, csm: null, danger: 1, actors: this.actors, playerPos: () => new Vector3(0, 0, 50), playerEye: () => new Vector3(0, 1.6, 50), playerHurt: () => { }, playerDead: () => true, playerCrouch: () => 0, playerSpeed: () => 0, tracer: () => { }, onKill: () => { } };
    const me = new Actor(ctx, 'raider', new Vector3(0.4, 0, -1.2), 0); me.yaw = 2.3; me.play('R_idle'); this.actors.push(me);
    for (const m of me.meshes) { for (const g of shadow) g.addShadowCaster(m); if (m.material instanceof PBRMaterial) m.material.maxSimultaneousLights = 6 }
    if (me.gun) for (const m of me.gun.getChildMeshes()) if (m.material instanceof PBRMaterial) m.material.maxSimultaneousLights = 6;
    (me as any).update = () => { me.model.rotation.y = me.yaw + me.faceOff }; s.onBeforeRenderObservable.add(() => me.poseGun()); me.play('Idle_Loop');
    // dust in the lamplight
    const ds = new ParticleSystem('hdust', 300, s); ds.particleTexture = softDot(s, 'hd', 32, 0.3); ds.emitter = new Vector3(0, 2, 0);
    ds.minEmitBox = new Vector3(-6, -2, -8); ds.maxEmitBox = new Vector3(6, 2, 8); ds.color1 = new Color4(1, 0.85, 0.6, 0.35); ds.color2 = new Color4(1, 0.8, 0.5, 0.2); ds.colorDead = new Color4(1, 0.8, 0.5, 0);
    ds.minSize = 0.01; ds.maxSize = 0.03; ds.minLifeTime = 8; ds.maxLifeTime = 16; ds.emitRate = 25; ds.direction1 = new Vector3(-0.05, -0.02, -0.05); ds.direction2 = new Vector3(0.05, 0.05, 0.05); ds.minEmitPower = 0.1; ds.maxEmitPower = 0.2; ds.preWarmCycles = 100; ds.start();
    post(s, this.cam, this.q === 'ultra' ? 'high' : this.q, { exposure: 1.3, contrast: 1.12, sat: -10, warm: true });
    s.onBeforeRenderObservable.add(() => {
      const dt = this.engine.getDeltaTime() / 1000; this.t += dt;
      this.cam.position.set(-2.4 + Math.sin(this.t * 0.11) * 0.25, 1.55 + Math.sin(this.t * 0.07) * 0.05, 1.9 + Math.cos(this.t * 0.09) * 0.15); this.cam.setTarget(new Vector3(-0.56, 1.2, -2.07));
      for (const [i, b] of this.bulbs.entries()) b.intensity = 16 * (0.93 + 0.07 * Math.sin(this.t * (3 + i) + i) + (Math.random() < 0.004 ? -0.5 : 0));
    });
  }
  residents(save: Save) {
    // seat residents around the room (re-done when the roster changes)
    for (const a of this.actors.slice(1)) a.dispose(); this.actors.length = 1;
    const spots: [number, number, number, string][] = [[-4.2, 5.2, 0.3, 'Idle_Talking_Loop'], [-2.8, 6.8, 2.6, 'Crouch_Idle_Loop'], [3.6, -3.2, -2.2, 'Idle_FoldArms_Loop'], [-3.6, -2.5, 1.2, 'Idle_Loop'], [2.2, 4.5, 3.8, 'Idle_Talking_Loop'], [-5, 0.5, 1.6, 'Crouch_Idle_Loop'], [1.6, 7.4, -2.8, 'Idle_FoldArms_Loop'], [4.8, 4.8, 0.8, 'Idle_Loop']];
    save.residents.slice(0, spots.length).forEach((r, i) => {
      const [x, z, ry, an] = spots[i];
      const a = new Actor(this.actors[0].ctx, 'survivor', new Vector3(x, 0, z), i + 1); a.yaw = ry; a.play(an); this.actors.push(a);
      for (const m of a.meshes) if (m.material instanceof PBRMaterial) m.material.maxSimultaneousLights = 6;
      (a as any).update = () => { a.model.rotation.y = a.yaw + a.faceOff };
    });
    for (const a of this.actors) (a as any).update();
  }
}

// ── management UI ──
type Tab = 'runs' | 'stash' | 'shelter' | 'people' | 'log';
let tab: Tab = 'runs', selMission = 0;
export const loadout: Partial<Record<ItemId, number>> = {};
export function renderHub(save: Save, onDeploy: (m: Mission, lo: Partial<Record<ItemId, number>>) => void, onChange: () => void) {
  const root = document.getElementById('hubUI')!;
  const res = (['food', 'water', 'meds', 'ammoR', 'ammoP', 'scrap', 'parts', 'fuel', 'intel'] as ItemId[]).map(k => `<span title="${ITEMS[k].name}">${ITEMS[k].icon} <b>${save.stash[k] || 0}</b></span>`).join('');
  const need = save.residents.length;
  const days = Math.min(Math.floor(save.stash.food / Math.max(1, need)), Math.floor(save.stash.water / Math.max(1, need)));
  let body = '';
  if (tab === 'runs') {
    const m = save.missions[selMission] || save.missions[0];
    if (loadout.ammoR === undefined) { loadout.ammoR = Math.min(save.stash.ammoR, 150); loadout.ammoP = Math.min(save.stash.ammoP, 48); loadout.meds = Math.min(save.stash.meds, 2); loadout.food = 0; loadout.water = 0 }
    for (const k of ['ammoR', 'ammoP', 'meds'] as ItemId[]) loadout[k] = Math.min(loadout[k] || 0, save.stash[k]);
    body = `<div class="cols"><div class="board">${save.missions.map((x, i) => `<button class="mis ${x.kind}${i === selMission ? ' on' : ''}" data-mis="${i}"><em>${x.kind.toUpperCase()}</em><b>${x.title}</b><span>${'◆'.repeat(x.danger)}${'◇'.repeat(5 - x.danger)} · ${x.reward}</span></button>`).join('')}</div>
      <div class="brief"><em>${m.kind.toUpperCase()} · DANGER ${m.danger}/5</em><h2>${m.title}</h2><p>${MISSION_TEXT[m.kind].brief}</p>
      <div class="lo"><h3>LOADOUT</h3>${(['ammoR', 'ammoP', 'meds'] as ItemId[]).map(k => `<label>${ITEMS[k].icon} ${ITEMS[k].name}<input type="range" min="0" max="${save.stash[k]}" step="${k === 'meds' ? 1 : 6}" value="${loadout[k]}" data-lo="${k}"><b>${loadout[k]}</b></label>`).join('')}
      <small>Anything you carry is lost if you die out there.</small></div>
      <button class="deploy" data-deploy="1">DEPLOY ▸</button></div></div>`;
  } else if (tab === 'stash') {
    const ws = lvl(save, 'workshop');
    body = `<div class="grid">${(Object.keys(ITEMS) as ItemId[]).map(k => `<div class="it"><i>${ITEMS[k].icon}</i><b>${save.stash[k] || 0}</b><span>${ITEMS[k].name}</span><small>${ITEMS[k].desc}</small></div>`).join('')}</div>
      <div class="act">${ws ? `<button data-press="1" ${save.stash.scrap < 1 ? 'disabled' : ''}>Press ammo · 1 scrap → ${15 * ws} rounds</button><button data-pressp="1" ${save.stash.scrap < 1 ? 'disabled' : ''}>Press .45 · 1 scrap → ${8 * ws} rounds</button>` : '<small>Build a Workshop to press ammunition from scrap.</small>'}</div>`;
  } else if (tab === 'shelter') {
    body = `<div class="ups">${UPGRADES.map(u => { const l = lvl(save, u.id), max = l >= u.max, cost = u.cost(l); const ok = !max && canAfford(save, cost);
      return `<div class="up"><b>${u.name}</b><em>${'▮'.repeat(l)}${'▯'.repeat(u.max - l)}</em><p>${u.desc(l)}</p>${max ? '<small>MAXED</small>' : `<p class="next">Next: ${u.desc(l + 1)}</p><button data-up="${u.id}" ${ok ? '' : 'disabled'}>Build · ${Object.entries(cost).map(([k, n]) => `${ITEMS[k as ItemId].icon}${n}`).join(' ')}</button>`}</div>` }).join('')}</div>`;
  } else if (tab === 'people') {
    body = `<div class="ppl"><div class="p you"><b>You</b><span>Runner</span><div class="bar"><i style="width:${save.hp}%"></i></div></div>${save.residents.map(r => `<div class="p"><b>${r.name}</b><span>${r.role} · since day ${r.joined}</span><div class="bar"><i style="width:${r.hp}%"></i></div></div>`).join('')}</div>
      <p class="note">Each resident eats 1 food and drinks 1 water a day. Supplies last <b>${days}</b> day${days === 1 ? '' : 's'}.</p>`;
  } else body = `<div class="log">${save.log.map(l => `<p>${l}</p>`).join('')}</div>`;
  root.innerHTML = `<header><div class="brand">HOLDOUT</div><div class="day">DAY <b>${save.day}</b> · ${need} SHELTERED · ${days}D SUPPLY</div><div class="res">${res}</div></header>
    <nav>${(['runs', 'stash', 'shelter', 'people', 'log'] as Tab[]).map(t => `<button data-tab="${t}" class="${t === tab ? 'on' : ''}">${{ runs: 'Runs', stash: 'Stash', shelter: 'Shelter', people: 'People', log: 'Log' }[t]}</button>`).join('')}<button data-menu="1" class="menu">☰</button></nav>
    <section>${body}</section>`;
  root.onclick = e => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null; if (!b || b.disabled) return; sfx('ui');
    if (b.dataset.tab) { tab = b.dataset.tab as Tab; renderHub(save, onDeploy, onChange) }
    if (b.dataset.mis) { selMission = +b.dataset.mis; renderHub(save, onDeploy, onChange) }
    if (b.dataset.deploy) { const m = save.missions[selMission] || save.missions[0]; onDeploy(m, { ...loadout }) }
    if (b.dataset.up) { const u = UPGRADES.find(x => x.id === b.dataset.up)!; const c = u.cost(lvl(save, u.id)); if (canAfford(save, c)) { pay(save, c); save.upgrades[u.id] = lvl(save, u.id) + 1; save.log.unshift(`Day ${save.day}. Built ${u.name} (level ${save.upgrades[u.id]}).`); store(save); onChange(); renderHub(save, onDeploy, onChange) } }
    if (b.dataset.press) { save.stash.scrap--; save.stash.ammoR += 15 * lvl(save, 'workshop'); store(save); renderHub(save, onDeploy, onChange) }
    if (b.dataset.pressp) { save.stash.scrap--; save.stash.ammoP += 8 * lvl(save, 'workshop'); store(save); renderHub(save, onDeploy, onChange) }
    if (b.dataset.menu) document.getElementById('title')!.style.display = 'flex';
  };
  root.oninput = e => { const i = e.target as HTMLInputElement; if (i.dataset.lo) { loadout[i.dataset.lo as ItemId] = +i.value; (i.nextElementSibling as HTMLElement).textContent = i.value } };
}
export function resetLoadout() { for (const k in loadout) delete loadout[k as ItemId] }
