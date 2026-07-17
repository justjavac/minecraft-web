'use client';

import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, MeshBasicMaterial, NearestFilter, type Material, type Mesh } from 'three';
import { digState } from '@/lib/game';
import { mulberry32 } from '@/lib/noise';
import { getAtlasMaterials } from '@/lib/textures';
import { useRendererKind } from './renderer-kind';

const STAGES = 8;
const TILE = 16;

/** 程序化裂纹贴图：8 个阶段横向排列，阶段越高裂纹越密 */
function createCrackTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TILE * STAGES;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 canvas 2d 上下文');
  for (let s = 0; s < STAGES; s++) {
    const rand = mulberry32(1000 + s);
    ctx.strokeStyle = 'rgba(15, 12, 10, 0.8)';
    ctx.lineWidth = 1;
    for (let i = 0; i < s + 2; i++) {
      let x = TILE / 2 + (rand() - 0.5) * 10;
      let y = TILE / 2 + (rand() - 0.5) * 10;
      ctx.beginPath();
      ctx.moveTo(s * TILE + x, y);
      const segs = 2 + Math.floor(rand() * 3);
      for (let j = 0; j < segs; j++) {
        x += (rand() - 0.5) * 7;
        y += (rand() - 0.5) * 7;
        ctx.lineTo(s * TILE + x, y);
      }
      ctx.stroke();
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.repeat.x = 1 / STAGES;
  return tex;
}

/** 长按挖掘时目标方块上的裂纹进度覆盖层 */
export function CrackOverlay() {
  const ref = useRef<Mesh>(null);
  const kind = useRendererKind();
  const [material, setMaterial] = useState<Material | null>(null);

  useEffect(() => {
    // 纹理在 effect 中创建、cleanup 成对释放（StrictMode 安全，见 ChunkMesh 注释）
    const tex = createCrackTexture();
    void getAtlasMaterials(kind).then((mats) => {
      setMaterial(mats.basic({ map: tex, transparent: true, depthWrite: false }));
    });
    return () => tex.dispose();
  }, [kind]);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    if (digState.target && digState.progress > 0.02) {
      mesh.visible = true;
      mesh.position.set(
        digState.target[0] + 0.5,
        digState.target[1] + 0.5,
        digState.target[2] + 0.5,
      );
      const stage = Math.min(STAGES - 1, Math.floor(digState.progress * STAGES));
      (mesh.material as MeshBasicMaterial).map!.offset.x = stage / STAGES;
    } else {
      mesh.visible = false;
    }
  });

  if (!material) return null;
  return (
    <mesh ref={ref} material={material} visible={false} frustumCulled={false} renderOrder={1}>
      <boxGeometry args={[1.004, 1.004, 1.004]} />
    </mesh>
  );
}
