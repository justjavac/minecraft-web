'use client';

import { useMemo, useState } from 'react';
import { materialTile } from '@/lib/materials';
import { getActiveWorld } from '@/lib/game';
import { useGameStore } from '@/lib/store';
import { TOOLS, type ToolDef } from '@/lib/tools';
import { bookshelfPower, ENCHANTS, enchantLevelCap, levelFromXp, rollOffers } from '@/lib/xp';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { AbsSlot, G, GuiHotbarSlots, GuiSlot, HOT_Y, hotX, McGuiFrame } from './McGui';
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

/** 附魔台界面（Faithful enchanting_table.png）：热键栏点工具/装备 → 三选一附魔（耗青金石与整级经验） */
export function EnchantingDialog() {
  const open = useGameStore((s) => s.enchantOpen);
  const setOpen = useGameStore((s) => s.setEnchantOpen);
  const slots = useGameStore((s) => s.hotbarSlots);
  const xpTotal = useGameStore((s) => s.xpTotal);
  const enchantApply = useGameStore((s) => s.enchantApply);
  const [selected, setSelected] = useState<number | null>(null);
  const [rollSeed, setRollSeed] = useState(0);

  const { level } = levelFromXp(xpTotal);
  const lapisCount = slots.reduce((n, s) => n + (s?.kind === 'material' && s.material === 'lapis' ? s.count : 0), 0);

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
    const slot = selected !== null ? slots[selected] : null;
    if (!slot) return null;
    if (slot.kind === 'tool') return kindOfTool(TOOLS[slot.tool]);
    if (slot.kind === 'armor') return 'armor';
    return null;
  }, [selected, slots]);

  const selectedSlot = selected !== null ? slots[selected] : null;
  const currentEnch = selectedSlot && (selectedSlot.kind === 'tool' || selectedSlot.kind === 'armor') ? selectedSlot.ench : undefined;
  // 已有附魔参与摇项（精准采集与时运互斥，见 lib/xp.ts rollOffers）；书架功率决定档位等级曲线
  const offers = useMemo(
    () => (kind && selected !== null ? rollOffers((selected + 1) * 0x9e37 ^ rollSeed, kind, Math.max(1, effectiveLevel), power, currentEnch) : []),
    [kind, selected, rollSeed, effectiveLevel, power, currentEnch],
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
          {/* 物品格：预览选中物品；点击重摇（MC 里换一件物品即刷新选项） */}
          <GuiSlot
            pos={ITEM_SLOT}
            slot={selectedSlot}
            onClick={selected !== null ? () => setRollSeed((n) => n + 1) : undefined}
            title={selected !== null ? '点击重摇附魔项' : undefined}
          />
          {/* 青金石格：展示背包内青金石总数（附魔时自动扣除） */}
          <AbsSlot pos={LAPIS_SLOT} stack={lapisCount > 0 ? { item: 'lapis', count: lapisCount } : null} />
          {/* 三条附魔选项（槽位固定耗 1/2/3 青金石与经验级；高档可产出多条附魔） */}
          {offers.map((o, i) => {
            const afford = level >= o.levels && lapisCount >= o.lapis;
            return (
              <button
                key={i}
                disabled={!afford}
                onClick={() => {
                  if (selected !== null && enchantApply(selected, o)) setSelected(null);
                }}
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
          {selected !== null && kind && offers.length === 0 && (
            <span
              className="absolute flex items-center justify-center text-[12px] text-white/60"
              style={{ left: OFFER_X, top: offerY(0), width: OFFER_W, height: OFFER_H }}
            >
              该物品没有可用附魔
            </span>
          )}
          {/* 热键栏：点击工具/装备选中附魔对象 */}
          <GuiHotbarSlots
            slots={slots}
            onSlotClick={(i) => {
              const s = slots[i];
              if (s && (s.kind === 'tool' || s.kind === 'armor')) setSelected(i);
            }}
          />
          {/* 已附魔物品紫色描边；选中物品加亮框 */}
          {slots.map(
            (s, i) =>
              s &&
              (s.kind === 'tool' || s.kind === 'armor') &&
              s.ench && (
                <div
                  key={`e${i}`}
                  className="pointer-events-none absolute border border-purple-400/70"
                  style={{ left: hotX(i), top: HOT_Y, width: G, height: G }}
                />
              ),
          )}
          {selected !== null && (
            <div
              className="pointer-events-none absolute border-2 border-purple-300"
              style={{ left: hotX(selected), top: HOT_Y, width: G, height: G }}
            />
          )}
        </McGuiFrame>
      </DialogContent>
    </Dialog>
  );
}
