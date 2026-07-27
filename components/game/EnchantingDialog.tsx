'use client';

import { useMemo, useState } from 'react';
import { BLOCKS } from '@/lib/blocks';
import { armorDefOf } from '@/lib/armor';
import { materialName, materialTile } from '@/lib/materials';
import { mulberry32 } from '@/lib/noise';
import { useGameStore } from '@/lib/store';
import { TOOLS, type ToolDef } from '@/lib/tools';
import { ENCHANTS, enchantsFor, levelFromXp, type EnchOffer } from '@/lib/xp';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TileIcon } from './TileIcon';

const LAPIS_TILE = () => materialTile('lapis');

type ItemKind = 'sword' | 'dig' | 'armor' | 'hoe' | 'bow';

function kindOfTool(def: ToolDef): ItemKind {
  if (def.kind === 'sword') return 'sword';
  if (def.kind === 'hoe') return 'hoe';
  if (def.kind === 'bow') return 'bow';
  return 'dig';
}

/** 为选中物品生成 3 个附魔选项（选中即定型，不重摇） */
function rollOffers(seed: number, kind: ItemKind, playerLevel: number): EnchOffer[] {
  const pool = enchantsFor(kind);
  const rand = mulberry32(seed);
  const offers: EnchOffer[] = [];
  const used = new Set<string>();
  for (let n = 0; n < 3 && pool.length > 0; n++) {
    const def = pool[Math.floor(rand() * pool.length)];
    if (used.has(def.key)) continue;
    used.add(def.key);
    // 等级随玩家等级上探（MC：等级越高越容易出高等级附魔）
    const cap = Math.min(def.maxLvl, Math.max(1, Math.ceil(playerLevel / 5)));
    const lvl = 1 + Math.floor(rand() * cap);
    offers.push({ ench: def.key, lvl, lapis: lvl, levels: lvl });
  }
  return offers;
}

const enchName = (o: EnchOffer): string => `${ENCHANTS[o.ench].name} ${['', 'I', 'II', 'III', 'IV', 'V'][o.lvl]}`;

/** 附魔台界面：选工具/装备 → 三选一附魔（耗青金石与整级经验） */
export function EnchantingDialog() {
  const open = useGameStore((s) => s.enchantOpen);
  const setOpen = useGameStore((s) => s.setEnchantOpen);
  const slots = useGameStore((s) => s.hotbarSlots);
  const xpTotal = useGameStore((s) => s.xpTotal);
  const enchantApply = useGameStore((s) => s.enchantApply);
  const notice = useGameStore((s) => s.notice);
  const [selected, setSelected] = useState<number | null>(null);
  const [rollSeed, setRollSeed] = useState(0);

  const { level } = levelFromXp(xpTotal);
  const lapisCount = slots.reduce((n, s) => n + (s?.kind === 'material' && s.material === 'lapis' ? s.count : 0), 0);

  const kind: ItemKind | null = useMemo(() => {
    const slot = selected !== null ? slots[selected] : null;
    if (!slot) return null;
    if (slot.kind === 'tool') return kindOfTool(TOOLS[slot.tool]);
    if (slot.kind === 'armor') return 'armor';
    return null;
  }, [selected, slots]);

  const offers = useMemo(() => (kind && selected !== null ? rollOffers((selected + 1) * 0x9e37 ^ rollSeed, kind, Math.max(1, level)) : []), [kind, selected, rollSeed, level]);

  return (
    <Dialog
      open={open !== null}
      onOpenChange={(o) => {
        if (!o) setOpen(null);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>附魔台</DialogTitle>
          <DialogDescription>
            等级 {level} · 青金石 {lapisCount} · 点击背包中的工具/装备，再从三个附魔项中选一个
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {selected !== null && slots[selected] && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">可选附魔（每项：青金石 = 等级 = 附魔等级）</span>
                <button
                  className="text-xs text-muted-foreground underline"
                  onClick={() => setRollSeed((n) => n + 1)}
                  title="重摇（MC 里换一件物品即刷新）"
                >
                  重摇
                </button>
              </div>
              {offers.map((o) => {
                const afford = level >= o.levels && lapisCount >= o.lapis;
                return (
                  <button
                    key={o.ench}
                    disabled={!afford}
                    onClick={() => {
                      if (enchantApply(selected, o)) setSelected(null);
                    }}
                    className="flex w-full items-center justify-between rounded border border-purple-500/40 bg-purple-900/30 px-3 py-2 text-left text-sm disabled:opacity-40"
                  >
                    <span>{enchName(o)}</span>
                    <span className="flex items-center gap-2 text-xs">
                      <TileIcon tile={LAPIS_TILE()} size={16} /> ×{o.lapis}
                      <span className="text-green-400">{o.levels} 级</span>
                    </span>
                  </button>
                );
              })}
              {offers.length === 0 && <span className="text-xs text-muted-foreground">该物品没有可用附魔</span>}
            </div>
          )}
          {notice && <div className="text-xs text-amber-400">{notice}</div>}
          <div className="grid grid-cols-9 gap-1">
            {slots.map((slot, i) => {
              if (!slot) return <div key={i} className="h-9 w-9 rounded border border-white/10 bg-black/20" />;
              const enchAble = slot.kind === 'tool' || slot.kind === 'armor';
              const tile =
                slot.kind === 'block'
                  ? BLOCKS[slot.id].side
                  : slot.kind === 'material'
                    ? materialTile(slot.material)
                    : slot.kind === 'tool'
                      ? TOOLS[slot.tool].iconTile
                      : armorDefOf(slot).iconTile;
              const name = slot.kind === 'block' ? BLOCKS[slot.id].name : slot.kind === 'material' ? materialName(slot.material) : slot.kind === 'tool' ? TOOLS[slot.tool].name : armorDefOf(slot).name;
              const enchList =
                (slot.kind === 'tool' || slot.kind === 'armor') && slot.ench
                  ? Object.entries(slot.ench)
                      .map(([k, v]) => `${ENCHANTS[k as keyof typeof ENCHANTS].name} ${v}`)
                      .join(' ')
                  : '';
              return (
                <button
                  key={i}
                  disabled={!enchAble}
                  onClick={() => setSelected(i)}
                  title={enchList ? `${name}（${enchList}）` : name}
                  className={`relative h-9 w-9 rounded border bg-black/30 disabled:opacity-30 ${selected === i ? 'border-purple-400' : 'border-white/20'} ${enchList ? 'ring-1 ring-purple-500/60' : ''}`}
                >
                  <TileIcon tile={tile} size={28} className="mx-auto" />
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
