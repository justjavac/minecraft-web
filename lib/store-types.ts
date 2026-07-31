// zustand 全局状态的类型定义与共享常量：GameStore 接口、slice 组合处与各 slice 文件共用

import type { ArmorMaterial, ArmorPiece, ArmorSlots } from './armor';
import type { BlockId } from './blocks';
import type { Recipe } from './recipes';
import type { Slot } from './slots';
import type { ToolType } from './tools';
import type { EnchMap, EnchOffer } from './xp';

export type Screen = 'menu' | 'playing';
export type GameMode = 'new' | 'continue';
export type WorldMode = 'creative' | 'survival';

/** 容器界面内的可交互区域（光标拖拽/快移的作用对象；'storage' = 打开的箱子/木桶） */
export type GuiArea = 'hotbar' | 'main' | 'storage';

/** 槽位按下信息（pointerdown；触屏点按 = button 0 左键语义，无右键/拖动分发） */
export interface GuiPressInfo {
  button: number;
  shift: boolean;
}

/** 全部面板关闭态（界面互斥共享名单：打开任一界面时关掉其余；死亡时全关。此前 8 份手抄复制已漂移漏清） */
export const ALL_PANELS_CLOSED = {
  pickerOpen: false,
  craftingOpen: false,
  furnaceOpen: null,
  brewingOpen: null,
  enchantOpen: null,
  tradeMob: null,
  storageOpen: null,
  grindstoneOpen: null,
} as const;

/** 是否有任一面板打开（暂停遮罩抑制判断等） */
export const anyPanelOpen = (s: {
  pickerOpen: boolean;
  craftingOpen: boolean;
  furnaceOpen: string | null;
  brewingOpen: string | null;
  enchantOpen: string | null;
  tradeMob: number | null;
  storageOpen: string | null;
  grindstoneOpen: string | null;
}): boolean =>
  s.pickerOpen || s.craftingOpen || s.furnaceOpen !== null || s.brewingOpen !== null || s.enchantOpen !== null || s.tradeMob !== null || s.storageOpen !== null || s.grindstoneOpen !== null;

export interface Settings {
  /** 主音量 0..1 */
  volume: number;
  /** 视野角度 60..110 */
  fov: number;
  /** 渲染距离（chunk 半径）2..8；桌面默认 6，移动端/低端设备首次启动默认 4（见 store-settings） */
  renderDistance: number;
  /** 视角灵敏度倍率 0.5..2（鼠标） */
  sensitivity: number;
  /** 触屏视角灵敏度倍率 0.5..2（仅触屏拖动生效，与鼠标灵敏度独立） */
  touchSensitivity: number;
  /** 反转 Y 轴（鼠标与触屏视角均生效） */
  invertY: boolean;
  /** 渲染器：WebGPU（默认，不支持自动降级 WebGL）/ WebGL */
  renderer: 'webgl' | 'webgpu';
  /** 自动跳跃（MC 辅助功能）：着地行走自动跨上 1 格台阶 */
  autoJump: boolean;
  /** 显示云 */
  clouds: boolean;
  /** 破坏/放置粒子效果 */
  particles: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.55,
  fov: 75,
  renderDistance: 6,
  sensitivity: 1,
  touchSensitivity: 1,
  invertY: false,
  renderer: 'webgpu',
  autoJump: true,
  clouds: true,
  particles: true,
};

export interface GameStore {
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
  /** 床设的重生点（MC：死亡/虚空回这里；未睡过床为 null 回世界出生点）。与 spawnPoint（上次位置/维度落点）分离 */
  respawnPoint: { x: number; y: number; z: number } | null;
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
  /** 死亡地点（死亡界面显示坐标，重生或新开/读档时清空） */
  deathPos: { x: number; y: number; z: number } | null;
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
  /** 附魔台界面开关（值为附魔台位置 key "x,y,z"，null 未打开） */
  enchantOpen: string | null;
  /** 附魔台物品槽（Java 槽位模型：仅可放工具/装备；关界面退回背包，见 stowEnchantSlots） */
  enchantItem: Slot;
  /** 附魔台青金石槽（Java 槽位模型：仅青金石，上限 64） */
  enchantLapis: Slot;
  /** 打开的砂轮位置 key（"x,y,z"），null 未打开 */
  grindstoneOpen: string | null;
  /** 砂轮两个输入槽（仅工具/装备；输出由 lib/grindstone.ts grindResult 派生，取出即生效） */
  grindSlots: [Slot, Slot];
  /** 正在交易的村民 id（null 未打开交易界面） */
  tradeMob: number | null;
  /** 打开的容器（箱子/木桶）位置 key，null 未打开 */
  storageOpen: string | null;
  /** 创造选块界面开关 */
  pickerOpen: boolean;
  startNew: (seed: string, worldMode: WorldMode) => void;
  continueGame: () => void;
  backToMenu: () => void;
  setSlot: (i: number) => void;
  setHotbarBlock: (slot: number, id: BlockId) => void;
  /** 创造模式把任意物品放入当前热键栏格（创造物品栏「物品」页签；满叠/满耐久） */
  creativeGive: (slot: Slot) => void;
  /** 中键选块（MC pick block）：创造直接放入当前格；生存 hotbar 有则切换、背包有则换到当前格 */
  pickBlock: (id: BlockId) => void;
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
  setRespawnPoint: (p: { x: number; y: number; z: number } | null) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setWorldMode: (m: WorldMode) => void;
  setDimension: (d: import('./dimension').Dimension) => void;
  /** 增加经验（杀怪/挖矿/烧炼/繁殖） */
  addXp: (amount: number) => void;
  /** 附魔：对附魔台物品槽内的工具/装备应用一个附魔项（消耗槽内青金石与整级经验；附魔后物品留在槽内，MC Java），返回是否成功 */
  enchantApply: (offer: EnchOffer) => boolean;
  setHealth: (v: number) => void;
  setHunger: (v: number) => void;
  setSaturation: (v: number) => void;
  setDead: (d: boolean) => void;
  /** 受伤（带无敌帧）；返回是否实际扣血。bypassArmor：摔落/溺水/虚空/凋零类伤害不吃护甲/保护（MC） */
  damagePlayer: (amount: number, opts?: { bypassArmor?: boolean }) => boolean;
  /** 读档时恢复生存数值 */
  loadSurvival: (s: { health: number; hunger: number; saturation?: number; slots?: Slot[]; backpack?: Slot[]; armor?: ArmorSlots; xp?: number }) => void;
  setCraftingOpen: (open: boolean, withTable?: boolean) => void;
  setFurnaceOpen: (key: string | null) => void;
  setBrewingOpen: (key: string | null) => void;
  setEnchantOpen: (key: string | null) => void;
  /** 附魔台槽点击（item 物品槽仅工具/装备；lapis 槽仅青金石。shift 取出到背包） */
  enchantSlotMouseDown: (which: 'item' | 'lapis', info: GuiPressInfo) => void;
  /** 关闭附魔界面前调用：物品槽/青金石槽内容退回背包（热键栏优先），放不下在脚下掉落 */
  stowEnchantSlots: () => void;
  setGrindstoneOpen: (key: string | null) => void;
  /** 砂轮输入槽点击（仅工具/装备可放入；shift 取出到背包） */
  grindSlotMouseDown: (which: 0 | 1, info: GuiPressInfo) => void;
  /** 取砂轮产出：两件输入消耗、成品入光标（shift 直接入背包）并返还祛魔经验 */
  grindTakeOutput: (info: GuiPressInfo) => void;
  /** 关闭砂轮界面前调用：输入槽内容退回背包（热键栏优先），放不下在脚下掉落 */
  stowGrindSlots: () => void;
  setTradeMob: (id: number | null) => void;
  /** 执行当前村民的第 i 项交易（扣付出、给获得、加经验；当期库存售罄则拒绝并提示） */
  executeMobTrade: (i: number) => void;
  /** 当前村民第 i 项交易当期剩余库存（每天 2 次补货；供交易界面显示） */
  tradeStockLeft: (i: number) => number;
  setStorageOpen: (key: string | null) => void;
  /** 把热键栏/背包某格的整叠物品移入打开的容器 */
  storagePut: (area: 'hotbar' | 'main', slotIndex: number) => void;
  /** 把打开容器的 index 整叠物品移到热键栏 */
  storageTake: (index: number) => void;
  /** 吃选中槽位的食物（MC：回复饥饿与饱和度），非食物返回 false */
  eatSelectedFood: () => boolean;
  /** 取出打开熔炉的全部产出到热键栏并结算烧炼经验（shift 点击产出槽走这里） */
  furnaceTakeOutput: () => void;
  /** 取出打开酿造台药水槽 i 的药水 */
  brewingTakePotion: (i: number) => void;
  /** 向热键栏添加可堆叠物品，返回放不下的数量 */
  addStack: (item: { kind: 'block'; id: BlockId } | { kind: 'material'; material: string }, count?: number) => number;
  /** 给工具找空槽，满则返回 false */
  addTool: (tool: ToolType, durability?: number, ench?: EnchMap) => boolean;
  /** 给装备找空槽，满则返回 false */
  addArmor: (piece: ArmorPiece, durability?: number, material?: ArmorMaterial, ench?: EnchMap) => boolean;
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
  /** shift+点击结果槽：连续合成直到材料耗尽或背包满（MC Java），返回合成次数 */
  craftAll: (recipe: Recipe) => number;
  /** 物品栏内移动：点击把 hotbar/main 某格整格移到另一区域（可堆叠自动合并）。
   *  保留作程序化 API / shift 快移路由；GUI 点击交互已由光标体系（slotMouseDown 等）取代 */
  moveSlot: (area: 'hotbar' | 'main', index: number) => void;
  /** 卸下装备槽的一件装备到物品栏（热键栏优先），满则不动 */
  unequipArmor: (piece: ArmorPiece) => void;
  /** 光标堆叠（MC Java 光标拖拽）：拿起的物品跟随鼠标，null = 空手。仅界面打开期间存在，关闭时 stowCursor 退回背包 */
  cursorSlot: Slot;
  /** 容器/槽位操作计数（熔炉/箱子等界面内容不走 zustand 字段，界面据此重渲染） */
  guiTick: number;
  /** 槽位按下（左/右键/shift 快移；光标有物时记录拖动 pending，pointerup 未拖动按普通点击处理） */
  slotMouseDown: (area: GuiArea, index: number, info: GuiPressInfo) => void;
  /** 拖动中进入格子（左键均分重算 / 右键逐格放一） */
  slotDragEnter: (area: GuiArea, index: number) => void;
  /** 全局 pointerup：结束拖动；未形成拖动则对起始格执行普通点击 */
  dragEnd: () => void;
  /** 双击（光标有物）：把界面内同类物品收集进光标（到 64） */
  slotDoubleClick: (area: GuiArea, index: number) => void;
  /** 关闭界面前调用：光标物品退回背包（热键栏优先），放不下在玩家脚下生成掉落实体 */
  stowCursor: () => void;
  /** 熔炉槽点击（输入/燃料可放可取；输出只可取，shift 直接入背包并结算烧炼经验） */
  furnaceSlotMouseDown: (which: 'input' | 'fuel' | 'output', info: GuiPressInfo) => void;
  /** 酿造台槽点击（燃料/材料/药水槽；放置有类型约束，shift 取出到背包） */
  brewingSlotMouseDown: (which: 'fuel' | 'ingredient' | 'potion', index: number, info: GuiPressInfo) => void;
}
