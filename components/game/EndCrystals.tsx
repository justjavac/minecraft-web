'use client';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, Mesh, MeshBasicMaterial, OctahedronGeometry } from 'three';
import { endCrystals, type EndCrystal } from '@/lib/endfight';

/** 末影水晶：黑曜石柱顶旋转浮动的粉紫晶体（MC 标志）；击毁爆炸、为龙回血见 lib/endfight.ts */
export function EndCrystals() {
  const groupRef = useRef<Group>(null);
  const meshMap = useRef(new Map<EndCrystal, Mesh>());
  const assets = useRef<{ geo: OctahedronGeometry; mat: MeshBasicMaterial } | null>(null);

  useEffect(() => {
    const geo = new OctahedronGeometry(0.55);
    const mat = new MeshBasicMaterial({ color: '#e080ff', transparent: true, opacity: 0.9, fog: false });
    assets.current = { geo, mat };
    return () => {
      geo.dispose();
      mat.dispose();
      assets.current = null;
    };
  }, []);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    const a = assets.current;
    if (!group || !a) return;
    const map = meshMap.current;
    // 击毁/离场的水晶移除网格（alive 标志即真源，每帧同步开销可忽略——场上至多 10 颗）
    for (const [c, mesh] of map) {
      if (!c.alive) {
        mesh.removeFromParent();
        map.delete(c);
      }
    }
    for (const c of endCrystals) {
      if (!c.alive) continue;
      let mesh = map.get(c);
      if (!mesh) {
        mesh = new Mesh(a.geo, a.mat);
        map.set(c, mesh);
        group.add(mesh);
      }
      mesh.position.set(c.x, c.y + Math.sin(clock.elapsedTime * 1.5 + c.x) * 0.15, c.z);
      mesh.rotation.y = clock.elapsedTime * 1.2;
    }
  });

  return <group ref={groupRef} />;
}
