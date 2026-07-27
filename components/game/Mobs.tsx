'use client';

import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, Group, Mesh, Vector3, type Material } from 'three';
import { getActiveWorld, playerPosition } from '@/lib/game';
import { arrows, clearMobs, mobs, tickMobs, type Mob, type MobType } from '@/lib/mobs';
import { professionOf, PROFESSION_INFO, type Profession } from '@/lib/trading';
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
const shroomGeo = new BoxGeometry(0.14, 0.06, 0.14);
const shroomCapGeo = new BoxGeometry(0.18, 0.06, 0.18);
const arrowGeo = new BoxGeometry(0.05, 0.05, 0.5);
const swordGeo = new BoxGeometry(0.05, 0.5, 0.05);
const blazeRodGeo = new BoxGeometry(0.09, 0.9, 0.09);
const fireballGeo = new BoxGeometry(0.22, 0.22, 0.22);
const ghastBodyGeo = new BoxGeometry(2.2, 2.2, 2.2);
const ghastTentacleGeo = new BoxGeometry(0.22, 1.1, 0.22);
const sheepWoolGeo = new BoxGeometry(1.0, 0.62, 0.62);
const sheepSlimGeo = new BoxGeometry(0.7, 0.42, 0.42);
const sheepHeadGeo = new BoxGeometry(0.36, 0.3, 0.3);
const wolfBodyGeo = new BoxGeometry(0.55, 0.4, 0.9);
const wolfHeadGeo = new BoxGeometry(0.34, 0.3, 0.34);
const wolfEarGeo = new BoxGeometry(0.08, 0.14, 0.08);
const wolfTailGeo = new BoxGeometry(0.12, 0.12, 0.45);
const collarGeo = new BoxGeometry(0.4, 0.14, 0.14);
const enderLegGeo = new BoxGeometry(0.18, 1.2, 0.18);
const enderBodyGeo = new BoxGeometry(0.42, 1.1, 0.26);
const enderArmGeo = new BoxGeometry(0.12, 1.4, 0.12);
const enderEyeGeo = new BoxGeometry(0.08, 0.06, 0.02);
const witherRibGeo = new BoxGeometry(0.7, 0.16, 0.3);
const witherHeadGeo = new BoxGeometry(0.44, 0.44, 0.44);
const witherSideHeadGeo = new BoxGeometry(0.34, 0.34, 0.34);
// 末影龙：躯干纵贯 z 轴（头朝 +z，与 mob 朝向 yaw 一致），部件以体心为原点
const dragonBodyGeo = new BoxGeometry(1.1, 1, 4.2);
const dragonNeckGeo = new BoxGeometry(0.55, 0.55, 1.1);
const dragonHeadGeo = new BoxGeometry(0.85, 0.85, 1.3);
const dragonSnoutGeo = new BoxGeometry(0.5, 0.4, 0.6);
const dragonHornGeo = new BoxGeometry(0.12, 0.5, 0.12);
const dragonTailGeo = new BoxGeometry(0.55, 0.55, 2.2);
const dragonTailTipGeo = new BoxGeometry(0.3, 0.3, 1.8);
const dragonWingGeo = new BoxGeometry(3.2, 0.12, 1.7);
const dragonEyeBandGeo = new BoxGeometry(0.9, 0.15, 0.15);
const shulkerBaseGeo = new BoxGeometry(0.9, 0.55, 0.9);
const shulkerLidGeo = new BoxGeometry(0.8, 0.35, 0.8);
const slimeBodyGeo = new BoxGeometry(1.2, 1.2, 1.2);
const slimeEyeGeo = new BoxGeometry(0.14, 0.14, 0.04);
const slimeMouthGeo = new BoxGeometry(0.32, 0.09, 0.04);

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
    mooshroom: l('#a03028'), // 蘑菇牛红身（MC 红蘑菇牛）
    mooshroomSpot: l('#e8e0d8'),
    piglinSkin: l('#c98a8a'), // 僵尸猪灵：腐粉
    piglinFlesh: l('#e0a69a'), // 猪灵：粉棕
    piglinDark: l('#9a6a5a'),
    brute: l('#6a5a50'), // 蛮兵：深褐
    bruteDark: l('#4a3e38'),
    piglinRot: l('#7f9e5f'), // 僵尸猪灵：尸斑绿
    goldSword: l('#e8c840'),
    blaze: l('#e8b830'), // 烈焰人明黄
    blazeRod: l('#c07818'), // 烈焰棒橙
    wither: l('#1a1a1a'), // 凋灵骷髅炭黑
    ghast: l('#f0f0f0'), // 恶魂雪白
    ghastTear: l('#c8b8d8'),
    sheepFace: l('#d8b8a0'),
    wolf: l('#c8c8c8'),
    wolfDark: l('#909090'),
    collar: l('#c03030'),
    enderman: l('#141414'),
    enderEyes: l('#b050e0'),
    witherBody: l('#242028'),
    dragonBody: l('#171221'),
    dragonWing: l('#2b2340'),
    dragonEye: l('#c860ff'),
    shulkerShell: l('#8a6a9a'),
    shulkerTop: l('#a585b5'),
    shulkerBullet: l('#c9a0e8'),
    slimeOuter: l('#7ecb6a'),
    slimeDark: l('#2a5a28'),
    chicken: l('#e8e8e8'),
    beak: l('#e8a030'),
    robe: l('#7a5230'),
    villagerSkin: l('#b58a6a'),
    arrow: l('#a8a8a8'),
    enderEye: l('#2fae5f'), // 末影之眼（绿）
    // 村民职业袍色（交易界面同色）
    ...Object.fromEntries(Object.entries(PROFESSION_INFO).map(([p, info]) => [`robe_${p}`, l(info.robe)])),
    // 羊毛色（羊模型用，MC 分布六色）
    ...Object.fromEntries(['white', 'black', 'gray', 'light_gray', 'brown', 'pink'].map((c) => [`wool_${c}`, l({ white: '#e8e8e8', black: '#1a1a1a', gray: '#5a5a5a', light_gray: '#a0a0a0', brown: '#6b4a2f', pink: '#f0a8b8' }[c] ?? '#e8e8e8')])),
  };
}

function addPart(g: Group, geo: BoxGeometry, mat: Material, x: number, y: number, z: number): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

/** 职业袍色材质（buildMobMats 预建 robe_<profession> 键） */
function profRobe(mats: MobMats, prof: Profession): Material {
  return mats[`robe_${prof}`] ?? mats.robe;
}

/** 羊毛色材质（buildMobMats 预建 wool_<color> 键） */
function woolMats(mats: MobMats, key: string): Material {
  return mats[`wool_${key}`] ?? mats.wolf;
}

function makeMobMesh(type: MobType, mats: MobMats, mob?: Mob): Group {
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
    case 'mooshroom':
      // 红身牛 + 背上蘑菇伞 + 白斑（MC 蘑菇牛）
      addPart(g, pigLegGeo, mats.mooshroom, -0.25, 0.15, -0.25);
      addPart(g, pigLegGeo, mats.mooshroom, 0.25, 0.15, -0.25);
      addPart(g, pigLegGeo, mats.mooshroom, -0.25, 0.15, 0.25);
      addPart(g, pigLegGeo, mats.mooshroom, 0.25, 0.15, 0.25);
      addPart(g, bodyWideGeo, mats.mooshroom, 0, 0.6, 0);
      addPart(g, headGeo, mats.mooshroomSpot, 0, 0.75, 0.55);
      addPart(g, hornGeo, mats.mooshroomSpot, -0.18, 1.02, 0.55);
      addPart(g, hornGeo, mats.mooshroomSpot, 0.18, 1.02, 0.55);
      // 背上三朵蘑菇（红伞白斑小方块）
      addPart(g, shroomGeo, mats.mooshroom, -0.15, 1.05, -0.1);
      addPart(g, shroomCapGeo, mats.mooshroomSpot, -0.15, 1.13, -0.1);
      addPart(g, shroomGeo, mats.mooshroom, 0.18, 1.05, 0.15);
      addPart(g, shroomCapGeo, mats.mooshroomSpot, 0.18, 1.13, 0.15);
      addPart(g, shroomGeo, mats.mooshroom, 0, 1.05, -0.25);
      addPart(g, shroomCapGeo, mats.mooshroomSpot, 0, 1.13, -0.25);
      break;
    case 'zombified_piglin':
      // 僵尸猪灵：腐粉与尸斑拼接的人形 + 金剑（MC 标志性中立怪）
      addPart(g, legGeo, mats.piglinRot, -0.13, 0.375, 0);
      addPart(g, legGeo, mats.piglinRot, 0.13, 0.375, 0);
      addPart(g, bodyGeo, mats.piglinSkin, 0, 1.1, 0);
      addPart(g, armGeo, mats.piglinSkin, -0.34, 1.15, 0);
      addPart(g, armGeo, mats.piglinRot, 0.34, 1.15, 0);
      addPart(g, headGeo, mats.piglinSkin, 0, 1.66, 0);
      addPart(g, snoutGeo, mats.piglinRot, 0, 1.6, 0.22);
      addPart(g, swordGeo, mats.goldSword, 0.42, 1.0, 0.1);
      break;
    case 'piglin':
      // 猪灵：粉棕皮猪人 + 金剑（MC；金甲玩家的朋友）
      addPart(g, legGeo, mats.piglinDark, -0.13, 0.375, 0);
      addPart(g, legGeo, mats.piglinDark, 0.13, 0.375, 0);
      addPart(g, bodyGeo, mats.piglinFlesh, 0, 1.1, 0);
      addPart(g, armGeo, mats.piglinFlesh, -0.34, 1.15, 0);
      addPart(g, armGeo, mats.piglinFlesh, 0.34, 1.15, 0);
      addPart(g, headGeo, mats.piglinFlesh, 0, 1.66, 0);
      addPart(g, snoutGeo, mats.piglinDark, 0, 1.6, 0.22);
      addPart(g, swordGeo, mats.goldSword, 0.42, 1.0, 0.1);
      break;
    case 'piglin_brute':
      // 猪灵蛮兵：深褐魁梧猪人 + 金斧（更高大，MC 堡垒守卫）
      addPart(g, legGeo, mats.bruteDark, -0.15, 0.375, 0);
      addPart(g, legGeo, mats.bruteDark, 0.15, 0.375, 0);
      addPart(g, bodyGeo, mats.brute, 0, 1.15, 0);
      addPart(g, armGeo, mats.brute, -0.36, 1.2, 0);
      addPart(g, armGeo, mats.brute, 0.36, 1.2, 0);
      addPart(g, headGeo, mats.brute, 0, 1.72, 0);
      addPart(g, snoutGeo, mats.bruteDark, 0, 1.66, 0.22);
      addPart(g, swordGeo, mats.goldSword, 0.44, 1.05, 0.1);
      break;
    case 'blaze':
      // 烈焰人：明黄头 + 环身烈焰棒（MC 标志造型）
      addPart(g, headGeo, mats.blaze, 0, 1.3, 0);
      for (const [rx, rz] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]] as const) {
        addPart(g, blazeRodGeo, mats.blazeRod, rx, 0.85, rz);
      }
      break;
    case 'wither_skeleton':
      // 凋灵骷髅：炭黑高个 + 石剑
      addPart(g, legGeo, mats.wither, -0.13, 0.45, 0);
      addPart(g, legGeo, mats.wither, 0.13, 0.45, 0);
      addPart(g, bodyGeo, mats.wither, 0, 1.25, 0);
      addPart(g, armGeo, mats.wither, -0.34, 1.3, 0);
      addPart(g, armGeo, mats.wither, 0.34, 1.3, 0);
      addPart(g, headGeo, mats.wither, 0, 1.85, 0);
      addPart(g, swordGeo, mats.arrow, 0.42, 1.1, 0.1);
      break;
    case 'enderman':
      // 末影人：炭黑高个（2.9 高）+ 紫瞳 + 垂手长臂（MC 标志造型）
      addPart(g, enderLegGeo, mats.enderman, -0.12, 0.6, 0);
      addPart(g, enderLegGeo, mats.enderman, 0.12, 0.6, 0);
      addPart(g, enderBodyGeo, mats.enderman, 0, 1.75, 0);
      addPart(g, enderArmGeo, mats.enderman, -0.36, 1.3, 0);
      addPart(g, enderArmGeo, mats.enderman, 0.36, 1.3, 0);
      addPart(g, headGeo, mats.enderman, 0, 2.55, 0);
      addPart(g, enderEyeGeo, mats.enderEyes, -0.09, 2.6, 0.22);
      addPart(g, enderEyeGeo, mats.enderEyes, 0.09, 2.6, 0.22);
      break;
    case 'wither':
      // 凋灵 Boss：三头骨 + 炭黑骨架体（MC 标志造型）
      addPart(g, witherRibGeo, mats.witherBody, 0, 1.0, 0);
      addPart(g, witherRibGeo, mats.witherBody, 0, 1.35, 0);
      addPart(g, witherHeadGeo, mats.witherBody, 0, 1.8, 0);
      addPart(g, witherSideHeadGeo, mats.witherBody, -0.42, 1.55, 0);
      addPart(g, witherSideHeadGeo, mats.witherBody, 0.42, 1.55, 0);
      break;
    case 'shulker':
      // 潜影贝：紫壳方盒 + 微开顶盖（MC 标志造型；固着不动）
      addPart(g, shulkerBaseGeo, mats.shulkerShell, 0, 0.3, 0);
      addPart(g, shulkerLidGeo, mats.shulkerTop, 0.04, 0.72, 0.04);
      break;
    case 'slime':
      // 史莱姆：绿方块 + 双眼与嘴（MC 标志造型；体型由 slimeSize 缩放）
      addPart(g, slimeBodyGeo, mats.slimeOuter, 0, 0.7, 0);
      addPart(g, slimeEyeGeo, mats.slimeDark, -0.2, 0.85, 0.62);
      addPart(g, slimeEyeGeo, mats.slimeDark, 0.2, 0.85, 0.62);
      addPart(g, slimeMouthGeo, mats.slimeDark, 0, 0.5, 0.62);
      break;
    case 'ender_dragon': {
      // 末影龙 Boss：黑紫长躯 + 双翼展开 + 紫眼（MC 标志造型）；部件以体心为原点
      addPart(g, dragonBodyGeo, mats.dragonBody, 0, 0, 0);
      addPart(g, dragonNeckGeo, mats.dragonBody, 0, 0.3, 2.3);
      addPart(g, dragonHeadGeo, mats.dragonBody, 0, 0.45, 3.1);
      addPart(g, dragonSnoutGeo, mats.dragonBody, 0, 0.3, 3.9);
      addPart(g, dragonEyeBandGeo, mats.dragonEye, 0, 0.65, 3.45);
      addPart(g, dragonHornGeo, mats.dragonWing, -0.25, 1.05, 2.9);
      addPart(g, dragonHornGeo, mats.dragonWing, 0.25, 1.05, 2.9);
      addPart(g, dragonTailGeo, mats.dragonBody, 0, -0.1, -2.8);
      addPart(g, dragonTailTipGeo, mats.dragonBody, 0, -0.05, -4.6);
      const lw = addPart(g, dragonWingGeo, mats.dragonWing, -2.1, 0.7, 0.4);
      lw.rotation.z = 0.5;
      const rw = addPart(g, dragonWingGeo, mats.dragonWing, 2.1, 0.7, 0.4);
      rw.rotation.z = -0.5;
      break;
    }
    case 'ghast':
      // 恶魂：雪白巨体 + 下垂触手（MC 下界空中巨怪）
      addPart(g, ghastBodyGeo, mats.ghast, 0, 1.2, 0);
      for (const [tx, tz] of [[-0.7, -0.7], [0, -0.7], [0.7, -0.7], [-0.7, 0], [0.7, 0], [-0.7, 0.7], [0, 0.7], [0.7, 0.7]] as const) {
        addPart(g, ghastTentacleGeo, mats.ghastTear, tx, -0.15, tz);
      }
      break;
    case 'chicken':
      addPart(g, chickenBodyGeo, mats.chicken, 0, 0.35, 0);
      addPart(g, chickenHeadGeo, mats.chicken, 0, 0.62, 0.2);
      addPart(g, beakGeo, mats.beak, 0, 0.58, 0.38);
      break;
    case 'villager': {
      // 长袍身体 + 大头 + 大鼻子；袍色随职业（农民/图书管理员/石匠/牧师/皮匠）
      const robe = mob ? profRobe(mats, professionOf(mob.id)) : mats.robe;
      addPart(g, legGeo, robe, -0.13, 0.375, 0);
      addPart(g, legGeo, robe, 0.13, 0.375, 0);
      addPart(g, bodyGeo, robe, 0, 1.1, 0);
      addPart(g, headGeo, mats.villagerSkin, 0, 1.66, 0);
      addPart(g, snoutGeo, mats.villagerSkin, 0, 1.56, 0.25);
      break;
    }
    case 'sheep': {
      // 羊：毛壳（按毛色）+ 头；剪过毛的只剩瘦脸与细身
      const woolMat = woolMats(mats, mob?.woolColor ?? 'white');
      addPart(g, pigLegGeo, mats.sheepFace, -0.2, 0.15, -0.2);
      addPart(g, pigLegGeo, mats.sheepFace, 0.2, 0.15, -0.2);
      addPart(g, pigLegGeo, mats.sheepFace, -0.2, 0.15, 0.2);
      addPart(g, pigLegGeo, mats.sheepFace, 0.2, 0.15, 0.2);
      if (mob?.sheared) {
        addPart(g, sheepSlimGeo, mats.sheepFace, 0, 0.5, 0);
      } else {
        addPart(g, sheepWoolGeo, woolMat, 0, 0.62, 0);
      }
      addPart(g, sheepHeadGeo, mats.sheepFace, 0, mob?.sheared ? 0.72 : 0.78, 0.5);
      break;
    }
    case 'wolf': {
      // 狼：四足 + 头 + 竖耳 + 尾；驯服的有红项圈（MC）
      addPart(g, pigLegGeo, mats.wolfDark, -0.18, 0.15, -0.2);
      addPart(g, pigLegGeo, mats.wolfDark, 0.18, 0.15, -0.2);
      addPart(g, pigLegGeo, mats.wolfDark, -0.18, 0.15, 0.2);
      addPart(g, pigLegGeo, mats.wolfDark, 0.18, 0.15, 0.2);
      addPart(g, wolfBodyGeo, mats.wolf, 0, 0.55, 0);
      addPart(g, wolfHeadGeo, mats.wolf, 0, 0.72, 0.45);
      addPart(g, wolfEarGeo, mats.wolfDark, -0.12, 0.95, 0.42);
      addPart(g, wolfEarGeo, mats.wolfDark, 0.12, 0.95, 0.42);
      addPart(g, wolfTailGeo, mats.wolf, 0, 0.68, -0.5);
      if (mob?.tamed) addPart(g, collarGeo, mats.collar, 0, 0.62, 0.28);
      break;
    }
  }
  return g;
}

const arrowForward = new Vector3(0, 0, 1);
const arrowDir = new Vector3();
/** 帧循环复用的去重集合（避免每帧分配） */
const seenScratch = new Set<string>();
const seenArrowsScratch = new Set<number>();
/** 敌对生物类型（朝向玩家；其余朝移动方向）。模块级常量，避免每生物每帧分配数组字面量 */
const HOSTILE_TYPES: readonly MobType[] = ['zombie', 'skeleton', 'spider', 'creeper'];

/** 生物渲染与 AI 驱动（仅生存模式；网格按 id 复用） */
export function Mobs() {
  const groupRef = useRef<Group>(null);
  const meshMap = useRef(new Map<string, Group>());
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
        // 羊剪毛/狼驯服会换模型：网格键带状态位，状态变时旧网格被回收重建
        const meshKey = `${m.id}:${m.sheared ? 1 : 0}${m.tamed ? 1 : 0}`;
        seen.add(meshKey);
        let mesh = meshMap.current.get(meshKey);
        if (!mesh) {
          mesh = makeMobMesh(m.type, mobMats, m);
          group.add(mesh);
          meshMap.current.set(meshKey, mesh);
        }
      mesh.position.set(m.x, m.y, m.z);
      // 朝向：敌对朝玩家，被动朝移动方向
      const def = m.fleeTimer > 0 || !HOSTILE_TYPES.includes(m.type);
      mesh.rotation.y = def && m.wanderMoving
        ? Math.atan2(Math.cos(m.wanderDir), Math.sin(m.wanderDir))
        : Math.atan2(playerPosition.x - m.x, playerPosition.z - m.z);
      // 苦力怕引爆时闪烁膨胀；幼体体型 0.55；史莱姆按体型档缩放（大 1.4 / 中 0.7 / 小 0.35）
      if (m.type === 'creeper' && m.ignite >= 0) {
        mesh.scale.setScalar(1 + 0.08 * Math.sin(performance.now() / 50));
      } else if (m.type === 'slime') {
        mesh.scale.setScalar((m.slimeSize ?? 4) * 0.35);
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
          // 烈焰人火球：橙色大球；恶魂爆裂球：淡紫大球；末影之眼：绿色小球；潜影弹：紫色小球；箭：灰色小条
          const isBall = a.kind === 'fireball' || a.kind === 'ghast' || a.kind === 'eye' || a.kind === 'shulker';
          mesh = new Mesh(isBall ? fireballGeo : arrowGeo, a.kind === 'ghast' ? mobMats.ghastTear : a.kind === 'fireball' ? mobMats.blaze : a.kind === 'eye' ? mobMats.enderEye : a.kind === 'shulker' ? mobMats.shulkerBullet : mobMats.arrow);
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
