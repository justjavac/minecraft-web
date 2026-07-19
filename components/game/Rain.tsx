'use client';

// 降雨/雷暴：相机周围的竖直雨丝（lineSegments 循环下落），头顶有遮挡或在水下时不显示

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, LineBasicMaterial, type LineSegments } from 'three';
import { BLOCKS, isLavaId, isWaterId } from '@/lib/blocks';
import { getActiveWorld } from '@/lib/game';
import { weather } from '@/lib/weather';

const MAX_DROPS = 900; // 雷暴密度
const RAIN_DROPS = 450; // 普通雨密度
const RADIUS = 22; // 水平散布半径
const TOP = 16; // 相机上方生成高度
const BOTTOM = 5; // 低于相机多少回收
const STREAK = 0.55; // 雨丝长度

// 模块级雨场状态：帧循环里直接改（与 digState/breakParticles 同模式）
const drops = new Float32Array(MAX_DROPS * 4); // 每滴：x, y, z, speed
const rainGeo = new BufferGeometry();
const rainPos = new Float32Array(MAX_DROPS * 2 * 3);
const rainAttr = new BufferAttribute(rainPos, 3);
rainAttr.setUsage(35048); // DynamicDrawUsage
rainGeo.setAttribute('position', rainAttr);
const rainMat = new LineBasicMaterial({ color: '#8fb3d9', transparent: true, opacity: 0.45, depthWrite: false });
const rainState = { seeded: false };

export function Rain() {
  const ref = useRef<LineSegments>(null);

  useFrame(({ camera }, delta) => {
    const lines = ref.current;
    if (!lines) return;
    const raining = weather.kind !== 'clear';
    if (!raining) {
      lines.visible = false;
      rainState.seeded = false;
      return;
    }
    const world = getActiveWorld();
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    if (world) {
      const head = world.getBlock(Math.floor(cx), Math.floor(cy), Math.floor(cz));
      if (isWaterId(head) || isLavaId(head)) {
        lines.visible = false;
        return;
      }
      // 头顶 24 格内有不透明遮挡（洞穴/屋内）则看不到雨
      for (let y = 1; y <= 24; y++) {
        const b = world.getBlock(Math.floor(cx), Math.floor(cy) + y, Math.floor(cz));
        if (BLOCKS[b]?.opaque) {
          lines.visible = false;
          return;
        }
      }
    }
    lines.visible = true;

    const count = weather.kind === 'thunder' ? MAX_DROPS : RAIN_DROPS;
    rainMat.opacity = weather.kind === 'thunder' ? 0.6 : 0.45;
    const dt = Math.min(delta, 0.05);
    // 首次（或雨后重开）时在相机周围撒满
    if (!rainState.seeded) {
      rainState.seeded = true;
      for (let i = 0; i < MAX_DROPS; i++) {
        drops[i * 4] = cx + (Math.random() * 2 - 1) * RADIUS;
        drops[i * 4 + 1] = cy - BOTTOM + Math.random() * (TOP + BOTTOM);
        drops[i * 4 + 2] = cz + (Math.random() * 2 - 1) * RADIUS;
        drops[i * 4 + 3] = 18 + Math.random() * 6;
      }
    }
    for (let i = 0; i < MAX_DROPS; i++) {
      const di = i * 4;
      if (i < count) {
        drops[di + 1] -= drops[di + 3] * dt;
        // 回收：落出下界或偏离相机过远
        const dx = drops[di] - cx;
        const dz = drops[di + 2] - cz;
        if (drops[di + 1] < cy - BOTTOM || dx * dx + dz * dz > RADIUS * RADIUS * 1.4) {
          drops[di] = cx + (Math.random() * 2 - 1) * RADIUS;
          drops[di + 1] = cy + TOP * (0.7 + Math.random() * 0.3);
          drops[di + 2] = cz + (Math.random() * 2 - 1) * RADIUS;
        }
      }
      // 未启用的滴藏到远处（顶点写到地下，画面上不可见）
      const pi = i * 6;
      const vy = i < count ? drops[di + 1] : -1000;
      rainPos[pi] = drops[di];
      rainPos[pi + 1] = vy;
      rainPos[pi + 2] = drops[di + 2];
      rainPos[pi + 3] = drops[di];
      rainPos[pi + 4] = vy + STREAK;
      rainPos[pi + 5] = drops[di + 2];
    }
    rainAttr.needsUpdate = true;
  });

  return (
    <lineSegments ref={ref} geometry={rainGeo} material={rainMat} frustumCulled={false} visible={false} />
  );
}
