'use client';

import { ATLAS_CELL_RATIO, ATLAS_COLS, ATLAS_PAD_RATIO, ATLAS_ROWS } from '@/lib/blocks';

interface TileIconProps {
  tile: number;
  /** 显示尺寸 px（默认 28） */
  size?: number;
  className?: string;
}

/** 从贴图 atlas 裁剪的单格图标（CSS background 定位，像素风不模糊；格距含挤出，取内容区）。
 * backgroundImage 引用 :root 上的 `--mc-atlas`（textures.ts build 完成后写入一次），
 * 全量 dataURL 在 DOM 中只有一份；变量未设置时背景为空，与旧行为一致 */
export function TileIcon({ tile, size = 28, className = '' }: TileIconProps) {
  const col = tile % ATLAS_COLS;
  const row = Math.floor(tile / ATLAS_COLS);
  return (
    <span
      className={`inline-block shrink-0 [image-rendering:pixelated] ${className}`}
      style={{
        width: size,
        height: size,
        backgroundImage: 'var(--mc-atlas)',
        backgroundSize: `${ATLAS_COLS * ATLAS_CELL_RATIO * size}px ${ATLAS_ROWS * ATLAS_CELL_RATIO * size}px`,
        backgroundPosition: `-${(col * ATLAS_CELL_RATIO + ATLAS_PAD_RATIO) * size}px -${(row * ATLAS_CELL_RATIO + ATLAS_PAD_RATIO) * size}px`,
      }}
    />
  );
}
