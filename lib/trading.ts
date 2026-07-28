// 村民交易：职业交易表（MC 风格）与交易执行。纯数据逻辑（可单测）

import { armorDef, type ArmorPiece } from './armor';
import { BLOCK_BY_KEY } from './blocks';
import { MATERIAL_INFO } from './materials';
import { mulberry32 } from './noise';
import { addStackToSlots, type Slot } from './slots';

export type TradeItem = { kind: 'material'; material: string; count: number } | { kind: 'block'; id: number; count: number };

export interface Trade {
  /** 玩家付出（1-2 种） */
  give: TradeItem[];
  /** 玩家获得 */
  get: TradeItem;
  /** 交易得经验（MC：首次交易 3-6） */
  xp: number;
}

export type Profession = 'farmer' | 'librarian' | 'mason' | 'cleric' | 'leatherworker';

export const PROFESSION_INFO: Record<Profession, { name: string; robe: string }> = {
  farmer: { name: '农民', robe: '#8a6a3f' },
  librarian: { name: '图书管理员', robe: '#e8e0d0' },
  mason: { name: '石匠', robe: '#6a6a72' },
  cleric: { name: '牧师', robe: '#7a4a8a' },
  leatherworker: { name: '皮匠', robe: '#a06830' },
};

const M = (material: string, count: number): TradeItem => ({ kind: 'material', material, count });
const B = (key: string, count: number): TradeItem => ({ kind: 'block', id: BLOCK_BY_KEY[key].id, count });

/** 职业交易表（MC 风格：农产/杂物换绿宝石，绿宝石换成品） */
export const TRADES: Record<Profession, Trade[]> = {
  farmer: [
    { give: [M('wheat', 20)], get: M('emerald', 1), xp: 4 },
    { give: [M('emerald', 1)], get: M('bread', 6), xp: 2 },
    { give: [B('pumpkin', 4)], get: M('emerald', 1), xp: 4 },
    { give: [B('melon', 4)], get: M('emerald', 1), xp: 4 },
  ],
  librarian: [
    { give: [M('paper', 24)], get: M('emerald', 1), xp: 4 },
    { give: [M('book', 9)], get: M('emerald', 1), xp: 6 },
    { give: [M('emerald', 3)], get: B('bookshelf', 1), xp: 3 },
    { give: [M('emerald', 1)], get: M('paper', 12), xp: 2 },
  ],
  mason: [
    { give: [B('cobble', 16)], get: M('emerald', 1), xp: 4 },
    { give: [B('stone', 20)], get: M('emerald', 1), xp: 4 },
    { give: [M('emerald', 1)], get: B('polished_andesite', 4), xp: 2 },
    { give: [M('emerald', 1)], get: B('stone_bricks', 4), xp: 2 },
  ],
  cleric: [
    { give: [M('gold_ingot', 2)], get: M('emerald', 1), xp: 4 },
    { give: [M('emerald', 1)], get: M('lapis', 2), xp: 3 },
    { give: [M('emerald', 1)], get: M('glowstone_dust', 4), xp: 3 },
    { give: [M('emerald', 2)], get: B('glowstone', 1), xp: 3 },
  ],
  leatherworker: [
    { give: [M('leather', 6)], get: M('emerald', 1), xp: 4 },
    { give: [M('emerald', 5)], get: { kind: 'material', material: 'armor:helmet', count: 1 }, xp: 5 },
    { give: [M('emerald', 8)], get: { kind: 'material', material: 'armor:chestplate', count: 1 }, xp: 5 },
    { give: [M('emerald', 3)], get: M('leather', 3), xp: 2 },
  ],
};

/** 村民职业按 id 确定性分配（5 职业均布） */
export function professionOf(mobId: number): Profession {
  const list: Profession[] = ['farmer', 'librarian', 'mason', 'cleric', 'leatherworker'];
  return list[Math.floor(mulberry32(mobId * 0x9e37)() * list.length)];
}

/** 材料名（界面显示；armor:xxx 为装备特别编码） */
export function tradeItemName(item: TradeItem): string {
  if (item.kind === 'block') return BLOCK_BY_KEY[Object.keys(BLOCK_BY_KEY).find((k) => BLOCK_BY_KEY[k].id === item.id) ?? ''].name;
  if (item.material.startsWith('armor:')) return armorDef('leather', item.material.slice(6) as ArmorPiece).name;
  return MATERIAL_INFO[item.material]?.name ?? item.material;
}

/** 玩家是否有足够的付出物（材料按热键栏+背包统计；方块仅热键栏——与放置消耗口径一致） */
export function canAfford(slots: Slot[], trade: Trade): boolean {
  return trade.give.every((g) => {
    if (g.kind === 'material' && g.material.startsWith('armor:')) return false; // 装备不可作付出物
    const have = slots.reduce((n, s) => {
      if (!s) return n;
      if (g.kind === 'material' && s.kind === 'material' && s.material === g.material) return n + s.count;
      if (g.kind === 'block' && s.kind === 'block' && s.id === g.id) return n + s.count;
      return n;
    }, 0);
    return have >= g.count;
  });
}

/** 扣减付出物（材料与方块都从热键栏扣，不足从背包扣） */
function consume(hotbar: Slot[], backpack: Slot[], g: TradeItem): { hotbar: Slot[]; backpack: Slot[] } | null {
  let need = g.count;
  const take = (slots: Slot[]): Slot[] =>
    slots.map((s) => {
      if (need <= 0 || !s) return s;
      if (g.kind === 'material' && s.kind === 'material' && s.material === g.material) {
        const t = Math.min(s.count, need);
        need -= t;
        return s.count - t > 0 ? { ...s, count: s.count - t } : null;
      }
      if (g.kind === 'block' && s.kind === 'block' && s.id === g.id) {
        const t = Math.min(s.count, need);
        need -= t;
        return s.count - t > 0 ? { ...s, count: s.count - t } : null;
      }
      return s;
    });
  const h = take(hotbar);
  const b = take(backpack);
  return need <= 0 ? { hotbar: h, backpack: b } : null;
}

/** 执行交易：扣付出物、给获得物、返回新槽位与经验；库存不足返回 null */
export function executeTrade(
  hotbar: Slot[],
  backpack: Slot[],
  trade: Trade,
): { hotbar: Slot[]; backpack: Slot[]; xp: number } | null {
  if (!canAfford([...hotbar, ...backpack], trade)) return null;
  let h = hotbar;
  let b = backpack;
  for (const g of trade.give) {
    const r = consume(h, b, g);
    if (!r) return null;
    h = r.hotbar;
    b = r.backpack;
  }
  // 获得物：材料/方块走热键栏堆叠；装备特别编码放热键栏空格（耐久取 ARMOR_DEFS）
  if (trade.get.kind === 'material' && trade.get.material.startsWith('armor:')) {
    const piece = trade.get.material.slice(6) as ArmorPiece;
    const empty = h.findIndex((s) => s === null);
    if (empty >= 0) {
      h = [...h];
      h[empty] = { kind: 'armor', piece, durability: armorDef('leather', piece).durability };
    }
  } else {
    const out =
      trade.get.kind === 'block'
        ? addStackToSlots(h, { kind: 'block', id: trade.get.id }, trade.get.count)
        : addStackToSlots(h, { kind: 'material', material: trade.get.material }, trade.get.count);
    h = out.slots;
  }
  return { hotbar: h, backpack: b, xp: trade.xp };
}

// ——— 交易库存（简化 MC：每项交易每天限购，跨天补满；状态按村民 id 存内存，不持久化） ———

/** 每项交易每日限购次数（MC 12-16，取 12） */
export const MAX_TRADE_USES = 12;

/** 单个村民的当日库存：day = 游戏内天数，used[交易序号] = 当日已交易次数 */
interface VillagerStock {
  day: number;
  used: Map<number, number>;
}
const stocks = new Map<number, VillagerStock>();

// 游戏内天数：昼夜时钟 t（0..1）回卷（1→0，即过日出）记一天；时钟值由调用方传入保持纯数据
let lastClockT = -1;
let dayCount = 0;
/** 由昼夜时钟 t 推游戏天数（t 回卷时 +1）；store 交易/查库存时调用 */
export function tradeDay(t: number): number {
  if (lastClockT >= 0 && t < lastClockT) dayCount++;
  lastClockT = t;
  return dayCount;
}

/** 取村民当日库存记录（跨天自动重置补满） */
function stockOf(mobId: number, day: number): VillagerStock {
  let s = stocks.get(mobId);
  if (!s || s.day !== day) {
    s = { day, used: new Map() };
    stocks.set(mobId, s);
  }
  return s;
}

/** 第 tradeIndex 项交易当日剩余次数 */
export function tradeStockLeft(mobId: number, tradeIndex: number, day: number): number {
  return MAX_TRADE_USES - (stockOf(mobId, day).used.get(tradeIndex) ?? 0);
}

/** 扣 1 次当日库存；已达上限返回 false（不扣） */
export function deductTradeStock(mobId: number, tradeIndex: number, day: number): boolean {
  const s = stockOf(mobId, day);
  const used = s.used.get(tradeIndex) ?? 0;
  if (used >= MAX_TRADE_USES) return false;
  s.used.set(tradeIndex, used + 1);
  return true;
}

/** 清空全部库存与天数状态（测试用） */
export function resetTradeStocks(): void {
  stocks.clear();
  lastClockT = -1;
  dayCount = 0;
}
