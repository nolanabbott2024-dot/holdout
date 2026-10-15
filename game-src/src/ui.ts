// Holdout — DOM overlays: raid HUD (vitals, ammo, compass, markers, prompts, feed) and shared screen helpers.
const $ = (id: string) => document.getElementById(id)!;
export const el = (html: string) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild as HTMLElement };

import { mobile } from './render';
export function raidHud(on: boolean) { $('hud').style.display = on ? 'block' : 'none'; $('touch').style.display = on && mobile ? 'block' : 'none'; if (!on) { $('marks').innerHTML = ''; $('prompt').textContent = '' } }
export function objective(text: string, title: string) { $('objT').textContent = title.toUpperCase(); $('objX').textContent = text }
let feedN = 0;
export function feed(msg: string, warn = false) {
  const f = el(`<div class="fi${warn ? ' warn' : ''}">${msg}</div>`); $('feed').prepend(f); const id = ++feedN;
  setTimeout(() => f.classList.add('out'), 3600); setTimeout(() => f.remove(), 4300);
  while ($('feed').children.length > 6) $('feed').lastElementChild!.remove();
}
export function hurt(hp: number, dir: number) {
  const v = $('vign'); v.style.opacity = String(Math.min(1, 0.35 + (100 - hp) / 140)); v.classList.remove('flash'); void v.offsetWidth; v.classList.add('flash');
  const d = $('dmgDir'); d.style.transform = `rotate(${dir}rad)`; d.classList.remove('show'); void d.offsetWidth; d.classList.add('show');
}
export function hitmark(head: boolean, kill: boolean) { const h = $('hitm'); h.className = 'hitm show' + (head ? ' head' : '') + (kill ? ' kill' : ''); clearTimeout((h as any)._t); (h as any)._t = setTimeout(() => h.className = 'hitm', 160) }
let lastPrompt = '';
export function prompt(text: string, p: number) {
  if (text !== lastPrompt) { $('prompt').textContent = text; lastPrompt = text }
  $('promptBar').style.display = p > 0 ? 'block' : 'none'; ($('promptFill') as HTMLElement).style.width = Math.min(100, p * 100) + '%';
}
export function extract(p: number) { const e = $('extract'); e.style.display = p > 0 ? 'block' : 'none'; $('extractFill').style.width = Math.min(100, p * 100) + '%' }
let lastHud = '';
export function hud(s: { hp: number; st: number; mag: number; res: number; wpn: string; kg: number; max: number; meds: number; ads: number; reloading: boolean; heading: number }) {
  $('hpFill').style.width = s.hp + '%'; $('hpFill').classList.toggle('low', s.hp < 30); $('stFill').style.width = s.st * 100 + '%';
  const key = `${s.mag}|${s.res}|${s.wpn}|${Math.round(s.kg * 10)}|${s.meds}|${s.reloading}`;
  if (key !== lastHud) { lastHud = key; $('mag').textContent = s.reloading ? '··' : String(s.mag); $('res').textContent = '/ ' + s.res; $('wpn').textContent = s.wpn; $('kg').textContent = `PACK ${s.kg.toFixed(1)} / ${s.max} KG`; $('meds').textContent = `✚ ${s.meds}  [4]` }
  $('xh').style.opacity = String(1 - s.ads);
  // compass: heading in degrees, 0 = north (-z)
  const deg = ((-s.heading * 180 / Math.PI) % 360 + 360) % 360;
  $('compStrip').style.transform = `translateX(${-deg * 3}px)`;
  if (!s.st && s.hp) { }
  $('vign').style.opacity = String(Math.max(0, (60 - s.hp) / 90));
}
export function buildCompass() {
  const strip = $('compStrip'); let h = '';
  for (let d = -360; d <= 720; d += 15) { const n = ((d % 360) + 360) % 360; const lab = ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as any)[n]; h += `<i style="left:${d * 3}px" class="${lab ? 'card' : n % 45 ? '' : 'mid'}">${lab || (n % 45 ? '' : n)}</i>` }
  strip.innerHTML = h;
}
export function markers(list: { s: { x: number; y: number; front: boolean }; t: string; c: string; d: number; p: any }[], yaw: number, pos: any) {
  const box = $('marks'); while (box.children.length < list.length) box.appendChild(el('<div class="mk"><b></b><span></span></div>')); while (box.children.length > list.length) box.lastElementChild!.remove();
  const comp = $('compMarks'); while (comp.children.length < list.length) comp.appendChild(el('<i></i>')); while (comp.children.length > list.length) comp.lastElementChild!.remove();
  list.forEach((m, i) => {
    const e = box.children[i] as HTMLElement; e.className = 'mk ' + m.c; (e.children[0] as HTMLElement).textContent = m.t; (e.children[1] as HTMLElement).textContent = Math.round(m.d) + ' m';
    let x = m.s.x, y = m.s.y; if (!m.s.front) { x = x < 0.5 ? 0.97 : 0.03; y = 0.5 }
    x = Math.max(0.03, Math.min(0.97, x)); y = Math.max(0.08, Math.min(0.9, y));
    e.style.transform = `translate(${x * innerWidth}px,${y * innerHeight}px)`;
    // on the compass
    const dx = m.p.x - pos.x, dz = m.p.z - pos.z; const bearing = Math.atan2(dx, -dz) * 180 / Math.PI; const head = -yaw * 180 / Math.PI;
    let rel = ((bearing - head) % 360 + 540) % 360 - 180; const c = comp.children[i] as HTMLElement; c.className = m.c; c.style.left = `calc(50% + ${Math.max(-150, Math.min(150, rel * 3))}px)`;
  });
}
export function pause(on: boolean) { $('pause').style.display = on ? 'flex' : 'none'; pauseCb?.(on) }
let pauseCb: ((on: boolean) => void) | null = null;
export function onPause(f: (on: boolean) => void) { pauseCb = f }
export function screen(id: string | null) { for (const s of Array.from(document.querySelectorAll('.screen'))) (s as HTMLElement).style.display = s.id === id ? 'flex' : 'none' }
export function loading(text: string | null, sub = '') { const l = $('loading'); l.style.display = text === null ? 'none' : 'flex'; if (text !== null) { $('loadT').textContent = text; $('loadS').textContent = sub } }
