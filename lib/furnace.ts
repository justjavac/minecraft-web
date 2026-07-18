// 熔炉烧炼与食物：烧炼配方、燃料、炉状态、每帧推进。纯数据逻辑（可单测）

import { BLOCK_BY_KEY, COBBLE, GLASS, LOG, PLANKS, SAND, STONE } from './blocks';
import { spawnBlockDrop, spawnMaterialDrop } from './items';
import { addStackToSlots, type Slot } from './slots';

// ——— 食物（MC 回复量，饱和度按本游戏 /5 缩放） ———
export interface FoodDef {
  name: string;
  hunger: number;
  saturation: number;
}

export const FOODS: Record<string, FoodDef> = {
  raw_pork: { name: '生猪排', hunger: 3, saturation: 1 },
  cooked_pork: { name: '熟猪排', hunger: 8, saturation: 3 },
  raw_beef: { name: '生牛肉', hunger: 3, saturation: 1 },
  cooked_beef: { name: '熟牛排', hunger: 8, saturation: 3 },
  raw_chicken: { name: '生鸡肉', hunger: 2, saturation: 1 },
  cooked_chicken: { name: '熟鸡肉', hunger: 6, saturation: 2 },
};

// ——— 烧炼配方与燃料 ———

export interface SmeltDef {
  out: string; // 'block:<id>' | 'material:<name>'
  name: string;
}

const K = (key: string) => `block:${BLOCK_BY_KEY[key].id}`;

/** 输入 item → 输出（每件 10 秒，与 MC 一致） */
export const SMELTING: Record<string, SmeltDef> = {
  [`block:${COBBLE}`]: { out: `block:${STONE}`, name: '石头' },
  [`block:${SAND}`]: { out: `block:${GLASS}`, name: '玻璃' },
  [K('red_sand')]: { out: `block:${GLASS}`, name: '玻璃' },
  [`block:${LOG}`]: { out: 'material:charcoal', name: '木炭' },
  // 其他木材原木也可烧木炭（MC 一致）
  ...Object.fromEntries(
    (['spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry'] as const).map((w) => [
      K(`${w}_log`),
      { out: 'material:charcoal', name: '木炭' } satisfies SmeltDef,
    ]),
  ),
  'material:raw_pork': { out: 'material:cooked_pork', name: '熟猪排' },
  'material:raw_beef': { out: 'material:cooked_beef', name: '熟牛排' },
  'material:raw_chicken': { out: 'material:cooked_chicken', name: '熟鸡肉' },
  // 粗矿烧炼成锭（MC 一致）
  'material:raw_iron': { out: 'material:iron_ingot', name: '铁锭' },
  'material:raw_gold': { out: 'material:gold_ingot', name: '金锭' },
  'material:raw_copper': { out: 'material:copper_ingot', name: '铜锭' },
  // 石头系烧炼（MC：石头→平滑石头，石砖→裂纹石砖…）
  [K('stone')]: { out: K('smooth_stone'), name: '平滑石头' },
  [K('stone_bricks')]: { out: K('cracked_stone_bricks'), name: '裂纹石砖' },
  [K('sandstone')]: { out: K('smooth_sandstone'), name: '平滑砂岩' },
  [K('red_sandstone')]: { out: K('smooth_red_sandstone'), name: '平滑红砂岩' },
  [K('cobbled_deepslate')]: { out: K('deepslate'), name: '深板岩' },
  [K('deepslate_bricks')]: { out: K('cracked_deepslate_bricks'), name: '裂纹深板岩砖' },
  [K('deepslate_tiles')]: { out: K('cracked_deepslate_tiles'), name: '裂纹深板岩瓦' },
  [K('clay')]: { out: K('terracotta'), name: '陶瓦' },
};

/** 燃料燃烧秒数（MC：木板/原木 15s，木棍 5s，木炭 80s，干海带块 200s，煤块 800s） */
export const FUELS: Record<string, number> = {
  [`block:${PLANKS}`]: 15,
  [`block:${LOG}`]: 15,
  // 其他木材的木板/原木同为 15s（MC 一致）
  ...Object.fromEntries(
    (['spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry'] as const).flatMap((w) => [
      [K(`${w}_planks`), 15],
      [K(`${w}_log`), 15],
    ]),
  ),
  [K('dried_kelp_block')]: 200,
  [K('coal_block')]: 800,
  'material:stick': 5,
  'material:charcoal': 80,
  'material:coal': 80, // MC：煤 80s
};

export const SMELT_TIME = 10; // 秒/件

// ——— 炉状态 ———

export interface FurnaceStack {
  item: string; // 'block:<id>' | 'material:<name>'
  count: number;
}

export interface FurnaceState {
  input: FurnaceStack | null;
  fuel: FurnaceStack | null;
  output: FurnaceStack | null;
  /** 当前燃料剩余秒数（>0 表示正在燃烧） */
  burnLeft: number;
  /** 当前烧炼进度（秒） */
  progress: number;
}

/** 世界内所有熔炉，key = "x,y,z" */
export const furnaces = new Map<string, FurnaceState>();

export function getFurnace(key: string): FurnaceState {
  let f = furnaces.get(key);
  if (!f) {
    f = { input: null, fuel: null, output: null, burnLeft: 0, progress: 0 };
    furnaces.set(key, f);
  }
  return f;
}

export function clearFurnaces(): void {
  furnaces.clear();
}

function itemOf(slot: Slot): string | null {
  if (!slot || (slot.kind !== 'block' && slot.kind !== 'material')) return null;
  return slot.kind === 'block' ? `block:${slot.id}` : `material:${slot.material}`;
}

function mergeable(stack: FurnaceStack | null, item: string): boolean {
  return !stack || (stack.item === item && stack.count < 64);
}

/**
 * 从热键栏 slotIndex 移 1 个物品到熔炉：
 * 默认燃料进燃料槽、可烧炼物进输入槽；force 可指定去向（原木等双重身份物品）。
 * 返回去向（'input' | 'fuel' | null）
 */
export function putIntoFurnace(
  slots: Slot[],
  slotIndex: number,
  f: FurnaceState,
  force?: 'input' | 'fuel',
): { slots: Slot[]; to: 'input' | 'fuel' | null } {
  const slot = slots[slotIndex];
  if (!slot || (slot.kind !== 'block' && slot.kind !== 'material') || slot.count <= 0) return { slots, to: null };
  const item = itemOf(slot);
  if (!item) return { slots, to: null };
  let to: 'input' | 'fuel' | null = null;
  if (force) {
    const ok = force === 'fuel' ? FUELS[item] !== undefined && mergeable(f.fuel, item) : SMELTING[item] !== undefined && mergeable(f.input, item);
    if (ok) to = force;
  } else if (FUELS[item] !== undefined && mergeable(f.fuel, item)) {
    to = 'fuel';
  } else if (SMELTING[item] !== undefined && mergeable(f.input, item)) {
    to = 'input';
  }
  if (!to) return { slots, to: null };

  const next = [...slots];
  next[slotIndex] = slot.count > 1 ? ({ ...slot, count: slot.count - 1 } as Slot) : null;
  const target = to === 'fuel' ? f.fuel : f.input;
  const stack: FurnaceStack = target ? { item: target.item, count: target.count + 1 } : { item, count: 1 };
  if (to === 'fuel') f.fuel = stack;
  else f.input = stack;
  return { slots: next, to };
}

/** 取出全部输出到热键栏，放不下的留在炉里 */
export function takeOutput(slots: Slot[], f: FurnaceState): Slot[] {
  if (!f.output) return slots;
  const { item, count } = f.output;
  const [kind, idStr] = item.split(':');
  const out =
    kind === 'block'
      ? addStackToSlots(slots, { kind: 'block', id: Number(idStr) }, count)
      : addStackToSlots(slots, { kind: 'material', material: idStr }, count);
  f.output = out.leftover > 0 ? { item, count: out.leftover } : null;
  return out.slots;
}

function outputBlocked(f: FurnaceState, out: string): boolean {
  return f.output !== null && (f.output.item !== out || f.output.count >= 64);
}

/** 每帧推进所有熔炉（MC：10 秒一件，燃料按秒数燃烧） */
export function tickFurnaces(dt: number): void {
  for (const f of furnaces.values()) {
    if (!f.input || !SMELTING[f.input.item]) {
      f.progress = 0;
      if (f.burnLeft > 0) f.burnLeft = Math.max(0, f.burnLeft - dt);
      continue;
    }
    const smelt = SMELTING[f.input.item];
    if (outputBlocked(f, smelt.out)) continue;
    // 点燃新燃料
    if (f.burnLeft <= 0) {
      if (!f.fuel || FUELS[f.fuel.item] === undefined) continue;
      f.burnLeft = FUELS[f.fuel.item];
      f.fuel.count -= 1;
      if (f.fuel.count <= 0) f.fuel = null;
    }
    f.burnLeft = Math.max(0, f.burnLeft - dt);
    f.progress += dt;
    if (f.progress >= SMELT_TIME) {
      f.progress = 0;
      f.input.count -= 1;
      if (f.input.count <= 0) f.input = null;
      if (f.output) f.output = { item: smelt.out, count: f.output.count + 1 };
      else f.output = { item: smelt.out, count: 1 };
    }
  }
}

/** 熔炉被破坏：掉落炉内容物并清除状态 */
export function dropFurnaceContents(key: string, x: number, y: number, z: number): void {
  const f = furnaces.get(key);
  if (!f) return;
  for (const stack of [f.input, f.fuel, f.output]) {
    if (!stack) continue;
    const [kind, idStr] = stack.item.split(':');
    if (kind === 'block') spawnBlockDrop(Number(idStr), x + 0.5, y + 0.5, z + 0.5, stack.count);
    else spawnMaterialDrop(idStr, x + 0.5, y + 0.5, z + 0.5, stack.count);
  }
  furnaces.delete(key);
}
