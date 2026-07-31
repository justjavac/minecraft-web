'use client';

import { ATLAS_CELL_RATIO, ATLAS_COLS, ATLAS_PAD_RATIO, ATLAS_ROWS } from '@/lib/blocks';
import { blockIcon3dUrl } from '@/lib/blockIcon3d';

interface TileIconProps {
  tile: number;
  /** 显示尺寸 px（默认 28） */
  size?: number;
  className?: string;
  /** 方块 id：整块立方体时渲染 MC Java 式等轴 3D 图标；非整块/atlas 未就绪回退平面 tile */
  blockId?: number;
}

/** 从贴图 atlas 裁剪的单格图标（CSS background 定位，像素风不模糊；格距含挤出，取内容区）。
 * backgroundImage 引用 :root 上的 `--mc-atlas`（textures.ts build 完成后写入一次），
 * 全量 dataURL 在 DOM 中只有一份；变量未设置时背景为空，与旧行为一致。
 * 传 blockId 且为整块立方体时改渲染等轴 3D 图标（lib/blockIcon3d.ts，生成一次按 id 缓存 dataURL） */
export function TileIcon({ tile, size = 28, className = '', blockId }: TileIconProps) {
  const icon3d = blockId !== undefined ? blockIcon3dUrl(blockId) : null;
  if (icon3d) {
    return (
      <img
        src={icon3d}
        alt=""
        draggable={false}
        width={size}
        height={size}
        className={`inline-block shrink-0 select-none [image-rendering:pixelated] ${className}`}
      />
    );
  }
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
