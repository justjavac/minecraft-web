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
      const id = world.getBlock(hit.block[0], hit.block[1], hit.block[2]);
      const box = BLOCKS[id]?.box3;
      if (box) {
        // 薄片/异形块（雪层/红石粉/压力板/按钮等带 box3）按实际碰撞盒描框，不画整方块
        const [x0, y0, z0, x1, y1, z1] = box;
        mesh.scale.set(Math.max(x1 - x0, 0.01), Math.max(y1 - y0, 0.01), Math.max(z1 - z0, 0.01));
        mesh.position.set(hit.block[0] + (x0 + x1) / 2, hit.block[1] + (y0 + y1) / 2, hit.block[2] + (z0 + z1) / 2);
      } else {
        mesh.scale.set(1, 1, 1);
        mesh.position.set(hit.block[0] + 0.5, hit.block[1] + 0.5, hit.block[2] + 0.5);
      }
      mesh.visible = true;
      debugInfo.target = `${BLOCKS[id]?.name ?? id} (${hit.block[0]}, ${hit.block[1]}, ${hit.block[2]})`;
    } else {
      mesh.visible = false;
      debugInfo.target = '';
    }
  });

  return <group ref={groupRef} />;
}
