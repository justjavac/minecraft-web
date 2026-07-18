'use client';

import { BLOCKS } from '@/lib/blocks';
import { ARMOR_DEFS } from '@/lib/armor';
import { RECIPES, canCraft, type Recipe } from '@/lib/recipes';
import { countsOf } from '@/lib/slots';
import { useGameStore } from '@/lib/store';
import { TOOLS } from '@/lib/tools';
import { TileIcon } from './TileIcon';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/** 输出物显示 */
function outDisplay(recipe: Recipe): { name: string; tile?: number } {
  if (recipe.out.kind === 'block') {
    return { name: `${BLOCKS[recipe.out.id].name} ×${recipe.out.count}`, tile: BLOCKS[recipe.out.id].side };
  }
  if (recipe.out.kind === 'material') return { name: `木棍 ×${recipe.out.count}` };
  if (recipe.out.kind === 'armor') return { name: ARMOR_DEFS[recipe.out.piece].name };
  return { name: TOOLS[recipe.out.tool].name };
}

/** 材料项显示名 */
function costName(item: string): string {
  if (item.startsWith('block:')) return BLOCKS[Number(item.slice(6))].name;
  if (item === 'material:stick') return '木棍';
  return item;
}

/** 合成界面：随身 2×2（E 键）或工作台 3×3（右键工作台），配方与 MC 一致 */
export function CraftingDialog() {
  const open = useGameStore((s) => s.craftingOpen);
  const withTable = useGameStore((s) => s.craftingTable);
  const setOpen = useGameStore((s) => s.setCraftingOpen);
  const slots = useGameStore((s) => s.hotbarSlots);
  const craft = useGameStore((s) => s.craft);
  const counts = countsOf(slots);
  const recipes = RECIPES.filter((r) => withTable || !r.needsTable);

  return (
    <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{withTable ? '工作台（3×3）' : '随身合成（2×2）'}</DialogTitle>
          <DialogDescription>
            {withTable ? '全部配方可用' : '工具等高级配方需要右键工作台'}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {recipes.map((r) => {
            const ok = canCraft(slots, r);
            const d = outDisplay(r);
            return (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                <div className="flex items-center gap-2">
                  {d.tile !== undefined && <TileIcon tile={d.tile} size={32} />}
                  <div>
                    <div className="text-sm font-medium">{d.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.cost.map((c) => `${costName(c.item)} ${counts[c.item] ?? 0}/${c.count}`).join(' · ')}
                    </div>
                  </div>
                </div>
                <Button size="sm" disabled={!ok} onClick={() => craft(r)}>
                  合成
                </Button>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
