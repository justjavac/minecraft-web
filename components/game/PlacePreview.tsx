'use client';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, Mesh } from 'three';
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
  const kind = useRendererKind();
  const groupRef = useRef<Group>(null);
  const meshesRef = useRef(new Map<number, Mesh>());

  // 每种热键栏方块常驻一个 mesh，只切可见性：WebGPURenderer 在存活 mesh 上更换
  // geometry 会崩（three#30398），不能像 WebGL 那样运行时换 geometry。
  // 命令式创建/销毁：几何与 effect 严格成对（StrictMode 安全，见 ChunkMesh 注释）
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    let cancelled = false;
    const meshes = meshesRef.current;
    void getAtlasMaterials(kind).then((mats) => {
      if (cancelled) return;
      const material = mats.lambert({
        map: mats.texture,
        alphaTest: 0.5,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      });
      for (const [slot, id] of HOTBAR_BLOCKS.entries()) {
        // 热键栏均为实心方块，必有几何
        const mesh = new Mesh(toGeometry(buildBlockGeometry(id))!, material);
        mesh.visible = false;
        mesh.frustumCulled = false;
        mesh.userData.slot = slot;
        meshes.set(id, mesh);
        group.add(mesh);
      }
    });
    return () => {
      cancelled = true;
      for (const mesh of meshes.values()) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
      meshes.clear();
    };
  }, [kind]);

  useFrame(() => {
    const world = getActiveWorld();
    // 计算当前应显示的槽位与位置（不满足条件则全部隐藏）
    let slot = -1;
    let px = 0;
    let py = 0;
    let pz = 0;
    const hit = targetBlock.hit;
    const face = hit?.face;
    if (world && hit && face && (face[0] !== 0 || face[1] !== 0 || face[2] !== 0)) {
      const x = hit.block[0] + face[0];
      const y = hit.block[1] + face[1];
      const z = hit.block[2] + face[2];
      if (y >= 0 && y < WORLD_HEIGHT && !intersectsPlayer(x, y, z)) {
        slot = useGameStore.getState().selectedSlot;
        px = x;
        py = y;
        pz = z;
      }
    }
    for (const mesh of meshesRef.current.values()) {
      mesh.visible = mesh.userData.slot === slot;
      if (mesh.visible) mesh.position.set(px, py, pz);
    }
  });

  return <group ref={groupRef} />;
}
