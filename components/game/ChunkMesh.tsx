'use client';

import { memo, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { buildChunkGeometry, type GeometryData } from '@/lib/mesher';
import type { Chunk, World } from '@/lib/world';
import type { AtlasMaterials } from '@/lib/textures';

export function toGeometry(data: GeometryData): THREE.BufferGeometry | null {
  if (data.indices.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
  geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
  return geo;
}

interface ChunkMeshProps {
  world: World;
  chunk: Chunk;
  /** chunk.version 变化时重建几何 */
  version: number;
  materials: AtlasMaterials;
}

export const ChunkMesh = memo(function ChunkMesh({ world, chunk, version, materials }: ChunkMeshProps) {
  const groupRef = useRef<THREE.Group>(null);

  // 命令式创建/销毁 mesh：geometry 生命周期与 effect 严格成对——StrictMode 双调用下
  // 「渲染期创建 + cleanup 销毁」会把仍在渲染的几何销毁掉（dev 下 WebGPU 崩溃根因）；
  // 每次重建都是新 mesh（WebGPURenderer 不支持在存活 mesh 上更换 geometry，three#30398）；
  // 材质为全局共享（atlas），只在创建处销毁几何，绝不动材质
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const data = buildChunkGeometry(world, chunk);
    const meshes: THREE.Mesh[] = [];
    for (const [geo, mat] of [
      [toGeometry(data.solid), materials.solid],
      [toGeometry(data.water), materials.water],
    ] as const) {
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, mat);
      meshes.push(mesh);
      group.add(mesh);
    }
    return () => {
      for (const mesh of meshes) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
    };
  }, [world, chunk, version, materials]);

  return <group ref={groupRef} />;
});
