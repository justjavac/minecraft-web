'use client';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferGeometry, Float32BufferAttribute, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import { bobber } from '@/lib/fishing';
import { playerPosition } from '@/lib/game';

/** 钓鱼浮标：白身红顶小球 + 玩家手到浮标的钓线（MC 观感）；状态机见 lib/fishing.ts */
export function FishingBobber() {
  const groupRef = useRef<Group>(null);
  const bob = useRef<Mesh | null>(null);
  const line = useRef<Line | null>(null);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const body = new Mesh(new SphereGeometry(0.08, 8, 6), new MeshBasicMaterial({ color: '#e8e0d0' }));
    const tip = new Mesh(new SphereGeometry(0.05, 8, 6), new MeshBasicMaterial({ color: '#c03028' }));
    tip.position.y = 0.09;
    body.add(tip);
    body.visible = false;
    group.add(body);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
    const ln = new Line(geo, new LineBasicMaterial({ color: '#1a1a1a' }));
    ln.visible = false;
    ln.frustumCulled = false;
    group.add(ln);
    bob.current = body;
    line.current = ln;
    return () => {
      body.removeFromParent();
      ln.removeFromParent();
      body.geometry.dispose();
      (body.material as MeshBasicMaterial).dispose();
      tip.geometry.dispose();
      (tip.material as MeshBasicMaterial).dispose();
      ln.geometry.dispose();
      (ln.material as LineBasicMaterial).dispose();
      bob.current = null;
      line.current = null;
    };
  }, []);

  useFrame(() => {
    const b = bobber.current;
    const body = bob.current;
    const ln = line.current;
    if (!body || !ln) return;
    if (!b) {
      body.visible = false;
      ln.visible = false;
      return;
    }
    body.visible = true;
    body.position.set(b.x, b.y, b.z);
    ln.visible = true;
    const pos = ln.geometry.getAttribute('position') as Float32BufferAttribute;
    pos.setXYZ(0, playerPosition.x, playerPosition.y + 1.3, playerPosition.z);
    pos.setXYZ(1, b.x, b.y, b.z);
    pos.needsUpdate = true;
  });

  return <group ref={groupRef} />;
}
