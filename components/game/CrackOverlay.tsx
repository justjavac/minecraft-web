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

/** 程序化裂纹贴图：8 个阶段横向排列，阶段越高裂纹越密。
 *  逐像素 8 方向锯齿游走（MC 闪电状裂纹），避免 stroke 抗锯齿发灰 */
const CRACK_DIRS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
] as const;

function drawCrackStage(ctx: CanvasRenderingContext2D, dx: number, stage: number): void {
  const rand = mulberry32(1000 + stage);
  ctx.fillStyle = 'rgba(20, 14, 10, 0.92)';
  const walk = (x: number, y: number, d: number, len: number): void => {
    for (let i = 0; i < len; i++) {
      const px = Math.round(x);
      const py = Math.round(y);
      if (px < 0 || px > 15 || py < 0 || py > 15) return;
      ctx.fillRect(dx + px, py, 1, 1);
      // 多数直行，偶尔急转 ±45°/±90°，形成折线裂纹
      const r = rand();
      if (r < 0.3) d = (d + (rand() < 0.5 ? 1 : 7)) % 8;
      else if (r < 0.4) d = (d + (rand() < 0.5 ? 2 : 6)) % 8;
      x += CRACK_DIRS[d][0];
      y += CRACK_DIRS[d][1];
      // 中后期阶段偶发 90° 分支
      if (stage >= 2 && rand() < 0.08) {
        walk(x, y, (d + (rand() < 0.5 ? 2 : 6)) % 8, 2 + ((rand() * 3) | 0));
      }
    }
  };
  // 阶段越高：主裂纹越多、越长、起点散布越开
  const paths = 1 + stage;
  for (let p = 0; p < paths; p++) {
    const spread = 2 + stage * 1.5;
    walk(
      7.5 + (rand() - 0.5) * spread,
      7.5 + (rand() - 0.5) * spread,
      (rand() * 8) | 0,
      4 + stage * 2 + ((rand() * 4) | 0),
    );
  }
}

function createCrackTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TILE * STAGES;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 canvas 2d 上下文');
  for (let s = 0; s < STAGES; s++) drawCrackStage(ctx, s * TILE, s);
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
