'use client';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, Mesh, type Material } from 'three';
import { getActiveWorld, playerPosition, targetBlock } from '@/lib/game';
import { buildBlockGeometry } from '@/lib/mesher';
import { useGameStore } from '@/lib/store';
import { getAtlasMaterials } from '@/lib/textures';
import { WORLD_HEIGHT } from '@/lib/world';
import { toGeometry } from './ChunkMesh';
import { useRendererKind } from './renderer-kind';

const HALF_W = 0.3;
const HEIGHT = 1.8;

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

/** 当前要放置的方块 id（创造=热键栏内容；生存=选中槽位的方块，非方块则 -1） */
function placingId(): number {
  const s = useGameStore.getState();
  if (s.worldMode === 'creative') return s.hotbarBlocks[s.selectedSlot];
  const slot = s.hotbarSlots[s.selectedSlot];
  return slot?.kind === 'block' ? slot.id : -1;
}

/** 模块级 ghost mesh 池（与 particlePool 同模式；组件为单例，按方块 id 缓存） */
const ghostMeshes = new Map<number, Mesh>();

/** 准星处的半透明放置预览（ghost block，射线由 Player 每帧统一计算）。
 *  mesh 按方块 id 命令式按需创建（新建对象而非换 geometry，规避 three#30398 的 WebGPU 崩溃） */
export function PlacePreview() {
  const kind = useRendererKind();
  const groupRef = useRef<Group>(null);
  const materialRef = useRef<Material | null>(null);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    let cancelled = false;
    void getAtlasMaterials(kind).then((mats) => {
      if (cancelled) return;
      materialRef.current = mats.lambert({
        map: mats.texture,
        alphaTest: 0.5,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      });
    });
    return () => {
      cancelled = true;
      materialRef.current = null;
      for (const mesh of ghostMeshes.values()) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
      ghostMeshes.clear();
    };
  }, [kind]);

  useFrame(() => {
    const world = getActiveWorld();
    const group = groupRef.current;
    if (!world || !group) return;

    // 计算当前应显示的方块与位置（不满足条件则全部隐藏）
    let id = -1;
    let px = 0;
    let py = 0;
    let pz = 0;
    const hit = targetBlock.hit;
    const face = hit?.face;
    if (hit && face && (face[0] !== 0 || face[1] !== 0 || face[2] !== 0)) {
      const x = hit.block[0] + face[0];
      const y = hit.block[1] + face[1];
      const z = hit.block[2] + face[2];
      if (y >= 0 && y < WORLD_HEIGHT && !intersectsPlayer(x, y, z)) {
        id = placingId();
        px = x;
        py = y;
        pz = z;
      }
    }

    // 按需创建 ghost mesh（首次出现的新方块），其余全部隐藏
    if (id >= 0 && !ghostMeshes.has(id) && materialRef.current) {
      const geo = toGeometry(buildBlockGeometry(id));
      if (geo) {
        const mesh = new Mesh(geo, materialRef.current);
        mesh.visible = false;
        mesh.frustumCulled = false;
        ghostMeshes.set(id, mesh);
        group.add(mesh);
      }
    }
    for (const [meshId, mesh] of ghostMeshes) {
      mesh.visible = meshId === id;
      if (mesh.visible) mesh.position.set(px, py, pz);
    }
  });

  return <group ref={groupRef} />;
}
