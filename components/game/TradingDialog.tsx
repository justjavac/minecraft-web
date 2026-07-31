'use client';

import { useState } from 'react';
import { useGameStore } from '@/lib/store';
import { canAfford, professionOf, PROFESSION_INFO, TRADES, tradeItemName, type TradeItem } from '@/lib/trading';
import { BLOCKS } from '@/lib/blocks';
import { materialTile } from '@/lib/materials';
import { armorDef, type ArmorPiece } from '@/lib/armor';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { G, GuiSlot, McGuiFrame } from './McGui';
import { TileIcon } from './TileIcon';

function itemTile(item: TradeItem): number {
  if (item.kind === 'block') return BLOCKS[item.id].side;
  if (item.material.startsWith('armor:')) return armorDef('leather', item.material.slice(6) as ArmorPiece).iconTile;
  return materialTile(item.material);
}

/** villager.png 槽位坐标（×2，面板 552x332 / 纹理 1024x512） */
const BUY_A: [number, number] = [268, 60];
const BUY_B: [number, number] = [320, 60];
const SELL: [number, number] = [430, 50];
const invX = (i: number) => 214 + (i % 9) * G;
const invY = (i: number) => 166 + Math.floor(i / 9) * G;
const hotX = (i: number) => 214 + i * G;
const HOT_Y = 282;
/** 左侧交易列表（面板内 x12 y38 起，行高 44） */
const ROW_X = 12;
const ROW_W = 184;
const ROW_H = 42;
const rowY = (i: number) => 38 + i * 44;

/** 交易项图标 + 数量角标 */
function TradeIcon({ item, size }: { item: TradeItem; size: number }) {
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: 30, height: 30 }} title={tradeItemName(item)}>
      <TileIcon tile={itemTile(item)} size={size} />
      <span className="pointer-events-none absolute bottom-0 right-0 text-[9px] font-bold text-white drop-shadow">{item.count}</span>
    </span>
  );
}

/** 村民交易界面（Faithful villager.png）：左侧交易列表点击成交，右侧预览付出/获得；库存不足置灰 */
export function TradingDialog() {
  const tradeMob = useGameStore((s) => s.tradeMob);
  const setTradeMob = useGameStore((s) => s.setTradeMob);
  const hotbarSlots = useGameStore((s) => s.hotbarSlots);
  const mainSlots = useGameStore((s) => s.mainSlots);
  const executeMobTrade = useGameStore((s) => s.executeMobTrade);
  const tradeStockLeft = useGameStore((s) => s.tradeStockLeft);
  const slotMouseDown = useGameStore((s) => s.slotMouseDown);
  const slotDragEnter = useGameStore((s) => s.slotDragEnter);
  const slotDoubleClick = useGameStore((s) => s.slotDoubleClick);
  const [preview, setPreview] = useState(0);

  const prof = tradeMob !== null ? professionOf(tradeMob) : null;
  const trades = prof ? TRADES[prof] : [];
  const allSlots = [...hotbarSlots, ...mainSlots];
  const sel = trades[preview] ?? trades[0] ?? null;

  return (
    <Dialog
      open={tradeMob !== null}
      onOpenChange={(o) => {
        if (!o) setTradeMob(null);
      }}
    >
      <DialogContent className="border-0 bg-transparent p-0 shadow-none sm:max-w-none">
        <McGuiFrame texture="/textures/gui/container/villager.png" width={552} imgW={1024}>
          {/* 职业名（MC：界面顶部显示村民类型） */}
          <span className="absolute text-[13px] font-bold text-neutral-700" style={{ left: 214, top: 12 }}>
            {prof ? `${PROFESSION_INFO[prof].name}村民` : ''}
          </span>
          {/* 交易列表：点击成交一笔（MC：交易得经验） */}
          {trades.map((t, i) => {
            const afford = canAfford(allSlots, t);
            const left = tradeMob !== null ? tradeStockLeft(i) : 0;
            return (
              <button
                key={i}
                disabled={!afford || left <= 0}
                onMouseEnter={() => setPreview(i)}
                onClick={() => executeMobTrade(i)}
                className="absolute flex items-center px-1 text-left hover:bg-white/25 disabled:opacity-40"
                style={{ left: ROW_X, top: rowY(i), width: ROW_W, height: ROW_H }}
              >
                {t.give.map((g, gi) => (
                  <TradeIcon key={gi} item={g} size={24} />
                ))}
                <span className="mx-0.5 text-[13px] text-neutral-700">→</span>
                <TradeIcon item={t.get} size={24} />
                <span className="ml-auto flex flex-col items-end text-[9px] leading-tight">
                  <span className="text-green-800">+{t.xp}xp</span>
                  <span className="text-amber-800">{left > 0 ? `剩 ${left}` : '明日补货'}</span>
                </span>
              </button>
            );
          })}
          {/* 右侧槽：预览当前交易的付出与获得 */}
          {sel && (
            <>
              <span className="absolute flex items-center justify-center" style={{ left: BUY_A[0], top: BUY_A[1], width: G, height: G }}>
                <TradeIcon item={sel.give[0]} size={28} />
              </span>
              {sel.give[1] && (
                <span className="absolute flex items-center justify-center" style={{ left: BUY_B[0], top: BUY_B[1], width: G, height: G }}>
                  <TradeIcon item={sel.give[1]} size={28} />
                </span>
              )}
              <span className="absolute flex items-center justify-center" style={{ left: SELL[0], top: SELL[1], width: 48, height: 48 }}>
                <TileIcon tile={itemTile(sel.get)} size={36} />
                {sel.get.count > 1 && (
                  <span className="pointer-events-none absolute bottom-0.5 right-1 text-[11px] font-bold text-white drop-shadow">{sel.get.count}</span>
                )}
              </span>
            </>
          )}
          {/* 背包 + 热键栏（villager 面板 x 起点 214，与标准容器不同）：光标拖拽可整理物品（MC：交易中可操作背包） */}
          {mainSlots.map((s, i) => (
            <GuiSlot
              key={`m${i}`}
              pos={[invX(i), invY(i)]}
              slot={s}
              onPress={(info) => slotMouseDown('main', i, info)}
              onDragEnter={() => slotDragEnter('main', i)}
              onDoubleClick={() => slotDoubleClick('main', i)}
            />
          ))}
          {hotbarSlots.map((s, i) => (
            <GuiSlot
              key={`h${i}`}
              pos={[hotX(i), HOT_Y]}
              slot={s}
              onPress={(info) => slotMouseDown('hotbar', i, info)}
              onDragEnter={() => slotDragEnter('hotbar', i)}
              onDoubleClick={() => slotDoubleClick('hotbar', i)}
            />
          ))}
        </McGuiFrame>
      </DialogContent>
    </Dialog>
  );
}
