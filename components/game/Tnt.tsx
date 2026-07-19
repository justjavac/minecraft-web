'use client';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh, type Group } from 'three';
import { BLOCK_BY_KEY } from '@/lib/blocks';
import { getActiveWorld, playerPosition } from '@/lib/game';
import { buildBlockGeometry } from '@/lib/mesher';
import { useGameStore } from '@/lib/store';
import { getAtlasMaterials, type AtlasMaterials } from '@/lib/textures';
import { clearTnt, primedTnt, tickTnt } from '@/lib/tnt';
import { toGeometry } from './ChunkMesh';
import { useRendererKind } from './renderer-kind';

/** 引信中的 TNT 实体：重力缓落 + 白闪引信（越近爆点闪得越快）+ 到期爆炸 */
export function Tnt() {
  const groupRef = useRef<Group>(null);
  const meshMap = useRef(new Map<number, Mesh>());
  const geoRef = useRef<ReturnType<typeof toGeometry>>(null);
  const materialsRef = useRef<AtlasMaterials | null>(null);
  const kind = useRendererKind();

  useEffect(() => {
    void getAtlasMaterials(kind).then((m) => {
      materialsRef.current = m;
      geoRef.current = toGeometry(buildBlockGeometry(BLOCK_BY_KEY.tnt.id));
    });
    const meshes = meshMap.current;
    return () => {
      clearTnt();
      for (const mesh of meshes.values()) {
        mesh.removeFromParent();
      }
      meshes.clear();
      geoRef.current?.dispose();
    };
  }, [kind]);

  useFrame((_, delta) => {
    const world = getActiveWorld();
    const group = groupRef.current;
    if (!world || !group || !materialsRef.current) return;
    const dt = Math.min(delta, 0.05);

    tickTnt(world, dt, playerPosition, (dmg) => {
      if (!useGameStore.getState().dead) useGameStore.getState().damagePlayer(dmg);
    });

    // 同步 mesh：新增/更新/删除；引信后段加速白闪
    const seen = new Set<number>();
    for (const t of primedTnt) {
      seen.add(t.id);
      let mesh = meshMap.current.get(t.id);
      if (!mesh && geoRef.current) {
        mesh = new Mesh(geoRef.current, materialsRef.current.solid);
        mesh.scale.setScalar(0.98);
        group.add(mesh);
        meshMap.current.set(t.id, mesh);
      }
      if (!mesh) continue;
      mesh.position.set(t.x - 0.49, t.y, t.z - 0.49);
      // MC：引信后半段间隔白闪，越接近爆炸闪得越快
      const interval = t.fuse > 2 ? 0.4 : 0.15;
      mesh.visible = Math.floor(t.fuse / interval) % 2 === 0 || t.fuse > 3.5;
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
