// zustand 全局状态：界面、种子、热键栏、飞行/暂停、生存数值、槽位背包、装备

import { create } from 'zustand';
import { armorDef, armorDefOf, armorPoints, emptyArmorSlots, type ArmorMaterial, type ArmorPiece, type ArmorSlots } from './armor';
import { armorRepairMaterial, mergeEnchants, toolRepairMaterial } from './anvil';
import { BLOCKS, HOTBAR_BLOCKS, type BlockId } from './blocks';
import { getBrew, putIntoBrewing, takePotion } from './brewing';
import { MATERIAL_INFO } from './materials';
import { FOODS, getFurnace, putIntoFurnace, takeOutput } from './furnace';
import { hurtState, playerPosition, survivalStats } from './game';
import { effects } from './effects';
import { spawnArmorDrop, spawnBlockDrop, spawnMaterialDrop, spawnToolDrop } from './items';
import { applyCraft, canCraft, hasSpaceFor, type Recipe } from './recipes';
import { netheriteUpgradeOf } from './smithing';
import { addArmorToSlots, addStackToSlots, addToolToSlots, emptyBackpack, emptySlots, type Slot } from './slots';
import { getStorage, putIntoStorage, takeFromStorage } from './storage';
import { TOOLS, type ToolType } from './tools';
import { executeTrade, professionOf, TRADES } from './trading';
import { levelFromXp, subtractLevels, type EnchOffer } from './xp';

export type Screen = 'menu' | 'playing';
export type GameMode = 'new' | 'continue';
export type WorldMode = 'creative' | 'survival';

export const MAX_HEALTH = 20;
export const MAX_HUNGER = 20;
/** MC 饱和度上限（隐藏值，先于饥饿消耗） */
export const MAX_SATURATION = 5;
const HURT_COOLDOWN = 500; // ms 受击无敌帧

export interface Settings {
  /** 主音量 0..1 */
  volume: number;
  /** 视野角度 60..110 */
  fov: number;
  /** 渲染距离（chunk 半径）2..8 */
  renderDistance: number;
  /** 视角灵敏度倍率 0.5..2 */
  sensitivity: number;
  /** 渲染器：WebGPU（默认，不支持自动降级 WebGL）/ WebGL */
  renderer: 'webgl' | 'webgpu';
}

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.55,
  fov: 75,
  renderDistance: 6,
  sensitivity: 1,
  renderer: 'webgpu',
};

const SETTINGS_KEY = 'kimi-mc-settings';

function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: Settings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // 隐私模式等场景下写入失败，忽略
  }
}

interface GameStore {
  screen: Screen;
  mode: GameMode;
  seed: string;
  selectedSlot: number;
  flying: boolean;
  /** 指针未锁定时为 true（显示暂停遮罩） */
  paused: boolean;
  /** F3 调试面板 */
  debug: boolean;
  /** 触屏设备（初始化时检测一次）：显示触控层、禁用指针锁流程 */
  touchMode: boolean;
  /** 世界与贴图加载完成（加载中显示覆盖层） */
  worldReady: boolean;
  /** 世界加载失败信息（覆盖层显示并提供重试），null 表示正常 */
  loadError: string | null;
  /** 世界加载重试计数（变化触发 WorldRenderer 重新加载） */
  worldRetry: number;
  /** 本局是否锁定过指针（区分「准备进入」和「已暂停」文案） */
  hasLocked: boolean;
  /** 用户设置（localStorage 持久化） */
  settings: Settings;
  /** 本局出生点（继续游戏时取存档位置，新游戏为 null 用默认出生点） */
  spawnPoint: { x: number; y: number; z: number } | null;
  /** 世界模式：创造 / 生存（开局定，随存档） */
  worldMode: WorldMode;
  /** 当前维度（主世界 / 下界，随存档） */
  dimension: import('./dimension').Dimension;
  /** 生存数值（创造模式不使用） */
  health: number;
  hunger: number;
  /** 经验总量（MC 等级由 levelFromXp 换算） */
  xpTotal: number;
  /** MC 隐藏饱和度：先于饥饿消耗，满饥饿且有饱和度时快速回血 */
  saturation: number;
  dead: boolean;
  /** 最近一次实际受伤时间戳（HUD 红屏闪烁） */
  lastDamageAt: number;
  /** 生存模式热键栏 9 格（方块堆叠 / 材料 / 工具 / 装备） */
  hotbarSlots: Slot[];
  /** 生存模式主物品栏 27 格（热键栏放不下时溢出到这里；E 打开物品栏互移） */
  mainSlots: Slot[];
  /** 装备槽（皮甲 4 件） */
  armorSlots: ArmorSlots;
  /** 合成界面开关与是否带工作台（3×3 配方） */
  craftingOpen: boolean;
  craftingTable: boolean;
  /** 打开的熔炉位置 key（"x,y,z"），null 未打开 */
  furnaceOpen: string | null;
  /** 打开的酿造台位置 key，null 未打开 */
  brewingOpen: string | null;
  /** 附魔台界面开关（不绑位置，null 未打开） */
  enchantOpen: string | null;
  /** 正在交易的村民 id（null 未打开交易界面） */
  tradeMob: number | null;
  /** 打开的容器（箱子/木桶）位置 key，null 未打开 */
  storageOpen: string | null;
  /** 创造模式热键栏 9 格内容（选块界面可更换） */
  hotbarBlocks: BlockId[];
  /** 创造选块界面开关 */
  pickerOpen: boolean;
  startNew: (seed: string, worldMode: WorldMode) => void;
  continueGame: () => void;
  backToMenu: () => void;
  setSlot: (i: number) => void;
  setHotbarBlock: (slot: number, id: BlockId) => void;
  setPickerOpen: (open: boolean) => void;
  toggleFly: () => void;
  setPaused: (paused: boolean) => void;
  toggleDebug: () => void;
  setWorldReady: (ready: boolean) => void;
  setLoadError: (msg: string | null) => void;
  /** 清错误并触发重新加载（worldRetry +1） */
  retryWorld: () => void;
  setHasLocked: (locked: boolean) => void;
  setSpawnPoint: (p: { x: number; y: number; z: number } | null) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setWorldMode: (m: WorldMode) => void;
  setDimension: (d: import('./dimension').Dimension) => void;
  /** 增加经验（杀怪/挖矿/烧炼/繁殖） */
  addXp: (amount: number) => void;
  /** 附魔：对热键栏 slotIndex 的工具/装备应用一个附魔项（消耗青金石与整级经验），返回是否成功 */
  enchantApply: (slotIndex: number, offer: EnchOffer) => boolean;
  setHealth: (v: number) => void;
  setHunger: (v: number) => void;
  setSaturation: (v: number) => void;
  setDead: (d: boolean) => void;
  /** 受伤（带无敌帧）；返回是否实际扣血 */
  damagePlayer: (amount: number) => boolean;
  /** 读档时恢复生存数值 */
  loadSurvival: (s: { health: number; hunger: number; saturation?: number; slots?: Slot[]; backpack?: Slot[]; armor?: ArmorSlots; xp?: number }) => void;
  setCraftingOpen: (open: boolean, withTable?: boolean) => void;
  setFurnaceOpen: (key: string | null) => void;
  setBrewingOpen: (key: string | null) => void;
  setEnchantOpen: (key: string | null) => void;
  setTradeMob: (id: number | null) => void;
  /** 执行当前村民的第 i 项交易（扣付出、给获得、加经验） */
  executeMobTrade: (i: number) => void;
  setStorageOpen: (key: string | null) => void;
  /** 把热键栏/背包某格的整叠物品移入打开的容器 */
  storagePut: (area: 'hotbar' | 'main', slotIndex: number) => void;
  /** 把打开容器的 index 整叠物品移到热键栏 */
  storageTake: (index: number) => void;
  /** 吃选中槽位的食物（MC：回复饥饿与饱和度），非食物返回 false */
  eatSelectedFood: () => boolean;
  /** 把热键栏 slotIndex 的物品移 1 个进打开的熔炉（force 指定去向） */
  furnacePut: (slotIndex: number, force?: 'input' | 'fuel') => void;
  /** 取出打开熔炉的全部产出 */
  furnaceTakeOutput: () => void;
  /** 把热键栏 slotIndex 的物品移 1 个进打开的酿造台 */
  brewingPut: (slotIndex: number) => void;
  /** 取出打开酿造台药水槽 i 的药水 */
  brewingTakePotion: (i: number) => void;
  /** 向热键栏添加可堆叠物品，返回放不下的数量 */
  addStack: (item: { kind: 'block'; id: BlockId } | { kind: 'material'; material: string }, count?: number) => number;
  /** 给工具找空槽，满则返回 false */
  addTool: (tool: ToolType, durability?: number) => boolean;
  /** 给装备找空槽，满则返回 false */
  addArmor: (piece: ArmorPiece, durability?: number, material?: ArmorMaterial) => boolean;
  /** 把选中的装备穿上（已有装备换回手中），非装备返回 false */
  equipSelectedArmor: () => boolean;
  /** 从选中槽位消耗一个方块用于放置，返回其 id；选中不是方块或为空返回 null */
  consumeSelectedBlock: () => BlockId | null;
  /** 扣选中工具的耐久，耗尽则移除该槽位 */
  damageHeldTool: (amount: number) => void;
  /** 从热键栏任意槽位消耗材料，不足则一个不扣并返回 false */
  consumeMaterial: (material: string, count?: number) => boolean;
  /** 锻造台升级：手持下界合金锭 + 物品栏首个钻石工具 → 下界合金工具（保留附魔/耐久，MC），成功返回 true */
  smithingUpgrade: () => boolean;
  /** 手持鞘翅右击：装备到胸甲槽（原胸甲回手，MC），成功返回 true */
  equipElytra: () => boolean;
  /** 铁砧：手持工具/装备右击——有同型带附魔件则附魔合并（B 消失），否则耗 1 对应材料修 25% 耐久（MC） */
  anvilUse: () => { ok: boolean; notice: string };
  /** 短暂提示条（睡觉/合成等反馈），HUD 定时清除 */
  notice: string | null;
  setNotice: (text: string | null) => void;
  /** 执行一次合成（材料与空间预检），成功返回 true */
  craft: (recipe: Recipe) => boolean;
  /** 物品栏内移动：点击把 hotbar/main 某格整格移到另一区域（可堆叠自动合并） */
  moveSlot: (area: 'hotbar' | 'main', index: number) => void;
  /** 卸下装备槽的一件装备到物品栏（热键栏优先），满则不动 */
  unequipArmor: (piece: ArmorPiece) => void;
}

export const useGameStore = create<GameStore>()((set, get) => ({
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
  settings: loadSettings(),
  spawnPoint: null,
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
  craftingOpen: false,
  craftingTable: false,
  furnaceOpen: null, brewingOpen: null, enchantOpen: null, tradeMob: null,
  storageOpen: null,
  hotbarBlocks: [...HOTBAR_BLOCKS],
  pickerOpen: false,
  notice: null,
  setNotice: (notice) => set({ notice }),
  touchMode:
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || (window.matchMedia?.('(pointer: coarse)')?.matches ?? false)),
  startNew: (seed, worldMode) => {
    survivalStats.exhaustion = 0;
    set({
      screen: 'playing', mode: 'new', seed, paused: false, flying: false, worldReady: false, loadError: null,
      hasLocked: false, spawnPoint: null,
      worldMode, health: MAX_HEALTH, hunger: MAX_HUNGER, saturation: MAX_SATURATION, xpTotal: 0,
      dimension: 'overworld',
      dead: false, hotbarSlots: emptySlots(), mainSlots: emptyBackpack(), armorSlots: emptyArmorSlots(), craftingOpen: false, furnaceOpen: null, brewingOpen: null, enchantOpen: null, tradeMob: null, storageOpen: null,
    });
  },
  continueGame: () =>
    set({ screen: 'playing', mode: 'continue', paused: false, flying: false, worldReady: false, loadError: null, hasLocked: false, spawnPoint: null, dead: false, craftingOpen: false, furnaceOpen: null, brewingOpen: null, enchantOpen: null, storageOpen: null }),
  backToMenu: () => set({ screen: 'menu', paused: false, hasLocked: false, spawnPoint: null, craftingOpen: false, furnaceOpen: null, brewingOpen: null, enchantOpen: null, tradeMob: null, storageOpen: null, loadError: null }),
  setSlot: (i) => set({ selectedSlot: i }),
  setHotbarBlock: (slot, id) =>
    set((s) => {
      if (slot < 0 || slot >= s.hotbarBlocks.length) return s;
      const hotbarBlocks = [...s.hotbarBlocks];
      hotbarBlocks[slot] = id;
      return { hotbarBlocks };
    }),
  setPickerOpen: (pickerOpen) => {
    if (pickerOpen && typeof document !== 'undefined') document.exitPointerLock();
    // 界面互斥：打开时关掉其余三个界面（关闭时不动其他的）
    set(pickerOpen ? { pickerOpen, craftingOpen: false, furnaceOpen: null, brewingOpen: null, enchantOpen: null, storageOpen: null } : { pickerOpen });
  },
  toggleFly: () => set((s) => ({ flying: s.worldMode === 'creative' ? !s.flying : false })),
  setPaused: (paused) => set({ paused }),
  toggleDebug: () => set((s) => ({ debug: !s.debug })),
  setWorldReady: (worldReady) => set({ worldReady }),
  setLoadError: (loadError) => set({ loadError }),
  retryWorld: () => set((s) => ({ loadError: null, worldReady: false, worldRetry: s.worldRetry + 1 })),
  setHasLocked: (hasLocked) => set({ hasLocked }),
  setSpawnPoint: (spawnPoint) => set({ spawnPoint }),
  updateSettings: (patch) =>
    set((s) => {
      const settings = { ...s.settings, ...patch };
      saveSettings(settings);
      return { settings };
    }),
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
    // 同种附魔取更高级（MC 不降级）
    const ench = { ...slot.ench, [offer.ench]: Math.max(slot.ench?.[offer.ench] ?? 0, offer.lvl) };
    const next = [...s.hotbarSlots];
    next[slotIndex] = { ...slot, ench };
    set({ hotbarSlots: next, xpTotal: subtractLevels(s.xpTotal, offer.levels) });
    return true;
  },
  setHealth: (health) => set({ health }),
  setHunger: (hunger) => set({ hunger }),
  setSaturation: (saturation) => set({ saturation }),
  setDead: (dead) => set({ dead }),
  damagePlayer: (amount) => {
    const now = performance.now();
    if (now - hurtState.lastAt < HURT_COOLDOWN) return false;
    hurtState.lastAt = now;
    survivalStats.exhaustion += 0.1; // MC：受击也消耗能量
    set((s) => {
      // 皮甲减伤（每护甲点 4%，与 MC 一致）+ 保护附魔减伤（每级 4%，上限 80%，MC）并扣每件装备 1 点耐久；抗性效果（信标）再减 20%
      const points = armorPoints(s.armorSlots);
      const protLvl = Object.values(s.armorSlots).reduce((n, p) => n + (p?.ench?.protection ?? 0), 0);
      const reduction = points * 0.04 + Math.min(0.8 - points * 0.04, protLvl * 0.04) + (effects.resistance > 0 ? 0.2 : 0);
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
          else if (slot.kind === 'tool') spawnToolDrop(slot.tool, x, y + 0.5, z, slot.durability);
          else spawnArmorDrop(slot.piece, x, y + 0.5, z, slot.durability, slot.material);
        }
        for (const piece of ['helmet', 'chestplate', 'leggings', 'boots'] as const) {
          const cur = armorSlots[piece];
          if (cur) spawnArmorDrop(piece, x, y + 0.5, z, cur.durability, cur.material);
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
        ...(died ? { craftingOpen: false, furnaceOpen: null, brewingOpen: null, enchantOpen: null, tradeMob: null, storageOpen: null, pickerOpen: false } : {}),
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
  setCraftingOpen: (craftingOpen, withTable) => {
    if (craftingOpen && typeof document !== 'undefined') document.exitPointerLock(); // 打开界面先解锁指针，否则无法操作
    // 界面互斥：打开时关掉其余三个界面（关闭时不动其他的）
    set((s) => ({
      craftingOpen,
      craftingTable: craftingOpen ? (withTable ?? s.craftingTable) : s.craftingTable,
      ...(craftingOpen ? { furnaceOpen: null, brewingOpen: null, enchantOpen: null, tradeMob: null, storageOpen: null, pickerOpen: false } : {}),
    }));
  },
  setFurnaceOpen: (furnaceOpen) => {
    if (furnaceOpen && typeof document !== 'undefined') document.exitPointerLock();
    // 界面互斥：打开时关掉其余三个界面（关闭时不动其他的）
    set(furnaceOpen ? { furnaceOpen, craftingOpen: false, brewingOpen: null, enchantOpen: null, tradeMob: null, storageOpen: null, pickerOpen: false } : { furnaceOpen });
  },
  setBrewingOpen: (brewingOpen) => {
    if (brewingOpen && typeof document !== 'undefined') document.exitPointerLock();
    // 界面互斥：打开时关掉其余界面（关闭时不动其他的）
    set(brewingOpen ? { brewingOpen, craftingOpen: false, furnaceOpen: null, storageOpen: null, pickerOpen: false } : { brewingOpen });
  },
  setEnchantOpen: (enchantOpen) => {
    if (enchantOpen && typeof document !== 'undefined') document.exitPointerLock();
    set(enchantOpen ? { enchantOpen, craftingOpen: false, furnaceOpen: null, brewingOpen: null, storageOpen: null, pickerOpen: false } : { enchantOpen });
  },
  setTradeMob: (tradeMob) => {
    if (tradeMob !== null && typeof document !== 'undefined') document.exitPointerLock();
    set(tradeMob !== null ? { tradeMob, craftingOpen: false, furnaceOpen: null, brewingOpen: null, storageOpen: null, pickerOpen: false, enchantOpen: null } : { tradeMob });
  },
  executeMobTrade: (i) => {
    const s = get();
    if (s.tradeMob === null) return;
    const trade = TRADES[professionOf(s.tradeMob)][i];
    if (!trade) return;
    const r = executeTrade(s.hotbarSlots, s.mainSlots, trade);
    if (!r) return;
    set({ hotbarSlots: r.hotbar, mainSlots: r.backpack });
    s.addXp(r.xp);
  },
  setStorageOpen: (storageOpen) => {
    if (storageOpen && typeof document !== 'undefined') document.exitPointerLock();
    // 界面互斥：打开时关掉其余三个界面（关闭时不动其他的）
    set(storageOpen ? { storageOpen, craftingOpen: false, furnaceOpen: null, brewingOpen: null, enchantOpen: null, pickerOpen: false } : { storageOpen });
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
    const before = getFurnace(s.furnaceOpen).output;
    set({ hotbarSlots: takeOutput(s.hotbarSlots, getFurnace(s.furnaceOpen)) });
    // 烧炼产出经验：每取出一件 +1 XP（MC 烧炼经验简化）
    if (before) s.addXp(before.count);
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
  addTool: (tool, durability) => {
    // 热键栏满了放背包
    const hot = addToolToSlots(get().hotbarSlots, tool, durability ?? TOOLS[tool].durability);
    if (hot) {
      set({ hotbarSlots: hot });
      return true;
    }
    const main = addToolToSlots(get().mainSlots, tool, durability ?? TOOLS[tool].durability);
    if (!main) return false;
    set({ mainSlots: main });
    return true;
  },
  addArmor: (piece, durability, material) => {
    const hot = addArmorToSlots(get().hotbarSlots, piece, durability ?? armorDef(material ?? 'leather', piece).durability, material);
    if (hot) {
      set({ hotbarSlots: hot });
      return true;
    }
    const main = addArmorToSlots(get().mainSlots, piece, durability ?? armorDef(material ?? 'leather', piece).durability, material);
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
      const hotbarSlots = [...s.hotbarSlots];
      const mainSlots = [...s.mainSlots];
      const maxDura = held.kind === 'tool' ? TOOLS[held.tool].durability : armorDefOf(held).durability;
      const merged = {
        ...held,
        ench: mergeEnchants(held.ench, b.ench),
        durability: Math.min(maxDura, held.durability + Math.ceil(maxDura * 0.12)), // MC 合并 +12% 耐久
      };
      hotbarSlots[s.selectedSlot] = merged as typeof held;
      if (bIdx < hotbarSlots.length) hotbarSlots[bIdx] = null;
      else mainSlots[bIdx - hotbarSlots.length] = null;
      set({ hotbarSlots, mainSlots });
      return { ok: true, notice: '附魔已合并（同级 +1，取高级）' };
    }
    // —— 修复：耐久未满 + 物品栏有对应材料 1 个 → 补 25%（MC 材料修复） ——
    const maxDura = held.kind === 'tool' ? TOOLS[held.tool].durability : armorDefOf(held).durability;
    if (held.durability >= maxDura) return { ok: false, notice: '耐久已满，无需修复' };
    const key = held.kind === 'tool' ? toolRepairMaterial(held.tool) : armorRepairMaterial(held.material);
    if (!key) return { ok: false, notice: '该物品无法修复' };
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
    hotbarSlots[s.selectedSlot] = { ...held, durability: Math.min(maxDura, held.durability + Math.ceil(maxDura * 0.25)) };
    set({ hotbarSlots, mainSlots });
    return { ok: true, notice: '已修复（+25% 耐久）' };
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
  consumeMaterial: (material, count = 1) => {
    let ok = false;
    set((s) => {
      let remaining = count;
      const slots = s.hotbarSlots.map((slot) => {
        if (remaining > 0 && slot?.kind === 'material' && slot.material === material) {
          const take = Math.min(slot.count, remaining);
          remaining -= take;
          return slot.count > take ? { ...slot, count: slot.count - take } : null;
        }
        return slot;
      });
      if (remaining > 0) return s; // 不够，一个都不扣
      ok = true;
      return { hotbarSlots: slots };
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
      const slot: Slot = { kind: 'armor', piece, durability: cur.durability, ench: cur.ench };
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
