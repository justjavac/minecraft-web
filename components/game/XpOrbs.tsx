'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, Mesh, MeshBasicMaterial, type Group } from 'three';
import { BLOCKS } from '@/lib/blocks';
import { getActiveWorld, playerPosition } from '@/lib/game';
import { tickXpOrbs, xpOrbs } from '@/lib/xporb';
import { useGameStore } from '@/lib/store';

const seenScratch = new Set<number>();

/** 经验球渲染与物理驱动（MC：黄绿闪烁小球，落地静滞，近距被玩家吸附拾取） */
export function XpOrbs() {
  const groupRef = useRef<Group>(null);
  const meshMap = useRef(new Map<number, Mesh>());
  const geo = useRef(new BoxGeometry(0.22, 0.22, 0.22));
  const matA = useRef(new MeshBasicMaterial({ color: '#a8e020' }));
  const matB = useRef(new MeshBasicMaterial({ color: '#e0ff70' }));

  useFrame(({ clock }, delta) => {
    const world = getActiveWorld();
    const group = groupRef.current;
    if (!world || !group) return;
    if (useGameStore.getState().paused) return;
    const dt = Math.min(delta, 0.05);

    tickXpOrbs(
      world,
      dt,
      playerPosition,
      (v) => useGameStore.getState().addXp(v),
      (bx, by, bz) => BLOCKS[world.getBlock(Math.floor(bx), by, Math.floor(bz))]?.solid === true,
    );

    // 网格同步（MC 经验球黄绿交替闪烁）
    const seen = seenScratch;
    seen.clear();
    const flash = Math.floor(clock.elapsedTime * 5) % 2 === 0;
    for (const o of xpOrbs) {
      seen.add(o.id);
      let mesh = meshMap.current.get(o.id);
      if (!mesh) {
        mesh = new Mesh(geo.current, flash ? matA.current : matB.current);
        group.add(mesh);
        meshMap.current.set(o.id, mesh);
      }
      mesh.material = flash ? matA.current : matB.current;
      mesh.position.set(o.x, o.y, o.z);
      const s = 1 + Math.sin(clock.elapsedTime * 6 + o.id) * 0.15; // 脉动（MC 经验球缩放）
      mesh.scale.setScalar(s);
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
