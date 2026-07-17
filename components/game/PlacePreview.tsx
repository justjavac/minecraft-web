'use client';

import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type { BufferGeometry, Material, Mesh } from 'three';
import { HOTBAR_BLOCKS } from '@/lib/blocks';
import { getActiveWorld, playerPosition, targetBlock } from '@/lib/game';
import { buildBlockGeometry } from '@/lib/mesher';
import { useGameStore } from '@/lib/store';
import { getAtlasMaterials } from '@/lib/textures';
import { WORLD_HEIGHT } from '@/lib/world';
import { toGeometry } from './ChunkMesh';
import { useRendererKind } from './renderer-kind';

const HALF_W = 0.3;
const HEIGHT = 1.8;

/** 预览几何缓存：按方块类型，最多热键栏 9 项，随模块常驻 */
const previewGeoCache = new Map<number, BufferGeometry>();

/** 放置位置与玩家 AABB 重叠时不显示预览（与 tryPlace 的拒绝逻辑一致） */
function intersectsPlayer(bx: number, by: number, bz: number): boolean {
  const p = playerPosition;
  return (
    bx + 1 > p.x - HALF_W &&
    bx < p.x + HALF_W &&
    bz + 1 > p.z - HALF_W &&
    bz < p.z + HALF_W &&
    by + 1 > p.y &&
    by < p.y + HEIGHT
  );
}

/** 准星处的半透明放置预览（ghost block，射线由 Player 每帧统一计算） */
export function PlacePreview() {
  const ref = useRef<Mesh>(null);
  const kind = useRendererKind();
  const [material, setMaterial] = useState<Material | null>(null);

  // 按渲染器类型创建半透明 Lambert 材质
  useEffect(() => {
    void getAtlasMaterials(kind).then((mats) => {
      setMaterial(
        mats.lambert({
          map: mats.texture,
          alphaTest: 0.5,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
        }),
      );
    });
  }, [kind]);

  useFrame(() => {
    const mesh = ref.current;
    const world = getActiveWorld();
    if (!mesh || !world) return;
    const hit = targetBlock.hit;
    const face = hit?.face;
    if (!hit || !face || (face[0] === 0 && face[1] === 0 && face[2] === 0)) {
      mesh.visible = false;
      return;
    }
    const px = hit.block[0] + face[0];
    const py = hit.block[1] + face[1];
    const pz = hit.block[2] + face[2];
    if (py < 0 || py >= WORLD_HEIGHT || intersectsPlayer(px, py, pz)) {
      mesh.visible = false;
      return;
    }
    const id = HOTBAR_BLOCKS[useGameStore.getState().selectedSlot];
    let geo = previewGeoCache.get(id);
    if (!geo) {
      const built = toGeometry(buildBlockGeometry(id));
      if (!built) {
        mesh.visible = false;
        return;
      }
      previewGeoCache.set(id, built);
      geo = built;
    }
    mesh.geometry = geo;
    mesh.position.set(px, py, pz);
    mesh.visible = true;
  });

  return material ? (
    <mesh ref={ref} material={material} visible={false} frustumCulled={false} />
  ) : null;
}
