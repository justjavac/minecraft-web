'use client';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, Mesh, MeshBasicMaterial, Vector3, type Group } from 'three';
import { ATLAS_CELL_RATIO, ATLAS_COLS, ATLAS_PAD_RATIO, ATLAS_ROWS, BLOCKS } from '@/lib/blocks';
import { breakParticles, getActiveWorld, type BreakParticleEvent } from '@/lib/game';
import { getAtlasMaterials, tilePx } from '@/lib/textures';
import { useGameStore } from '@/lib/store';
import { useRendererKind } from './renderer-kind';

const POOL_SIZE = 32;
const PARTICLES_PER_BREAK = 10;
const LIFE = 0.85; // 秒
const GRAVITY = 22;
const BASE_SIZE = 0.12;

interface Particle {
  mesh: Mesh;
  vel: Vector3;
  spin: Vector3;
  age: number;
  active: boolean;
  /** 本次激活的基础尺寸（shrink 动画在此基础上缩放） */
  size: number;
}

const geo = new BoxGeometry(1, 1, 1);
/** 模块级粒子池：帧循环里直接改（与 digState/touchInput 同模式） */
const particlePool: Particle[] = [];

/** 方块破坏时的碎块粒子：共享几何 + 每粒子克隆贴图（随机局部 UV），落地反弹后静止消失 */
export function BreakParticles() {
  const groupRef = useRef<Group>(null);
  const kind = useRendererKind();

  // 初始化粒子池（贴图就绪后），卸载时释放
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    let cancelled = false;
    void getAtlasMaterials(kind).then((mats) => {
      if (cancelled) return;
      for (let i = 0; i < POOL_SIZE; i++) {
        const tex = mats.texture.clone();
        tex.needsUpdate = true;
        const mesh = new Mesh(geo, mats.basic({ map: tex, transparent: true }));
        mesh.visible = false;
        group.add(mesh);
        particlePool.push({ mesh, vel: new Vector3(), spin: new Vector3(), age: 0, active: false, size: BASE_SIZE });
      }
    });
    return () => {
      cancelled = true;
      for (const p of particlePool) {
        p.mesh.removeFromParent();
        (p.mesh.material as MeshBasicMaterial).dispose();
        (p.mesh.material as MeshBasicMaterial).map?.dispose();
      }
      particlePool.length = 0;
    };
  }, [kind]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const world = getActiveWorld();

    // 设置里关闭粒子：丢弃破坏事件且不再更新（MC 粒子开关）
    if (!useGameStore.getState().settings.particles) {
      breakParticles.length = 0;
      return;
    }

    // 消费破坏事件，每次激活最多 PARTICLES_PER_BREAK 个粒子
    while (particlePool.length > 0 && breakParticles.length > 0) {
      const e = breakParticles.shift()!;
      spawn(e);
    }

    for (const p of particlePool) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= LIFE) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.vel.y -= GRAVITY * dt;
      const nx = p.mesh.position.x + p.vel.x * dt;
      let ny = p.mesh.position.y + p.vel.y * dt;
      const nz = p.mesh.position.z + p.vel.z * dt;
      if (world && p.vel.y <= 0) {
        // 粒子底部进入实心方块：反弹衰减，低速时停在地表并加摩擦
        const groundY = Math.floor(ny - p.size / 2);
        const below = BLOCKS[world.getBlock(Math.floor(nx), groundY, Math.floor(nz))];
        if (below?.solid) {
          ny = groundY + 1 + p.size / 2;
          p.vel.y *= -0.4;
          p.vel.x *= 0.5;
          p.vel.z *= 0.5;
          if (Math.abs(p.vel.y) < 1.5) {
            p.vel.y = 0;
            const f = Math.max(0, 1 - 8 * dt);
            p.vel.x *= f;
            p.vel.z *= f;
            p.spin.multiplyScalar(f);
          }
        }
      }
      p.mesh.position.set(nx, ny, nz);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      // 生命周期末段缩小消失
      p.mesh.scale.setScalar(p.size * (1 - (p.age / LIFE) * 0.5));
    }
  });

  return <group ref={groupRef} />;
}

function spawn(e: BreakParticleEvent): void {
  const col = e.tile % ATLAS_COLS;
  const row = Math.floor(e.tile / ATLAS_COLS);
  let spawned = 0;
  for (const p of particlePool) {
    if (p.active) continue;
    p.active = true;
    p.age = 0;
    p.size = BASE_SIZE * (0.8 + Math.random() * 0.5); // 尺寸随机，碎块有大有小
    p.mesh.visible = true;
    p.mesh.position.set(
      e.x + 0.25 + Math.random() * 0.5,
      e.y + 0.25 + Math.random() * 0.5,
      e.z + 0.25 + Math.random() * 0.5,
    );
    p.vel.set((Math.random() - 0.5) * 3, 2 + Math.random() * 2.5, (Math.random() - 0.5) * 3);
    p.spin.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, 0);
    p.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    p.mesh.scale.setScalar(p.size);
    // 每颗粒取贴图的随机 1/4 局部（MC 的 4×4 碎块样式），看起来像真正的碎屑而非整块缩小
    const crop = tilePx / 4;
    const cx = Math.floor(Math.random() * (tilePx - crop));
    const cy = Math.floor(Math.random() * (tilePx - crop));
    const map = (p.mesh.material as MeshBasicMaterial).map!;
    // atlas 格距含挤出（CELL_RATIO），子区偏移/比例换算到内容区
    map.repeat.set((crop / tilePx) / (ATLAS_COLS * ATLAS_CELL_RATIO), (crop / tilePx) / (ATLAS_ROWS * ATLAS_CELL_RATIO));
    map.offset.set(
      (col * ATLAS_CELL_RATIO + ATLAS_PAD_RATIO + cx / tilePx) / (ATLAS_COLS * ATLAS_CELL_RATIO),
      1 - (row * ATLAS_CELL_RATIO + ATLAS_PAD_RATIO + (cy + crop) / tilePx) / (ATLAS_ROWS * ATLAS_CELL_RATIO),
    );
    if (++spawned >= PARTICLES_PER_BREAK) break;
  }
}
