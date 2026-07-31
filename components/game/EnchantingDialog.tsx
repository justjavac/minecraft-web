'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { materialTile } from '@/lib/materials';
import { getActiveWorld } from '@/lib/game';
import { useGameStore } from '@/lib/store';
import { TOOLS, type ToolDef } from '@/lib/tools';
import { bookshelfPower, ENCHANTS, enchantLevelCap, levelFromXp, rollOffers } from '@/lib/xp';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { G, GuiHotbarSlots, GuiMainSlots, GuiSlot, McGuiFrame } from './McGui';
import { TileIcon } from './TileIcon';

const LAPIS_TILE = () => materialTile('lapis');

type ItemKind = 'sword' | 'dig' | 'armor' | 'hoe' | 'bow';

function kindOfTool(def: ToolDef): ItemKind {
  if (def.kind === 'sword') return 'sword';
  if (def.kind === 'hoe') return 'hoe';
  if (def.kind === 'bow') return 'bow';
  return 'dig';
}

const enchName = (e: { ench: keyof typeof ENCHANTS; lvl: number }): string => `${ENCHANTS[e.ench].name} ${['', 'I', 'II', 'III', 'IV', 'V'][e.lvl]}`;
/** 一档附魔的展示文案：主附魔 + 追加的兼容附魔（MC：高档可产出多条） */
const offerName = (o: { enchants: { ench: keyof typeof ENCHANTS; lvl: number }[] }): string => o.enchants.map(enchName).join('，');

/** 物品 / 青金石格（enchanting_table.png 内坐标 ×2） */
const ITEM_SLOT: [number, number] = [30, 94];
const LAPIS_SLOT: [number, number] = [70, 94];
/** 右侧三条附魔选项带（×2） */
const OFFER_X = 120;
const OFFER_W = 216;
const OFFER_H = 36;
const offerY = (i: number) => 28 + i * 38;

/**
 * 附魔台界面（MC Java 槽位模型）：物品槽（仅工具/装备）+ 青金石槽（仅青金石），均接入光标拖拽体系；
 * 三档选项基于槽内物品 + 书架 power 生成（rollOffers 种子定型：换物品/附魔成功即重摇）；
 * 点选项消耗槽内青金石（1/2/3）与整级经验，附魔后物品留在槽内由玩家取走（MC Java）。
 */
export function EnchantingDialog() {
  const open = useGameStore((s) => s.enchantOpen);
  const setOpen = useGameStore((s) => s.setEnchantOpen);
  const enchantItem = useGameStore((s) => s.enchantItem);
  const enchantLapis = useGameStore((s) => s.enchantLapis);
  const hotbarSlots = useGameStore((s) => s.hotbarSlots);
  const mainSlots = useGameStore((s) => s.mainSlots);
  const xpTotal = useGameStore((s) => s.xpTotal);
  const enchantApply = useGameStore((s) => s.enchantApply);
  const enchantSlotMouseDown = useGameStore((s) => s.enchantSlotMouseDown);
  const slotMouseDown = useGameStore((s) => s.slotMouseDown);
  const slotDragEnter = useGameStore((s) => s.slotDragEnter);
  const slotDoubleClick = useGameStore((s) => s.slotDoubleClick);
  const [rollSeed, setRollSeed] = useState(0);

  const { level } = levelFromXp(xpTotal);
  const lapisCount = enchantLapis?.kind === 'material' ? enchantLapis.count : 0;

  // MC 书架规则：2 格环内书架数（0-15）决定附魔档位上限——无书架最高 8 级档、满 15 书架 30 级档
  const power = useMemo(() => {
    if (!open) return 0;
    const world = getActiveWorld();
    if (!world) return 0;
    const [x, y, z] = open.split(',').map(Number);
    return bookshelfPower(world, x, y, z);
  }, [open]);
  const effectiveLevel = Math.min(level, enchantLevelCap(power));

  const kind: ItemKind | null = useMemo(() => {
    if (!enchantItem) return null;
    if (enchantItem.kind === 'tool') return kindOfTool(TOOLS[enchantItem.tool]);
    if (enchantItem.kind === 'armor') return 'armor';
    return null;
  }, [enchantItem]);

  // MC：换一件物品（或附魔成功改变物品）即重摇选项——以物品身份键变化触发
  const itemKey = useMemo(() => (enchantItem ? JSON.stringify(enchantItem) : null), [enchantItem]);
  const prevKey = useRef<string | null>(null);
  useEffect(() => {
    if (itemKey !== prevKey.current) {
      prevKey.current = itemKey;
      setRollSeed((n) => n + 1);
    }
  }, [itemKey]);

  const currentEnch = enchantItem && (enchantItem.kind === 'tool' || enchantItem.kind === 'armor') ? enchantItem.ench : undefined;
  // 已有附魔参与摇项（精准采集与时运互斥，见 lib/xp.ts rollOffers）；书架功率决定档位等级曲线
  const offers = useMemo(
    () => (kind ? rollOffers(0x9e37 ^ rollSeed, kind, Math.max(1, effectiveLevel), power, currentEnch) : []),
    [kind, rollSeed, effectiveLevel, power, currentEnch],
  );

  return (
    <Dialog
      open={open !== null}
      onOpenChange={(o) => {
        if (!o) setOpen(null);
      }}
    >
      <DialogContent className="border-0 bg-transparent p-0 shadow-none sm:max-w-none">
        <McGuiFrame texture="/textures/gui/container/enchanting_table.png">
          {/* 物品槽（Java：仅工具/装备；附魔后留在槽内由玩家取走） */}
          <GuiSlot pos={ITEM_SLOT} slot={enchantItem} onPress={(info) => enchantSlotMouseDown('item', info)} title="放入要附魔的工具/装备" />
          {/* 青金石槽（Java：仅青金石；附魔消耗槽内 1/2/3 个） */}
          <GuiSlot pos={LAPIS_SLOT} slot={enchantLapis} onPress={(info) => enchantSlotMouseDown('lapis', info)} title="青金石槽" />
          {/* 三条附魔选项（槽位固定耗 1/2/3 青金石与经验级；高档可产出多条附魔） */}
          {offers.map((o, i) => {
            const afford = level >= o.levels && lapisCount >= o.lapis;
            return (
              <button
                key={i}
                disabled={!afford}
                onClick={() => enchantApply(o)}
                className="absolute flex items-center justify-between px-3 text-left text-[13px] text-purple-100 [text-shadow:1px_1px_0_rgba(0,0,0,0.8)] hover:bg-white/15 disabled:opacity-40"
                style={{ left: OFFER_X, top: offerY(i), width: OFFER_W, height: OFFER_H }}
              >
                <span>{offerName(o)}</span>
                <span className="flex items-center gap-1 text-[11px]">
                  <TileIcon tile={LAPIS_TILE()} size={14} />×{o.lapis}
                  <span className="text-green-300">{o.levels} 级</span>
                </span>
              </button>
            );
          })}
          {/* 书架功率（MC：无书架最高 8 级档、满 15 书架 30 级档） */}
          <span
            className="absolute text-[10px] text-white/50"
            style={{ left: OFFER_X, top: offerY(2) + OFFER_H + 3, width: OFFER_W }}
          >
            书架 {power}/15{power === 0 ? '（无书架：最高 8 级档）' : power < 15 ? `（最高 ${enchantLevelCap(power)} 级档）` : '（满级 30 级档）'}
          </span>
          {enchantItem === null && (
            <span
              className="absolute flex items-center justify-center text-[12px] text-white/60"
              style={{ left: OFFER_X, top: offerY(0), width: OFFER_W, height: OFFER_H }}
            >
              放入可附魔的物品
            </span>
          )}
          {enchantItem !== null && kind && offers.length === 0 && (
            <span
              className="absolute flex items-center justify-center text-[12px] text-white/60"
              style={{ left: OFFER_X, top: offerY(0), width: OFFER_W, height: OFFER_H }}
            >
              该物品没有可用附魔
            </span>
          )}
          {/* 已附魔物品紫色描边 */}
          {enchantItem && (enchantItem.kind === 'tool' || enchantItem.kind === 'armor') && enchantItem.ench && Object.keys(enchantItem.ench).length > 0 && (
            <div className="pointer-events-none absolute border border-purple-400/70" style={{ left: ITEM_SLOT[0], top: ITEM_SLOT[1], width: G, height: G }} />
          )}
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
      </DialogContent>
    </Dialog>
  );
}
