// zustand 全局状态：界面、种子、热键栏、飞行/暂停、生存数值、槽位背包、装备

import { create } from 'zustand';
import { armorDef, armorDefOf, armorPoints, emptyArmorSlots } from './armor';
import { armorRepairMaterial, enchLevelSum, mergeEnchants, priorWorkPenalty, toolRepairMaterial } from './anvil';
import { BLOCKS, HOTBAR_BLOCKS, type BlockId } from './blocks';
import { getBrew, putIntoBrewing, takePotion } from './brewing';
import { MATERIAL_INFO } from './materials';
import { FOODS, getFurnace, putIntoFurnace, takeOutput } from './furnace';
import { hurtState, playerPosition, survivalStats, worldClock } from './game';
import { effects } from './effects';
import { beaconTiers } from './beacon';
import { spawnArmorDrop, spawnBlockDrop, spawnMaterialDrop, spawnToolDrop } from './items';
import { applyCraft, canCraft, hasSpaceFor } from './recipes';
import { netheriteUpgradeOf } from './smithing';
import { addArmorToSlots, addStackToSlots, addToolToSlots, emptyBackpack, emptySlots, type Slot } from './slots';
import { getStorage, putIntoStorage, takeFromStorage } from './storage';
import { TOOLS } from './tools';
import { executeTrade, MAX_TRADE_USES, professionOf, TRADES, tradeDay, tradeStockLeft, deductTradeStock } from './trading';
import { levelFromXp, subtractLevels } from './xp';

// 类型与共享常量在 lib/store-types.ts（slice 组合需要）；此处再导出保持既有 import 路径不变
export type { Screen, GameMode, WorldMode, Settings, GameStore } from './store-types';
export { ALL_PANELS_CLOSED, anyPanelOpen, DEFAULT_SETTINGS } from './store-types';
import { ALL_PANELS_CLOSED, type GameStore } from './store-types';
import { createSettingsSlice } from './store-settings';
import { createPanelsSlice } from './store-panels';

export const MAX_HEALTH = 20;
export const MAX_HUNGER = 20;
/** MC 饱和度上限（隐藏值，先于饥饿消耗） */
export const MAX_SATURATION = 5;
const HURT_COOLDOWN = 500; // ms 受击无敌帧

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
  lastDamageAt: 0,
  hotbarSlots: emptySlots(),
  mainSlots: emptyBackpack(),
  armorSlots: emptyArmorSlots(),
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
      // 创造模式热键栏给默认方块面板（hotbarSlots 与生存共用一套——创造可持工具/材料，MC 模型）；生存为空
      hotbarSlots: worldMode === 'creative' ? HOTBAR_BLOCKS.map((id) => ({ kind: 'block' as const, id, count: 1 })) : emptySlots(),
      mainSlots: emptyBackpack(), armorSlots: emptyArmorSlots(), craftingOpen: false, pickerOpen: false, furnaceOpen: null, brewingOpen: null, enchantOpen: null, tradeMob: null, storageOpen: null,
    });
  },
  continueGame: () =>
    set({ screen: 'playing', mode: 'continue', paused: false, flying: false, worldReady: false, loadError: null, hasLocked: false, spawnPoint: null, respawnPoint: null, dead: false, craftingOpen: false, pickerOpen: false, furnaceOpen: null, brewingOpen: null, enchantOpen: null, tradeMob: null, storageOpen: null }),
  backToMenu: () => set({ screen: 'menu', paused: false, hasLocked: false, spawnPoint: null, respawnPoint: null, craftingOpen: false, pickerOpen: false, furnaceOpen: null, brewingOpen: null, enchantOpen: null, tradeMob: null, storageOpen: null, loadError: null }),
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
  addXp: (amount) => set((s) => ({ xpTotal: s.xpTotal + Math.max(0, Math.floor(amount)) })),
  enchantApply: (slotIndex, offer) => {
    const s = get();
    const slot = s.hotbarSlots[slotIndex];
    if (!slot || (slot.kind !== 'tool' && slot.kind !== 'armor')) return false;
    const { level } = levelFromXp(s.xpTotal);
    if (level < offer.levels) {
      s.setNotice(`经验等级不足（需要 ${offer.levels} 级）`);
      return false;
    }
    if (!s.consumeMaterial('lapis', offer.lapis)) {
      s.setNotice(`青金石不足（需要 ${offer.lapis} 个）`);
      return false;
    }
    // 同种附魔取更高级（MC 不降级）；必须从扣料后的最新状态构造 next（否则覆盖掉刚扣的青金石）
    const curSlots = get().hotbarSlots;
    const cur = curSlots[slotIndex];
    if (!cur || (cur.kind !== 'tool' && cur.kind !== 'armor')) return false;
    const ench = { ...cur.ench, [offer.ench]: Math.max(cur.ench?.[offer.ench] ?? 0, offer.lvl) };
    const next = [...curSlots];
    next[slotIndex] = { ...cur, ench };
    set({ hotbarSlots: next, xpTotal: subtractLevels(get().xpTotal, offer.levels) });
    return true;
  },
  setHealth: (health) => set({ health }),
  setHunger: (hunger) => set({ hunger }),
  setSaturation: (saturation) => set({ saturation }),
  setDead: (dead) => set({ dead }),
  damagePlayer: (amount, opts) => {
    // MC：创造模式玩家无敌，不受任何伤害（虚空 /kill 由各自路径单独处理，不经此函数）
    if (get().worldMode === 'creative') return false;
    const now = performance.now();
    if (now - hurtState.lastAt < HURT_COOLDOWN) return false;
    hurtState.lastAt = now;
    survivalStats.exhaustion += 0.1; // MC：受击也消耗能量
    set((s) => {
      // 皮甲减伤（每护甲点 4%，与 MC 一致）+ 保护附魔减伤（每级 4%，上限 80%，MC）并扣每件装备 1 点耐久；抗性效果（信标）再减 20%/级（4 层金字塔 II 级 40%）
      // MC：摔落/溺水/虚空/凋零等伤害不被护甲/保护减免，也不耗装备耐久（bypassArmor）
      const bypass = opts?.bypassArmor === true;
      const points = bypass ? 0 : armorPoints(s.armorSlots);
      const protLvl = bypass ? 0 : Object.values(s.armorSlots).reduce((n, p) => n + (p?.ench?.protection ?? 0), 0);
      const reduction = points * 0.04 + Math.min(0.8 - points * 0.04, protLvl * 0.04) + (effects.resistance > 0 ? 0.2 * (beaconTiers.get('resistance') ?? 1) : 0);
      const finalAmount = reduction > 0 ? Math.max(1, Math.ceil(amount * (1 - Math.min(0.8, reduction)))) : amount;
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
        // 死亡掉落：热键栏 + 背包 + 装备槽全部物品散落在死亡点（与 MC 一致）；经验清零
        xpTotal = 0;
        const { x, y, z } = playerPosition;
        for (const slot of [...s.hotbarSlots, ...s.mainSlots]) {
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
        hotbarSlots = emptySlots();
        mainSlots = emptyBackpack();
        armorSlots = emptyArmorSlots();
      }
      return {
        health,
        dead: health <= 0 || s.dead,
        lastDamageAt: now,
        hotbarSlots,
        mainSlots,
        armorSlots,
        xpTotal,
        // 死亡时关掉所有打开的界面（仅受伤未死不动）
        ...(died ? ALL_PANELS_CLOSED : {}),
      };
    });
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
      dead: false,
    }),
  executeMobTrade: (i) => {
    const s = get();
    if (s.tradeMob === null) return;
    const trade = TRADES[professionOf(s.tradeMob)][i];
    if (!trade) return;
    // 库存（简化 MC）：每项每天限购，售罄拒绝并提示；成交才扣库存
    const day = tradeDay(worldClock.t);
    if (tradeStockLeft(s.tradeMob, i, day) <= 0) {
      s.setNotice(`该交易今日已达上限（${MAX_TRADE_USES} 次），明天补货`);
      return;
    }
    const r = executeTrade(s.hotbarSlots, s.mainSlots, trade, s.worldMode === 'creative');
    if (!r) return;
    deductTradeStock(s.tradeMob, i, day);
    set({ hotbarSlots: r.hotbar, mainSlots: r.backpack });
    s.addXp(r.xp);
  },
  tradeStockLeft: (i) => {
    const s = get();
    if (s.tradeMob === null) return 0;
    return tradeStockLeft(s.tradeMob, i, tradeDay(worldClock.t));
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
    if (s.hunger >= MAX_HUNGER) return false; // MC：满饥饿不能进食
    const hunger = Math.min(MAX_HUNGER, s.hunger + food.hunger);
    // MC：饱和度不超过饥饿值（本游戏饥饿 20 / 饱和 5）
    const saturation = Math.min(MAX_SATURATION, s.saturation + food.saturation, hunger / 4);
    const slots = [...s.hotbarSlots];
    slots[s.selectedSlot] = slot.count > 1 ? { ...slot, count: slot.count - 1 } : null;
    set({ hunger, saturation, hotbarSlots: slots });
    return true;
  },
  furnacePut: (slotIndex, force) => {
    const s = get();
    if (!s.furnaceOpen) return;
    const { slots, to } = putIntoFurnace(s.hotbarSlots, slotIndex, getFurnace(s.furnaceOpen), force);
    if (to) set({ hotbarSlots: slots });
  },
  furnaceTakeOutput: () => {
    const s = get();
    if (!s.furnaceOpen) return;
    const f = getFurnace(s.furnaceOpen);
    const before = f.output?.count ?? 0;
    set({ hotbarSlots: takeOutput(s.hotbarSlots, f) });
    // 烧炼产出经验：按实际取出件数 +1 XP/件（热键栏满取不出则不给，MC 烧炼经验简化）
    const taken = before - (f.output?.count ?? 0);
    if (taken > 0) s.addXp(taken);
  },
  brewingPut: (slotIndex) => {
    const s = get();
    if (!s.brewingOpen) return;
    const { slots, to } = putIntoBrewing(s.hotbarSlots, slotIndex, getBrew(s.brewingOpen));
    if (to) set({ hotbarSlots: slots });
  },
  brewingTakePotion: (i) => {
    const s = get();
    if (!s.brewingOpen) return;
    set({ hotbarSlots: takePotion(s.hotbarSlots, getBrew(s.brewingOpen), i) });
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
      // MC 铁砧经验费：合并附魔等级总和 + 累计使用惩罚（2^works-1）；>30 级「过于昂贵」拒绝；创造模式免费
      const works = held.works ?? 0;
      const cost = enchLevelSum(mergedEnch) + priorWorkPenalty(works);
      const free = s.worldMode === 'creative';
      if (!free && cost > 30) return { ok: false, notice: '过于昂贵！' };
      if (!free && levelFromXp(s.xpTotal).level < cost) return { ok: false, notice: `经验不足（需要 ${cost} 级）` };
      const hotbarSlots = [...s.hotbarSlots];
      const mainSlots = [...s.mainSlots];
      const merged = {
        ...held,
        ench: mergedEnch,
        durability: Math.min(maxDura, held.durability + Math.ceil(maxDura * 0.12)), // MC 合并 +12% 耐久
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
    // MC 铁砧修复经验费：2 级 + 累计使用惩罚；>30 级「过于昂贵」拒绝；创造免费
    const works = held.works ?? 0;
    const cost = 2 + priorWorkPenalty(works);
    const free = s.worldMode === 'creative';
    if (!free && cost > 30) return { ok: false, notice: '过于昂贵！' };
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
