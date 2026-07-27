'use client';

import { useGameStore } from '@/lib/store';
import { canAfford, professionOf, PROFESSION_INFO, TRADES, tradeItemName, type TradeItem } from '@/lib/trading';
import { BLOCKS } from '@/lib/blocks';
import { materialTile } from '@/lib/materials';
import { ARMOR_DEFS, type ArmorPiece } from '@/lib/armor';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TileIcon } from './TileIcon';

function itemTile(item: TradeItem): number {
  if (item.kind === 'block') return BLOCKS[item.id].side;
  if (item.material.startsWith('armor:')) return ARMOR_DEFS[item.material.slice(6) as ArmorPiece].iconTile;
  return materialTile(item.material);
}

function ItemCell({ item }: { item: TradeItem }) {
  return (
    <span className="inline-flex items-center gap-1" title={tradeItemName(item)}>
      <TileIcon tile={itemTile(item)} size={18} />
      <span className="text-xs">
        {tradeItemName(item)} ×{item.count}
      </span>
    </span>
  );
}

/** 村民交易界面：职业交易列表（付出 → 获得 + 经验），库存不足置灰 */
export function TradingDialog() {
  const tradeMob = useGameStore((s) => s.tradeMob);
  const setTradeMob = useGameStore((s) => s.setTradeMob);
  const hotbarSlots = useGameStore((s) => s.hotbarSlots);
  const mainSlots = useGameStore((s) => s.mainSlots);
  const executeMobTrade = useGameStore((s) => s.executeMobTrade);

  const prof = tradeMob !== null ? professionOf(tradeMob) : null;
  const trades = prof ? TRADES[prof] : [];
  const allSlots = [...hotbarSlots, ...mainSlots];

  return (
    <Dialog
      open={tradeMob !== null}
      onOpenChange={(o) => {
        if (!o) setTradeMob(null);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{prof ? PROFESSION_INFO[prof].name : ''}村民</DialogTitle>
          <DialogDescription>点击成交一笔交易（MC：交易得经验）</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {trades.map((t, i) => {
            const afford = canAfford(allSlots, t);
            return (
              <button
                key={i}
                disabled={!afford}
                onClick={() => executeMobTrade(i)}
                className="flex w-full items-center justify-between rounded border border-emerald-600/40 bg-emerald-900/20 px-3 py-2 text-left disabled:opacity-40"
              >
                <span className="flex items-center gap-2">
                  {t.give.map((g, gi) => (
                    <ItemCell key={gi} item={g} />
                  ))}
                </span>
                <span className="text-emerald-400">→</span>
                <span className="flex items-center gap-2">
                  <ItemCell item={t.get} />
                  <span className="text-xs text-green-400">+{t.xp}xp</span>
                </span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
