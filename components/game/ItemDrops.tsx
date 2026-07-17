'use client';

import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh, type BufferGeometry, type Group } from 'three';
import { getActiveWorld, playerPosition } from '@/lib/game';
import { clearDrops, itemDrops, tickDrops, type ItemDrop } from '@/lib/items';
import { buildBlockGeometry, buildTileGeometry } from '@/lib/mesher';
import { useGameStore } from '@/lib/store';
import { getAtlasMaterials, type AtlasMaterials } from '@/lib/textures';
import { TOOLS } from '@/lib/tools';
import { toGeometry } from './ChunkMesh';
import { useRendererKind } from './renderer-kind';

/** 掉落物渲染与物理驱动：小方块旋转 + 上下浮动，几何按内容类型缓存 */
export function ItemDrops() {
  const groupRef = useRef<Group>(null);
  const meshMap = useRef(new Map<number, Mesh>());
  const geoCache = useRef(new Map<string, BufferGeometry>());
  const kind = useRendererKind();
  const [materials, setMaterials] = useState<AtlasMaterials | null>(null);

  useEffect(() => {
    void getAtlasMaterials(kind).then(setMaterials);
    const meshes = meshMap.current;
    const geos = geoCache.current;
    return () => {
      clearDrops();
      meshes.clear();
      for (const g of geos.values()) g.dispose(); // 几何缓存卸载时释放 GPU 资源
      geos.clear();
    };
  }, [kind]);

  useFrame((_, delta) => {
    const world = getActiveWorld();
    const group = groupRef.current;
    if (!world || !group || !materials) return;
    if (useGameStore.getState().paused) return;
    const dt = Math.min(delta, 0.05);

    tickDrops(world, dt, playerPosition, (drop) => {
      const s = useGameStore.getState();
      if (drop.drop.kind === 'block') {
        const left = s.addStack({ kind: 'block', id: drop.drop.blockId }, drop.count);
        if (left === 0) return true;
        drop.count = left; // 背包满：剩下的留在原地
        return false;
      }
      if (drop.drop.kind === 'material') {
        const left = s.addStack({ kind: 'material', material: drop.drop.material }, drop.count);
        if (left === 0) return true;
        drop.count = left;
        return false;
      }
      if (drop.drop.kind === 'tool') {
        return s.addTool(drop.drop.tool, drop.durability);
      }
      return s.addArmor(drop.drop.piece, drop.durability);
    });

    // 同步 mesh：新增/更新/删除
    const seen = new Set<number>();
    for (const d of itemDrops) {
      seen.add(d.id);
      let mesh = meshMap.current.get(d.id);
      if (!mesh) {
        const geo = geometryForDrop(d, geoCache.current);
        if (!geo) continue;
        mesh = new Mesh(geo, materials.solid);
        mesh.scale.setScalar(0.25);
        group.add(mesh);
        meshMap.current.set(d.id, mesh);
      }
      // 旋转 + 上下浮动（MC 掉落物动画）
      mesh.position.set(d.x, d.y + 0.05 + Math.sin(d.age * 2.5) * 0.06, d.z);
      mesh.rotation.y = d.age * 1.8;
    }
    for (const [id, mesh] of meshMap.current) {
      if (!seen.has(id)) {
        mesh.removeFromParent();
        meshMap.current.delete(id);
      }
    }
  });

  return <group ref={groupRef} />;
}

function geometryForDrop(d: ItemDrop, cache: Map<string, BufferGeometry>): BufferGeometry | null {
  let key: string;
  let build: () => BufferGeometry | null;
  if (d.drop.kind === 'block') {
    const blockId = d.drop.blockId; // 提前取值，TS 无法把窄化带进闭包
    key = `b:${blockId}`;
    build = () => toGeometry(buildBlockGeometry(blockId));
  } else {
    const tile = d.drop.kind === 'tool' ? TOOLS[d.drop.tool].iconTile : 8; // 材料（木棍）用木板纹理
    key = `t:${tile}`;
    build = () => toGeometry(buildTileGeometry(tile));
  }
  let geo = cache.get(key);
  if (!geo) {
    const built = build();
    if (!built) return null;
    cache.set(key, built);
    geo = built;
  }
  return geo;
}
