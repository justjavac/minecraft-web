'use client';

import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, Group, Mesh, Vector3, type Material } from 'three';
import { getActiveWorld, playerPosition } from '@/lib/game';
import { arrows, clearMobs, mobs, tickMobs, type MobType } from '@/lib/mobs';
import { useGameStore } from '@/lib/store';
import { getAtlasMaterials, type AtlasMaterials } from '@/lib/textures';
import { useRendererKind } from './renderer-kind';

// ——— 共享几何 ———
const headGeo = new BoxGeometry(0.42, 0.42, 0.42);
const bodyGeo = new BoxGeometry(0.5, 0.7, 0.28);
const legGeo = new BoxGeometry(0.2, 0.75, 0.22);
const armGeo = new BoxGeometry(0.18, 0.6, 0.2);
const bodyWideGeo = new BoxGeometry(0.9, 0.5, 0.4);
const pigLegGeo = new BoxGeometry(0.12, 0.3, 0.12);
const chickenBodyGeo = new BoxGeometry(0.32, 0.35, 0.35);
const chickenHeadGeo = new BoxGeometry(0.2, 0.2, 0.2);
const beakGeo = new BoxGeometry(0.08, 0.06, 0.12);
const spiderBodyGeo = new BoxGeometry(0.9, 0.35, 0.7);
const spiderHeadGeo = new BoxGeometry(0.35, 0.3, 0.3);
const spiderLegGeo = new BoxGeometry(0.55, 0.06, 0.06);
const creeperBodyGeo = new BoxGeometry(0.45, 0.85, 0.3);
const creeperFaceGeo = new BoxGeometry(0.3, 0.3, 0.02);
const snoutGeo = new BoxGeometry(0.16, 0.14, 0.08);
const hornGeo = new BoxGeometry(0.08, 0.12, 0.08);
const arrowGeo = new BoxGeometry(0.05, 0.05, 0.5);

type MobMats = Record<string, Material>;

/** 按渲染器类型构建生物材质表 */
function buildMobMats(mats: AtlasMaterials): MobMats {
  const l = (color: string) => mats.lambert({ color });
  return {
    zombieSkin: l('#2e7d32'),
    zombieShirt: l('#2a4a7f'),
    zombiePants: l('#3a3a5e'),
    bone: l('#d8d8d8'),
    boneDark: l('#a8a8a8'),
    spider: l('#1a1a1a'),
    creeper: l('#3f9e3f'),
    creeperDark: l('#1a3d1a'),
    pig: l('#e8a0a8'),
    pigDark: l('#d4838c'),
    cow: l('#6b4a2f'),
    cowLight: l('#d8cfc0'),
    chicken: l('#e8e8e8'),
    beak: l('#e8a030'),
    robe: l('#7a5230'),
    villagerSkin: l('#b58a6a'),
    arrow: l('#a8a8a8'),
  };
}

function addPart(g: Group, geo: BoxGeometry, mat: Material, x: number, y: number, z: number): void {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  g.add(m);
}

function makeMobMesh(type: MobType, mats: MobMats): Group {
  const g = new Group();
  switch (type) {
    case 'zombie':
      addPart(g, legGeo, mats.zombiePants, -0.13, 0.375, 0);
      addPart(g, legGeo, mats.zombiePants, 0.13, 0.375, 0);
      addPart(g, bodyGeo, mats.zombieShirt, 0, 1.1, 0);
      addPart(g, armGeo, mats.zombieSkin, -0.34, 1.15, 0);
      addPart(g, armGeo, mats.zombieSkin, 0.34, 1.15, 0);
      addPart(g, headGeo, mats.zombieSkin, 0, 1.66, 0);
      break;
    case 'skeleton':
      addPart(g, legGeo, mats.boneDark, -0.13, 0.375, 0);
      addPart(g, legGeo, mats.boneDark, 0.13, 0.375, 0);
      addPart(g, bodyGeo, mats.bone, 0, 1.1, 0);
      addPart(g, armGeo, mats.bone, -0.34, 1.15, 0);
      addPart(g, armGeo, mats.bone, 0.34, 1.15, 0);
      addPart(g, headGeo, mats.bone, 0, 1.66, 0);
      break;
    case 'creeper':
      addPart(g, pigLegGeo, mats.creeperDark, -0.12, 0.15, -0.12);
      addPart(g, pigLegGeo, mats.creeperDark, 0.12, 0.15, -0.12);
      addPart(g, pigLegGeo, mats.creeperDark, -0.12, 0.15, 0.12);
      addPart(g, pigLegGeo, mats.creeperDark, 0.12, 0.15, 0.12);
      addPart(g, creeperBodyGeo, mats.creeper, 0, 0.85, 0);
      addPart(g, headGeo, mats.creeper, 0, 1.48, 0);
      addPart(g, creeperFaceGeo, mats.creeperDark, 0, 1.48, 0.22);
      break;
    case 'spider':
      addPart(g, spiderBodyGeo, mats.spider, 0, 0.4, 0);
      addPart(g, spiderHeadGeo, mats.spider, 0, 0.35, 0.5);
      for (const side of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          addPart(g, spiderLegGeo, mats.spider, side * 0.6, 0.3, -0.3 + i * 0.2);
        }
      }
      break;
    case 'pig':
      addPart(g, pigLegGeo, mats.pigDark, -0.25, 0.15, -0.25);
      addPart(g, pigLegGeo, mats.pigDark, 0.25, 0.15, -0.25);
      addPart(g, pigLegGeo, mats.pigDark, -0.25, 0.15, 0.25);
      addPart(g, pigLegGeo, mats.pigDark, 0.25, 0.15, 0.25);
      addPart(g, bodyWideGeo, mats.pig, 0, 0.55, 0);
      addPart(g, headGeo, mats.pig, 0, 0.6, 0.55);
      addPart(g, snoutGeo, mats.pigDark, 0, 0.5, 0.79);
      break;
    case 'cow':
      addPart(g, pigLegGeo, mats.cow, -0.25, 0.15, -0.25);
      addPart(g, pigLegGeo, mats.cow, 0.25, 0.15, -0.25);
      addPart(g, pigLegGeo, mats.cow, -0.25, 0.15, 0.25);
      addPart(g, pigLegGeo, mats.cow, 0.25, 0.15, 0.25);
      addPart(g, bodyWideGeo, mats.cow, 0, 0.6, 0);
      addPart(g, headGeo, mats.cowLight, 0, 0.75, 0.55);
      addPart(g, hornGeo, mats.cowLight, -0.18, 1.02, 0.55);
      addPart(g, hornGeo, mats.cowLight, 0.18, 1.02, 0.55);
      break;
    case 'chicken':
      addPart(g, chickenBodyGeo, mats.chicken, 0, 0.35, 0);
      addPart(g, chickenHeadGeo, mats.chicken, 0, 0.62, 0.2);
      addPart(g, beakGeo, mats.beak, 0, 0.58, 0.38);
      break;
    case 'villager':
      // 长袍身体 + 大头 + 大鼻子
      addPart(g, legGeo, mats.robe, -0.13, 0.375, 0);
      addPart(g, legGeo, mats.robe, 0.13, 0.375, 0);
      addPart(g, bodyGeo, mats.robe, 0, 1.1, 0);
      addPart(g, headGeo, mats.villagerSkin, 0, 1.66, 0);
      addPart(g, snoutGeo, mats.villagerSkin, 0, 1.56, 0.25);
      break;
  }
  return g;
}

const arrowForward = new Vector3(0, 0, 1);
const arrowDir = new Vector3();
/** 帧循环复用的去重集合（避免每帧分配） */
const seenScratch = new Set<number>();
const seenArrowsScratch = new Set<number>();

/** 生物渲染与 AI 驱动（仅生存模式；网格按 id 复用） */
export function Mobs() {
  const groupRef = useRef<Group>(null);
  const meshMap = useRef(new Map<number, Group>());
  const arrowMeshMap = useRef(new Map<number, Mesh>());
  const [mobMats, setMobMats] = useState<MobMats | null>(null);
  const kind = useRendererKind();

  // 按渲染器类型构建材质表；卸载（退出世界）时清空怪物与网格
  useEffect(() => {
    void getAtlasMaterials(kind).then((m) => setMobMats(buildMobMats(m)));
    const meshes = meshMap.current;
    const arrowMeshes = arrowMeshMap.current;
    return () => {
      clearMobs();
      meshes.clear();
      arrowMeshes.clear();
    };
  }, [kind]);

  useFrame((_, delta) => {
    const world = getActiveWorld();
    const group = groupRef.current;
    if (!world || !group) return;
    const store = useGameStore.getState();
    if (store.worldMode !== 'survival' || store.paused) return;
    const dt = Math.min(delta, 0.05);

    const held = store.hotbarSlots[store.selectedSlot];
    const lureFood = held?.kind === 'material' ? held.material : null;
    tickMobs(world, dt, playerPosition, (dmg) => {
      if (!useGameStore.getState().dead) useGameStore.getState().damagePlayer(dmg);
    }, lureFood);

    // 同步生物网格（材质表就绪后才创建）
    if (mobMats) {
      const seen = seenScratch;
      seen.clear();
      for (const m of mobs) {
        seen.add(m.id);
        let mesh = meshMap.current.get(m.id);
        if (!mesh) {
          mesh = makeMobMesh(m.type, mobMats);
          group.add(mesh);
          meshMap.current.set(m.id, mesh);
        }
      mesh.position.set(m.x, m.y, m.z);
      // 朝向：敌对朝玩家，被动朝移动方向
      const def = m.fleeTimer > 0 || !['zombie', 'skeleton', 'spider', 'creeper'].includes(m.type);
      mesh.rotation.y = def && m.wanderMoving
        ? Math.atan2(Math.cos(m.wanderDir), Math.sin(m.wanderDir))
        : Math.atan2(playerPosition.x - m.x, playerPosition.z - m.z);
      // 苦力怕引爆时闪烁膨胀；幼体体型 0.55
      if (m.type === 'creeper' && m.ignite >= 0) {
        mesh.scale.setScalar(1 + 0.08 * Math.sin(performance.now() / 50));
      } else {
        mesh.scale.setScalar(m.baby ? 0.55 : 1);
      }
      }
      for (const [id, mesh] of meshMap.current) {
        if (!seen.has(id)) {
          mesh.removeFromParent();
          meshMap.current.delete(id);
        }
      }

      // 同步箭网格
      const seenArrows = seenArrowsScratch;
      seenArrows.clear();
      for (const a of arrows) {
        seenArrows.add(a.id);
        let mesh = arrowMeshMap.current.get(a.id);
        if (!mesh) {
          mesh = new Mesh(arrowGeo, mobMats.arrow);
          group.add(mesh);
          arrowMeshMap.current.set(a.id, mesh);
        }
        mesh.position.set(a.x, a.y, a.z);
        arrowDir.set(a.vx, a.vy, a.vz).normalize();
        mesh.quaternion.setFromUnitVectors(arrowForward, arrowDir);
      }
      for (const [id, mesh] of arrowMeshMap.current) {
        if (!seenArrows.has(id)) {
          mesh.removeFromParent();
          arrowMeshMap.current.delete(id);
        }
      }
    }
  });

  return <group ref={groupRef} />;
}
