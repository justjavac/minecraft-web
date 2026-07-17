'use client';

import { ATLAS_COLS, ATLAS_ROWS } from '@/lib/blocks';
import { atlasDataUrl } from '@/lib/textures';

interface TileIconProps {
  tile: number;
  /** 显示尺寸 px（默认 28） */
  size?: number;
  className?: string;
}

/** 从贴图 atlas 裁剪的单格图标（CSS background 定位，像素风不模糊） */
export function TileIcon({ tile, size = 28, className = '' }: TileIconProps) {
  const col = tile % ATLAS_COLS;
  const row = Math.floor(tile / ATLAS_COLS);
  return (
    <span
      className={`inline-block shrink-0 [image-rendering:pixelated] ${className}`}
      style={{
        width: size,
        height: size,
        backgroundImage: atlasDataUrl ? `url(${atlasDataUrl})` : undefined,
        backgroundSize: `${ATLAS_COLS * size}px ${ATLAS_ROWS * size}px`,
        backgroundPosition: `-${col * size}px -${row * size}px`,
      }}
    />
  );
}
