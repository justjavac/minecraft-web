'use client';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { activeBeacons, beaconVersion } from '@/lib/beacon';
import { WORLD_HEIGHT } from '@/lib/world';

/** 激活信标的光柱：从信标顶部直通世界限高（MC 招牌观感）。激活表版本号变化时重建（信标极少，开销可忽略） */
export function BeaconBeams() {
  const groupRef = useRef<Group>(null);
  const seen = useRef(-1);

  // 共享几何与材质：亮核 + 外晕两层方柱（additive 发光，不受雾影响，远处可见）
  const assets = useRef<{ coreGeo: BoxGeometry; glowGeo: BoxGeometry; coreMat: MeshBasicMaterial; glowMat: MeshBasicMaterial } | null>(null);
  useEffect(() => {
    const coreGeo = new BoxGeometry(0.6, 1, 0.6);
    const glowGeo = new BoxGeometry(1.1, 1, 1.1);
    const coreMat = new MeshBasicMaterial({ color: '#cfefff', transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false, fog: false });
    const glowMat = new MeshBasicMaterial({ color: '#9fd8ff', transparent: true, opacity: 0.25, blending: AdditiveBlending, depthWrite: false, fog: false });
    assets.current = { coreGeo, glowGeo, coreMat, glowMat };
    return () => {
      coreGeo.dispose();
      glowGeo.dispose();
      coreMat.dispose();
      glowMat.dispose();
      assets.current = null;
    };
  }, []);

  useFrame(() => {
    const group = groupRef.current;
    const a = assets.current;
    if (!group || !a || beaconVersion.v === seen.current) return;
    seen.current = beaconVersion.v;
    for (const child of [...group.children]) child.removeFromParent();
    for (const b of activeBeacons.values()) {
      const h = WORLD_HEIGHT - (b.y + 1); // 信标顶到限高
      if (h <= 0) continue;
      const core = new Mesh(a.coreGeo, a.coreMat);
      core.scale.y = h;
      core.position.set(b.x + 0.5, b.y + 1 + h / 2, b.z + 0.5);
      const glow = new Mesh(a.glowGeo, a.glowMat);
      glow.scale.y = h;
      glow.position.copy(core.position);
      group.add(core, glow);
    }
  });

  return <group ref={groupRef} />;
}
