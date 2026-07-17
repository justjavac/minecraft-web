'use client';

import { memo, useEffect, useMemo } from 'react';
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
  const { solid, water } = useMemo(() => {
    void version;
    const data = buildChunkGeometry(world, chunk);
    return { solid: toGeometry(data.solid), water: toGeometry(data.water) };
  }, [world, chunk, version]);

  useEffect(
    () => () => {
      solid?.dispose();
      water?.dispose();
    },
    [solid, water],
  );

  return (
    <group>
      {solid && <mesh geometry={solid} material={materials.solid} />}
      {water && <mesh geometry={water} material={materials.water} />}
    </group>
  );
});
