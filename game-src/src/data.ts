// Holdout — static game data: items, upgrades, mission templates, names.

export type ItemId = 'food' | 'water' | 'meds' | 'ammoR' | 'ammoP' | 'scrap' | 'parts' | 'fuel' | 'intel';
export interface ItemDef { id: ItemId; name: string; kg: number; icon: string; desc: string }
export const ITEMS: Record<ItemId, ItemDef> = {
  food:  { id: 'food',  name: 'Canned food',   kg: 0.5, icon: '▤', desc: 'Feeds one resident for a day.' },
  water: { id: 'water', name: 'Water',         kg: 1.0, icon: '◍', desc: 'One resident, one day.' },
  meds:  { id: 'meds',  name: 'Med kit',       kg: 0.4, icon: '✚', desc: 'Restores 60 health. [4] in the field.' },
  ammoR: { id: 'ammoR', name: '5.45 rounds',   kg: 0.012, icon: '⁞', desc: 'AKS-74U ammunition.' },
  ammoP: { id: 'ammoP', name: '.45 rounds',    kg: 0.015, icon: '⁚', desc: 'MK23 ammunition.' },
  scrap: { id: 'scrap', name: 'Scrap metal',   kg: 1.5, icon: '▧', desc: 'Builds and repairs the shelter.' },
  parts: { id: 'parts', name: 'Components',    kg: 0.6, icon: '⚙', desc: 'Electronics, valves, wiring.' },
  fuel:  { id: 'fuel',  name: 'Fuel',          kg: 2.0, icon: '⛽', desc: 'Runs the generator for a day.' },
  intel: { id: 'intel', name: 'Intel',         kg: 0.1, icon: '✉', desc: 'Maps and notes. Unlocks better runs.' },
};
export const PACK_KG = 22;

export interface UpgradeDef { id: string; name: string; max: number; desc: (lvl: number) => string; cost: (lvl: number) => Partial<Record<ItemId, number>> }
export const UPGRADES: UpgradeDef[] = [
  { id: 'purifier', name: 'Water purifier', max: 3, desc: l => `+${2 * l} water / day`, cost: l => ({ scrap: 4 + 4 * l, parts: 2 + 2 * l }) },
  { id: 'garden', name: 'Hydroponics', max: 3, desc: l => `+${2 * l} food / day`, cost: l => ({ scrap: 3 + 3 * l, parts: 2 + 3 * l, water: 2 }) },
  { id: 'infirmary', name: 'Infirmary', max: 2, desc: l => l ? `Residents heal ${15 + 15 * l}/day · you start raids at full health` : 'Residents heal slowly', cost: l => ({ scrap: 4 + 4 * l, meds: 2 + l }) },
  { id: 'workshop', name: 'Workshop', max: 2, desc: l => l ? `Press ammo: 1 scrap → ${15 * l} rounds` : 'No ammo press', cost: l => ({ scrap: 6 + 4 * l, parts: 3 + 2 * l }) },
  { id: 'radio', name: 'Radio mast', max: 2, desc: l => `${3 + l} runs on the board · ${l ? 'second extraction point' : 'one extraction point'}`, cost: l => ({ scrap: 5 + 3 * l, parts: 4 + 3 * l, intel: 1 + l }) },
  { id: 'generator', name: 'Generator', max: 1, desc: l => l ? 'Lights on: morale holds, workshop runs faster' : 'Dark corridors', cost: () => ({ scrap: 8, parts: 4, fuel: 2 }) },
];

export type MissionKind = 'loot' | 'rescue' | 'raid';
export const MISSION_TEXT: Record<MissionKind, { title: string[]; brief: string }> = {
  loot: { title: ['Supply run', 'Scavenge the blocks', 'Pharmacy sweep', 'Truck stop'], brief: 'Search containers in the marked blocks. Take what you can carry. Extract.' },
  rescue: { title: ['Distress call', 'Stranded family', 'Last signal', 'Rooftop flare'], brief: 'A survivor is holed up nearby. Reach them, then bring them home alive.' },
  raid: { title: ['Hit the camp', 'Take their cache', 'Settlement raid'], brief: 'Raiders hold a camp by the expressway. Clear it and take their stockpile.' },
};

export const FIRST = ['Ana', 'Marco', 'Dee', 'Hollis', 'Rosa', 'Teo', 'June', 'Silas', 'Inez', 'Gabe', 'Nadia', 'Ray', 'Luz', 'Owen', 'Pilar', 'Cass', 'Abel', 'Mara', 'Joaquín', 'Bea'];
export const ROLE = ['mechanic', 'nurse', 'cook', 'electrician', 'teacher', 'courier', 'welder', 'medic', 'farmer', 'radio op'];
export const pick = <T,>(a: T[], r = Math.random) => a[Math.floor(r() * a.length)];
