// Holdout — rendering presets: overcast Zone look for raids, warm bunker look for the hub.
import {
  Engine, Scene, Color3, Color4, Vector3, HDRCubeTexture, DirectionalLight, HemisphericLight, CascadedShadowGenerator,
  DefaultRenderingPipeline, SSAO2RenderingPipeline, SSRRenderingPipeline, ImageProcessingConfiguration, ColorCurves,
  Camera, Constants, ParticleSystem, DynamicTexture, BaseTexture,
} from '@babylonjs/core';

export type Q = 'low' | 'med' | 'high' | 'ultra';
export const QS: Record<Q, { scale: number; shadow: number; casc: number; ssao: boolean; ssr: boolean; msaa: number; dust: number; mist: number; hd: boolean }> = {
  low:   { scale: 1.5, shadow: 1024, casc: 2, ssao: false, ssr: false, msaa: 1, dust: 150, mist: 25, hd: false },
  med:   { scale: 1.0, shadow: 2048, casc: 3, ssao: true,  ssr: false, msaa: 1, dust: 300, mist: 50, hd: true },
  high:  { scale: 1.0, shadow: 2048, casc: 4, ssao: true,  ssr: true,  msaa: 1, dust: 500, mist: 70, hd: true },
  ultra: { scale: 1 / Math.min(2, devicePixelRatio || 1), shadow: 4096, casc: 4, ssao: true, ssr: true, msaa: 4, dust: 800, mist: 100, hd: true },
};
export const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

let skyTex: BaseTexture | null = null;
export function sky(scene: Scene) {
  // one HDR per scene (textures belong to a scene)
  return new HDRCubeTexture('/lab/assets/sky.hdr', scene, 512, false, true, false, true);
}

export function softDot(scene: Scene, name: string, size: number, hard: number) {
  const t = new DynamicTexture(name, size, scene, false); const g = t.getContext() as CanvasRenderingContext2D;
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(hard, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size); t.update(); t.hasAlpha = true; return t;
}

export interface Look { pp: DefaultRenderingPipeline; csm: CascadedShadowGenerator | null; sun: DirectionalLight | null }

/** Overcast outdoor look (raid). */
export function zoneLook(scene: Scene, cam: Camera, q: Q): Look {
  const C = QS[q];
  const FOG = new Color3(0.56, 0.60, 0.63);
  scene.clearColor = new Color4(FOG.r, FOG.g, FOG.b, 1);
  scene.fogMode = Scene.FOGMODE_EXP2; scene.fogDensity = 0.0062; scene.fogColor = FOG;
  const env = sky(scene); scene.environmentTexture = env; scene.environmentIntensity = 0.85;
  const sk = scene.createDefaultSkybox(env, true, 1500, 0.35, false)!; sk.applyFog = false; sk.infiniteDistance = true; sk.isPickable = false;
  const sun = new DirectionalLight('sun', new Vector3(-0.35, -1, 0.55).normalize(), scene);
  sun.intensity = 1.6; sun.diffuse = new Color3(1.0, 0.96, 0.9); sun.shadowMinZ = -80; sun.shadowMaxZ = 300;
  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.25; hemi.diffuse = new Color3(0.75, 0.8, 0.86); hemi.groundColor = new Color3(0.2, 0.19, 0.18); hemi.specular = Color3.Black();
  const csm = new CascadedShadowGenerator(C.shadow, sun);
  csm.numCascades = C.casc; csm.lambda = 0.85; csm.shadowMaxZ = 140; csm.stabilizeCascades = true;
  csm.usePercentageCloserFiltering = true; csm.filteringQuality = C.shadow >= 2048 ? 2 : 1;
  csm.darkness = 0.45; csm.bias = 0.004; csm.normalBias = 0.02;
  const pp = post(scene, cam, q, { exposure: 1.05, contrast: 1.18, sat: -28 });
  // dust motes + ground mist follow the camera
  const dust = new ParticleSystem('dust', C.dust, scene);
  dust.particleTexture = softDot(scene, 'dot', 32, 0.3);
  dust.emitter = cam.position; dust.minEmitBox = new Vector3(-14, -1.6, -14); dust.maxEmitBox = new Vector3(14, 3, 14);
  dust.color1 = new Color4(0.85, 0.82, 0.74, 0.5); dust.color2 = new Color4(0.7, 0.7, 0.68, 0.3); dust.colorDead = new Color4(0.7, 0.7, 0.7, 0);
  dust.minSize = 0.012; dust.maxSize = 0.035; dust.minLifeTime = 6; dust.maxLifeTime = 14; dust.emitRate = C.dust / 10;
  dust.direction1 = new Vector3(-0.05, -0.02, -0.05); dust.direction2 = new Vector3(0.08, 0.04, 0.06); dust.minEmitPower = 0.2; dust.maxEmitPower = 0.5;
  dust.gravity = new Vector3(0.04, -0.01, 0.02); dust.preWarmCycles = 100; dust.start();
  const mist = new ParticleSystem('mist', C.mist, scene);
  mist.particleTexture = softDot(scene, 'puff', 128, 0.05);
  const mistAt = new Vector3(); mist.emitter = mistAt as any;
  mist.minEmitBox = new Vector3(-60, 0.2, -60); mist.maxEmitBox = new Vector3(60, 1.4, 60);
  mist.color1 = new Color4(FOG.r * 1.05, FOG.g * 1.05, FOG.b * 1.05, 0.06); mist.color2 = new Color4(FOG.r, FOG.g, FOG.b, 0.045); mist.colorDead = new Color4(FOG.r, FOG.g, FOG.b, 0);
  mist.minSize = 7; mist.maxSize = 15; mist.minLifeTime = 25; mist.maxLifeTime = 45; mist.emitRate = C.mist / 30;
  mist.direction1 = new Vector3(-0.1, 0, -0.05); mist.direction2 = new Vector3(0.15, 0.01, 0.1); mist.minEmitPower = 0.3; mist.maxEmitPower = 0.6;
  mist.preWarmCycles = 250; mist.preWarmStepOffset = 4; mist.start();
  scene.onBeforeRenderObservable.add(() => { mistAt.set(cam.globalPosition.x, cam.globalPosition.y - 1.6, cam.globalPosition.z) });
  return { pp, csm, sun };
}

export function post(scene: Scene, cam: Camera, q: Q, o: { exposure: number; contrast: number; sat: number; warm?: boolean }) {
  const C = QS[q];
  if (C.ssao) {
    const ao = new SSAO2RenderingPipeline('ao', scene, { ssaoRatio: q === 'ultra' ? 1 : 0.5, blurRatio: 1 }, [cam], false);
    ao.radius = 1.4; ao.totalStrength = 1.1; ao.base = 0.08; ao.samples = q === 'ultra' ? 24 : 12; ao.maxZ = 100; ao.expensiveBlur = q === 'ultra';
  }
  if (C.ssr) {
    const ssr = new SSRRenderingPipeline('ssr', scene, [cam], false, Constants.TEXTURETYPE_UNSIGNED_BYTE);
    ssr.thickness = 0.35; ssr.step = q === 'ultra' ? 1 : 2; ssr.maxSteps = q === 'ultra' ? 260 : 150; ssr.maxDistance = 120;
    ssr.strength = 0.9; ssr.reflectionSpecularFalloffExponent = 2.2; ssr.roughnessFactor = 0.15;
    ssr.blurDispersionStrength = 0.025; ssr.enableSmoothReflections = true; ssr.attenuateScreenBorders = true; ssr.attenuateIntersectionDistance = true;
    ssr.selfCollisionNumSkip = 2; ssr.ssrDownsample = q === 'ultra' ? 0 : 1; ssr.blurDownsample = 1;
    ssr.inputTextureColorIsInGammaSpace = false; ssr.generateOutputInGammaSpace = false;
  }
  const pp = new DefaultRenderingPipeline('pp', true, scene, [cam]);
  pp.samples = C.msaa; pp.fxaaEnabled = C.msaa === 1; pp.imageProcessingEnabled = true;
  const ip = pp.imageProcessing;
  ip.toneMappingEnabled = true; ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  ip.exposure = o.exposure; ip.contrast = o.contrast;
  ip.vignetteEnabled = true; ip.vignetteWeight = 2.2; ip.vignetteStretch = 0.4; ip.vignetteColor = new Color4(0.02, 0.03, 0.03, 0);
  ip.colorCurvesEnabled = true;
  const cc = new ColorCurves(); cc.globalSaturation = o.sat;
  if (o.warm) { cc.shadowsHue = 25; cc.shadowsDensity = 18; cc.shadowsSaturation = 30; cc.highlightsHue = 35; cc.highlightsDensity = 20; cc.highlightsSaturation = 35 }
  else { cc.shadowsHue = 195; cc.shadowsDensity = 22; cc.shadowsSaturation = 35; cc.highlightsHue = 40; cc.highlightsDensity = 12; cc.highlightsSaturation = 20 }
  ip.colorCurves = cc;
  pp.bloomEnabled = true; pp.bloomThreshold = o.warm ? 0.7 : 0.85; pp.bloomWeight = o.warm ? 0.35 : 0.18; pp.bloomKernel = 64; pp.bloomScale = 0.5;
  pp.grainEnabled = true; pp.grain.intensity = 7; pp.grain.animated = true;
  pp.chromaticAberrationEnabled = q !== 'low'; pp.chromaticAberration.aberrationAmount = 4; pp.chromaticAberration.radialIntensity = 0.6;
  pp.sharpenEnabled = q !== 'low'; pp.sharpen.edgeAmount = 0.2;
  return pp;
}

export function makeEngine(canvas: HTMLCanvasElement, q: Q) {
  const e = new Engine(canvas, QS[q].msaa > 1, { stencil: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }, false);
  e.setHardwareScalingLevel(QS[q].scale);
  return e;
}
