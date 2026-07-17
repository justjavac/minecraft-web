'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, EdgesGeometry, type LineSegments, type Material } from 'three';
import { BLOCKS } from '@/lib/blocks';
import { debugInfo, getActiveWorld, targetBlock } from '@/lib/game';
import { getAtlasMaterials } from '@/lib/textures';
import { useRendererKind } from './renderer-kind';

/** 准星选中方块的黑色线框（射线由 Player 每帧统一计算） */
export function BlockHighlight() {
  const ref = useRef<LineSegments>(null);
  const geo = useMemo(() => new EdgesGeometry(new BoxGeometry(1.002, 1.002, 1.002)), []);
  const kind = useRendererKind();
  const [mat, setMat] = useState<Material | null>(null);

  useEffect(() => {
    void getAtlasMaterials(kind).then((m) => {
      setMat(m.line({ color: '#111111' }));
    });
    return () => geo.dispose();
  }, [geo, kind]);

  useFrame(() => {
    const world = getActiveWorld();
    const mesh = ref.current;
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

  if (!mat) return null;
  return <lineSegments ref={ref} geometry={geo} material={mat} visible={false} frustumCulled={false} />;
}
