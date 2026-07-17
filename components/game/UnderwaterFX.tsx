'use client';

import { useFrame } from '@react-three/fiber';
import type { Color, Fog } from 'three';
import { WATER } from '@/lib/blocks';
import { atmosphere, getActiveWorld } from '@/lib/game';
import { useGameStore } from '@/lib/store';

const WATER_COLOR = '#16486e';
const WATER_FOG_NEAR = 1;
const WATER_FOG_FAR = 22;

/** 天空雾随渲染距离联动：覆盖最远 chunk，又不至于太近泛白 */
export function skyFog(renderDistance: number): { near: number; far: number } {
  return {
    near: renderDistance * 16 * 0.55,
    far: renderDistance * 16 + 16,
  };
}

/** 头没入水中时切换为水下雾效，离开后恢复天空（雾距随设置） */
export function UnderwaterFX() {
  useFrame(({ scene, camera }) => {
    const world = getActiveWorld();
    if (!world) return;
    const fog = scene.fog as Fog | null;
    const bg = scene.background as Color | null;
    if (!fog || !bg) return;
    const head = world.getBlock(
      Math.floor(camera.position.x),
      Math.floor(camera.position.y),
      Math.floor(camera.position.z),
    );
    if (head === WATER) {
      bg.set(WATER_COLOR);
      fog.color.set(WATER_COLOR);
      fog.near = WATER_FOG_NEAR;
      fog.far = WATER_FOG_FAR;
    } else {
      const { near, far } = skyFog(useGameStore.getState().settings.renderDistance);
      if (fog.near !== near || fog.far !== far) {
        // 恢复天空：颜色取 DayNight 当前计算的大气色
        bg.setRGB(atmosphere.r, atmosphere.g, atmosphere.b);
        fog.color.setRGB(atmosphere.r, atmosphere.g, atmosphere.b);
        fog.near = near;
        fog.far = far;
      }
    }
  });

  return null;
}
