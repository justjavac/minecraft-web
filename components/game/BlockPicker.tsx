'use client';

import { useMemo, useState } from 'react';
import { BLOCKS, type BlockCat, type BlockId } from '@/lib/blocks';
import { useGameStore } from '@/lib/store';
import { TileIcon } from './TileIcon';
import { Input } from '@/components/ui/input';

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

/** 可选进热键栏的方块（固体 + 水系 + 花草十字；基岩类也可见——创造模式本就可以放） */
const PICKABLE: BlockId[] = BLOCKS.filter((d) => d.solid || d.fluid || d.shape === 'cross').map((d) => d.id);

/** 创造模式选块界面（E 键/热键栏下方按钮）：搜索 + 分类网格，点击放入当前热键栏格 */
export function BlockPicker() {
  const open = useGameStore((s) => s.pickerOpen);
  const selectedSlot = useGameStore((s) => s.selectedSlot);
  const setHotbarBlock = useGameStore((s) => s.setHotbarBlock);
  const setPickerOpen = useGameStore((s) => s.setPickerOpen);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<BlockCat | 'all'>('all');

  const list = useMemo(() => {
    const q = query.trim();
    return PICKABLE.filter((id) => {
      const d = BLOCKS[id];
      if (cat !== 'all' && d.cat !== cat) return false;
      if (q && !d.name.includes(q) && !d.key.includes(q.toLowerCase())) return false;
      return true;
    });
  }, [query, cat]);

  if (!open) return null;
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/50"
      onClick={() => setPickerOpen(false)}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-3 rounded-lg border-2 border-zinc-900/20 bg-zinc-100 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索方块（中文名或英文 key）"
            className="bg-white"
          />
          <span className="shrink-0 text-sm text-muted-foreground">{list.length} 种</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {CATS.map((c) => (
            <button
              key={c.key}
              onClick={() => setCat(c.key)}
              className={`rounded px-2 py-1 text-xs ${cat === c.key ? 'bg-emerald-600 text-white' : 'bg-white/70 hover:bg-white'}`}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="grid flex-1 grid-cols-6 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-8 md:grid-cols-10">
          {list.map((id) => {
            const d = BLOCKS[id];
            return (
              <button
                key={id}
                title={d.name}
                onClick={() => {
                  setHotbarBlock(selectedSlot, id);
                  setPickerOpen(false);
                }}
                className="flex aspect-square items-center justify-center rounded border border-zinc-900/15 bg-white/60 hover:bg-emerald-100 hover:ring-2 hover:ring-emerald-500"
              >
                <TileIcon tile={d.side} size={30} />
              </button>
            );
          })}
        </div>
        <p className="text-center text-xs text-muted-foreground">
          点击方块放入热键栏第 {selectedSlot + 1} 格 · Esc / 点击空白处关闭
        </p>
      </div>
    </div>
  );
}
