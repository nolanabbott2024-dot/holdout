// Holdout — the I-95 interchange: visual map (preview → HD KTX2), collision/pick proxies, walkable grid, kit props.
import {
  Scene, Mesh, AbstractMesh, VertexData, VertexBuffer, Vector3, Matrix, Ray, PBRMaterial, Material, LoadAssetContainerAsync,
  AssetContainer, TransformNode, CascadedShadowGenerator, StandardMaterial,
} from '@babylonjs/core';

declare const __I95V__: Record<string, string>;
const url = (f: string) => '/assets/i95/' + f + '?v=' + (__I95V__[f] || '0');

// surface classes
export const C_VOID = 0, C_ROAD = 1, C_WALK = 2, C_GRASS = 3, C_BUILD = 4, C_STRUCT = 5;
function classify(mat: string): number {
  const n = mat.toLowerCase();
  if (/water|tree|marking|graffiti/.test(n)) return -1;              // not solid
  if (/road|highway|intersection|asphalt|bike lane|zebra/.test(n)) return C_ROAD;
  if (/sidewalk/.test(n)) return C_WALK;
  if (/grass|rubble|rock/.test(n)) return C_GRASS;
  if (/city_block|garage|tower|brick|stone_wall|lotta walls|bunker/.test(n)) return C_BUILD;
  return C_STRUCT;
}

export interface World {
  scene: Scene; visual: AbstractMesh[]; proxies: Mesh[]; triClass: Map<Mesh, Uint8Array>;
  grid: { x0: number; z0: number; step: number; nx: number; nz: number; y: Float32Array; c: Uint8Array };
  ground(x: number, z: number, from?: number): { y: number; c: number; n: Vector3 } | null;
  cellAt(x: number, z: number): { y: number; c: number };
  ray(o: Vector3, d: Vector3, len: number): { p: Vector3; c: number; n: Vector3; d: number } | null;
  hdDone: boolean;
  /** Character move with raycast collision. Mutates pos; returns {grounded, hitWall}. */
  move(pos: Vector3, mx: number, mz: number, vy: number, dt: number, r: number, grounded: boolean, lite?: boolean): { grounded: boolean; vy: number; wall: boolean };
}

function upN(n: Vector3 | null) { if (!n) return new Vector3(0, 1, 0); return n.y < 0 ? n.scale(-1) : n }
let faceCls: (m: Mesh, f: number) => number = () => 0;
export async function loadWorld(scene: Scene, csm: CascadedShadowGenerator | null, hd: boolean, progress: (t: string) => void): Promise<World> {
  progress('Loading the interchange…');
  const c = await LoadAssetContainerAsync(url('i95_lo.glb'), scene, { pluginExtension: '.glb' });
  c.addAllToScene();
  const visual: AbstractMesh[] = [];
  for (const m of c.meshes) if (m instanceof Mesh && m.getTotalVertices()) {
    m.isPickable = false; m.receiveShadows = true; m.freezeWorldMatrix(); m.doNotSyncBoundingInfo = true;
    if (csm && classify(m.material?.name || '') !== -1) csm.addShadowCaster(m, false);
    if (m.material instanceof PBRMaterial) m.material.maxSimultaneousLights = 3;
    visual.push(m);
  }
  progress('Building collision…');
  const { proxies, triClass } = buildProxies(scene, visual);
  faceCls = (m, f) => { const a = triClass.get(m); return a ? a[f % a.length] : 0 };
  const W: World = {
    scene, visual, proxies, triClass, hdDone: false, move: null as any,
    grid: null as any,
    ground(x, z, from = 120) {
      const r = new Ray(new Vector3(x, from, z), new Vector3(0, -1, 0), from + 80);
      const h = scene.pickWithRay(r, m => (m as any)._hx === true);
      if (!h?.hit) return null;
      const cls = faceCls(h.pickedMesh as Mesh, h.faceId);
      return { y: h.pickedPoint!.y, c: cls, n: upN(h.getNormal(true, false)) };
    },
    cellAt(x, z) {
      const g = W.grid; const i = Math.floor((x - g.x0) / g.step), k = Math.floor((z - g.z0) / g.step);
      if (i < 0 || k < 0 || i >= g.nx || k >= g.nz) return { y: -99, c: C_VOID };
      return { y: g.y[k * g.nx + i], c: g.c[k * g.nx + i] };
    },
    ray(o, d, len) {
      const h = scene.pickWithRay(new Ray(o, d, len), m => (m as any)._hx === true);
      if (!h?.hit) return null;
      return { p: h.pickedPoint!, c: faceCls(h.pickedMesh as Mesh, h.faceId), n: h.getNormal(true, false) || new Vector3(0, 1, 0), d: h.distance };
    },
  };
  const pred = (m: AbstractMesh) => (m as any)._hx === true && m.isEnabled();
  const R = new Ray(Vector3.Zero(), Vector3.Zero(), 1);
  const cast = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number) => {
    R.origin.set(ox, oy, oz); R.direction.set(dx, dy, dz); R.length = len;
    const h = scene.pickWithRay(R, pred, false); return h?.hit ? h : null;
  };
  const DIRS = Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)]);
  const D4 = DIRS.filter((_, i) => i % 2 === 0);
  W.move = (pos, mx, mz, vy, dt, r, grounded, lite = false) => {
    const HS = lite ? [0.9] : [0.55, 1.35], DS = lite ? D4 : DIRS, IT = lite ? 1 : 2;
    let wall = false;
    const ml = Math.hypot(mx, mz);
    // 1) sweep: don't tunnel through thin walls
    if (ml > 1e-5) for (const hy of HS) {
      const h = cast(pos.x, pos.y + hy, pos.z, mx / ml, 0, mz / ml, ml + r);
      if (h) { const n = h.getNormal(true, false); if (n && Math.abs(n.y) < 0.7) { const k = Math.max(0, h.distance - r) / ml; const nx = n.x, nz = n.z, nl = Math.hypot(nx, nz) || 1;
        // keep the part of the move along the wall
        const along = mx * (-nz / nl) + mz * (nx / nl); mx = mx * k + (-nz / nl) * along * (1 - k); mz = mz * k + (nx / nl) * along * (1 - k); wall = true } }
    }
    pos.x += mx; pos.z += mz;
    // 2) push out of anything closer than the radius
    for (let it = 0; it < IT; it++) for (const hy of HS) for (const [dx, dz] of DS) {
      const h = cast(pos.x, pos.y + hy, pos.z, dx, 0, dz, r);
      if (h) { const n = h.getNormal(true, false); if (n && Math.abs(n.y) > 0.7) continue; pos.x -= dx * (r - h.distance) * 0.5; pos.z -= dz * (r - h.distance) * 0.5; wall = true }
    }
    // 3) vertical: step up to 0.5 m, snap down 0.5 m when grounded, otherwise fall
    if (vy > 0) { const h = cast(pos.x, pos.y + 1.6, pos.z, 0, 1, 0, vy * dt + 0.15); if (h) vy = 0 }
    const down = grounded && vy <= 0 ? 0.55 : Math.max(0, -vy * dt) + 0.02;
    const h = cast(pos.x, pos.y + 0.5, pos.z, 0, -1, 0, 0.5 + down);
    if (h && vy <= 0) { pos.y = h.pickedPoint!.y; return { grounded: true, vy: 0, wall } }
    pos.y += vy * dt;
    return { grounded: false, vy, wall };
  };
  progress('Surveying streets…');
  W.grid = survey(W);
  if (hd) upgradeHD(scene, visual, progress).then(() => { W.hdDone = true });
  return W;
}

async function upgradeHD(scene: Scene, visual: AbstractMesh[], progress: (t: string) => void) {
  let done = 0;
  await Promise.all([0, 1, 2].map(async k => {
    try {
      const c = await LoadAssetContainerAsync(url(`i95_hd${k}.glb`), scene, { pluginExtension: '.glb' });
      const hi = new Map<string, Material>(); for (const m of c.materials) { hi.set(m.name, m); scene.addMaterial(m); (m as PBRMaterial).maxSimultaneousLights = 3 }
      for (const t of c.textures) scene.addTexture(t);
      const old = new Set<Material>();
      for (const m of visual) { const h = m.material && hi.get(m.material.name); if (h && h !== m.material) { old.add(m.material!); m.material = h } }
      for (const m of c.meshes) m.dispose();
      for (const m of old) if (!m.getBindedMeshes().length) m.dispose(true, true);
    } catch (e) { console.warn('HD part failed', k, e) }
    done++; progress(done < 3 ? `HD textures ${done}/3` : '');
  }));
}

/** Split every solid triangle into 24 m cells → small invisible meshes for fast collision and raycasts. */
function buildProxies(scene: Scene, visual: AbstractMesh[]) {
  const CELL = 24;
  const cells = new Map<string, { p: number[]; cls: number[] }>();
  const v = new Vector3(), a = new Vector3(), b = new Vector3();
  for (const m of visual as Mesh[]) {
    const cls = classify(m.material?.name || ''); if (cls < 0) continue;
    const pos = m.getVerticesData(VertexBuffer.PositionKind); const idx = m.getIndices(); if (!pos || !idx) continue;
    const wm = m.computeWorldMatrix(true);
    const wp = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) { Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], wm, v); wp[i] = v.x; wp[i + 1] = v.y; wp[i + 2] = v.z }
    for (let t = 0; t < idx.length; t += 3) {
      const i0 = idx[t] * 3, i1 = idx[t + 1] * 3, i2 = idx[t + 2] * 3;
      const cx = (wp[i0] + wp[i1] + wp[i2]) / 3, cz = (wp[i0 + 2] + wp[i1 + 2] + wp[i2 + 2]) / 3;
      // skip degenerate
      a.set(wp[i1] - wp[i0], wp[i1 + 1] - wp[i0 + 1], wp[i1 + 2] - wp[i0 + 2]); b.set(wp[i2] - wp[i0], wp[i2 + 1] - wp[i0 + 1], wp[i2 + 2] - wp[i0 + 2]);
      if (Vector3.Cross(a, b).lengthSquared() < 1e-8) continue;
      const key = Math.floor(cx / CELL) + ',' + Math.floor(cz / CELL);
      let c = cells.get(key); if (!c) { c = { p: [], cls: [] }; cells.set(key, c) }
      c.p.push(wp[i0], wp[i0 + 1], wp[i0 + 2], wp[i1], wp[i1 + 1], wp[i1 + 2], wp[i2], wp[i2 + 1], wp[i2 + 2]); c.cls.push(cls);
    }
  }
  const proxies: Mesh[] = []; const triClass = new Map<Mesh, Uint8Array>();
  for (const [k, c] of cells) {
    const m = new Mesh('px_' + k, scene); const vd = new VertexData();
    const idx = Array.from({ length: c.p.length / 3 }, (_, i) => i);
    vd.positions = c.p; vd.indices = idx;
        vd.applyToMesh(m, false);
    m.isVisible = false; m.checkCollisions = false; m.isPickable = true; (m as any)._hx = true;
    m.freezeWorldMatrix(); m.doNotSyncBoundingInfo = false; m.refreshBoundingInfo();
    proxies.push(m); triClass.set(m, Uint8Array.from(c.cls));
  }
  return { proxies, triClass };
}

/** 4 m walkability grid: rasterize up-facing triangles top-down (highest surface wins). */
function survey(W: World) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const m of W.proxies) { const b = m.getBoundingInfo().boundingBox; x0 = Math.min(x0, b.minimumWorld.x); x1 = Math.max(x1, b.maximumWorld.x); z0 = Math.min(z0, b.minimumWorld.z); z1 = Math.max(z1, b.maximumWorld.z) }
  const step = 4, nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step);
  const y = new Float32Array(nx * nz).fill(-99), c = new Uint8Array(nx * nz);
  for (const m of W.proxies) {
    const p = m.getVerticesData(VertexBuffer.PositionKind)!; const cl = W.triClass.get(m)!;
    for (let t = 0; t < cl.length; t++) {
      const o = t * 9;
      const ax = p[o], ay = p[o + 1], az = p[o + 2], bx = p[o + 3], by = p[o + 4], bz = p[o + 5], cx = p[o + 6], cy = p[o + 7], cz = p[o + 8];
      // face normal y
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx_ = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz_ = ux * vy - uy * vx; const nl = Math.hypot(nx_, ny, nz_) || 1;
      if (Math.abs(ny / nl) < 0.6) continue;
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(den) < 1e-9) continue;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / step)), i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - x0) / step));
      const k0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - z0) / step)), k1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - z0) / step));
      for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * step, pz = z0 + (k + 0.5) * step;
        const w1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den, w2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den, w3 = 1 - w1 - w2;
        if (w1 < -0.001 || w2 < -0.001 || w3 < -0.001) continue;
        const h = w1 * ay + w2 * by + w3 * cy, j = k * nx + i;
        if (h > y[j] && h < 60) { y[j] = h; c[j] = cl[t] }
      }
    }
  }
  return { x0, z0, step, nx, nz, y, c };
}

/** Random cell centers of given classes, optionally within a radius of a point. */
export function sampleCells(W: World, classes: number[], n: number, rnd: () => number, near?: { x: number; z: number; r: number; min?: number }) {
  const g = W.grid, out: Vector3[] = [];
  for (let tries = 0; tries < n * 400 && out.length < n; tries++) {
    let i: number, k: number;
    if (near) { const a = rnd() * Math.PI * 2, r = (near.min || 0) + rnd() * (near.r - (near.min || 0)); i = Math.floor((near.x + Math.cos(a) * r - g.x0) / g.step); k = Math.floor((near.z + Math.sin(a) * r - g.z0) / g.step) }
    else { i = Math.floor(rnd() * g.nx); k = Math.floor(rnd() * g.nz) }
    if (i < 1 || k < 1 || i >= g.nx - 1 || k >= g.nz - 1) continue;
    const j = k * g.nx + i; if (!classes.includes(g.c[j])) continue;
    // require flat-ish neighbourhood
    const yy = g.y[j]; let ok = true; for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const jj = (k + dk) * g.nx + i + di; if (Math.abs(g.y[jj] - yy) > 1.2) ok = false }
    if (!ok) continue;
    out.push(new Vector3(g.x0 + (i + 0.5) * g.step + (rnd() - 0.5) * 2, yy, g.z0 + (k + 0.5) * g.step + (rnd() - 0.5) * 2));
  }
  return out;
}

// ── kit props (crates, cars, camp pieces) ──
// containers belong to one scene: cache per scene
const KITS = new WeakMap<Scene, Promise<AssetContainer>>();
export function loadKit(scene: Scene) {
  if (!KITS.has(scene)) KITS.set(scene, LoadAssetContainerAsync('/assets/kit.glb', scene, { pluginExtension: '.glb' }).then(c => { (scene as any)._kit = c; return c }));
  return KITS.get(scene)!;
}
export function prop(scene: Scene, name: string, pos: Vector3, yaw: number, csm: CascadedShadowGenerator | null, collide = true): TransformNode | null {
  const KIT: AssetContainer | undefined = (scene as any)._kit; if (!KIT) return null;
  const src = KIT.rootNodes.flatMap(n => [n, ...n.getDescendants(false)]).find(n => n.name === 'kit_' + name);
  if (!src) return null;
  const inst = KIT.instantiateModelsToScene(n => n, false, { doNotInstantiate: true, predicate: (e: any) => e === src || (typeof e.isDescendantOf === "function" ? (e.isDescendantOf(src) || src.isDescendantOf(e)) : true) });
  const root = new TransformNode('prop_' + name, scene);
  for (const r of inst.rootNodes) { r.parent = root }
  // instantiate keeps the template's ancestry; find the cloned node by name and reparent it
  const clone = root.getDescendants(false).find(n => n.name.endsWith('kit_' + name)) as TransformNode | undefined;
  if (clone && clone.parent !== root) { clone.parent = root; for (const r of inst.rootNodes) if (r !== clone && !clone.isDescendantOf(r as any)) r.dispose() }
  root.position.copyFrom(pos); root.rotation.y = yaw;
  for (const m of root.getChildMeshes(false)) {
    const mt: any = m.material;
    if (mt && !mt._weathered && scene.metadata?.weather !== false) {   // the kit is bright and toy-like: grime it to sit in the photo-real map
      mt._weathered = true;
      if (mt.albedoColor) { const c = mt.albedoColor, g = (c.r + c.g + c.b) / 3; c.set((g + (c.r - g) * 0.45) * 0.62, (g + (c.g - g) * 0.45) * 0.6, (g + (c.b - g) * 0.45) * 0.56) }
      if (mt.roughness !== undefined) mt.roughness = Math.max(0.75, mt.roughness ?? 1);
    }
    m.receiveShadows = true; if (csm) csm.addShadowCaster(m, false);
    m.checkCollisions = collide; m.isPickable = true; (m as any)._hx = true; (m as any)._prop = root;
  }
  return root;
}
