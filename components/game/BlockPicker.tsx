'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { armorDef, type ArmorMaterial, type ArmorPiece } from '@/lib/armor';
import { BLOCKS, type BlockCat, type BlockId } from '@/lib/blocks';
import { MATERIAL_INFO } from '@/lib/materials';
import { useGameStore } from '@/lib/store';
import { withBase } from '@/lib/basepath';
import type { Slot } from '@/lib/slots';
import { TOOLS, type ToolType } from '@/lib/tools';
import { TileIcon } from './TileIcon';
import { G, GuiSlot } from './McGui';

const CATS: { key: BlockCat | 'all'; name: string }[] = [
  { key: 'all', name: '全部' },
  { key: 'stone', name: '石料' },
  { key: 'earth', name: '泥土' },
  { key: 'ore', name: '矿石' },
  { key: 'wood', name: '木材' },
  { key: 'color', name: '彩色' },
  { key: 'ocean', name: '海洋' },
  { key: 'utility', name: '功能' },
];

/** 可选进热键栏的方块（固体 + 水系 + 花草十字 + 基础款藤蔓；基岩类也可见——创造模式本就可以放；
 * 双格植物顶段/竹顶段等联动变体不单独列出，避免放出悬空半段；活塞/中继器/比较器朝向与开关变体只列基础款） */
const PICKABLE: BlockId[] = BLOCKS.filter(
  (d) =>
    !d.plantTop &&
    d.key !== 'bamboo_top' &&
    !(d.dropBlock !== undefined && (d.key.startsWith('piston_') || d.key.startsWith('repeater_') || d.key.startsWith('comparator_'))) &&
    (d.solid || d.fluid || d.shape === 'cross' || (d.shape === 'panel' && d.facing === 0)),
).map((d) => d.id);

/** 创造物品栏「物品」页签内容（MC：创造物品栏含全部工具/武器/装备/材料食物） */
interface CreativeItem {
  name: string;
  tile: number;
  slot: Slot;
}
const CREATIVE_ITEMS: CreativeItem[] = [
  // 工具与武器（满耐久）
  ...(Object.keys(TOOLS) as ToolType[]).map((t) => ({
    name: TOOLS[t].name,
    tile: TOOLS[t].iconTile,
    slot: { kind: 'tool' as const, tool: t, durability: TOOLS[t].durability },
  })),
  // 装备（皮革/金/铁/钻/下界合金 × 头/胸/腿/靴，满耐久）
  ...(['leather', 'gold', 'iron', 'diamond', 'netherite'] as ArmorMaterial[]).flatMap((m) =>
    (['helmet', 'chestplate', 'leggings', 'boots'] as ArmorPiece[]).map((piece) => ({
      name: armorDef(m, piece).name,
      tile: armorDef(m, piece).iconTile,
      slot: { kind: 'armor' as const, piece, material: m, durability: armorDef(m, piece).durability },
    })),
  ),
  // 材料/食物/杂项（满叠 64）
  ...Object.entries(MATERIAL_INFO).map(([k, info]) => ({
    name: info.name,
    tile: info.tile,
    slot: { kind: 'material' as const, material: k, count: 64 },
  })),
];

/** tab_item_search.png 面板坐标（×2，面板 390x270） */
const PANEL_W = 390;
const PANEL_H = 270;
const COLS = 9;
const ROWS = 5;
const GRID_X = 16;
const GRID_Y = 36;
const HOT_Y = 216;
/** 搜索框 / 滚动条轨（x,y,w,h） */
const SEARCH_BOX: [number, number, number, number] = [160, 10, 176, 16];
const TRACK: [number, number, number, number] = [356, 38, 28, 212];

/** 创造模式选块界面（E 键）：Faithful tab_item_search.png 背景，搜索 + 分类 + 滚动网格（对齐 MC 创造物品栏搜索页） */
export function BlockPicker() {
  const open = useGameStore((s) => s.pickerOpen);
  const selectedSlot = useGameStore((s) => s.selectedSlot);
  const hotbarSlots = useGameStore((s) => s.hotbarSlots);
  const setHotbarBlock = useGameStore((s) => s.setHotbarBlock);
  const setPickerOpen = useGameStore((s) => s.setPickerOpen);
  const [mode, setMode] = useState<'blocks' | 'items'>('blocks');
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<BlockCat | 'all'>('all');
  const [scrollRow, setScrollRow] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);

  const list = useMemo(() => {
    const q = query.trim();
    return PICKABLE.filter((id) => {
      const d = BLOCKS[id];
      if (cat !== 'all' && d.cat !== cat) return false;
      if (q && !d.name.includes(q) && !d.key.includes(q.toLowerCase())) return false;
      return true;
    });
  }, [query, cat]);
  const itemList = useMemo(() => {
    const q = query.trim();
    return q ? CREATIVE_ITEMS.filter((it) => it.name.includes(q)) : CREATIVE_ITEMS;
  }, [query]);

  const activeLen = mode === 'blocks' ? list.length : itemList.length;
  const totalRows = Math.ceil(activeLen / COLS);
  const maxRow = Math.max(0, totalRows - ROWS);
  const clampedRow = Math.min(scrollRow, maxRow);

  // 滚轮滚动网格（按行步进；preventDefault 需非 passive 监听）
  useEffect(() => {
    const el = gridRef.current;
    if (!open || !el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScrollRow((r) => Math.max(0, Math.min(maxRow, r + (e.deltaY > 0 ? 1 : -1))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [open, maxRow]);

  // Esc 关闭（组件是纯 div 不是 Dialog，需自己监听；与底部提示文案一致）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setPickerOpen]);

  if (!open) return null;
  const visible = list.slice(clampedRow * COLS, (clampedRow + ROWS) * COLS);
  const visibleItems = itemList.slice(clampedRow * COLS, (clampedRow + ROWS) * COLS);
  /** 滚动条拇指：高度按可见比例、位置按滚动进度 */
  const thumbH = totalRows > 0 ? Math.max(24, (TRACK[3] * ROWS) / Math.max(ROWS, totalRows)) : TRACK[3];
  const thumbY = TRACK[1] + (maxRow > 0 ? ((TRACK[3] - thumbH) * clampedRow) / maxRow : 0);

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50" onClick={() => setPickerOpen(false)}>
      <div className="flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
        {/* 模式页签（方块 / 物品；MC 创造物品栏含全部物品） */}
        <div className="mb-1 flex gap-1">
          {(['blocks', 'items'] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setScrollRow(0); }}
              className={`mc-btn mc-btn-sm ${mode === m ? 'outline outline-2 outline-white' : ''}`}
            >
              {m === 'blocks' ? '方块' : '物品'}
            </button>
          ))}
          {mode === 'blocks' && <span className="mx-0.5" />}
          {mode === 'blocks' &&
            CATS.map((c) => (
              <button
                key={c.key}
                onClick={() => { setCat(c.key); setScrollRow(0); }}
                className={`mc-btn mc-btn-sm ${cat === c.key ? 'outline outline-2 outline-white' : ''}`}
              >
                {c.name}
              </button>
            ))}
        </div>
        {/* 面板：tab_item_search.png（512 原图左上 390x270） */}
        <div className="relative select-none overflow-hidden" style={{ width: PANEL_W, height: PANEL_H }}>
          <img
            src={withBase('/textures/gui/container/creative_inventory/tab_item_search.png')}
            alt=""
            draggable={false}
            className="absolute left-0 top-0 max-w-none select-none [image-rendering:pixelated]"
            style={{ width: 512, height: 512 }}
          />
          {/* 搜索框（叠在纹理搜索框上，透明底） */}
          <input
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setScrollRow(0); }}
            placeholder={mode === 'blocks' ? '搜索方块' : '搜索物品'}
            className="absolute bg-transparent text-[13px] text-white placeholder-white/40 outline-none"
            style={{ left: SEARCH_BOX[0] + 4, top: SEARCH_BOX[1], width: SEARCH_BOX[2] - 8, height: SEARCH_BOX[3] }}
          />
          {/* 网格区：裁剪窗口 + 按行滚动 */}
          <div
            ref={gridRef}
            className="absolute overflow-hidden"
            style={{ left: GRID_X, top: GRID_Y, width: COLS * G, height: ROWS * G }}
          >
            {mode === 'blocks' &&
              visible.map((id, i) => {
                const d = BLOCKS[id];
                return (
                  <button
                    key={id}
                    title={d.name}
                    onClick={() => {
                      setHotbarBlock(selectedSlot, id);
                      setPickerOpen(false);
                    }}
                    className="absolute flex items-center justify-center hover:bg-white/25"
                    style={{ left: (i % COLS) * G, top: Math.floor(i / COLS) * G, width: G, height: G }}
                  >
                    <TileIcon tile={d.side} size={30} blockId={id} />
                  </button>
                );
              })}
            {mode === 'items' &&
              visibleItems.map((it, i) => (
                <button
                  key={it.name}
                  title={it.name}
                  onClick={() => {
                    useGameStore.getState().creativeGive(it.slot);
                    setPickerOpen(false);
                  }}
                  className="absolute flex items-center justify-center hover:bg-white/25"
                  style={{ left: (i % COLS) * G, top: Math.floor(i / COLS) * G, width: G, height: G }}
                >
                  <TileIcon tile={it.tile} size={30} />
                </button>
              ))}
          </div>
          {/* 滚动条拇指（轨道由纹理提供；点击轨道翻页） */}
          {maxRow > 0 && (
            <button
              className="absolute"
              style={{ left: TRACK[0], top: TRACK[1], width: TRACK[2], height: TRACK[3] }}
              onClick={(e) => {
                const r = (e.clientY - e.currentTarget.getBoundingClientRect().top) / TRACK[3];
                setScrollRow(Math.round(r * maxRow));
              }}
            >
              <span
                className="absolute left-1 right-1 rounded-sm border border-[#3f3f3f] bg-[#c6c6c6]"
                style={{ top: thumbY - TRACK[1], height: thumbH }}
              />
            </button>
          )}
          {/* 底部热键栏行（点选要替换的格子） */}
          {hotbarSlots.map((s, i) => (
            <GuiSlot key={i} pos={[GRID_X + i * G, HOT_Y]} slot={s} onClick={() => useGameStore.setState({ selectedSlot: i })} />
          ))}
          <span
            className="pointer-events-none absolute border-2 border-white"
            style={{ left: GRID_X + selectedSlot * G, top: HOT_Y, width: G, height: G }}
          />
        </div>
        <p className="mt-1 text-center text-xs text-white/70 [text-shadow:1px_1px_0_#000]">
          {mode === 'blocks' ? `点击方块放入热键栏第 ${selectedSlot + 1} 格（共 ${list.length} 种）` : `点击物品放入热键栏第 ${selectedSlot + 1} 格（共 ${itemList.length} 种）`} · 滚轮翻页 · Esc / 点击空白处关闭
        </p>
      </div>
    </div>
  );
}
