// Holdout — Babylon graphics lab. One Metro street, one operator, the full Zone lighting stack.
import {
  Engine, Scene, Vector3, Color3, Color4, HDRCubeTexture, DirectionalLight, HemisphericLight,
  CascadedShadowGenerator, UniversalCamera, DefaultRenderingPipeline, SSAO2RenderingPipeline,
  SSRRenderingPipeline, ImageProcessingConfiguration, ColorCurves, ParticleSystem, DynamicTexture,
  LoadAssetContainerAsync, PBRMaterial, AbstractMesh, Mesh, Texture, Ray, Constants, Material,
  AssetContainer, VertexBuffer, Scalar,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { TilesRenderer } from '3d-tiles-renderer/babylonjs';

type Q = 'low' | 'med' | 'high' | 'ultra';
const QS: Record<Q, { scale: number; shadow: number; casc: number; ssao: boolean; ssr: boolean; msaa: number; dust: number; mist: number; lib: 'lo' | 'ktx2'; err: number }> = {
  low:   { scale: 1.5, shadow: 1024, casc: 2, ssao: false, ssr: false, msaa: 1, dust: 200, mist: 30, lib: 'lo',   err: 16 },
  med:   { scale: 1.0, shadow: 2048, casc: 3, ssao: true,  ssr: false, msaa: 1, dust: 400, mist: 60, lib: 'ktx2', err: 10 },
  high:  { scale: 1.0, shadow: 2048, casc: 4, ssao: true,  ssr: true,  msaa: 1, dust: 600, mist: 80, lib: 'ktx2', err: 6 },
  ultra: { scale: 1 / Math.min(2, devicePixelRatio || 1), shadow: 4096, casc: 4, ssao: true, ssr: true, msaa: 4, dust: 900, mist: 110, lib: 'ktx2', err: 3 },
};
const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
const qp = new URLSearchParams(location.search).get('q') as Q | null;
let saved: Q | null = null; try { saved = localStorage.getItem('holdout-lab-q') as Q | null } catch {}
const QN: Q = (qp && QS[qp]) ? qp : (saved && QS[saved]) ? saved : mobile ? 'med' : 'high';
const C = QS[QN];
const MAP = (new URLSearchParams(location.search).get('map') || 'i95') as 'i95' | 'metro';

const $ = (id: string) => document.getElementById(id)!;
const status = (t: string) => { $('st').textContent = t };
const canvas = $('c') as HTMLCanvasElement;
const engine = new Engine(canvas, C.msaa > 1, { stencil: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }, false);
engine.setHardwareScalingLevel(C.scale);
const scene = new Scene(engine);
scene.useRightHandedSystem = true; // tiles + game use right-handed y-up: game (x,z) maps 1:1
const FOG = new Color3(0.56, 0.60, 0.63);
scene.clearColor = new Color4(FOG.r, FOG.g, FOG.b, 1);
scene.fogMode = Scene.FOGMODE_EXP2; scene.fogDensity = MAP === 'i95' ? 0.0055 : 0.0105; scene.fogColor = FOG;
scene.skipPointerMovePicking = true;

// ── Sky / environment: overcast HDRI ──────────────────────────────────────────
const env = new HDRCubeTexture('assets/sky.hdr', scene, 512, false, true, false, true);
scene.environmentTexture = env; scene.environmentIntensity = 0.85;
const sky = scene.createDefaultSkybox(env, true, 1500, 0.35, false)!;
sky.applyFog = false; sky.infiniteDistance = true;

// Overcast "sun": weak, high, wide-soft shadows. Hemi fill keeps undersides from going black.
const sun = new DirectionalLight('sun', new Vector3(-0.35, -1, 0.55).normalize(), scene);
sun.intensity = 1.6; sun.diffuse = new Color3(1.0, 0.96, 0.9); sun.shadowMinZ = -60; sun.shadowMaxZ = 260;
const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
hemi.intensity = 0.25; hemi.diffuse = new Color3(0.75, 0.8, 0.86); hemi.groundColor = new Color3(0.2, 0.19, 0.18); hemi.specular = Color3.Black();

const csm = new CascadedShadowGenerator(C.shadow, sun);
csm.numCascades = C.casc; csm.lambda = 0.85; csm.shadowMaxZ = 160; csm.stabilizeCascades = true;
csm.usePercentageCloserFiltering = true; csm.filteringQuality = C.shadow >= 2048 ? 2 /*high*/ : 1;
csm.darkness = 0.45; csm.bias = 0.004; csm.normalBias = 0.02; csm.cascadeBlendPercentage = 0.1;

// ── Camera ────────────────────────────────────────────────────────────────────
const cam = new UniversalCamera('cam', new Vector3(84, 1.7, 133), scene);
cam.minZ = 0.08; cam.maxZ = 1800; cam.fov = 1.0; cam.speed = 0.18; cam.angularSensibility = 2600; cam.inertia = 0.75;
cam.keysUp.push(87); cam.keysDown.push(83); cam.keysLeft.push(65); cam.keysRight.push(68);
cam.attachControl(canvas, true);
canvas.addEventListener('click', () => { if (!mobile && document.pointerLockElement !== canvas) canvas.requestPointerLock?.() });

// ── Post stack ───────────────────────────────────────────────────────────────
let ssr: SSRRenderingPipeline | null = null;
if (C.ssao) {
  const ao = new SSAO2RenderingPipeline('ao', scene, { ssaoRatio: QN === 'ultra' ? 1 : 0.5, blurRatio: 1 }, [cam], false);
  ao.radius = 1.6; ao.totalStrength = 1.15; ao.base = 0.08; ao.samples = QN === 'ultra' ? 24 : 12; ao.maxZ = 120; ao.expensiveBlur = QN === 'ultra';
}
if (C.ssr) {
  ssr = new SSRRenderingPipeline('ssr', scene, [cam], false, Constants.TEXTURETYPE_UNSIGNED_BYTE);
  ssr.thickness = 0.35; ssr.step = QN === 'ultra' ? 1 : 2; ssr.maxSteps = QN === 'ultra' ? 280 : 160; ssr.maxDistance = 140;
  ssr.strength = 1.0; ssr.reflectionSpecularFalloffExponent = 2.2; ssr.roughnessFactor = 0.15;
  ssr.blurDispersionStrength = 0.025; ssr.enableSmoothReflections = true; ssr.attenuateScreenBorders = true;
  ssr.attenuateIntersectionDistance = true; ssr.selfCollisionNumSkip = 2; ssr.ssrDownsample = QN === 'ultra' ? 0 : 1; ssr.blurDownsample = 1;
  ssr.inputTextureColorIsInGammaSpace = false; ssr.generateOutputInGammaSpace = false;
}
const pp = new DefaultRenderingPipeline('pp', true, scene, [cam]);
pp.samples = C.msaa;
pp.fxaaEnabled = C.msaa === 1;
pp.imageProcessingEnabled = true;
const ip = pp.imageProcessing;
ip.toneMappingEnabled = true; ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
ip.exposure = 1.05; ip.contrast = 1.18;
ip.vignetteEnabled = true; ip.vignetteWeight = 2.2; ip.vignetteStretch = 0.4; ip.vignetteColor = new Color4(0.02, 0.03, 0.03, 0);
ip.colorCurvesEnabled = true;
const cc = new ColorCurves();
cc.globalSaturation = -28;                            // drained Zone palette
cc.shadowsHue = 195; cc.shadowsDensity = 22; cc.shadowsSaturation = 35;   // cold teal shadows
cc.highlightsHue = 40; cc.highlightsDensity = 12; cc.highlightsSaturation = 20; // faint warm highlights
cc.midtonesHue = 80; cc.midtonesDensity = 6; cc.midtonesSaturation = 10;
ip.colorCurves = cc;
pp.bloomEnabled = true; pp.bloomThreshold = 0.85; pp.bloomWeight = 0.18; pp.bloomKernel = 64; pp.bloomScale = 0.5;
pp.grainEnabled = true; pp.grain.intensity = 7; pp.grain.animated = true;
pp.chromaticAberrationEnabled = QN !== 'low'; pp.chromaticAberration.aberrationAmount = 4; pp.chromaticAberration.radialIntensity = 0.6;
pp.sharpenEnabled = QN !== 'low'; pp.sharpen.edgeAmount = 0.22;

// ── Particles: dust motes + low ground mist ──────────────────────────────────
function softDot(name: string, size: number, hard: number) {
  const t = new DynamicTexture(name, size, scene, false); const g = t.getContext() as CanvasRenderingContext2D;
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(hard, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size); t.update(); t.hasAlpha = true; return t;
}
const dust = new ParticleSystem('dust', C.dust, scene);
dust.particleTexture = softDot('dot', 32, 0.3);
dust.emitter = cam.position; dust.minEmitBox = new Vector3(-14, -1.6, -14); dust.maxEmitBox = new Vector3(14, 3, 14);
dust.color1 = new Color4(0.85, 0.82, 0.74, 0.5); dust.color2 = new Color4(0.7, 0.7, 0.68, 0.3); dust.colorDead = new Color4(0.7, 0.7, 0.7, 0);
dust.minSize = 0.012; dust.maxSize = 0.035; dust.minLifeTime = 6; dust.maxLifeTime = 14; dust.emitRate = C.dust / 10;
dust.direction1 = new Vector3(-0.05, -0.02, -0.05); dust.direction2 = new Vector3(0.08, 0.04, 0.06); dust.minEmitPower = 0.2; dust.maxEmitPower = 0.5;
dust.gravity = new Vector3(0.04, -0.01, 0.02); dust.blendMode = ParticleSystem.BLENDMODE_STANDARD; dust.preWarmCycles = 120; dust.start();

const mist = new ParticleSystem('mist', C.mist, scene);
mist.particleTexture = softDot('puff', 128, 0.05);
const mistAt = new Vector3(); mist.emitter = mistAt as any;
mist.minEmitBox = new Vector3(-70, 0.2, -70); mist.maxEmitBox = new Vector3(70, 1.4, 70);
mist.color1 = new Color4(FOG.r * 1.05, FOG.g * 1.05, FOG.b * 1.05, 0.07); mist.color2 = new Color4(FOG.r, FOG.g, FOG.b, 0.05); mist.colorDead = new Color4(FOG.r, FOG.g, FOG.b, 0);
mist.minSize = 7; mist.maxSize = 16; mist.minLifeTime = 25; mist.maxLifeTime = 45; mist.emitRate = C.mist / 30;
mist.direction1 = new Vector3(-0.1, 0, -0.05); mist.direction2 = new Vector3(0.15, 0.01, 0.1); mist.minEmitPower = 0.3; mist.maxEmitPower = 0.6;
mist.minAngularSpeed = -0.02; mist.maxAngularSpeed = 0.02; mist.blendMode = ParticleSystem.BLENDMODE_STANDARD; mist.isBillboardBased = true;
mist.preWarmCycles = 300; mist.preWarmStepOffset = 4; mist.start();

// ── Metro tiles ───────────────────────────────────────────────────────────────
const tileMeshes: AbstractMesh[] = [];
const LIB = new Map<string, PBRMaterial>();
let libKind = '';
const isRoad = (n: string) => /Ashphalt|Asphalt|_Streets|Road(?!Light)|Cross walk|White paint|Arrow/i.test(n);
const isWalk = (n: string) => /Sidewalk|Curb|side walks|STONES|Concrete/i.test(n);

function tuneLib(m: PBRMaterial) {
  const n = m.name;
  m.backFaceCulling = false;
  m.metallic = Math.min(0.6, m.metallic ?? 0); m.roughness = Math.max(0.35, m.roughness ?? 1); m.maxSimultaneousLights = 2;
  if (!m.emissiveTexture && !/LIGHT|Light|Lamp|Emission/.test(n)) m.emissiveColor = Color3.Black();
  if (/glass|Glass|Window/.test(n) && !m.albedoTexture) { m.albedoColor.scaleInPlace(0.6); m.roughness = 0.06; m.metallic = 0.4 }
  else if (/glass|Glass/.test(n)) { m.roughness = 0.08; m.metallic = 0.35 }
  if (isRoad(n)) { m.roughness = 0.14; m.metallic = 0; m.albedoColor.scaleInPlace(0.55) }       // rain-wet asphalt
  else if (isWalk(n)) { m.roughness = 0.38; m.albedoColor.scaleInPlace(0.75) }                       // damp paving
  else if (!/glass|Glass/.test(n)) m.albedoColor.scaleInPlace(0.88);                               // weathered, dusty
  if (m.bumpTexture) m.bumpTexture.level = 0.9;
  const uvT = (m as any).metadata?.gltf?.extras?.uvT;
  if (uvT && m.albedoTexture) {
    const t = (m.albedoTexture as Texture).clone(); t.uScale = uvT.s[0]; t.vScale = uvT.s[1]; t.uOffset = uvT.o[0]; t.vOffset = uvT.o[1]; t.wAng = -(uvT.r || 0);
    m.albedoTexture = t;
  }
  for (const t of [m.albedoTexture, m.bumpTexture, m.emissiveTexture]) if (t) { t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE; t.anisotropicFilteringLevel = QN === 'low' ? 4 : 8 }
  m.environmentIntensity = 1;
  m.maxSimultaneousLights = 2;
}

async function loadLib(kind: 'lo' | 'ktx2') {
  const file = kind === 'lo' ? 'mats_lo.glb' : 'mats_ktx2.glb';
  const c: AssetContainer = await LoadAssetContainerAsync('/assets/metro/' + file, scene, { pluginExtension: '.glb' });
  const next = new Map<string, PBRMaterial>();
  for (const m of c.materials) if (m instanceof PBRMaterial) { tuneLib(m); next.set(m.name, m) }
  for (const t of c.textures) scene.addTexture(t);
  for (const m of c.materials) scene.addMaterial(m);
  for (const mesh of c.meshes) mesh.dispose(); // library meshes are just carriers
  const old = [...LIB.values()];
  LIB.clear(); for (const [k, v] of next) LIB.set(k, v);
  for (const mesh of tileMeshes) applyMat(mesh);
  for (const m of old) if (![...LIB.values()].includes(m)) m.dispose(true, true);
  libKind = kind; refreshHud();
}

function applyMat(mesh: AbstractMesh) {
  const key = (mesh.metadata && mesh.metadata.matName) || mesh.material?.name;
  if (!key) return;
  mesh.metadata = { ...(mesh.metadata || {}), matName: key };
  const lib = LIB.get(key);
  if (lib && mesh.material !== lib) {
    const ph = mesh.material; mesh.material = lib;
    if (ph && !LIB.has(ph.name + '#keep') && ![...LIB.values()].includes(ph as PBRMaterial)) { if (!ph.getBindedMeshes().length) ph.dispose(true, true) }
  }
}

// Babylon 9 + 3DTilesRendererJS: real 3D Tiles traversal (SSE-driven LOD, REPLACE refine, LRU cache)
let tiles: TilesRenderer | null = null;
let tilesBusy = true;
function prepTileMesh(mesh: AbstractMesh) {
  if (!(mesh instanceof Mesh) || !mesh.getTotalVertices()) return;
  if (!mesh.isVerticesDataPresent(VertexBuffer.NormalKind)) mesh.convertToFlatShadedMesh();
  applyMat(mesh);
  mesh.receiveShadows = true; csm.addShadowCaster(mesh, false);
  mesh.isPickable = true;
  tileMeshes.push(mesh);
}
function startTiles() {
  tiles = new TilesRenderer('/assets/metro/tileset.json', scene);
  tiles.errorTarget = C.err;
  (tiles as any).lruCache.minSize = 120; (tiles as any).lruCache.maxSize = 400;
  (tiles as any).downloadQueue.maxJobsPerOrigin = mobile ? 4 : 8;
  tiles.addEventListener('load-model', (e: any) => { for (const m of e.scene.getChildMeshes(false)) prepTileMesh(m) });
  tiles.addEventListener('dispose-model', (e: any) => {
    const gone = new Set(e.scene.getChildMeshes(false));
    for (let i = tileMeshes.length - 1; i >= 0; i--) if (gone.has(tileMeshes[i])) { csm.removeShadowCaster(tileMeshes[i], false); tileMeshes.splice(i, 1) }
  });
  tiles.addEventListener('tiles-load-start', () => { tilesBusy = true });
  tiles.addEventListener('tiles-load-end', () => { tilesBusy = false });
  scene.onBeforeRenderObservable.add(() => tiles.update());
}
const tilesSettled = (max = 25000) => new Promise<void>(res => { const t0 = performance.now(); const t = setInterval(() => { if (!tilesBusy || performance.now() - t0 > max) { clearInterval(t); res() } }, 250) });

function groundY(x: number, z: number, from = MAP === 'i95' ? 200 : 40) {
  const hit = scene.pickWithRay(new Ray(new Vector3(x, from, z), new Vector3(0, -1, 0), from + 80), m => tileMeshes.includes(m) && m.isEnabled() && ![2, 3].includes((m.material as any)?.transparencyMode));
  return hit?.hit ? hit.pickedPoint!.y : 0;
}

// ── I-95 interchange: the authored map as-is; preview textures first, full AI-upscaled KTX2 after ──
async function loadI95() {
  const c = await LoadAssetContainerAsync(i95url('i95_lo.glb'), scene, { pluginExtension: '.glb' });
  c.addAllToScene();
  for (const m of c.meshes) if (m instanceof Mesh && m.getTotalVertices()) {
    m.receiveShadows = true; csm.addShadowCaster(m, false); m.isPickable = true; m.freezeWorldMatrix(); tileMeshes.push(m);
    if (m.material instanceof PBRMaterial) m.material.maxSimultaneousLights = 2;
  }
  libKind = 'lo'; refreshHud();
}
declare const __I95V__: Record<string, string>;
const i95url = (f: string) => '/assets/i95/' + f + '?v=' + (__I95V__[f] || '0');   // /assets is immutable-cached: version every URL
let hdDone = 0;
async function upgradeI95() {
  // full-res (AI-upscaled, KTX2) split in 3 parts; each part swaps in as soon as it lands
  await Promise.all([0, 1, 2].map(async k => {
    const c = await LoadAssetContainerAsync(i95url(`i95_hd${k}.glb`), scene, { pluginExtension: '.glb' });
    const hi = new Map<string, Material>(); for (const m of c.materials) { hi.set(m.name, m); scene.addMaterial(m); (m as PBRMaterial).maxSimultaneousLights = 2 }
    for (const t of c.textures) scene.addTexture(t);
    const old = new Set<Material>();
    for (const m of tileMeshes) { const h = m.material && hi.get(m.material.name); if (h && h !== m.material) { old.add(m.material!); m.material = h } }
    for (const m of c.meshes) m.dispose();
    for (const m of old) if (!m.getBindedMeshes().length) m.dispose(true, true);
    hdDone++; status(hdDone < 3 ? `loading full-res textures ${hdDone}/3…` : '');
  }));
  libKind = 'ktx2'; refreshHud();
}

// ── Operator ──────────────────────────────────────────────────────────────────
let op: AbstractMesh | null = null;
async function loadOperator(x: number, z: number, yaw: number) {
  const c = await LoadAssetContainerAsync('/assets/ops.glb', scene, { pluginExtension: '.glb' });
  c.addAllToScene();
  const root = c.meshes[0];
  for (const m of c.meshes) {
    if (/^V[234]$/.test(m.name)) m.isVisible = false;
    if (m.material instanceof PBRMaterial) { const pm = m.material; pm.maxSimultaneousLights = 2; pm.albedoColor.scaleInPlace(0.92); pm.roughness = Math.max(0.55, pm.roughness ?? 1); if (pm.bumpTexture) pm.bumpTexture.level = 1 }
    if (m.getTotalVertices() > 0 && m.isVisible) { csm.addShadowCaster(m, false); m.receiveShadows = true }
  }
  for (const g of c.animationGroups) g.stop();
  const idle = c.animationGroups.find(g => g.name === 'R_idle') || c.animationGroups.find(g => g.name === 'Idle_Loop');
  idle?.start(true, 1);
  const { min, max } = root.getHierarchyBoundingVectors(true);
  const h = max.y - min.y; if (h > 0.1 && (h < 1.4 || h > 2.2)) root.scaling.scaleInPlace(1.8 / h);
  const gy = groundY(x, z);
  root.position.set(x, gy, z);
  root.computeWorldMatrix(true);
  const feet = root.getHierarchyBoundingVectors(true).min.y; root.position.y += gy - feet; // plant the boots on the pavement
  root.rotationQuaternion = null; root.rotation.y = yaw;
  op = root;
}

// ── Shots (also used by the test harness) ────────────────────────────────────
const STREET = MAP === 'i95' ? { x: -215.4, z: -62.6 } : { x: 89, z: 133 };
// absolute heights (abs: true) — the expressway runs in a trench under overpasses, so no top-down raycast
const SHOTS_I95 = [
  { name: 'Avenue', p: [-212.5, 4.8, -92], t: [-214, 5.6, 40], abs: true },
  { name: 'Operator', p: [-213.2, 4.5, -64.6], t: [-211.0, 4.3, -60.8], abs: true },
  { name: 'Side street', p: [-389, 4.9, -95], t: [-390, 5.5, 60], abs: true },
  { name: 'Expressway', p: [-70, -12.8, -21], t: [60, -12.2, -29], abs: true },
  { name: 'Overlook', p: [-280, 45, -200], t: [-60, 0, -20], abs: true },
];
const SHOTS = MAP === 'i95' ? SHOTS_I95 : [
  { name: 'Street east', p: [80, 1.7, 131.2], t: [140, 2.6, 134] },
  { name: 'Operator',    p: [91.4, 1.35, 131.4], t: [93.4, 1.25, 134.6] },
  { name: 'Street west', p: [100, 1.75, 135], t: [40, 3.0, 132] },
  { name: 'Overlook', p: [62, 9, 133], t: [100, 0, 133.5] },
];
function shot(i: number) {
  const s: any = SHOTS[i % SHOTS.length];
  if (s.abs) { cam.position.set(s.p[0], s.p[1], s.p[2]); cam.setTarget(new Vector3(s.t[0], s.t[1], s.t[2])); return }
  const gy = groundY(s.p[0], s.p[2]);
  cam.position.set(s.p[0], gy + s.p[1], s.p[2]);
  cam.setTarget(new Vector3(s.t[0], groundY(s.t[0], s.t[2]) + s.t[1], s.t[2]));
}

// ── HUD ───────────────────────────────────────────────────────────────────────
function refreshHud() {
  $('q').innerHTML = (['low', 'med', 'high', 'ultra'] as Q[]).map(k => `<button class="${k === QN ? 'on' : ''}" data-q="${k}">${k}</button>`).join('');
  $('shots').innerHTML = SHOTS.map((s, i) => `<button data-s="${i}">${s.name}</button>`).join('');
  $('lib').textContent = libKind ? `textures: ${libKind === 'lo' ? 'preview' : 'KTX2 full'}` : '';
}
document.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button'); if (!b) return;
  if (b.dataset.q) { try { localStorage.setItem('holdout-lab-q', b.dataset.q) } catch {} location.search = '?q=' + b.dataset.q }
  if (b.dataset.s) shot(+b.dataset.s);
});
let acc = 0;
scene.onBeforeRenderObservable.add(() => {
  mistAt.set(cam.position.x, 0, cam.position.z);
  acc += engine.getDeltaTime(); if (acc > 500) { acc = 0; $('fps').textContent = `${engine.getFps().toFixed(0)} fps · ${QN} · ${scene.getActiveMeshes().length} meshes` }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
(async () => {
  refreshHud();
  status('loading textures…');
  if (MAP === 'i95') await loadI95(); else { await loadLib('lo'); startTiles() }
  if (MAP === 'i95') tilesBusy = false;
  (window as any).__lab = { scene, engine, cam, shot, q: QN, ready: false, lib: () => libKind, tiles: () => tileMeshes.length, busy: () => tilesBusy, settled: tilesSettled, groundY, look: (p: number[], t: number[], fov = 1.0) => { cam.position.set(p[0], p[1], p[2]); cam.setTarget(new Vector3(t[0], t[1], t[2])); cam.fov = fov }, place: (x: number, z: number, yaw: number) => { if (op) { const gy = groundY(x, z); op.position.set(x, gy, z); op.rotation.y = yaw } }, renderer: () => tiles };
  shot(0);
  engine.runRenderLoop(() => scene.render());
  status('streaming district…');
  await tilesSettled();
  shot(0);
  await loadOperator(MAP === 'i95' ? STREET.x + 4.2 : STREET.x + 4.2, MAP === 'i95' ? STREET.z + 2.6 : STREET.z + 2.8, MAP === 'i95' ? 3.6 : -2.4);
  status('');
  if (MAP === 'i95') { if (QN !== 'low') { status('loading full-res textures…'); await upgradeI95(); status('') } }
  else if (C.lib === 'ktx2') { status('upgrading textures (KTX2)…'); await loadLib('ktx2'); status('') }
  await scene.whenReadyAsync();
  (window as any).__lab.ready = true;
})().catch(e => { console.error(e); status('error: ' + (e?.message || e)) });
window.addEventListener('resize', () => engine.resize());
