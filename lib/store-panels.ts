// 面板 slice：7 个界面开关（合成/熔炉/酿造/附魔/交易/容器/选块）+ 互斥 setters（名单见 ALL_PANELS_CLOSED）

import type { StateCreator } from 'zustand';
import { ALL_PANELS_CLOSED, type GameStore } from './store-types';

export interface PanelsSlice {
  craftingOpen: boolean;
  craftingTable: boolean;
  furnaceOpen: string | null;
  brewingOpen: string | null;
  enchantOpen: string | null;
  tradeMob: number | null;
  storageOpen: string | null;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  setCraftingOpen: (open: boolean, withTable?: boolean) => void;
  setFurnaceOpen: (key: string | null) => void;
  setBrewingOpen: (key: string | null) => void;
  setEnchantOpen: (key: string | null) => void;
  setTradeMob: (id: number | null) => void;
  setStorageOpen: (key: string | null) => void;
}

export const createPanelsSlice: StateCreator<GameStore, [], [], PanelsSlice> = (set) => ({
  craftingOpen: false,
  craftingTable: false,
  furnaceOpen: null,
  brewingOpen: null,
  enchantOpen: null,
  tradeMob: null,
  storageOpen: null,
  pickerOpen: false,
  setPickerOpen: (pickerOpen) => {
    if (pickerOpen && typeof document !== 'undefined') document.exitPointerLock();
    // 界面互斥：打开时关掉其余全部面板（关闭时不动其他的）
    set(pickerOpen ? { ...ALL_PANELS_CLOSED, pickerOpen: true } : { pickerOpen });
  },
  setCraftingOpen: (craftingOpen, withTable) => {
    if (craftingOpen && typeof document !== 'undefined') document.exitPointerLock(); // 打开界面先解锁指针，否则无法操作
    set((s) => ({
      ...(craftingOpen ? ALL_PANELS_CLOSED : {}),
      craftingOpen,
      craftingTable: craftingOpen ? (withTable ?? s.craftingTable) : s.craftingTable,
    }));
  },
  setFurnaceOpen: (furnaceOpen) => {
    if (furnaceOpen && typeof document !== 'undefined') document.exitPointerLock();
    set(furnaceOpen ? { ...ALL_PANELS_CLOSED, furnaceOpen } : { furnaceOpen });
  },
  setBrewingOpen: (brewingOpen) => {
    if (brewingOpen && typeof document !== 'undefined') document.exitPointerLock();
    set(brewingOpen ? { ...ALL_PANELS_CLOSED, brewingOpen } : { brewingOpen });
  },
  setEnchantOpen: (enchantOpen) => {
    if (enchantOpen && typeof document !== 'undefined') document.exitPointerLock();
    set(enchantOpen ? { ...ALL_PANELS_CLOSED, enchantOpen } : { enchantOpen });
  },
  setTradeMob: (tradeMob) => {
    if (tradeMob !== null && typeof document !== 'undefined') document.exitPointerLock();
    set(tradeMob !== null ? { ...ALL_PANELS_CLOSED, tradeMob } : { tradeMob });
  },
  setStorageOpen: (storageOpen) => {
    if (storageOpen && typeof document !== 'undefined') document.exitPointerLock();
    set(storageOpen ? { ...ALL_PANELS_CLOSED, storageOpen } : { storageOpen });
  },
});
