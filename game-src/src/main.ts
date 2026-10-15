// Holdout — boot + flow: title → shelter → run → debrief → next day.
import '@babylonjs/loaders/glTF';
import { Scene, UniversalCamera, Vector3, Engine } from '@babylonjs/core';
import { makeEngine, zoneLook, Q, QS, Look } from './render';
import { load, store, wipe, newSave, advanceDay, newResident, Save, Mission } from './save';
import { ItemId, ITEMS } from './data';
import { initInput, I, lock, unlock, endFrame, setLockHandler } from './input';
import { initAudio, ambience, sfx, setVolume } from './audio';
import { loadWorld, World } from './world';
import { Raid, RaidResult } from './raid';
import { Hub, renderHub, resetLoadout } from './hub';
import * as UI from './ui';

const canvas = document.getElementById('c') as HTMLCanvasElement;
let save: Save = load();
const qParam = new URLSearchParams(location.search).get('q');
const q: Q = (QS as any)[qParam || ''] ? qParam as Q : (QS as any)[save.settings.quality] ? save.settings.quality as Q : 'high';
const engine: Engine = makeEngine(canvas, q);
initInput(canvas); UI.buildCompass();
let mode: 'title' | 'hub' | 'raid' | 'debrief' = 'title';
let hub: Hub | null = null, raidScene: Scene | null = null, W: World | null = null, rcam: UniversalCamera | null = null, look: Look | null = null, raid: Raid | null = null, paused = false;

let hubP: Promise<Hub> | null = null;
function ensureHub() {
  if (!hubP) hubP = (async () => {
    UI.loading('Opening the shelter…');
    const h = new Hub(engine, q); await h.build(); h.residents(save);
    await h.scene.whenReadyAsync(); hub = h; UI.loading(null); return h;
  })();
  return hubP;
}
async function ensureRaidScene() {
  if (raidScene) return;
  const s = raidScene = new Scene(engine); s.useRightHandedSystem = true; s.collisionsEnabled = true; s.skipPointerMovePicking = true;
  rcam = new UniversalCamera('rc', new Vector3(0, 2, 0), s); rcam.minZ = 0.05; rcam.maxZ = 1600; rcam.inputs.clear();
  rcam.fov = save.settings.fov * Math.PI / 180 * 0.78;
  look = zoneLook(s, rcam, q);
  W = await loadWorld(s, look.csm, QS[q].hd, t => UI.loading('Heading topside…', t));
}
function toHub() {
  mode = 'hub'; I.enabled = false; unlock(); UI.screen('hub'); ambience('hum');
  hub!.residents(save);
  renderHub(save, deploy, () => hub!.residents(save));
}
async function deploy(m: Mission, lo: Partial<Record<ItemId, number>>) {
  initAudio(); sfx('door');
  for (const [k, n] of Object.entries(lo)) save.stash[k as ItemId] -= n || 0;
  save.stats.runs++; store(save);
  UI.screen(null); UI.loading('Heading topside…', m.title);
  await ensureRaidScene();
  raid = new Raid(raidScene!, W!, rcam!, look!, save, m, engine);
  raid.onEnd = r => setTimeout(() => debrief(r), r.extracted ? 600 : 1200);
  await raid.start(lo, t => UI.loading('Heading topside…', t));
  await raidScene!.whenReadyAsync();
  UI.loading(null); mode = 'raid'; I.enabled = true; paused = false; resetLoadout();
  if (!I.touch) UI.screen('clickToPlay');
}
function debrief(r: RaidResult) {
  mode = 'debrief'; I.enabled = false; unlock(); ambience(null);
  const lines: string[] = [];
  if (r.extracted) {
    for (const [k, n] of Object.entries(r.pack)) if (n) { save.stash[k as ItemId] = (save.stash[k as ItemId] || 0) + n; const net = n - (r.loadout[k as ItemId] || 0); if (net > 0) lines.push(`${ITEMS[k as ItemId].icon} +${net} ${ITEMS[k as ItemId].name}`) }
    for (let i = 0; i < r.rescued; i++) { const nr = newResident(save.day); save.residents.push(nr); lines.push(`✦ ${nr.name} (${nr.role}) joined the shelter`) }
    save.stats.extracted++; save.stats.rescued += r.rescued;
    save.log.unshift(`Day ${save.day}. ${r.mission.title}: extracted${r.objective ? ', objective done' : ''}.`);
  } else { save.stats.died++; save.log.unshift(`Day ${save.day}. ${r.mission.title}: you went down. The pack was lost; they dragged you back.`) }
  save.stats.kills += r.kills;
  const report = advanceDay(save);
  const over = save.residents.length === 0;
  store(save);
  raid?.dispose(); raid = null;
  const d = document.getElementById('debrief')!;
  d.innerHTML = `<div class="db"><em>${r.mission.title.toUpperCase()}</em><h1 class="${r.extracted ? 'ok' : 'kia'}">${r.extracted ? 'EXTRACTED' : 'DOWN'}</h1>
    <div class="dbg"><div><h3>${r.extracted ? 'FOUND' : 'LOST'}</h3>${r.extracted ? (lines.length ? lines.map(l => `<p>${l}</p>`).join('') : '<p class="dim">Nothing new.</p>') : Object.entries(r.loadout).filter(([, n]) => n).map(([k, n]) => `<p class="dim">${ITEMS[k as ItemId].icon} ${n} ${ITEMS[k as ItemId].name}</p>`).join('') || '<p class="dim">Nothing.</p>'}</div>
    <div><h3>RUN</h3><p>Time ${Math.floor(r.time / 60)}:${String(Math.floor(r.time % 60)).padStart(2, '0')}</p><p>Kills ${r.kills}</p><p>Objective ${r.objective ? 'complete' : 'incomplete'}</p></div>
    <div><h3>DAY ${save.day}</h3>${report.map(l => `<p>${l}</p>`).join('') || '<p class="dim">Quiet night.</p>'}</div></div>
    ${over ? `<h2 class="kia">The shelter is empty. The Holdout has fallen.</h2><button data-new="1">START OVER</button>` : `<button data-cont="1">BACK TO THE SHELTER</button>`}</div>`;
  UI.screen('debrief');
  d.onclick = async e => { const b = (e.target as HTMLElement).closest('button'); if (!b) return; sfx('ui'); if (b.dataset.new) { wipe(); save = newSave(); store(save) } toHub() };
}

// ── title ──
function title() {
  const t = document.getElementById('title')!; t.style.display = 'flex';
  (document.getElementById('cont') as HTMLButtonElement).textContent = save.stats.runs ? `CONTINUE · DAY ${save.day}` : 'ENTER THE SHELTER';
  settingsForm(document.getElementById('tSettings')!);
}
document.getElementById('title')!.onclick = async e => {
  const b = (e.target as HTMLElement).closest('button'); if (!b) return; initAudio(); sfx('ui');
  if (b.id === 'cont' || b.id === 'newg') {
    if (b.id === 'newg') { if (save.stats.runs && !confirmNew()) return; wipe(); save = newSave(); store(save) }
    document.getElementById('title')!.style.display = 'none';
    await ensureHub(); toHub();
  }
};
let confirmT = 0; function confirmNew() { const b = document.getElementById('newg')!; if (Date.now() - confirmT < 3000) return true; confirmT = Date.now(); b.textContent = 'TAP AGAIN TO WIPE THE SAVE'; setTimeout(() => b.textContent = 'NEW GAME', 3000); return false }
function settingsForm(box: HTMLElement) {
  const s = save.settings;
  box.innerHTML = `<label>Mouse sensitivity<input type="range" min="0.3" max="2.5" step="0.05" value="${s.sens}" data-k="sens"><b>${s.sens}</b></label>
    <label>Field of view<input type="range" min="60" max="100" step="1" value="${s.fov}" data-k="fov"><b>${s.fov}°</b></label>
    <label>Volume<input type="range" min="0" max="1" step="0.05" value="${s.vol}" data-k="vol"><b>${Math.round(s.vol * 100)}%</b></label>
    <label>Graphics<span class="qs">${(['low', 'med', 'high', 'ultra'] as Q[]).map(k => `<button data-q="${k}" class="${k === s.quality ? 'on' : ''}">${k}</button>`).join('')}</span></label>`;
  box.oninput = e => { const i = e.target as HTMLInputElement; const k = i.dataset.k as 'sens' | 'fov' | 'vol'; if (!k) return; (s as any)[k] = +i.value; (i.nextElementSibling as HTMLElement).textContent = k === 'fov' ? i.value + '°' : k === 'vol' ? Math.round(+i.value * 100) + '%' : i.value; apply(); store(save) };
  box.onclick = e => { const b = (e.target as HTMLElement).closest('button'); if (b?.dataset.q && b.dataset.q !== s.quality) { s.quality = b.dataset.q; store(save); location.reload() } };
}
function apply() { setVolume(save.settings.vol); if (raid) raid.P.sens = save.settings.sens; if (rcam) rcam.fov = save.settings.fov * Math.PI / 180 * 0.78 }

// ── pause ──
setLockHandler(l => { if (mode === 'raid' && !l && !raid?.done && !I.touch) setPause(true); if (l && mode === 'raid') { setPause(false); UI.screen(null) } });
UI.onPause(on => setPause(on));
function setPause(on: boolean) { if (paused === on) { if (on) settingsForm(document.getElementById('pSettings')!); } paused = on; document.getElementById('pause')!.style.display = on ? 'flex' : 'none'; if (on) settingsForm(document.getElementById('pSettings')!) }
document.getElementById('pause')!.onclick = e => {
  const b = (e.target as HTMLElement).closest('button'); if (!b) return; sfx('ui');
  if (b.dataset.resume) { setPause(false); lock() }
  if (b.dataset.abandon) { setPause(false); raid?.P.damage(999, null); raid?.finish(false) }
};
document.getElementById('clickToPlay')!.onclick = () => { initAudio(); lock(); UI.screen(null) };

// ── loop ──
engine.runRenderLoop(() => {
  const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
  if (mode === 'raid' && raid && raidScene) {
    if (!paused) { raid.update(dt); if (I.pressed.has('Escape')) setPause(true) }
    raidScene.render();
  } else if (hub) hub.scene.render();
  endFrame();
});
addEventListener('resize', () => engine.resize());
setVolume(save.settings.vol);
title();
ensureHub().then(() => { if (mode === 'title') { ambience(null) } });
(window as any).__I = I; (window as any).__game = { get raid() { return raid }, get save() { return save }, get W() { return W }, get mode() { return mode }, engine, deploy: (i = 0) => deploy(save.missions[i], { ammoR: Math.min(150, save.stash.ammoR), ammoP: Math.min(48, save.stash.ammoP), meds: Math.min(2, save.stash.meds) }), ensureHub, toHub, setPause };
