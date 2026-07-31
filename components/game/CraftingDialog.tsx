'use client';

import { useState } from 'react';
import { armorDefOf, type ArmorMaterial, type ArmorPiece } from '@/lib/armor';
import { RECIPES, canCraft, recipePattern, type Recipe } from '@/lib/recipes';
import { useGameStore } from '@/lib/store';
import type { Slot } from '@/lib/slots';
import { BLOCKS } from '@/lib/blocks';
import { materialName, materialTile } from '@/lib/materials';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { slotName, slotTile } from './slotDisplay';
import { TileIcon } from './TileIcon';
import { G, GuiHotbarSlots, GuiMainSlots, McGuiFrame } from './McGui';

/** 背包（inventory.png）槽位坐标（×2） */
const ARMOR_POS = (i: number): [number, number] => [16, 16 + i * G];
const GRID2 = (i: number): [number, number] => [196 + (i % 2) * G, 36 + Math.floor(i / 2) * G];
const OUT2: [number, number] = [308, 56];
/** 工作台（crafting_table.png）槽位坐标（×2） */
const GRID3 = (i: number): [number, number] => [60 + (i % 3) * G, 34 + Math.floor(i / 3) * G];
const OUT3: [number, number, number] = [240, 60, 48];

function outTile(recipe: Recipe): number {
  if (recipe.out.kind === 'block') return slotTile({ kind: 'block', id: recipe.out.id, count: 1 });
  if (recipe.out.kind === 'material') return slotTile({ kind: 'material', material: recipe.out.material, count: 1 });
  if (recipe.out.kind === 'tool') return slotTile({ kind: 'tool', tool: recipe.out.tool, durability: 1 });
  return slotTile({ kind: 'armor', piece: recipe.out.piece, durability: 1 });
}

function outName(recipe: Recipe): string {
  const base = slotName(
    recipe.out.kind === 'block'
      ? { kind: 'block', id: recipe.out.id, count: 1 }
      : recipe.out.kind === 'material'
        ? { kind: 'material', material: recipe.out.material, count: 1 }
        : recipe.out.kind === 'tool'
          ? { kind: 'tool', tool: recipe.out.tool, durability: 1 }
          : { kind: 'armor', piece: recipe.out.piece, durability: 1 },
  );
  return recipe.out.kind === 'block' || recipe.out.kind === 'material' ? `${base} ×${recipe.out.count}` : base;
}

/** 摆法格内的物品图标（'block:<id>' / 'material:<name>'） */
function patternTile(item: string): number {
  if (item.startsWith('block:')) return BLOCKS[Number(item.slice(6))]?.side ?? 0;
  return materialTile(item.slice(9));
}

function costName(item: string): string {
  if (item.startsWith('block:')) return BLOCKS[Number(item.slice(6))]?.name ?? item;
  return materialName(item.slice(9));
}

/** 玩家持有某成本项的数量 */
function haveOf(slots: Slot[], item: string): number {
  const [kind, id] = item.split(':');
  return slots.reduce((n, s) => {
    if (!s) return n;
    if (kind === 'block' && s.kind === 'block' && s.id === Number(id)) return n + s.count;
    if (kind === 'material' && s.kind === 'material' && s.material === id) return n + s.count;
    return n;
  }, 0);
}

/** 装备槽（背包模式左侧一列）：空槽显示灰色皮革图标，有装备显示耐久条，点击卸下 */
function ArmorCell({
  pos,
  piece,
  slot,
  onClick,
}: {
  pos: [number, number];
  piece: ArmorPiece;
  slot: { durability: number; material?: ArmorMaterial } | null;
  onClick: () => void;
}) {
  const def = armorDefOf({ piece, material: slot?.material }); // 空槽按皮革基准显示
  const pct = slot ? slot.durability / def.durability : null;
  return (
    <button
      onClick={onClick}
      title={slot ? def.name : `空${def.name}槽`}
      className="absolute flex items-center justify-center"
      style={{ left: pos[0], top: pos[1], width: G, height: G }}
    >
      <span className={slot ? '' : 'opacity-50 grayscale'}>
        <TileIcon tile={def.iconTile} size={28} />
      </span>
      {pct !== null && pct < 1 && (
        <span className="pointer-events-none absolute bottom-0.5 left-1 right-1 h-0.5 bg-zinc-700">
          <span className="block h-full" style={{ width: `${pct * 100}%`, backgroundColor: pct > 0.3 ? '#4ade80' : '#ef4444' }} />
        </span>
      )}
    </button>
  );
}

const ARMOR_ORDER: ArmorPiece[] = ['helmet', 'chestplate', 'leggings', 'boots'];

/** MC 物品栏（E 键）/ 工作台：Faithful inventory.png / crafting_table.png 背景；左侧配方书点选合成，摆法与成品预览叠加在纹理格子上 */
export function CraftingDialog() {
  const open = useGameStore((s) => s.craftingOpen);
  const withTable = useGameStore((s) => s.craftingTable);
  const setOpen = useGameStore((s) => s.setCraftingOpen);
  const hotbarSlots = useGameStore((s) => s.hotbarSlots);
  const mainSlots = useGameStore((s) => s.mainSlots);
  const armorSlots = useGameStore((s) => s.armorSlots);
  const craft = useGameStore((s) => s.craft);
  const slotMouseDown = useGameStore((s) => s.slotMouseDown);
  const slotDragEnter = useGameStore((s) => s.slotDragEnter);
  const slotDoubleClick = useGameStore((s) => s.slotDoubleClick);
  const unequipArmor = useGameStore((s) => s.unequipArmor);
  const [hover, setHover] = useState<Recipe | null>(null);
  // 关闭时直接不渲染：避免每次背包变化都全量重算配方与 JSX（hooks 已全部调用，顺序稳定）
  if (!open) return null;
  const merged = [...hotbarSlots, ...mainSlots];
  const recipes = RECIPES.filter((r) => withTable || !r.needsTable);
  // 预览 = 悬停配方，默认第一个可合成的（让摆法区不空）
  const preview = hover ?? recipes.find((r) => canCraft(merged, r)) ?? recipes[0] ?? null;
  // 摆法预览：工作台用 3×3 真实摆法；随身 2×2 展示去重成本项（≤4 格）
  const cells: (string | null)[] = preview
    ? withTable
      ? recipePattern(preview)
      : [...new Set(preview.cost.map((c) => c.item))].slice(0, 4)
    : [];
  const gridPos = withTable ? GRID3 : GRID2;
  const outOk = preview ? canCraft(merged, preview) : false;

  return (
    <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
      <DialogContent className="border-0 bg-transparent p-0 shadow-none sm:max-w-none">
        <div className="flex items-start justify-center gap-1">
          {/* 配方书（MC 1.12+ 风格：物品栏左侧弹出的配方面板） */}
          <div
            className="flex flex-col border-2 border-t-white border-l-white border-b-[#555555] border-r-[#555555] bg-[#c6c6c6] p-1.5"
            style={{ width: 170, height: 332 }}
          >
            <div className="text-[12px] font-bold text-[#3f3f3f]">{withTable ? '工作台配方' : '配方'}</div>
            <div className="mt-1 grid flex-1 grid-cols-4 content-start gap-0.5 overflow-y-auto">
              {recipes.map((r) => {
                const ok = canCraft(merged, r);
                return (
                  <button
                    key={r.id}
                    disabled={!ok}
                    onClick={() => craft(r)}
                    onMouseEnter={() => setHover(r)}
                    title={outName(r)}
                    className={`flex h-9 w-9 items-center justify-center border border-t-[#5a5a5a] border-l-[#5a5a5a] border-b-white border-r-white bg-[#8b8b8b] hover:brightness-110 disabled:opacity-40 ${
                      preview === r ? 'outline outline-1 outline-white' : ''
                    }`}
                  >
                    <TileIcon tile={outTile(r)} size={28} />
                  </button>
                );
              })}
            </div>
            {/* 配方信息：成品与成本（不足的材料标红） */}
            {preview && (
              <div className="mt-1 border-t border-[#8b8b8b] pt-1 text-[10px] leading-[14px] text-[#3f3f3f]" style={{ minHeight: 62 }}>
                <div className="font-bold">{outName(preview)}</div>
                {preview.cost.map((c, i) => {
                  const have = haveOf(merged, c.item);
                  return (
                    <div key={i} className={`flex items-center gap-1 ${have < c.count ? 'text-red-700' : ''}`}>
                      <TileIcon tile={patternTile(c.item)} size={12} />
                      <span>
                        {costName(c.item)} ×{c.count}（有 {have}）
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {/* 纹理面板：摆法/成品预览 + 装备列（背包模式）+ 背包热键栏 */}
          <McGuiFrame centered={false} texture={withTable ? '/textures/gui/container/crafting_table.png' : '/textures/gui/container/inventory.png'}>
            {/* 摆法预览（悬停配方填入纹理格子） */}
            {cells.map((item, i) => (
              <span key={i} className="pointer-events-none absolute flex items-center justify-center" style={{ left: gridPos(i)[0], top: gridPos(i)[1], width: G, height: G }}>
                {item && <TileIcon tile={patternTile(item)} size={28} />}
              </span>
            ))}
            {/* 成品槽：点击合成 */}
            {preview && (
              <button
                onClick={() => outOk && craft(preview)}
                title={outName(preview)}
                className="absolute flex items-center justify-center"
                style={
                  withTable
                    ? { left: OUT3[0], top: OUT3[1], width: OUT3[2], height: OUT3[2] }
                    : { left: OUT2[0], top: OUT2[1], width: G, height: G }
                }
              >
                <TileIcon tile={outTile(preview)} size={withTable ? 36 : 30} className={outOk ? '' : 'opacity-60'} />
                {(preview.out.kind === 'block' || preview.out.kind === 'material') && preview.out.count > 1 && (
                  <span className="pointer-events-none absolute bottom-0 right-0.5 text-[10px] font-bold text-white drop-shadow">{preview.out.count}</span>
                )}
              </button>
            )}
            {/* 装备列（仅背包模式；MC 工作台界面无装备槽） */}
            {!withTable &&
              ARMOR_ORDER.map((piece, i) => (
                <ArmorCell key={piece} pos={ARMOR_POS(i)} piece={piece} slot={armorSlots[piece]} onClick={() => armorSlots[piece] && unequipArmor(piece)} />
              ))}
            {/* 背包/热键栏：MC Java 光标拖拽（左键拿放/合并/交换，右键半取/单放，shift 快移，拖动分发，双击收集） */}
            <GuiMainSlots
              slots={mainSlots}
              onSlotPress={(i, info) => slotMouseDown('main', i, info)}
              onSlotDragEnter={(i) => slotDragEnter('main', i)}
              onSlotDoubleClick={(i) => slotDoubleClick('main', i)}
            />
            <GuiHotbarSlots
              slots={hotbarSlots}
              onSlotPress={(i, info) => slotMouseDown('hotbar', i, info)}
              onSlotDragEnter={(i) => slotDragEnter('hotbar', i)}
              onSlotDoubleClick={(i) => slotDoubleClick('hotbar', i)}
            />
          </McGuiFrame>
        </div>
      </DialogContent>
    </Dialog>
  );
}
