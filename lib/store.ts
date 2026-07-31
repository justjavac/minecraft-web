// zustand 全局状态：界面、种子、热键栏、飞行/暂停、生存数值、槽位背包、装备

import { create } from 'zustand';
import { armorDef, armorDefOf, armorPoints, damageAfterArmor, emptyArmorSlots } from './armor';
import { armorRepairMaterial, enchLevelSum, mergeEnchants, priorWorkPenalty, toolRepairMaterial } from './anvil';
import { BLOCKS, HOTBAR_BLOCKS, type BlockId } from './blocks';
import { getBrew, INGREDIENTS, POTIONS, shiftIntoBrewing, takePotion } from './brewing';
import { MATERIAL_INFO } from './materials';
import { FOODS, getFurnace, shiftIntoFurnace, takeOutput } from './furnace';
import { hurtState, playerPosition, survivalStats, worldClock } from './game';
import { effects } from './effects';
import { beaconTiers } from './beacon';
import { spawnArmorDrop, spawnBlockDrop, spawnMaterialDrop, spawnToolDrop } from './items';
import {
  clickItemStack,
  clickSlot,
  collectToCursor,
  dragPlaceOne,
  dragSplit,
  isStackable,
  itemKeyToSlot,
  rightClickSlot,
  shiftMove,
  slotToItemKey,
} from './inventory';
import { applyCraft, canCraft, hasSpaceFor } from './recipes';
import { grindResult } from './grindstone';
import { netheriteUpgradeOf } from './smithing';
import { setPersistenceNoticeHandler } from './persistence';
import { addArmorToSlots, addStackToSlots, addToolToSlots, emptyBackpack, emptySlots, type Slot } from './slots';
import { eatSound, hurtSound, levelupSound } from './sound';
import { getStorage, putIntoStorage, storages, takeFromStorage } from './storage';
import { TOOLS } from './tools';
import { executeTrade, MAX_TRADE_USES, professionOf, TRADES, tradePeriod, tradeStockLeft, deductTradeStock } from './trading';
import { levelFromXp, subtractLevels } from './xp';
import { spawnXpOrbs } from './xporb';

// 类型与共享常量在 lib/store-types.ts（slice 组合需要）；此处再导出保持既有 import 路径不变
export type { Screen, GameMode, WorldMode, Settings, GameStore } from './store-types';
export { ALL_PANELS_CLOSED, anyPanelOpen, DEFAULT_SETTINGS } from './store-types';
import { ALL_PANELS_CLOSED, type GameStore, type GuiArea } from './store-types';
import { createSettingsSlice } from './store-settings';
import { createPanelsSlice } from './store-panels';

export const MAX_HEALTH = 20;
export const MAX_HUNGER = 20;
/** MC 饱和度上限（隐藏值，先于饥饿消耗） */
export const MAX_SATURATION = 5;
const HURT_COOLDOWN = 500; // ms 受击无敌帧

// ——— 光标拖拽（MC Java 语义）：状态在 zustand（cursorSlot），拖动过程为模块级 ephemeral 状态 ———

/** 读取区域槽位数组（'storage' 取当前打开容器；未打开返回空数组，调用方越界即拒绝） */
function readAreaSlots(s: GameStore, area: GuiArea): Slot[] {
  if (area === 'hotbar') return s.hotbarSlots;
  if (area === 'main') return s.mainSlots;
  return s.storageOpen ? getStorage(s.storageOpen) : [];
}

/** 写回区域槽位数组，返回可 set 的 patch（'storage' 直接写回容器 map，返回空 patch） */
function writeAreaSlots(s: GameStore, area: GuiArea, slots: Slot[]): Partial<GameStore> {
  if (area === 'hotbar') return { hotbarSlots: slots };
  if (area === 'main') return { mainSlots: slots };
  if (s.storageOpen) storages.set(s.storageOpen, slots);
  return {};
}

function replaceSlot(slots: Slot[], index: number, slot: Slot): Slot[] {
  const next = [...slots];
  next[index] = slot;
  return next;
}

type StoreSet = (partial: Partial<GameStore>) => void;

/** 把一个槽位物品退回背包（热键栏优先，溢出到主物品栏）；放不下在玩家脚下生成掉落实体（与死亡掉落同路径）。
 *  stowCursor / stowEnchantSlots / stowGrindSlots 共用 */
function stowOneToInventory(get: () => GameStore, set: StoreSet, slot: NonNullable<Slot>): void {
  let remaining: Slot = slot;
  if (slot.kind === 'block' || slot.kind === 'material') {
    const item = slot.kind === 'block' ? { kind: 'block' as const, id: slot.id } : { kind: 'material' as const, material: slot.material };
    const hot = addStackToSlots(get().hotbarSlots, item, slot.count);
    if (hot.slots !== get().hotbarSlots) set({ hotbarSlots: hot.slots });
    let left = hot.leftover;
    if (left > 0) {
      const main = addStackToSlots(get().mainSlots, item, left);
      if (main.slots !== get().mainSlots) set({ mainSlots: main.slots });
      left = main.leftover;
    }
    remaining = left > 0 ? { ...slot, count: left } : null;
  } else {
    // 工具/装备：热键栏 → 背包找第一个空槽
    const hi = get().hotbarSlots.indexOf(null);
    if (hi >= 0) {
      set({ hotbarSlots: replaceSlot(get().hotbarSlots, hi, slot) });
      remaining = null;
    } else {
      const mi = get().mainSlots.indexOf(null);
      if (mi >= 0) {
        set({ mainSlots: replaceSlot(get().mainSlots, mi, slot) });
        remaining = null;
      }
    }
  }
  if (remaining) {
    const { x, y, z } = playerPosition;
    if (remaining.kind === 'block') spawnBlockDrop(remaining.id, x, y + 0.5, z, remaining.count);
    else if (remaining.kind === 'material') spawnMaterialDrop(remaining.material, x, y + 0.5, z, remaining.count);
    else if (remaining.kind === 'tool') spawnToolDrop(remaining.tool, x, y + 0.5, z, remaining.durability, remaining.ench);
    else spawnArmorDrop(remaining.piece, x, y + 0.5, z, remaining.durability, remaining.material, remaining.ench);
  }
}

/** 光标拖动 pending/进行态（不入 zustand：mousedown 记录，进入第二格晋升为真拖动，pointerup 结算） */
interface GuiDrag {
  button: 0 | 2;
  area: GuiArea;
  index: number;
  /** 拖动起始光标（左键均分每次从它重算） */
  initial: NonNullable<Slot>;
  /** 已拖过格子及其拖动前的值（含起点，晋升时才填） */
  targets: { area: GuiArea; index: number; before: Slot }[];
  active: boolean;
}
let guiDrag: GuiDrag | null = null;

export const useGameStore = create<GameStore>()((set, get) => ({
  ...createSettingsSlice(set, get, {} as never),
  ...createPanelsSlice(set, get, {} as never),
  screen: 'menu',
  mode: 'new',
  seed: '',
  selectedSlot: 0,
  flying: false,
  paused: false,
  debug: false,
  worldReady: false,
  loadError: null,
  worldRetry: 0,
  hasLocked: false,
  spawnPoint: null,
  respawnPoint: null,
  worldMode: 'creative',
  dimension: 'overworld' as import('./dimension').Dimension,
  health: MAX_HEALTH,
  hunger: MAX_HUNGER,
  saturation: MAX_SATURATION,
  xpTotal: 0,
  dead: false,
  deathPos: null,
  lastDamageAt: 0,
  hotbarSlots: emptySlots(),
  mainSlots: emptyBackpack(),
  armorSlots: emptyArmorSlots(),
  cursorSlot: null,
  enchantItem: null,
  enchantLapis: null,
  grindSlots: [null, null],
  guiTick: 0,
  notice: null,
  setNotice: (notice) => set({ notice }),
  touchMode:
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || (window.matchMedia?.('(pointer: coarse)')?.matches ?? false)),
  startNew: (seed, worldMode) => {
    survivalStats.exhaustion = 0;
    set({
      screen: 'playing', mode: 'new', seed, paused: false, flying: false, worldReady: false, loadError: null,
      hasLocked: false, spawnPoint: null, respawnPoint: null,
      worldMode, health: MAX_HEALTH, hunger: MAX_HUNGER, saturation: MAX_SATURATION, xpTotal: 0,
      dimension: 'overworld',
      dead: false,
      deathPos: null,
      // 创造模式热键栏给默认方块面板（hotbarSlots 与生存共用一套——创造可持工具/材料，MC 模型）；生存为空
      hotbarSlots: worldMode === 'creative' ? HOTBAR_BLOCKS.map((id) => ({ kind: 'block' as const, id, count: 1 })) : emptySlots(),
      mainSlots: emptyBackpack(), armorSlots: emptyArmorSlots(), cursorSlot: null, craftingOpen: false, pickerOpen: false, furnaceOpen: null, brewingOpen: null, enchantOpen: null, tradeMob: null, storageOpen: null, grindstoneOpen: null, enchantItem: null, enchantLapis: null, grindSlots: [null, null],
    });
  },
  continueGame: () =>
    set({ screen: 'playing', mode: 'continue', paused: false, flying: false, worldReady: false, loadError: null, hasLocked: false, spawnPoint: null, respawnPoint: null, dead: false, deathPos: null, cursorSlot: null, craftingOpen: false, pickerOpen: false, furnaceOpen: null, brewingOpen: null, enchantOpen: null, tradeMob: null, storageOpen: null, grindstoneOpen: null, enchantItem: null, enchantLapis: null, grindSlots: [null, null] }),
  backToMenu: () => set({ screen: 'menu', paused: false, hasLocked: false, spawnPoint: null, respawnPoint: null, cursorSlot: null, craftingOpen: false, pickerOpen: false, furnaceOpen: null, brewingOpen: null, enchantOpen: null, tradeMob: null, storageOpen: null, grindstoneOpen: null, enchantItem: null, enchantLapis: null, grindSlots: [null, null], loadError: null }),
  setSlot: (i) => set({ selectedSlot: i }),
  setHotbarBlock: (slot, id) =>
    set((s) => {
      if (slot < 0 || slot >= s.hotbarSlots.length) return s;
      const hotbarSlots = [...s.hotbarSlots];
      hotbarSlots[slot] = { kind: 'block', id, count: 1 };
      return { hotbarSlots };
    }),
  creativeGive: (slot) =>
    set((s) => {
      const hotbarSlots = [...s.hotbarSlots];
      hotbarSlots[s.selectedSlot] = slot;
      return { hotbarSlots };
    }),
  pickBlock: (id) => {
    const s = get();
    if (!BLOCKS[id]) return; // 空气/无效方块不选
    if (s.worldMode === 'creative') {
      // 创造：hotbar 已有该方块则切换过去（MC pick block 不重复占格），否则放入当前格
      const bi = s.hotbarSlots.findIndex((sl) => sl?.kind === 'block' && sl.id === id);
      if (bi >= 0) s.setSlot(bi);
      else s.setHotbarBlock(s.selectedSlot, id);
      return;
    }
    // 生存：hotbar 有该方块则切换过去；背包有则与当前格交换拿到手上（MC pick block）
    const hi = s.hotbarSlots.findIndex((sl) => sl?.kind === 'block' && sl.id === id);
    if (hi >= 0) {
      s.setSlot(hi);
      return;
    }
    const mi = s.mainSlots.findIndex((sl) => sl?.kind === 'block' && sl.id === id);
    if (mi < 0) return;
    set((st) => {
      const hotbarSlots = [...st.hotbarSlots];
      const mainSlots = [...st.mainSlots];
      const tmp = hotbarSlots[st.selectedSlot] ?? null;
      hotbarSlots[st.selectedSlot] = mainSlots[mi];
      mainSlots[mi] = tmp;
      return { hotbarSlots, mainSlots };
    });
  },
  toggleFly: () => set((s) => ({ flying: s.worldMode === 'creative' ? !s.flying : false })),
  setPaused: (paused) => set({ paused }),
  toggleDebug: () => set((s) => ({ debug: !s.debug })),
  setWorldReady: (worldReady) => set({ worldReady }),
  setLoadError: (loadError) => set({ loadError }),
  retryWorld: () => set((s) => ({ loadError: null, worldReady: false, worldRetry: s.worldRetry + 1 })),
  setHasLocked: (hasLocked) => set({ hasLocked }),
  setSpawnPoint: (spawnPoint) => set({ spawnPoint }),
  setRespawnPoint: (respawnPoint) => set({ respawnPoint }),
  setWorldMode: (worldMode) => set({ worldMode }),
  setDimension: (dimension) => set({ dimension }),
  addXp: (amount) => {
    // 跨级检测：升级瞬间播放上行琶音（mobs 掉落经验球、烧炼、交易的经验都汇到这里）
    const before = levelFromXp(get().xpTotal).level;
    set((s) => ({ xpTotal: s.xpTotal + Math.max(0, Math.floor(amount)) }));
    if (levelFromXp(get().xpTotal).level > before) levelupSound();
  },
  enchantApply: (offer) => {
    const s = get();
    const slot = s.enchantItem;
    if (!slot || (slot.kind !== 'tool' && slot.kind !== 'armor')) return false;
    const { level } = levelFromXp(s.xpTotal);
    if (level < offer.levels) {
      s.setNotice(`经验等级不足（需要 ${offer.levels} 级）`);
      return false;
    }
    // Java 槽位模型：消耗附魔台青金石槽内的青金石（不再是自动从背包扣）
    const lapisCount = s.enchantLapis?.kind === 'material' && s.enchantLapis.material === 'lapis' ? s.enchantLapis.count : 0;
    if (lapisCount < offer.lapis) {
      s.setNotice(`青金石不足（需要 ${offer.lapis} 个）`);
      return false;
    }
    // 同种附魔取更高级（MC 不降级）；附魔后物品留在槽内由玩家取走（MC Java）
    const ench = { ...slot.ench };
    for (const e of offer.enchants) ench[e.ench] = Math.max(ench[e.ench] ?? 0, e.lvl);
    set({
      enchantItem: { ...slot, ench },
      enchantLapis: lapisCount > offer.lapis ? { kind: 'material', material: 'lapis', count: lapisCount - offer.lapis } : null,
      xpTotal: subtractLevels(s.xpTotal, offer.levels),
    });
    return true;
  },
  setHealth: (health) => set({ health }),
  setHunger: (hunger) => set({ hunger }),
  setSaturation: (saturation) => set({ saturation }),
  setDead: (dead) => set({ dead, ...(dead ? {} : { deathPos: null }) }),
  damagePlayer: (amount, opts) => {
    // MC：创造模式玩家无敌，不受任何伤害（虚空 /kill 由各自路径单独处理，不经此函数）
    if (get().worldMode === 'creative') return false;
    const now = performance.now();
    if (now - hurtState.lastAt < HURT_COOLDOWN) return false;
    hurtState.lastAt = now;
    survivalStats.exhaustion += 0.1; // MC：受击也消耗能量
    set((s) => {
      // 护甲减伤走 Java 两段式（armor.ts damageAfterArmor：护甲/盔甲韧性递减 + 保护附魔 EPF 第二段，无 1 点伤害地板）；
      // 抗性效果（信标）在护甲之后再减 20%/级（4 层金字塔 II 级 40%，MC）；穿甲伤害不减免也不耗装备耐久
      // MC：摔落/溺水/虚空/凋零等伤害不被护甲/保护减免，也不耗装备耐久（bypassArmor）
      const bypass = opts?.bypassArmor === true;
      const points = bypass ? 0 : armorPoints(s.armorSlots);
      let finalAmount = bypass ? amount : damageAfterArmor(amount, s.armorSlots);
      if (!bypass && effects.resistance > 0) finalAmount *= 1 - 0.2 * (beaconTiers.get('resistance') ?? 1);
      let armorSlots = s.armorSlots;
      if (points > 0) {
        armorSlots = { ...s.armorSlots };
        for (const piece of ['helmet', 'chestplate', 'leggings', 'boots'] as const) {
          const cur = armorSlots[piece];
          if (!cur) continue;
          const durability = cur.durability - 1;
          armorSlots[piece] = durability > 0 ? { ...cur, durability } : null;
        }
      }
      const health = Math.max(0, s.health - finalAmount);
      const died = health <= 0 && !s.dead;
      let hotbarSlots = s.hotbarSlots;
      let mainSlots = s.mainSlots;
      let xpTotal = s.xpTotal;
      if (died) {
        // 死亡掉落：热键栏 + 背包 + 装备槽全部物品散落在死亡点（与 MC 一致）；经验化球散落可捡回（MC：约 min(等级×7,100)）
        const { x, y, z } = playerPosition;
        const dropXp = Math.min(levelFromXp(s.xpTotal).level * 7, 100);
        if (dropXp > 0) spawnXpOrbs(x, y + 0.5, z, dropXp);
        xpTotal = 0;
        for (const slot of [...s.hotbarSlots, ...s.mainSlots, s.enchantItem, s.enchantLapis, ...s.grindSlots]) {
          if (!slot) continue;
          if (slot.kind === 'block') spawnBlockDrop(slot.id, x, y + 0.5, z, slot.count);
          else if (slot.kind === 'material') spawnMaterialDrop(slot.material, x, y + 0.5, z, slot.count);
          else if (slot.kind === 'tool') spawnToolDrop(slot.tool, x, y + 0.5, z, slot.durability, slot.ench);
          else spawnArmorDrop(slot.piece, x, y + 0.5, z, slot.durability, slot.material, slot.ench);
        }
        for (const piece of ['helmet', 'chestplate', 'leggings', 'boots'] as const) {
          const cur = armorSlots[piece];
          if (cur) spawnArmorDrop(piece, x, y + 0.5, z, cur.durability, cur.material, cur.ench);
        }
        // 光标上的物品同样掉落（死亡时光标只可能来自刚关闭的界面，按死亡掉落处理）
        const held = s.cursorSlot;
        if (held) {
          if (held.kind === 'block') spawnBlockDrop(held.id, x, y + 0.5, z, held.count);
          else if (held.kind === 'material') spawnMaterialDrop(held.material, x, y + 0.5, z, held.count);
          else if (held.kind === 'tool') spawnToolDrop(held.tool, x, y + 0.5, z, held.durability, held.ench);
          else spawnArmorDrop(held.piece, x, y + 0.5, z, held.durability, held.material, held.ench);
        }
        hotbarSlots = emptySlots();
        mainSlots = emptyBackpack();
        armorSlots = emptyArmorSlots();
      }
      return {
        health,
        dead: health <= 0 || s.dead,
        lastDamageAt: now,
        // 记录死亡地点供死亡界面显示坐标（重生时由 setDead(false) 清空）
        ...(died ? { deathPos: { x: Math.floor(playerPosition.x), y: Math.floor(playerPosition.y), z: Math.floor(playerPosition.z) } } : {}),
        hotbarSlots,
        mainSlots,
        armorSlots,
        xpTotal,
        // 死亡时关掉所有打开的界面（仅受伤未死不动）；附魔台/砂轮槽内物品已随上面一并掉落
        ...(died ? { ...ALL_PANELS_CLOSED, cursorSlot: null, enchantItem: null, enchantLapis: null, grindSlots: [null, null] as [Slot, Slot] } : {}),
      };
    });
    hurtSound(); // 实际扣血才播（创造/无敌帧上面已 return false）
    return true;
  },
  loadSurvival: ({ health, hunger, saturation, slots, backpack, armor, xp }) =>
    set({
      health,
      hunger,
      saturation: saturation ?? MAX_SATURATION,
      hotbarSlots: slots ?? emptySlots(),
      mainSlots: backpack ?? emptyBackpack(),
      armorSlots: armor ?? emptyArmorSlots(),
      xpTotal: xp ?? 0,
      cursorSlot: null,
      dead: false,
      deathPos: null,
    }),
  executeMobTrade: (i) => {
    const s = get();
    if (s.tradeMob === null) return;
    const trade = TRADES[professionOf(s.tradeMob)][i];
    if (!trade) return;
    // 库存（简化 MC）：每项每天限购，每天 2 次补货（午/子夜两个补货期），售罄拒绝并提示；成交才扣库存
    const period = tradePeriod(worldClock.t);
    if (tradeStockLeft(s.tradeMob, i, period) <= 0) {
      s.setNotice(`该交易本期已达上限（${MAX_TRADE_USES} 次），下次补货恢复`);
      return;
    }
    const r = executeTrade(s.hotbarSlots, s.mainSlots, trade, s.worldMode === 'creative');
    if (!r) return;
    deductTradeStock(s.tradeMob, i, period);
    set({ hotbarSlots: r.hotbar, mainSlots: r.backpack });
    s.addXp(r.xp);
  },
  tradeStockLeft: (i) => {
    const s = get();
    if (s.tradeMob === null) return 0;
    return tradeStockLeft(s.tradeMob, i, tradePeriod(worldClock.t));
  },
  storagePut: (area, slotIndex) => {
    const s = get();
    if (!s.storageOpen) return;
    if (area === 'hotbar') set({ hotbarSlots: putIntoStorage(s.hotbarSlots, slotIndex, getStorage(s.storageOpen)) });
    else set({ mainSlots: putIntoStorage(s.mainSlots, slotIndex, getStorage(s.storageOpen)) });
  },
  storageTake: (index) => {
    const s = get();
    if (!s.storageOpen) return;
    const storage = getStorage(s.storageOpen);
    const before = storage[index];
    if (!before) return;
    // 优先移到热键栏，一格没动则进背包
    const hot = takeFromStorage(s.hotbarSlots, storage, index);
    if (storage[index] !== before) {
      set({ hotbarSlots: hot });
      return;
    }
    const main = takeFromStorage(s.mainSlots, storage, index);
    if (storage[index] !== before) set({ mainSlots: main });
  },
  eatSelectedFood: () => {
    const s = get();
    const slot = s.hotbarSlots[s.selectedSlot];
    if (!slot || slot.kind !== 'material') return false;
    const food = FOODS[slot.material];
    if (!food) return false;
    if (s.hunger >= MAX_HUNGER) {
      s.setNotice('还不饿'); // MC：满饥饿不能进食；拒绝要给反馈，不静默吞掉操作
      return false;
    }
    const hunger = Math.min(MAX_HUNGER, s.hunger + food.hunger);
    // MC：饱和度不超过饥饿值（本游戏饥饿 20 / 饱和 5）
    const saturation = Math.min(MAX_SATURATION, s.saturation + food.saturation, hunger / 4);
    const slots = [...s.hotbarSlots];
    slots[s.selectedSlot] = slot.count > 1 ? { ...slot, count: slot.count - 1 } : null;
    set({ hunger, saturation, hotbarSlots: slots });
    eatSound();
    return true;
  },
  furnaceTakeOutput: () => {
    const s = get();
    if (!s.furnaceOpen) return;
    const f = getFurnace(s.furnaceOpen);
    const before = f.output?.count ?? 0;
    set({ hotbarSlots: takeOutput(s.hotbarSlots, f) });
    // 烧炼经验：炉内按配方表累积小数 xp，取出成品时结算整数部分、余数留炉（MC；热键栏满取不出则不给）
    const taken = before - (f.output?.count ?? 0);
    if (taken > 0) {
      const award = Math.floor(f.xp ?? 0);
      if (award > 0) {
        f.xp = (f.xp ?? 0) - award;
        s.addXp(award);
      }
    }
  },
  brewingTakePotion: (i) => {
    const s = get();
    if (!s.brewingOpen) return;
    set({ hotbarSlots: takePotion(s.hotbarSlots, getBrew(s.brewingOpen), i) });
  },
  // ——— 光标拖拽（MC Java 语义；纯规则在 lib/inventory.ts，此处只做状态接线） ———
  stowCursor: () => {
    const c = get().cursorSlot;
    if (!c) return;
    stowOneToInventory(get, set, c);
    set({ cursorSlot: null });
  },
  stowEnchantSlots: () => {
    const s = get();
    if (!s.enchantItem && !s.enchantLapis) return;
    if (s.enchantItem) stowOneToInventory(get, set, s.enchantItem);
    if (s.enchantLapis) stowOneToInventory(get, set, s.enchantLapis);
    set({ enchantItem: null, enchantLapis: null });
  },
  stowGrindSlots: () => {
    const s = get();
    if (!s.grindSlots[0] && !s.grindSlots[1]) return;
    if (s.grindSlots[0]) stowOneToInventory(get, set, s.grindSlots[0]);
    if (s.grindSlots[1]) stowOneToInventory(get, set, s.grindSlots[1]);
    set({ grindSlots: [null, null] });
  },
  // ——— 附魔台 Java 槽位模型：物品槽（仅工具/装备）+ 青金石槽（仅青金石） ———
  enchantSlotMouseDown: (which, info) => {
    const s = get();
    if (!s.enchantOpen) return;
    const button = info.button === 2 ? 2 : 0;
    if (which === 'item') {
      const cur = s.enchantItem;
      if (info.shift && button === 0) {
        // shift 取出到背包（热键栏优先，溢出到主物品栏）
        if (!cur) return;
        const r1 = shiftMove(cur, s.hotbarSlots);
        let left = r1.slot;
        let mainSlots = s.mainSlots;
        if (left) {
          const r2 = shiftMove(left, s.mainSlots);
          mainSlots = r2.target;
          left = r2.slot;
        }
        set({ enchantItem: left, ...(r1.target !== s.hotbarSlots ? { hotbarSlots: r1.target } : {}), ...(mainSlots !== s.mainSlots ? { mainSlots } : {}), guiTick: s.guiTick + 1 });
        return;
      }
      const cursor = s.cursorSlot;
      if (cursor !== null && cursor.kind !== 'tool' && cursor.kind !== 'armor') return; // 仅可附魔物品（本项目：工具/装备）
      const r = button === 0 ? clickSlot([cur], 0, cursor) : rightClickSlot([cur], 0, cursor);
      if (r.slots[0] === cur && r.cursor === cursor) return;
      set({ enchantItem: r.slots[0], cursorSlot: r.cursor, guiTick: s.guiTick + 1 });
      return;
    }
    // 青金石槽（{ item, count } 字符串栈语义，复用 clickItemStack；上限 64）
    const stack = s.enchantLapis?.kind === 'material' ? { item: 'material:lapis', count: s.enchantLapis.count } : null;
    if (info.shift && button === 0) {
      if (!stack) return;
      const r1 = shiftMove(itemKeyToSlot(stack.item, stack.count), s.hotbarSlots);
      let left = r1.slot;
      let mainSlots = s.mainSlots;
      if (left) {
        const r2 = shiftMove(left, s.mainSlots);
        mainSlots = r2.target;
        left = r2.slot;
      }
      set({
        enchantLapis: left ? { kind: 'material', material: 'lapis', count: (left as { count: number }).count } : null,
        ...(r1.target !== s.hotbarSlots ? { hotbarSlots: r1.target } : {}),
        ...(mainSlots !== s.mainSlots ? { mainSlots } : {}),
        guiTick: s.guiTick + 1,
      });
      return;
    }
    const cursor = s.cursorSlot;
    if (cursor !== null && !(cursor.kind === 'material' && cursor.material === 'lapis')) return; // 仅青金石
    const r = clickItemStack(stack, cursor, button);
    if (r.stack === stack && r.cursor === cursor) return;
    set({ enchantLapis: r.stack ? { kind: 'material', material: 'lapis', count: r.stack.count } : null, cursorSlot: r.cursor, guiTick: s.guiTick + 1 });
  },
  // ——— 砂轮：两输入槽（仅工具/装备）+ 派生产出槽（取出即生效） ———
  grindSlotMouseDown: (which, info) => {
    const s = get();
    if (!s.grindstoneOpen) return;
    const button = info.button === 2 ? 2 : 0;
    const cur = s.grindSlots[which];
    if (info.shift && button === 0) {
      // shift 取出到背包（热键栏优先，溢出到主物品栏）
      if (!cur) return;
      const r1 = shiftMove(cur, s.hotbarSlots);
      let left = r1.slot;
      let mainSlots = s.mainSlots;
      if (left) {
        const r2 = shiftMove(left, s.mainSlots);
        mainSlots = r2.target;
        left = r2.slot;
      }
      const grindSlots: [Slot, Slot] = which === 0 ? [left, s.grindSlots[1]] : [s.grindSlots[0], left];
      set({ grindSlots, ...(r1.target !== s.hotbarSlots ? { hotbarSlots: r1.target } : {}), ...(mainSlots !== s.mainSlots ? { mainSlots } : {}), guiTick: s.guiTick + 1 });
      return;
    }
    const cursor = s.cursorSlot;
    if (cursor !== null && cursor.kind !== 'tool' && cursor.kind !== 'armor') return; // 砂轮只收工具/装备
    const r = button === 0 ? clickSlot([cur], 0, cursor) : rightClickSlot([cur], 0, cursor);
    if (r.slots[0] === cur && r.cursor === cursor) return;
    const grindSlots: [Slot, Slot] = which === 0 ? [r.slots[0], s.grindSlots[1]] : [s.grindSlots[0], r.slots[0]];
    set({ grindSlots, cursorSlot: r.cursor, guiTick: s.guiTick + 1 });
  },
  grindTakeOutput: (info) => {
    const s = get();
    if (!s.grindstoneOpen) return;
    const r = grindResult(s.grindSlots[0], s.grindSlots[1]);
    if (!r) return;
    if (info.shift && info.button === 0) {
      // shift：成品直接入背包（热键栏优先）；背包满则不取（输入不消耗）
      const r1 = shiftMove(r.out, s.hotbarSlots);
      let left = r1.slot;
      let mainSlots = s.mainSlots;
      if (left) {
        const r2 = shiftMove(left, s.mainSlots);
        mainSlots = r2.target;
        left = r2.slot;
      }
      if (left) return;
      set({ grindSlots: [null, null], ...(r1.target !== s.hotbarSlots ? { hotbarSlots: r1.target } : {}), ...(mainSlots !== s.mainSlots ? { mainSlots } : {}), guiTick: s.guiTick + 1 });
      s.addXp(r.xp);
      return;
    }
    if (s.cursorSlot !== null) return; // 成品为工具/装备不可堆叠：光标须为空（不放也不并）
    set({ grindSlots: [null, null], cursorSlot: r.out, guiTick: s.guiTick + 1 });
    s.addXp(r.xp); // 祛魔返还经验（MC：取出产出时结算）
  },
  slotMouseDown: (area, index, info) => {
    const s = get();
    // shift+左键：快速移动（路由按当前打开的界面）
    if (info.shift && info.button === 0) {
      if (area === 'storage') {
        s.storageTake(index);
        set({ guiTick: get().guiTick + 1 });
        return;
      }
      if (s.storageOpen) {
        s.storagePut(area, index);
        set({ guiTick: get().guiTick + 1 });
        return;
      }
      if (s.furnaceOpen) {
        const f = getFurnace(s.furnaceOpen);
        const slots = readAreaSlots(s, area);
        const next = shiftIntoFurnace(slots[index] ?? null, f);
        if (next !== slots[index]) set({ ...writeAreaSlots(s, area, replaceSlot(slots, index, next)), guiTick: s.guiTick + 1 });
        return;
      }
      if (s.brewingOpen) {
        const b = getBrew(s.brewingOpen);
        const slots = readAreaSlots(s, area);
        const next = shiftIntoBrewing(slots[index] ?? null, b);
        if (next !== slots[index]) set({ ...writeAreaSlots(s, area, replaceSlot(slots, index, next)), guiTick: s.guiTick + 1 });
        return;
      }
      if (s.enchantOpen) {
        // 附魔台（Java）：青金石 → 青金石槽（并到 64，余数留原格）；工具/装备 → 空物品槽；其余背包 ↔ 热键栏
        const slots = readAreaSlots(s, area);
        const slot = slots[index] ?? null;
        if (slot?.kind === 'material' && slot.material === 'lapis') {
          const curCount = s.enchantLapis?.kind === 'material' ? s.enchantLapis.count : 0;
          const add = Math.min(64 - curCount, slot.count);
          if (add <= 0) return;
          set({
            ...writeAreaSlots(s, area, replaceSlot(slots, index, slot.count > add ? { ...slot, count: slot.count - add } : null)),
            enchantLapis: { kind: 'material', material: 'lapis', count: curCount + add },
            guiTick: s.guiTick + 1,
          });
          return;
        }
        if (slot && (slot.kind === 'tool' || slot.kind === 'armor') && s.enchantItem === null) {
          set({ ...writeAreaSlots(s, area, replaceSlot(slots, index, null)), enchantItem: slot, guiTick: s.guiTick + 1 });
          return;
        }
        s.moveSlot(area, index);
        return;
      }
      if (s.grindstoneOpen) {
        // 砂轮（Java）：工具/装备 → 第一个空输入槽（满则不动）；其余背包 ↔ 热键栏
        const slots = readAreaSlots(s, area);
        const slot = slots[index] ?? null;
        if (slot && (slot.kind === 'tool' || slot.kind === 'armor')) {
          const emptyIdx = s.grindSlots[0] === null ? 0 : s.grindSlots[1] === null ? 1 : -1;
          if (emptyIdx < 0) return;
          const grindSlots: [Slot, Slot] = emptyIdx === 0 ? [slot, s.grindSlots[1]] : [s.grindSlots[0], slot];
          set({ ...writeAreaSlots(s, area, replaceSlot(slots, index, null)), grindSlots, guiTick: s.guiTick + 1 });
          return;
        }
        s.moveSlot(area, index);
        return;
      }
      // 合成/交易/附魔等：背包 ↔ 热键栏（moveSlot 语义）
      s.moveSlot(area, index);
      return;
    }
    if (info.button !== 0 && info.button !== 2) return;
    const button: 0 | 2 = info.button === 2 ? 2 : 0;
    const slots = readAreaSlots(s, area);
    if (index < 0 || index >= slots.length) return;
    if (s.cursorSlot === null) {
      // 空光标：拿起立即生效
      const r = button === 0 ? clickSlot(slots, index, null) : rightClickSlot(slots, index, null);
      if (r.slots === slots && r.cursor === null) return;
      set({ ...writeAreaSlots(s, area, r.slots), cursorSlot: r.cursor, guiTick: s.guiTick + 1 });
      return;
    }
    // 光标有物：记拖动 pending（MC：按下即进入可拖动状态；pointerup 未拖动按普通点击处理）
    guiDrag = { button, area, index, initial: s.cursorSlot, targets: [], active: false };
  },
  slotDragEnter: (area, index) => {
    const d = guiDrag;
    if (!d) return;
    const s = get();
    // 右键拖动：给指定格放 1 个（增量，无需重算；每次取最新 state，避免连续放置互相覆盖）
    const placeOneAt = (t: { area: GuiArea; index: number; before: Slot }): void => {
      const cur = get();
      const cursor = cur.cursorSlot;
      if (!cursor) return;
      const r = dragPlaceOne(t.before, cursor);
      if (r.cursor === cursor) return;
      set({ ...writeAreaSlots(cur, t.area, replaceSlot(readAreaSlots(cur, t.area), t.index, r.slot)), cursorSlot: r.cursor, guiTick: cur.guiTick + 1 });
    };
    if (!d.active) {
      if (area === d.area && index === d.index) return;
      d.active = true;
      d.targets.push({ area: d.area, index: d.index, before: readAreaSlots(s, d.area)[d.index] ?? null });
      // 右键拖动：起点格同样放 1 个（MC：拖动分发从按下格开始）
      if (d.button === 2) placeOneAt(d.targets[0]);
    }
    if (d.targets.some((t) => t.area === area && t.index === index)) return;
    const slots = readAreaSlots(s, area);
    if (index < 0 || index >= slots.length) return;
    d.targets.push({ area, index, before: slots[index] });
    if (d.button === 2) {
      placeOneAt(d.targets[d.targets.length - 1]);
      if (!get().cursorSlot) guiDrag = null; // 光标耗尽：拖动结束
      return;
    }
    // 左键拖动：从起始光标重算均分（floor 均分，余数留光标）
    const r = dragSplit(d.targets.map((t) => t.before), d.initial);
    const perArea = new Map<GuiArea, Slot[]>();
    for (let i = 0; i < d.targets.length; i++) {
      const t = d.targets[i];
      const arr = perArea.get(t.area) ?? readAreaSlots(s, t.area);
      perArea.set(t.area, replaceSlot(arr, t.index, r.slots[i]));
    }
    const patch: Partial<GameStore> = { cursorSlot: r.cursor, guiTick: s.guiTick + 1 };
    for (const [a, arr] of perArea) Object.assign(patch, writeAreaSlots(s, a, arr));
    set(patch);
  },
  dragEnd: () => {
    const d = guiDrag;
    guiDrag = null;
    if (!d || d.active) return; // 真拖动：余数留光标（MC）
    const s = get();
    const slots = readAreaSlots(s, d.area);
    const r = d.button === 0 ? clickSlot(slots, d.index, s.cursorSlot) : rightClickSlot(slots, d.index, s.cursorSlot);
    if (r.slots === slots && r.cursor === s.cursorSlot) return;
    set({ ...writeAreaSlots(s, d.area, r.slots), cursorSlot: r.cursor, guiTick: s.guiTick + 1 });
  },
  slotDoubleClick: () => { // area/index 仅 UI 语义（双击的格子必含同类物品），收集范围按当前界面定
    const s = get();
    const cursor = s.cursorSlot;
    if (!isStackable(cursor)) return;
    const areas: GuiArea[] = s.storageOpen ? ['hotbar', 'main', 'storage'] : ['hotbar', 'main'];
    const r = collectToCursor(areas.map((a) => readAreaSlots(s, a)), cursor);
    if (r.cursor === cursor) return;
    const patch: Partial<GameStore> = { cursorSlot: r.cursor, guiTick: s.guiTick + 1 };
    areas.forEach((a, i) => Object.assign(patch, writeAreaSlots(s, a, r.areas[i])));
    set(patch);
  },
  furnaceSlotMouseDown: (which, info) => {
    const s = get();
    if (!s.furnaceOpen) return;
    const f = getFurnace(s.furnaceOpen);
    const button = info.button === 2 ? 2 : 0;
    if (which === 'output') {
      // 产出槽：只能取不能放；shift 整叠入背包并结算经验（复用 furnaceTakeOutput）
      if (info.shift && button === 0) {
        s.furnaceTakeOutput();
        set({ guiTick: get().guiTick + 1 });
        return;
      }
      if (!f.output) return;
      const before = f.output.count;
      const item = f.output.item;
      const cursor = s.cursorSlot;
      let take: number;
      let nextCursor: Slot;
      if (cursor === null) {
        take = button === 2 ? 1 : before; // 右键取 1 件
        nextCursor = itemKeyToSlot(item, take);
      } else {
        if (!isStackable(cursor)) return; // 工具/装备不能放也不能并
        const key = slotToItemKey(cursor);
        if (key !== item) return; // 异类不能放也不能并
        const room = 64 - cursor.count;
        take = Math.min(room, before);
        if (take <= 0) return;
        nextCursor = { ...cursor, count: cursor.count + take };
      }
      f.output = before > take ? { item, count: before - take } : null;
      // 烧炼经验：取出成品时结算整数部分、余数留炉（同 furnaceTakeOutput）
      const award = Math.floor(f.xp ?? 0);
      if (award > 0) {
        f.xp = (f.xp ?? 0) - award;
        s.addXp(award);
      }
      set({ cursorSlot: nextCursor, guiTick: s.guiTick + 1 });
      return;
    }
    // 输入/燃料槽
    const stack = which === 'fuel' ? f.fuel : f.input;
    if (info.shift && button === 0) {
      // shift 取出到背包（热键栏优先，溢出到主物品栏）
      if (!stack) return;
      const r1 = shiftMove(itemKeyToSlot(stack.item, stack.count), s.hotbarSlots);
      let left = r1.slot;
      let mainSlots = s.mainSlots;
      if (left) {
        const r2 = shiftMove(left, s.mainSlots);
        mainSlots = r2.target;
        left = r2.slot;
      }
      const newStack = left ? { item: stack.item, count: (left as { count: number }).count } : null;
      if (which === 'fuel') f.fuel = newStack;
      else f.input = newStack;
      set({ ...(r1.target !== s.hotbarSlots ? { hotbarSlots: r1.target } : {}), ...(mainSlots !== s.mainSlots ? { mainSlots } : {}), guiTick: s.guiTick + 1 });
      return;
    }
    const cursor = s.cursorSlot;
    if (cursor !== null && slotToItemKey(cursor) === null) return; // 工具/装备进不了熔炉槽
    const r = clickItemStack(stack, cursor, button);
    if (r.stack === stack && r.cursor === cursor) return;
    if (which === 'fuel') f.fuel = r.stack;
    else f.input = r.stack;
    set({ cursorSlot: r.cursor, guiTick: s.guiTick + 1 });
  },
  brewingSlotMouseDown: (which, index, info) => {
    const s = get();
    if (!s.brewingOpen) return;
    const b = getBrew(s.brewingOpen);
    const button = info.button === 2 ? 2 : 0;
    const getStack = (): { item: string; count: number } | null =>
      which === 'fuel' ? b.fuel : which === 'ingredient' ? b.ingredient : (b.potions[index] ?? null);
    const setStack = (st: { item: string; count: number } | null): void => {
      if (which === 'fuel') b.fuel = st;
      else if (which === 'ingredient') b.ingredient = st;
      else b.potions[index] = st;
    };
    const stack = getStack();
    if (info.shift && button === 0) {
      // shift 取出到背包（热键栏优先）
      if (!stack) return;
      const r1 = shiftMove(itemKeyToSlot(stack.item, stack.count), s.hotbarSlots);
      let left = r1.slot;
      let mainSlots = s.mainSlots;
      if (left) {
        const r2 = shiftMove(left, s.mainSlots);
        mainSlots = r2.target;
        left = r2.slot;
      }
      setStack(left ? { item: stack.item, count: (left as { count: number }).count } : null);
      set({ ...(r1.target !== s.hotbarSlots ? { hotbarSlots: r1.target } : {}), ...(mainSlots !== s.mainSlots ? { mainSlots } : {}), guiTick: s.guiTick + 1 });
      return;
    }
    const cursor = s.cursorSlot;
    if (cursor !== null) {
      // 放置约束（MC）：燃料槽只收烈焰粉、材料槽只收酿造材料、药水槽只收药水；方块/工具/装备进不了酿造台
      const key = slotToItemKey(cursor);
      const mat = key !== null && key.startsWith('material:') ? key.slice(9) : null;
      if (mat === null) return;
      if (which === 'fuel' && mat !== 'blaze_powder') return;
      if (which === 'ingredient' && !INGREDIENTS.includes(mat)) return;
      if (which === 'potion' && POTIONS[mat] === undefined) return;
    }
    const r = clickItemStack(stack, cursor, button, which === 'potion' ? 1 : 64, true);
    setStack(r.stack);
    if (r.stack === stack && r.cursor === cursor) return;
    set({ cursorSlot: r.cursor, guiTick: s.guiTick + 1 });
  },
  addStack: (item, count = 1) => {
    // 先填热键栏，放不下的溢出到背包（MC：新物品优先热键栏）
    const first = addStackToSlots(get().hotbarSlots, item, count);
    if (first.slots !== get().hotbarSlots) set({ hotbarSlots: first.slots });
    if (first.leftover <= 0) return 0;
    const second = addStackToSlots(get().mainSlots, item, first.leftover);
    if (second.slots !== get().mainSlots) set({ mainSlots: second.slots });
    return second.leftover;
  },
  addTool: (tool, durability, ench) => {
    // 热键栏满了放背包
    const hot = addToolToSlots(get().hotbarSlots, tool, durability ?? TOOLS[tool].durability, ench);
    if (hot) {
      set({ hotbarSlots: hot });
      return true;
    }
    const main = addToolToSlots(get().mainSlots, tool, durability ?? TOOLS[tool].durability, ench);
    if (!main) return false;
    set({ mainSlots: main });
    return true;
  },
  addArmor: (piece, durability, material, ench) => {
    const hot = addArmorToSlots(get().hotbarSlots, piece, durability ?? armorDef(material ?? 'leather', piece).durability, material, ench);
    if (hot) {
      set({ hotbarSlots: hot });
      return true;
    }
    const main = addArmorToSlots(get().mainSlots, piece, durability ?? armorDef(material ?? 'leather', piece).durability, material, ench);
    if (!main) return false;
    set({ mainSlots: main });
    return true;
  },
  equipSelectedArmor: () => {
    const s = get();
    const slot = s.hotbarSlots[s.selectedSlot];
    if (!slot || slot.kind !== 'armor') return false;
    const prev = s.armorSlots[slot.piece];
    const slots = [...s.hotbarSlots];
    slots[s.selectedSlot] = prev ? { kind: 'armor', piece: slot.piece, material: prev.material, durability: prev.durability, ench: prev.ench } : null;
    set({
      hotbarSlots: slots,
      armorSlots: { ...s.armorSlots, [slot.piece]: { durability: slot.durability, material: slot.material, ench: slot.ench } },
    });
    return true;
  },
  equipElytra: () => {
    const s = get();
    const slot = s.hotbarSlots[s.selectedSlot];
    if (slot?.kind !== 'material' || slot.material !== 'elytra') return false;
    const prev = s.armorSlots.chestplate;
    const slots = [...s.hotbarSlots];
    // 原胸甲回手（保留材质/附魔/耐久）
    slots[s.selectedSlot] = prev ? { kind: 'armor', piece: 'chestplate', material: prev.material, durability: prev.durability, ench: prev.ench } : null;
    set({
      hotbarSlots: slots,
      armorSlots: { ...s.armorSlots, chestplate: { durability: 432, material: 'elytra' } }, // MC 鞘翅耐久 432
    });
    return true;
  },
  anvilUse: () => {
    const s = get();
    const held = s.hotbarSlots[s.selectedSlot];
    if (!held || (held.kind !== 'tool' && held.kind !== 'armor')) {
      return { ok: false, notice: '手持要修复或合并的工具/装备' };
    }
    // —— 附魔合并：物品栏另有一件同型且带附魔的 B（工具同 type / 装备同 piece+material，MC 铁砧双槽） ——
    const all = [...s.hotbarSlots, ...s.mainSlots];
    const bIdx = all.findIndex((sl, i) => {
      if (i === s.selectedSlot || !sl) return false;
      if (sl.kind !== 'tool' && sl.kind !== 'armor') return false;
      if (!sl.ench || Object.keys(sl.ench).length === 0) return false;
      return (
        (held.kind === 'tool' && sl.kind === 'tool' && sl.tool === held.tool) ||
        (held.kind === 'armor' && sl.kind === 'armor' && sl.piece === held.piece && (sl.material ?? 'leather') === (held.material ?? 'leather'))
      );
    });
    if (bIdx >= 0) {
      const b = all[bIdx]!;
      if ((b.kind !== 'tool' && b.kind !== 'armor') || !b.ench) return { ok: false, notice: '合并失败' }; // 谓词已保证，仅为类型窄化
      const maxDura = held.kind === 'tool' ? TOOLS[held.tool].durability : armorDefOf(held).durability;
      const mergedEnch = mergeEnchants(held.ench, b.ench);
      // MC 铁砧经验费：合并附魔等级总和 + 累计使用惩罚（2^works-1）；Java 生存 ≥40 级「过于昂贵」拒绝（39 可用）；创造模式免费
      const works = held.works ?? 0;
      const cost = enchLevelSum(mergedEnch) + priorWorkPenalty(works);
      const free = s.worldMode === 'creative';
      if (!free && cost >= 40) return { ok: false, notice: '过于昂贵！' };
      if (!free && levelFromXp(s.xpTotal).level < cost) return { ok: false, notice: `经验不足（需要 ${cost} 级）` };
      const hotbarSlots = [...s.hotbarSlots];
      const mainSlots = [...s.mainSlots];
      const merged = {
        ...held,
        ench: mergedEnch,
        durability: Math.min(maxDura, held.durability + b.durability + Math.ceil(maxDura * 0.12)), // Java 合并：A 剩余 + B 剩余 + 12% 最大耐久（封顶）
        works: works + 1,
      };
      hotbarSlots[s.selectedSlot] = merged as typeof held;
      if (bIdx < hotbarSlots.length) hotbarSlots[bIdx] = null;
      else mainSlots[bIdx - hotbarSlots.length] = null;
      set({ hotbarSlots, mainSlots, ...(free ? {} : { xpTotal: subtractLevels(s.xpTotal, cost) }) });
      return { ok: true, notice: `附魔已合并（同级 +1，取高级）${free ? '' : `，消耗 ${cost} 级`}` };
    }
    // —— 修复：耐久未满 + 物品栏有对应材料 1 个 → 补 25%（MC 材料修复） ——
    const maxDura = held.kind === 'tool' ? TOOLS[held.tool].durability : armorDefOf(held).durability;
    if (held.durability >= maxDura) return { ok: false, notice: '耐久已满，无需修复' };
    const key = held.kind === 'tool' ? toolRepairMaterial(held.tool) : armorRepairMaterial(held.material);
    if (!key) return { ok: false, notice: '该物品无法修复' };
    // MC 铁砧修复经验费：2 级 + 累计使用惩罚；Java 生存 ≥40 级「过于昂贵」拒绝（39 可用）；创造免费
    const works = held.works ?? 0;
    const cost = 2 + priorWorkPenalty(works);
    const free = s.worldMode === 'creative';
    if (!free && cost >= 40) return { ok: false, notice: '过于昂贵！' };
    if (!free && levelFromXp(s.xpTotal).level < cost) return { ok: false, notice: `经验不足（需要 ${cost} 级）` };
    // 通用扣料（block:<id> 或 material:<name>，热键栏 + 背包）
    const hotbarSlots = [...s.hotbarSlots];
    const mainSlots = [...s.mainSlots];
    const consume = (slots: Slot[]): boolean => {
      for (let i = 0; i < slots.length; i++) {
        const sl = slots[i];
        if (!sl) continue;
        const k = sl.kind === 'block' ? `block:${sl.id}` : sl.kind === 'material' ? `material:${sl.material}` : null;
        if (k !== key) continue;
        slots[i] = sl.kind === 'block' || sl.kind === 'material' ? (sl.count > 1 ? { ...sl, count: sl.count - 1 } : null) : sl;
        return true;
      }
      return false;
    };
    if (!consume(hotbarSlots) && !consume(mainSlots)) {
      const matName = key.startsWith('block:') ? BLOCKS[Number(key.slice(6))]?.name : (MATERIAL_INFO[key.slice(9)]?.name ?? key.slice(9));
      return { ok: false, notice: `修复需要 1 个${matName}` };
    }
    hotbarSlots[s.selectedSlot] = { ...held, durability: Math.min(maxDura, held.durability + Math.ceil(maxDura * 0.25)), works: works + 1 };
    set({ hotbarSlots, mainSlots, ...(free ? {} : { xpTotal: subtractLevels(s.xpTotal, cost) }) });
    return { ok: true, notice: `已修复（+25% 耐久）${free ? '' : `，消耗 ${cost} 级`}` };
  },
  consumeSelectedBlock: () => {
    let id: BlockId | null = null;
    set((s) => {
      const slot = s.hotbarSlots[s.selectedSlot];
      if (!slot || slot.kind !== 'block' || slot.count <= 0) return s;
      id = slot.id;
      const slots = [...s.hotbarSlots];
      slots[s.selectedSlot] = slot.count > 1 ? { ...slot, count: slot.count - 1 } : null;
      return { hotbarSlots: slots };
    });
    return id;
  },
  damageHeldTool: (amount) =>
    set((s) => {
      if (s.worldMode === 'creative') return s; // MC：创造模式工具/武器不耗耐久
      const slot = s.hotbarSlots[s.selectedSlot];
      if (!slot || slot.kind !== 'tool') return s;
      // 耐久附魔：每级 1/(lvl+1) 概率不掉耐久（MC 公式）
      const unb = slot.ench?.unbreaking ?? 0;
      if (unb > 0 && Math.random() < unb / (unb + 1)) return s;
      const durability = slot.durability - amount;
      const slots = [...s.hotbarSlots];
      slots[s.selectedSlot] = durability > 0 ? { ...slot, durability } : null;
      return { hotbarSlots: slots };
    }),
  // 从全物品栏（热键栏 + 背包）消耗材料（MC：消耗品如箭/青金石在背包也算数；原先只查热键栏，箭全在背包时弓误报"没有箭了"）
  consumeMaterial: (material, count = 1) => {
    let ok = false;
    set((s) => {
      let remaining = count;
      const drain = (slots: Slot[]): Slot[] =>
        slots.map((slot) => {
          if (remaining > 0 && slot?.kind === 'material' && slot.material === material) {
            const take = Math.min(slot.count, remaining);
            remaining -= take;
            return slot.count > take ? { ...slot, count: slot.count - take } : null;
          }
          return slot;
        });
      const hotbarSlots = drain(s.hotbarSlots);
      const mainSlots = drain(s.mainSlots);
      if (remaining > 0) return s; // 不够，一个都不扣
      ok = true;
      return { hotbarSlots, mainSlots };
    });
    return ok;
  },
  smithingUpgrade: () => {
    let ok = false;
    set((s) => {
      const held = s.hotbarSlots[s.selectedSlot];
      if (held?.kind !== 'material' || held.material !== 'netherite_ingot') return s;
      // 热键栏优先、背包其次：找第一个可升级的钻石工具或钻石甲（MC 锻造台）
      const upgradable = (sl: Slot): boolean =>
        (sl?.kind === 'tool' && netheriteUpgradeOf(sl.tool) !== null) || (sl?.kind === 'armor' && sl.material === 'diamond');
      const hi = s.hotbarSlots.findIndex(upgradable);
      const mi = hi < 0 ? s.mainSlots.findIndex(upgradable) : -1;
      if (hi < 0 && mi < 0) return s;
      const hotbarSlots = [...s.hotbarSlots];
      const mainSlots = [...s.mainSlots];
      const upgrade = (sl: Slot): Slot => {
        if (sl?.kind === 'tool') {
          const to = netheriteUpgradeOf(sl.tool);
          return to ? { ...sl, tool: to } : sl; // 耐久/附魔原样保留（MC）
        }
        if (sl?.kind === 'armor' && sl.material === 'diamond') return { ...sl, material: 'netherite' as const };
        return sl;
      };
      if (hi >= 0) hotbarSlots[hi] = upgrade(hotbarSlots[hi]);
      else mainSlots[mi] = upgrade(mainSlots[mi]);
      // 消耗手持 1 锭（选中格即材料格）
      const cur = hotbarSlots[s.selectedSlot];
      if (cur?.kind !== 'material') return s;
      hotbarSlots[s.selectedSlot] = cur.count > 1 ? { ...cur, count: cur.count - 1 } : null;
      ok = true;
      return { hotbarSlots, mainSlots };
    });
    return ok;
  },
  craft: (recipe) => {
    const s = get();
    // 合成考虑整个物品栏（热键栏 + 背包，MC 一致）；产物优先热键栏
    const merged = [...s.hotbarSlots, ...s.mainSlots];
    if (!canCraft(merged, recipe)) return false;
    if (!hasSpaceFor(merged, recipe.out)) return false;
    const durability =
      recipe.out.kind === 'tool'
        ? TOOLS[recipe.out.tool].durability
        : recipe.out.kind === 'armor'
          ? armorDef(recipe.out.material ?? 'leather', recipe.out.piece).durability
          : 0;
    const next = applyCraft(merged, recipe, durability);
    set({ hotbarSlots: next.slice(0, 9), mainSlots: next.slice(9) });
    return true;
  },
  craftAll: (recipe) => {
    // MC Java：shift+点击结果槽连续合成，直到材料耗尽或背包满（craft 内含 canCraft/hasSpaceFor 预检）；
    // 单次 action 内循环完成，无逐次音效/提示；材料有限必终止（999 仅为保险上限）
    let n = 0;
    while (n < 999 && get().craft(recipe)) n++;
    return n;
  },
  moveSlot: (area, index) =>
    set((s) => {
      const from = area === 'hotbar' ? s.hotbarSlots : s.mainSlots;
      const to = area === 'hotbar' ? s.mainSlots : s.hotbarSlots;
      const slot = from[index];
      if (!slot) return s;
      if (slot.kind === 'block' || slot.kind === 'material') {
        const item = slot.kind === 'block' ? { kind: 'block' as const, id: slot.id } : { kind: 'material' as const, material: slot.material };
        const out = addStackToSlots(to, item, slot.count);
        if (out.leftover === slot.count) return s; // 一格都没动
        const nextFrom = [...from];
        nextFrom[index] = out.leftover > 0 ? { ...slot, count: out.leftover } : null;
        return area === 'hotbar' ? { hotbarSlots: nextFrom, mainSlots: out.slots } : { mainSlots: nextFrom, hotbarSlots: out.slots };
      }
      // 工具/装备：找空槽
      const empty = to.indexOf(null);
      if (empty < 0) return s;
      const nextTo = [...to];
      nextTo[empty] = slot;
      const nextFrom = [...from];
      nextFrom[index] = null;
      return area === 'hotbar' ? { hotbarSlots: nextFrom, mainSlots: nextTo } : { mainSlots: nextFrom, hotbarSlots: nextTo };
    }),
  unequipArmor: (piece) =>
    set((s) => {
      const cur = s.armorSlots[piece];
      if (!cur) return s;
      const slot: Slot = { kind: 'armor', piece, durability: cur.durability, ench: cur.ench, material: cur.material };
      let hotbarSlots = s.hotbarSlots;
      let mainSlots = s.mainSlots;
      const hi = hotbarSlots.indexOf(null);
      if (hi >= 0) {
        hotbarSlots = [...hotbarSlots];
        hotbarSlots[hi] = slot;
      } else {
        const mi = mainSlots.indexOf(null);
        if (mi < 0) return s;
        mainSlots = [...mainSlots];
        mainSlots[mi] = slot;
      }
      return { hotbarSlots, mainSlots, armorSlots: { ...s.armorSlots, [piece]: null } };
    }),
}));

export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 8);
}

// persistence 的用户可见提示（存档损坏/版本不兼容/写入失败）注入到 Hud 的 Notice 条——
// persistence 不反向 import store，故由这里经回调注入（模块加载即注册，菜单/游戏内都生效）
setPersistenceNoticeHandler((message) => useGameStore.getState().setNotice(message));
