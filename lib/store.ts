// zustand 全局状态：界面、种子、热键栏、飞行/暂停、生存数值、槽位背包、装备

import { create } from 'zustand';
import { ARMOR_DEFS, armorPoints, emptyArmorSlots, type ArmorPiece, type ArmorSlots } from './armor';
import { HOTBAR_BLOCKS, type BlockId } from './blocks';
import { FOODS, getFurnace, putIntoFurnace, takeOutput } from './furnace';
import { hurtState, playerPosition, survivalStats } from './game';
import { spawnArmorDrop, spawnBlockDrop, spawnMaterialDrop, spawnToolDrop } from './items';
import { applyCraft, canCraft, hasSpaceFor, type Recipe } from './recipes';
import { addArmorToSlots, addStackToSlots, addToolToSlots, emptySlots, type Slot } from './slots';
import { TOOLS, type ToolType } from './tools';

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
  /** 本局是否锁定过指针（区分「准备进入」和「已暂停」文案） */
  hasLocked: boolean;
  /** 用户设置（localStorage 持久化） */
  settings: Settings;
  /** 本局出生点（继续游戏时取存档位置，新游戏为 null 用默认出生点） */
  spawnPoint: { x: number; y: number; z: number } | null;
  /** 世界模式：创造 / 生存（开局定，随存档） */
  worldMode: WorldMode;
  /** 生存数值（创造模式不使用） */
  health: number;
  hunger: number;
  /** MC 隐藏饱和度：先于饥饿消耗，满饥饿且有饱和度时快速回血 */
  saturation: number;
  dead: boolean;
  /** 最近一次实际受伤时间戳（HUD 红屏闪烁） */
  lastDamageAt: number;
  /** 生存模式热键栏 9 格（方块堆叠 / 材料 / 工具 / 装备） */
  hotbarSlots: Slot[];
  /** 装备槽（皮甲 4 件） */
  armorSlots: ArmorSlots;
  /** 合成界面开关与是否带工作台（3×3 配方） */
  craftingOpen: boolean;
  craftingTable: boolean;
  /** 打开的熔炉位置 key（"x,y,z"），null 未打开 */
  furnaceOpen: string | null;
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
  setHasLocked: (locked: boolean) => void;
  setSpawnPoint: (p: { x: number; y: number; z: number } | null) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setWorldMode: (m: WorldMode) => void;
  setHealth: (v: number) => void;
  setHunger: (v: number) => void;
  setSaturation: (v: number) => void;
  setDead: (d: boolean) => void;
  /** 受伤（带无敌帧）；返回是否实际扣血 */
  damagePlayer: (amount: number) => boolean;
  /** 读档时恢复生存数值 */
  loadSurvival: (s: { health: number; hunger: number; saturation?: number; slots?: Slot[]; armor?: ArmorSlots }) => void;
  setCraftingOpen: (open: boolean, withTable?: boolean) => void;
  setFurnaceOpen: (key: string | null) => void;
  /** 吃选中槽位的食物（MC：回复饥饿与饱和度），非食物返回 false */
  eatSelectedFood: () => boolean;
  /** 把热键栏 slotIndex 的物品移 1 个进打开的熔炉（force 指定去向） */
  furnacePut: (slotIndex: number, force?: 'input' | 'fuel') => void;
  /** 取出打开熔炉的全部产出 */
  furnaceTakeOutput: () => void;
  /** 向热键栏添加可堆叠物品，返回放不下的数量 */
  addStack: (item: { kind: 'block'; id: BlockId } | { kind: 'material'; material: string }, count?: number) => number;
  /** 给工具找空槽，满则返回 false */
  addTool: (tool: ToolType, durability?: number) => boolean;
  /** 给装备找空槽，满则返回 false */
  addArmor: (piece: ArmorPiece, durability?: number) => boolean;
  /** 把选中的装备穿上（已有装备换回手中），非装备返回 false */
  equipSelectedArmor: () => boolean;
  /** 从选中槽位消耗一个方块用于放置，返回其 id；选中不是方块或为空返回 null */
  consumeSelectedBlock: () => BlockId | null;
  /** 扣选中工具的耐久，耗尽则移除该槽位 */
  damageHeldTool: (amount: number) => void;
  /** 执行一次合成（材料与空间预检），成功返回 true */
  craft: (recipe: Recipe) => boolean;
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
  hasLocked: false,
  settings: loadSettings(),
  spawnPoint: null,
  worldMode: 'creative',
  health: MAX_HEALTH,
  hunger: MAX_HUNGER,
  saturation: MAX_SATURATION,
  dead: false,
  lastDamageAt: 0,
  hotbarSlots: emptySlots(),
  armorSlots: emptyArmorSlots(),
  craftingOpen: false,
  craftingTable: false,
  furnaceOpen: null,
  hotbarBlocks: [...HOTBAR_BLOCKS],
  pickerOpen: false,
  touchMode:
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || (window.matchMedia?.('(pointer: coarse)')?.matches ?? false)),
  startNew: (seed, worldMode) => {
    survivalStats.exhaustion = 0;
    set({
      screen: 'playing', mode: 'new', seed, paused: false, flying: false, worldReady: false,
      hasLocked: false, spawnPoint: null,
      worldMode, health: MAX_HEALTH, hunger: MAX_HUNGER, saturation: MAX_SATURATION,
      dead: false, hotbarSlots: emptySlots(), armorSlots: emptyArmorSlots(), craftingOpen: false, furnaceOpen: null,
    });
  },
  continueGame: () =>
    set({ screen: 'playing', mode: 'continue', paused: false, flying: false, worldReady: false, hasLocked: false, spawnPoint: null, dead: false, craftingOpen: false, furnaceOpen: null }),
  backToMenu: () => set({ screen: 'menu', paused: false, hasLocked: false, spawnPoint: null, craftingOpen: false, furnaceOpen: null }),
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
    set({ pickerOpen });
  },
  toggleFly: () => set((s) => ({ flying: s.worldMode === 'creative' ? !s.flying : false })),
  setPaused: (paused) => set({ paused }),
  toggleDebug: () => set((s) => ({ debug: !s.debug })),
  setWorldReady: (worldReady) => set({ worldReady }),
  setHasLocked: (hasLocked) => set({ hasLocked }),
  setSpawnPoint: (spawnPoint) => set({ spawnPoint }),
  updateSettings: (patch) =>
    set((s) => {
      const settings = { ...s.settings, ...patch };
      saveSettings(settings);
      return { settings };
    }),
  setWorldMode: (worldMode) => set({ worldMode }),
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
      // 皮甲减伤（每护甲点 4%，与 MC 一致）并扣每件装备 1 点耐久
      const points = armorPoints(s.armorSlots);
      const finalAmount = points > 0 ? Math.max(1, Math.ceil(amount * (1 - points * 0.04))) : amount;
      let armorSlots = s.armorSlots;
      if (points > 0) {
        armorSlots = { ...s.armorSlots };
        for (const piece of Object.keys(ARMOR_DEFS) as ArmorPiece[]) {
          const cur = armorSlots[piece];
          if (!cur) continue;
          const durability = cur.durability - 1;
          armorSlots[piece] = durability > 0 ? { durability } : null;
        }
      }
      const health = Math.max(0, s.health - finalAmount);
      const died = health <= 0 && !s.dead;
      let hotbarSlots = s.hotbarSlots;
      if (died) {
        // 死亡掉落：热键栏 + 装备槽全部物品散落在死亡点（与 MC 一致）
        const { x, y, z } = playerPosition;
        for (const slot of s.hotbarSlots) {
          if (!slot) continue;
          if (slot.kind === 'block') spawnBlockDrop(slot.id, x, y + 0.5, z, slot.count);
          else if (slot.kind === 'material') spawnMaterialDrop(slot.material, x, y + 0.5, z, slot.count);
          else if (slot.kind === 'tool') spawnToolDrop(slot.tool, x, y + 0.5, z, slot.durability);
          else spawnArmorDrop(slot.piece, x, y + 0.5, z, slot.durability);
        }
        for (const piece of Object.keys(ARMOR_DEFS) as ArmorPiece[]) {
          const cur = armorSlots[piece];
          if (cur) spawnArmorDrop(piece, x, y + 0.5, z, cur.durability);
        }
        hotbarSlots = emptySlots();
        armorSlots = emptyArmorSlots();
      }
      return { health, dead: health <= 0 || s.dead, lastDamageAt: now, hotbarSlots, armorSlots };
    });
    return true;
  },
  loadSurvival: ({ health, hunger, saturation, slots, armor }) =>
    set({
      health,
      hunger,
      saturation: saturation ?? MAX_SATURATION,
      hotbarSlots: slots ?? emptySlots(),
      armorSlots: armor ?? emptyArmorSlots(),
      dead: false,
    }),
  setCraftingOpen: (craftingOpen, withTable) => {
    if (craftingOpen && typeof document !== 'undefined') document.exitPointerLock(); // 打开界面先解锁指针，否则无法操作
    set((s) => ({ craftingOpen, craftingTable: craftingOpen ? (withTable ?? s.craftingTable) : s.craftingTable }));
  },
  setFurnaceOpen: (furnaceOpen) => {
    if (furnaceOpen && typeof document !== 'undefined') document.exitPointerLock();
    set({ furnaceOpen });
  },
  eatSelectedFood: () => {
    const s = get();
    const slot = s.hotbarSlots[s.selectedSlot];
    if (!slot || slot.kind !== 'material') return false;
    const food = FOODS[slot.material];
    if (!food) return false;
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
    set({ hotbarSlots: takeOutput(s.hotbarSlots, getFurnace(s.furnaceOpen)) });
  },
  addStack: (item, count = 1) => {
    const { slots, leftover } = addStackToSlots(get().hotbarSlots, item, count);
    if (slots !== get().hotbarSlots) set({ hotbarSlots: slots });
    return leftover;
  },
  addTool: (tool, durability) => {
    const next = addToolToSlots(get().hotbarSlots, tool, durability ?? TOOLS[tool].durability);
    if (!next) return false;
    set({ hotbarSlots: next });
    return true;
  },
  addArmor: (piece, durability) => {
    const next = addArmorToSlots(get().hotbarSlots, piece, durability ?? ARMOR_DEFS[piece].durability);
    if (!next) return false;
    set({ hotbarSlots: next });
    return true;
  },
  equipSelectedArmor: () => {
    const s = get();
    const slot = s.hotbarSlots[s.selectedSlot];
    if (!slot || slot.kind !== 'armor') return false;
    const prev = s.armorSlots[slot.piece];
    const slots = [...s.hotbarSlots];
    slots[s.selectedSlot] = prev ? { kind: 'armor', piece: slot.piece, durability: prev.durability } : null;
    set({
      hotbarSlots: slots,
      armorSlots: { ...s.armorSlots, [slot.piece]: { durability: slot.durability } },
    });
    return true;
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
      const durability = slot.durability - amount;
      const slots = [...s.hotbarSlots];
      slots[s.selectedSlot] = durability > 0 ? { ...slot, durability } : null;
      return { hotbarSlots: slots };
    }),
  craft: (recipe) => {
    const s = get();
    if (!canCraft(s.hotbarSlots, recipe)) return false;
    if (!hasSpaceFor(s.hotbarSlots, recipe.out)) return false;
    const durability =
      recipe.out.kind === 'tool'
        ? TOOLS[recipe.out.tool].durability
        : recipe.out.kind === 'armor'
          ? ARMOR_DEFS[recipe.out.piece].durability
          : 0;
    set({ hotbarSlots: applyCraft(s.hotbarSlots, recipe, durability) });
    return true;
  },
}));

export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 8);
}
