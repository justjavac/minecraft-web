'use client';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, EdgesGeometry, Group, LineSegments } from 'three';
import { BLOCKS } from '@/lib/blocks';
import { debugInfo, getActiveWorld, targetBlock } from '@/lib/game';
import { getAtlasMaterials } from '@/lib/textures';
import { useRendererKind } from './renderer-kind';

/** 准星选中方块的黑色线框（射线由 Player 每帧统一计算） */
export function BlockHighlight() {
  const groupRef = useRef<Group>(null);
  const lineRef = useRef<LineSegments | null>(null);
  const kind = useRendererKind();

  // 命令式创建/销毁：几何与 effect 严格成对（StrictMode 安全，见 ChunkMesh 注释）
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    let cancelled = false;
    const line = new LineSegments(new EdgesGeometry(new BoxGeometry(1.002, 1.002, 1.002)));
    line.visible = false;
    line.frustumCulled = false;
    void getAtlasMaterials(kind).then((m) => {
      if (!cancelled) line.material = m.line({ color: '#111111' });
    });
    group.add(line);
    lineRef.current = line;
    return () => {
      cancelled = true;
      line.removeFromParent();
      line.geometry.dispose();
      lineRef.current = null;
    };
  }, [kind]);

  useFrame(() => {
    const world = getActiveWorld();
    const mesh = lineRef.current;
    if (!world || !mesh) return;
    const hit = targetBlock.hit;
    if (hit) {
      mesh.visible = true;
      mesh.position.set(hit.block[0] + 0.5, hit.block[1] + 0.5, hit.block[2] + 0.5);
      const id = world.getBlock(hit.block[0], hit.block[1], hit.block[2]);
      debugInfo.target = `${BLOCKS[id]?.name ?? id} (${hit.block[0]}, ${hit.block[1]}, ${hit.block[2]})`;
    } else {
      mesh.visible = false;
      debugInfo.target = '';
    }
  });

  return <group ref={groupRef} />;
}
