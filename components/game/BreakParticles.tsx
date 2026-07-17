'use client';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, Mesh, MeshBasicMaterial, Vector3, type Group } from 'three';
import { ATLAS_COLS, ATLAS_ROWS } from '@/lib/blocks';
import { breakParticles, type BreakParticleEvent } from '@/lib/game';
import { getAtlasMaterials } from '@/lib/textures';
import { useRendererKind } from './renderer-kind';

const POOL_SIZE = 32;
const PARTICLES_PER_BREAK = 10;
const LIFE = 0.7; // 秒
const GRAVITY = 22;
const BASE_SIZE = 0.12;

interface Particle {
  mesh: Mesh;
  vel: Vector3;
  spin: Vector3;
  age: number;
  active: boolean;
}

const geo = new BoxGeometry(1, 1, 1);
/** 模块级粒子池：帧循环里直接改（与 digState/touchInput 同模式） */
const particlePool: Particle[] = [];

/** 方块破坏时的碎块粒子：共享几何 + 每粒子克隆贴图（独立 UV 偏移） */
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
        tex.repeat.set(1 / ATLAS_COLS, 1 / ATLAS_ROWS);
        tex.needsUpdate = true;
        const mesh = new Mesh(geo, mats.basic({ map: tex, transparent: true }));
        mesh.visible = false;
        group.add(mesh);
        particlePool.push({ mesh, vel: new Vector3(), spin: new Vector3(), age: 0, active: false });
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
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      // 生命周期末段缩小消失
      p.mesh.scale.setScalar(BASE_SIZE * (1 - (p.age / LIFE) * 0.5));
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
    p.mesh.visible = true;
    p.mesh.position.set(
      e.x + 0.25 + Math.random() * 0.5,
      e.y + 0.25 + Math.random() * 0.5,
      e.z + 0.25 + Math.random() * 0.5,
    );
    p.vel.set((Math.random() - 0.5) * 3, 2 + Math.random() * 2.5, (Math.random() - 0.5) * 3);
    p.spin.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, 0);
    p.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    p.mesh.scale.setScalar(BASE_SIZE);
    (p.mesh.material as MeshBasicMaterial).map!.offset.set(
      col / ATLAS_COLS,
      1 - (row + 1) / ATLAS_ROWS,
    );
    if (++spawned >= PARTICLES_PER_BREAK) break;
  }
}
