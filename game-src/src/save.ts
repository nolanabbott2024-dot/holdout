// Holdout — persistent shelter state (localStorage) and the day/upkeep rules.
import { ItemId, UPGRADES, FIRST, ROLE, pick, MissionKind, MISSION_TEXT } from './data';

export interface Resident { name: string; role: string; hp: number; joined: number }
export interface Mission { id: string; kind: MissionKind; title: string; danger: number; seed: number; reward: string }
export interface Save {
  v: number; day: number; hp: number;
  stash: Record<ItemId, number>;
  upgrades: Record<string, number>;
  residents: Resident[];
  missions: Mission[];
  log: string[];
  stats: { runs: number; extracted: number; died: number; kills: number; rescued: number };
  settings: { sens: number; fov: number; quality: string; vol: number };
}
const KEY = 'holdout2-save';

export function newSave(): Save {
  const s: Save = {
    v: 1, day: 1, hp: 100,
    stash: { food: 6, water: 6, meds: 2, ammoR: 90, ammoP: 36, scrap: 3, parts: 1, fuel: 0, intel: 0 },
    upgrades: {}, residents: [], missions: [], log: [],
    stats: { runs: 0, extracted: 0, died: 0, kills: 0, rescued: 0 },
    settings: { sens: 1, fov: 72, quality: /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? 'med' : 'high', vol: 0.8 },
  };
  for (let i = 0; i < 3; i++) s.residents.push(newResident(1));
  s.log.unshift('Day 1. The blast doors held. Three of us made it down.');
  rollMissions(s);
  return s;
}
export function newResident(day: number): Resident { return { name: pick(FIRST), role: pick(ROLE), hp: 100, joined: day } }

export function load(): Save {
  try { const t = localStorage.getItem(KEY); if (t) { const s = JSON.parse(t); if (s && s.v === 1) return s } } catch { }
  return newSave();
}
export function store(s: Save) { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { } }
export function wipe() { try { localStorage.removeItem(KEY) } catch { } }

export const lvl = (s: Save, id: string) => s.upgrades[id] || 0;

export function rollMissions(s: Save) {
  const n = 3 + lvl(s, 'radio');
  const kinds: MissionKind[] = ['loot', 'rescue', 'raid'];
  s.missions = [];
  for (let i = 0; i < n; i++) {
    const kind = i < 3 ? kinds[i] : pick(kinds);
    const danger = Math.min(5, 1 + Math.floor((s.day - 1) / 3) + (kind === 'raid' ? 1 : 0) + (Math.random() < 0.3 ? 1 : 0));
    const reward = kind === 'loot' ? 'Supplies' : kind === 'rescue' ? '+1 resident' : 'Raider stockpile';
    s.missions.push({ id: Math.random().toString(36).slice(2, 8), kind, title: pick(MISSION_TEXT[kind].title), danger, seed: (Math.random() * 1e9) | 0, reward });
  }
}

export function canAfford(s: Save, cost: Partial<Record<ItemId, number>>) { return Object.entries(cost).every(([k, v]) => (s.stash[k as ItemId] || 0) >= (v || 0)) }
export function pay(s: Save, cost: Partial<Record<ItemId, number>>) { for (const [k, v] of Object.entries(cost)) s.stash[k as ItemId] -= v || 0 }

/** End of a day: production, upkeep, healing. Returns report lines. */
export function advanceDay(s: Save): string[] {
  const out: string[] = [];
  s.day++;
  const pw = 2 * lvl(s, 'purifier'), pf = 2 * lvl(s, 'garden');
  if (pw) { s.stash.water += pw; out.push(`Purifier: +${pw} water`) }
  if (pf) { s.stash.food += pf; out.push(`Hydroponics: +${pf} food`) }
  const n = s.residents.length;
  let hungry = 0, thirsty = 0;
  for (const r of s.residents) {
    if (s.stash.food > 0) s.stash.food--; else { hungry++; r.hp -= 20 }
    if (s.stash.water > 0) s.stash.water--; else { thirsty++; r.hp -= 30 }
    const heal = lvl(s, 'infirmary') ? 15 + 15 * lvl(s, 'infirmary') : 5;
    r.hp = Math.min(100, r.hp + heal);
  }
  if (n) out.push(`${n} residents ate and drank`);
  if (hungry) out.push(`${hungry} went hungry`);
  if (thirsty) out.push(`${thirsty} went thirsty`);
  const lost = s.residents.filter(r => r.hp <= 0);
  for (const r of lost) out.push(`${r.name} didn't make it.`);
  s.residents = s.residents.filter(r => r.hp > 0);
  if (lvl(s, 'generator') && s.stash.fuel > 0) { s.stash.fuel--; out.push('Generator burned 1 fuel') }
  s.hp = lvl(s, 'infirmary') ? 100 : Math.min(100, s.hp + 35);
  rollMissions(s);
  for (const l of out.slice().reverse()) s.log.unshift(`Day ${s.day}. ${l}`);
  s.log = s.log.slice(0, 40);
  return out;
}
export { UPGRADES };
