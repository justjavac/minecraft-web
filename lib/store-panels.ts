// 面板 slice：7 个界面开关（合成/熔炉/酿造/附魔/交易/容器/选块）+ 互斥 setters（名单见 ALL_PANELS_CLOSED）
// 任何开关变化前先 stowCursor：光标上的物品退回背包（放不下在脚下掉落），避免界面互斥关闭时吞掉物品

import type { StateCreator } from 'zustand';
import { panelUnlock } from './game';
import { ALL_PANELS_CLOSED, type GameStore } from './store-types';

/** 打开界面先解锁指针（否则无法操作）；标记退锁原因=面板——面板全关后 Player 据此自动回锁（用户 Esc 主动暂停无此标记，仍出暂停遮罩） */
function exitLockForPanel(): void {
  if (typeof document === 'undefined') return;
  if (document.pointerLockElement) panelUnlock.pending = true;
  document.exitPointerLock();
}

export interface PanelsSlice {
  craftingOpen: boolean;
  craftingTable: boolean;
  furnaceOpen: string | null;
  brewingOpen: string | null;
  enchantOpen: string | null;
  tradeMob: number | null;
  storageOpen: string | null;
  grindstoneOpen: string | null;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  setCraftingOpen: (open: boolean, withTable?: boolean) => void;
  setFurnaceOpen: (key: string | null) => void;
  setBrewingOpen: (key: string | null) => void;
  setEnchantOpen: (key: string | null) => void;
  setTradeMob: (id: number | null) => void;
  setStorageOpen: (key: string | null) => void;
  setGrindstoneOpen: (key: string | null) => void;
}

export const createPanelsSlice: StateCreator<GameStore, [], [], PanelsSlice> = (set, get) => {
  /** 任何界面开/关前：光标与各站点的槽内物品退回背包（界面互斥关闭会绕过对方 setter，不能只在各自 close 里退） */
  const stowAll = (): void => {
    get().stowCursor();
    get().stowEnchantSlots();
    get().stowGrindSlots();
  };
  return {
  craftingOpen: false,
  craftingTable: false,
  furnaceOpen: null,
  brewingOpen: null,
  enchantOpen: null,
  tradeMob: null,
  storageOpen: null,
  grindstoneOpen: null,
  pickerOpen: false,
  setPickerOpen: (pickerOpen) => {
    stowAll();
    if (pickerOpen) exitLockForPanel();
    // 界面互斥：打开时关掉其余全部面板（关闭时不动其他的）
    set(pickerOpen ? { ...ALL_PANELS_CLOSED, pickerOpen: true } : { pickerOpen });
  },
  setCraftingOpen: (craftingOpen, withTable) => {
    stowAll();
    if (craftingOpen) exitLockForPanel();
    set((s) => ({
      ...(craftingOpen ? ALL_PANELS_CLOSED : {}),
      craftingOpen,
      craftingTable: craftingOpen ? (withTable ?? s.craftingTable) : s.craftingTable,
    }));
  },
  setFurnaceOpen: (furnaceOpen) => {
    stowAll();
    if (furnaceOpen) exitLockForPanel();
    set(furnaceOpen ? { ...ALL_PANELS_CLOSED, furnaceOpen } : { furnaceOpen });
  },
  setBrewingOpen: (brewingOpen) => {
    stowAll();
    if (brewingOpen) exitLockForPanel();
    set(brewingOpen ? { ...ALL_PANELS_CLOSED, brewingOpen } : { brewingOpen });
  },
  setEnchantOpen: (enchantOpen) => {
    stowAll();
    if (enchantOpen) exitLockForPanel();
    set(enchantOpen ? { ...ALL_PANELS_CLOSED, enchantOpen } : { enchantOpen });
  },
  setGrindstoneOpen: (grindstoneOpen) => {
    stowAll();
    if (grindstoneOpen) exitLockForPanel();
    set(grindstoneOpen ? { ...ALL_PANELS_CLOSED, grindstoneOpen } : { grindstoneOpen });
  },
  setTradeMob: (tradeMob) => {
    stowAll();
    if (tradeMob !== null) exitLockForPanel();
    set(tradeMob !== null ? { ...ALL_PANELS_CLOSED, tradeMob } : { tradeMob });
  },
  setStorageOpen: (storageOpen) => {
    stowAll();
    if (storageOpen) exitLockForPanel();
    set(storageOpen ? { ...ALL_PANELS_CLOSED, storageOpen } : { storageOpen });
  },
  };
};
