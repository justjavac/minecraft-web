// 酿造台与药水：水瓶 + 材料 → 药水（燃料烈焰粉，MC 20 秒一轮、1 粉酿 20 轮）。纯数据逻辑（可单测）

import { spawnMaterialDrop } from './items';
import { addStackToSlots, type Slot } from './slots';

export interface PotionDef {
  name: string;
  /** 饮用效果（null = 无效果的基础药水；键名与 lib/effects.ts 一致） */
  effect: 'speed' | 'strength' | 'healing' | 'fireRes' | 'regen' | 'waterBreath' | null;
  /** 效果持续秒数（治疗为瞬发，0） */
  duration: number;
  /** II 级增强版（荧石粉酿造；缺省 I 级） */
  lvl?: 2;
}

export const POTIONS: Record<string, PotionDef> = {
  water_bottle: { name: '水瓶', effect: null, duration: 0 },
  awkward: { name: '粗制药水', effect: null, duration: 0 },
  speed: { name: '迅捷药水', effect: 'speed', duration: 180 },
  speed_ext: { name: '迅捷药水（延长）', effect: 'speed', duration: 480 }, // MC 3:00 → 8:00
  speed_2: { name: '迅捷药水 II', effect: 'speed', duration: 90, lvl: 2 },
  strength: { name: '力量药水', effect: 'strength', duration: 180 },
  strength_ext: { name: '力量药水（延长）', effect: 'strength', duration: 480 },
  strength_2: { name: '力量药水 II', effect: 'strength', duration: 90, lvl: 2 },
  healing: { name: '治疗药水', effect: 'healing', duration: 0 },
  healing_2: { name: '治疗药水 II', effect: 'healing', duration: 0, lvl: 2 }, // 瞬回 4 心（MC）
  fire_res: { name: '抗火药水', effect: 'fireRes', duration: 180 },
  fire_res_ext: { name: '抗火药水（延长）', effect: 'fireRes', duration: 480 }, // 抗火无 II 级（MC）
  regeneration: { name: '再生药水', effect: 'regen', duration: 30 },
  regeneration_ext: { name: '再生药水（延长）', effect: 'regen', duration: 80 },
  regeneration_2: { name: '再生药水 II', effect: 'regen', duration: 15, lvl: 2 },
  water_breathing: { name: '水肺药水', effect: 'waterBreath', duration: 180 },
  water_breathing_ext: { name: '水肺药水（延长）', effect: 'waterBreath', duration: 480 }, // 水肺无 II 级（MC）
};

/** 酿造配方：'<药水>+<材料>' → 药水（MC 核心链：水瓶→粗制→效果药；红石延时 ×8/3、荧石粉 II 级时长减半） */
export const BREWING: Record<string, string> = {
  'water_bottle+nether_wart': 'awkward',
  'awkward+sugar': 'speed',
  'awkward+blaze_powder': 'strength',
  'awkward+glistering_melon': 'healing',
  'awkward+magma_cream': 'fire_res',
  'awkward+ghast_tear': 'regeneration',
  'awkward+pufferfish': 'water_breathing',
  // 二级酿造：红石粉延时（MC：延时版与增强版互不兼容，故无 ext+荧石粉 / 2+红石）
  'speed+redstone': 'speed_ext',
  'strength+redstone': 'strength_ext',
  'fire_res+redstone': 'fire_res_ext',
  'regeneration+redstone': 'regeneration_ext',
  'water_breathing+redstone': 'water_breathing_ext',
  'speed+glowstone_dust': 'speed_2',
  'strength+glowstone_dust': 'strength_2',
  'healing+glowstone_dust': 'healing_2',
  'regeneration+glowstone_dust': 'regeneration_2',
};

export const BREW_TIME = 20; // MC 20 秒一轮
export const FUEL_USES = 20; // 一份烈焰粉酿 20 轮（MC）

const INGREDIENTS = ['nether_wart', 'sugar', 'blaze_powder', 'glistering_melon', 'magma_cream', 'ghast_tear', 'pufferfish', 'redstone', 'glowstone_dust'];

export interface BrewStack {
  item: string;
  count: number;
}

export interface BrewState {
  /** 材料槽（酿造材料，见 INGREDIENTS） */
  ingredient: BrewStack | null;
  /** 燃料槽（烈焰粉） */
  fuel: BrewStack | null;
  /** 3 个药水槽（item = 药水 key；不堆叠，count 恒 1） */
  potions: (BrewStack | null)[];
  /** 剩余可酿轮数（>0 即已点燃） */
  burnLeft: number;
  /** 当前轮进度（秒） */
  progress: number;
}

/** 世界内所有酿造台，key = "x,y,z" */
export const brews = new Map<string, BrewState>();

export function getBrew(key: string): BrewState {
  let b = brews.get(key);
  if (!b) {
    b = { ingredient: null, fuel: null, potions: [null, null, null], burnLeft: 0, progress: 0 };
    brews.set(key, b);
  }
  return b;
}

export function clearBrews(): void {
  brews.clear();
}

/**
 * 从热键栏 slotIndex 移 1 个进酿造台：烈焰粉进燃料槽、酿造材料进材料槽、药水进空药水槽。
 * 返回去向（'fuel' | 'ingredient' | 'potion' | null）
 */
export function putIntoBrewing(slots: Slot[], slotIndex: number, b: BrewState): { slots: Slot[]; to: 'fuel' | 'ingredient' | 'potion' | null } {
  const slot = slots[slotIndex];
  if (!slot || slot.kind !== 'material' || slot.count <= 0) return { slots, to: null };
  const m = slot.material;
  let to: 'fuel' | 'ingredient' | 'potion' | null = null;
  if (m === 'blaze_powder' && (!b.fuel || b.fuel.count < 64)) {
    b.fuel = b.fuel ? { item: 'blaze_powder', count: b.fuel.count + 1 } : { item: 'blaze_powder', count: 1 };
    to = 'fuel';
  } else if (INGREDIENTS.includes(m) && (!b.ingredient || (b.ingredient.item === m && b.ingredient.count < 64))) {
    b.ingredient = b.ingredient ? { item: m, count: b.ingredient.count + 1 } : { item: m, count: 1 };
    to = 'ingredient';
  } else if (POTIONS[m]) {
    const empty = b.potions.findIndex((p) => p === null);
    if (empty >= 0) {
      b.potions[empty] = { item: m, count: 1 };
      to = 'potion';
    }
  }
  if (!to) return { slots, to: null };
  const next = [...slots];
  next[slotIndex] = slot.count > 1 ? ({ ...slot, count: slot.count - 1 } as Slot) : null;
  return { slots: next, to };
}

/** 取出药水槽 i 的药水到热键栏（放不下则留在槽里） */
export function takePotion(slots: Slot[], b: BrewState, i: number): Slot[] {
  const p = b.potions[i];
  if (!p) return slots;
  const out = addStackToSlots(slots, { kind: 'material', material: p.item }, 1);
  if (out.leftover === 0) b.potions[i] = null;
  return out.slots;
}

/** 每帧推进所有酿造台（20 秒一轮，同槽多瓶同步转化——MC 一致） */
export function tickBrewing(dt: number): void {
  for (const b of brews.values()) {
    const outs = b.ingredient ? b.potions.map((p) => (p ? BREWING[`${p.item}+${b.ingredient!.item}`] : undefined)) : [];
    if (!outs.some(Boolean)) {
      b.progress = 0;
      continue;
    }
    if (b.burnLeft <= 0) {
      if (!b.fuel || b.fuel.item !== 'blaze_powder') continue;
      b.fuel.count -= 1;
      if (b.fuel.count <= 0) b.fuel = null;
      b.burnLeft = FUEL_USES;
    }
    b.progress += dt;
    if (b.progress >= BREW_TIME) {
      b.progress = 0;
      b.burnLeft -= 1;
      b.ingredient!.count -= 1;
      if (b.ingredient!.count <= 0) b.ingredient = null;
      b.potions = b.potions.map((p, i) => (p && outs[i] ? { item: outs[i]!, count: 1 } : p));
    }
  }
}

/** 酿造台被破坏：掉落内容物并清除状态 */
export function dropBrewingContents(key: string, x: number, y: number, z: number): void {
  const b = brews.get(key);
  if (!b) return;
  for (const stack of [b.ingredient, b.fuel, ...b.potions]) {
    if (stack) spawnMaterialDrop(stack.item, x + 0.5, y + 0.5, z + 0.5, stack.count);
  }
  brews.delete(key);
}
