'use client';

import { armorDefOf, type ArmorPiece } from '@/lib/armor';
import { RECIPES, canCraft, recipePattern, type Recipe } from '@/lib/recipes';
import { useGameStore } from '@/lib/store';
import type { Slot } from '@/lib/slots';
import { slotCount, slotDurabilityPct, slotName, slotTile } from './slotDisplay';
import { TileIcon } from './TileIcon';
import { useState } from 'react';
import { BLOCKS } from '@/lib/blocks';
import { materialTile } from '@/lib/materials';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// ——— MC 原版物品栏配色（浅灰面板 + 内凹深灰槽位） ———
const SLOT =
  'relative flex h-10 w-10 items-center justify-center border border-t-[#5a5a5a] border-l-[#5a5a5a] border-b-[#ffffff] border-r-[#ffffff] bg-[#8b8b8b]';

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

/** MC 原版合成预览：3×3 摆法网格 → 成品槽 */
function CraftPreview({ recipe }: { recipe: Recipe }) {
  const cells = recipePattern(recipe);
  return (
    <div className="flex items-center gap-2">
      <div className="grid grid-cols-3 gap-0.5">
        {cells.map((item, i) => (
          <span key={i} className={SLOT}>
            {item && <TileIcon tile={patternTile(item)} size={26} />}
          </span>
        ))}
      </div>
      <span className="text-xl text-[#5f5f5f]">→</span>
      <span className={`${SLOT} !h-12 !w-12 bg-[#a8e063]`}>
        <TileIcon tile={outTile(recipe)} size={34} />
      </span>
      <span className="text-sm text-[#3f3f3f]">{outName(recipe)}</span>
    </div>
  );
}

/** 物品格子（背包/热键栏通用）：图标 + 数量 + 耐久条 */
function InvCell({ slot, onClick }: { slot: Slot; onClick: () => void }) {
  const count = slotCount(slot);
  const pct = slotDurabilityPct(slot);
  return (
    <button onClick={onClick} title={slotName(slot)} className={`${SLOT} hover:brightness-110`}>
      {slot && (
        <>
          <TileIcon tile={slotTile(slot)} size={30} />
          {count > 1 && (
            <span className="absolute bottom-0 right-0.5 text-[11px] font-bold leading-3 text-white drop-shadow">
              {count}
            </span>
          )}
          {pct !== null && (
            <div className="absolute bottom-0.5 left-1 right-1 h-0.5 bg-zinc-700">
              <div
                className="h-full"
                style={{ width: `${pct * 100}%`, backgroundColor: pct > 0.3 ? '#4ade80' : '#ef4444' }}
              />
            </div>
          )}
        </>
      )}
    </button>
  );
}

const ARMOR_ORDER: ArmorPiece[] = ['helmet', 'chestplate', 'leggings', 'boots'];

/** MC 物品栏（E 键）：装备列 + 随身 2×2 合成 + 27 背包 + 9 热键栏；点格子在两区间移动 */
export function CraftingDialog() {
  const open = useGameStore((s) => s.craftingOpen);
  const withTable = useGameStore((s) => s.craftingTable);
  const setOpen = useGameStore((s) => s.setCraftingOpen);
  const hotbarSlots = useGameStore((s) => s.hotbarSlots);
  const mainSlots = useGameStore((s) => s.mainSlots);
  const armorSlots = useGameStore((s) => s.armorSlots);
  const craft = useGameStore((s) => s.craft);
  const moveSlot = useGameStore((s) => s.moveSlot);
  const unequipArmor = useGameStore((s) => s.unequipArmor);
  const [preview, setPreview] = useState<Recipe | null>(null);
  // 关闭时直接不渲染：避免每次背包变化都全量重算配方与 JSX（hooks 已全部调用，顺序稳定）
  if (!open) return null;
  const merged = [...hotbarSlots, ...mainSlots];
  const recipes = RECIPES.filter((r) => withTable || !r.needsTable);

  return (
    <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
      <DialogContent className="border-4 border-t-[#ffffff] border-l-[#ffffff] border-b-[#555555] border-r-[#555555] bg-[#c6c6c6] text-[#3f3f3f] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-[#3f3f3f]">{withTable ? '工作台' : '物品栏'}</DialogTitle>
          <DialogDescription className="text-[#5f5f5f]">
            {withTable ? '全部配方可用' : '点配方合成；点物品在背包与热键栏间移动'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-3">
          {/* 装备列 */}
          <div className="flex flex-col gap-1">
            {ARMOR_ORDER.map((piece) => {
              const cur = armorSlots[piece];
              const def = armorDefOf({ piece, material: cur?.material }); // 空槽按皮革基准显示
              return (
                <button
                  key={piece}
                  onClick={() => cur && unequipArmor(piece)}
                  title={cur ? def.name : `空${def.name}槽`}
                  className={`${SLOT} ${cur ? '' : 'opacity-60'}`}
                >
                  <span className={cur ? '' : 'grayscale'}>
                    <TileIcon tile={def.iconTile} size={28} />
                  </span>
                  {cur && (
                    <div className="absolute bottom-0.5 left-1 right-1 h-0.5 bg-zinc-700">
                      <div
                        className="h-full"
                        style={{
                          width: `${(cur.durability / def.durability) * 100}%`,
                          backgroundColor: cur.durability / def.durability > 0.3 ? '#4ade80' : '#ef4444',
                        }}
                      />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {/* 配方区（MC 风格：悬停显示 3×3 摆法预览；可合成的高亮） */}
          <div className="flex-1 space-y-2">
            {preview ? (
              <CraftPreview recipe={preview} />
            ) : (
              <div className="text-xs text-[#5f5f5f]">悬停配方查看摆法，点击合成</div>
            )}
            <div className="grid max-h-44 grid-cols-5 content-start gap-1 overflow-y-auto">
              {recipes.map((r) => {
                const ok = canCraft(merged, r);
                return (
                  <button
                    key={r.id}
                    disabled={!ok}
                    onClick={() => craft(r)}
                    onMouseEnter={() => setPreview(r)}
                    title={outName(r)}
                    className={`${SLOT} ${ok ? 'bg-[#a8e063] hover:brightness-105' : 'opacity-45'}`}
                  >
                    <TileIcon tile={outTile(r)} size={28} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 背包 27 格 */}
        <div className="grid grid-cols-9 gap-0.5">
          {mainSlots.map((slot, i) => (
            <InvCell key={i} slot={slot} onClick={() => moveSlot('main', i)} />
          ))}
        </div>
        {/* 热键栏 9 格 */}
        <div className="grid grid-cols-9 gap-0.5 border-t-2 border-[#8b8b8b] pt-1">
          {hotbarSlots.map((slot, i) => (
            <InvCell key={i} slot={slot} onClick={() => moveSlot('hotbar', i)} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
