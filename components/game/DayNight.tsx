'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  CanvasTexture,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  NearestFilter,
  RepeatWrapping,
  Vector3,
  type AmbientLight,
  type DirectionalLight,
  type Fog,
  type Material,
  type Mesh,
  type Sprite,
  type SpriteMaterial,
} from 'three';
import { isLavaId, isWaterId } from '@/lib/blocks';
import { atmosphere, debugInfo, getActiveWorld, worldClock } from '@/lib/game';
import { mulberry32 } from '@/lib/noise';
import { useGameStore } from '@/lib/store';
import { getAtlasMaterials, tickWaterTexture } from '@/lib/textures';
import { tickWeather, weather, weatherDim } from '@/lib/weather';
import { useRendererKind } from './renderer-kind';

const CYCLE_SECONDS = 600; // 一昼夜 10 分钟
const ORBIT_RADIUS = 280;
const BODY_SIZE = 36; // 太阳/月亮贴图尺寸
const CLOUD_Y = 80;
const CLOUD_SIZE = 600;
const CLOUD_SPEED = 2.5; // 纹理偏移速度

const SKY_DAY = new Color('#87ceeb');
const SKY_NIGHT = new Color('#0b1026');
const SKY_DUSK = new Color('#e8935c');
const SKY_FLASH = new Color('#e8ecff');
const sky = new Color();
const sunDir = new Vector3();

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** MC 风格方形天体贴图：主体色方块 + 内部明暗像素 */
function makeBodyTexture(base: string, shade: string, size: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 canvas 2d 上下文');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const rand = mulberry32(size * 7 + 13);
  ctx.fillStyle = shade;
  for (let i = 0; i < size / 4; i++) {
    const w = 2 + Math.floor(rand() * 4);
    ctx.fillRect(Math.floor(rand() * (size - w)), Math.floor(rand() * (size - w)), w, w);
  }
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  return tex;
}

/** 方块云贴图：8px 对齐的随机白色矩形 */
function makeCloudTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 canvas 2d 上下文');
  const rand = mulberry32(42);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  for (let i = 0; i < 16; i++) {
    const w = (2 + Math.floor(rand() * 5)) * 8;
    const h = (1 + Math.floor(rand() * 2)) * 8;
    ctx.fillRect(Math.floor(rand() * (size - w) / 8) * 8, Math.floor(rand() * (size - h) / 8) * 8, w, h);
  }
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

/** 昼夜循环：太阳/月亮轨道、云层漂移、光照与雾色随时间渐变 */
export function DayNight() {
  const sunRef = useRef<Sprite>(null);
  const moonRef = useRef<Sprite>(null);
  const cloudRef = useRef<Mesh>(null);
  const dirRef = useRef<DirectionalLight>(null);
  const ambRef = useRef<AmbientLight>(null);
  const sunTex = useMemo(() => makeBodyTexture('#f5d76e', '#eec845', 32), []);
  const moonTex = useMemo(() => makeBodyTexture('#dfe3ee', '#b9c0d4', 32), []);
  const cloudTex = useMemo(() => makeCloudTexture(), []);
  /** 按渲染器类型创建的材质（sprite/basic 的节点或经典变体） */
  const [mats, setMats] = useState<{ sun: Material; moon: Material; cloud: Material } | null>(null);
  const kind = useRendererKind();

  useEffect(() => {
    void getAtlasMaterials(kind).then((m) => {
      setMats({
        sun: m.sprite({ map: sunTex, transparent: true, fog: false, depthWrite: false }),
        moon: m.sprite({ map: moonTex, transparent: true, fog: false, depthWrite: false }),
        cloud: m.basic({ map: cloudTex, transparent: true, opacity: 0.55, depthWrite: false, side: DoubleSide }),
      });
    });
  }, [sunTex, moonTex, cloudTex, kind]);

  useFrame(({ scene, camera }, delta) => {
    const dt = Math.min(delta, 0.05);
    tickWaterTexture(performance.now());
    // 昼夜时钟在 game.ts 共享（0=日出 0.25=正午 0.5=日落 0.75=午夜），随存档持久化；暂停时冻结
    if (!useGameStore.getState().paused) {
      worldClock.t = (worldClock.t + delta / CYCLE_SECONDS) % 1;
      tickWeather(weather, delta);
    }
    const t = worldClock.t;
    const a = t * Math.PI * 2;
    const elevation = Math.sin(a);

    // 昼夜系数与黄昏系数（日出日落附近）；天气压暗，雷暴闪电瞬间增亮
    const dayFactor = smoothstep(-0.12, 0.15, elevation);
    const duskFactor = Math.max(0, 1 - Math.abs(elevation) / 0.22) * 0.55;
    const dim = weatherDim(weather.kind);
    sky.lerpColors(SKY_NIGHT, SKY_DAY, dayFactor);
    sky.lerp(SKY_DUSK, duskFactor);
    sky.multiplyScalar(dim);
    if (weather.flash > 0) sky.lerp(SKY_FLASH, weather.flash * 0.75);
    atmosphere.r = sky.r;
    atmosphere.g = sky.g;
    atmosphere.b = sky.b;
    debugInfo.hour = Math.floor(((t + 0.25) % 1) * 24);

    // 水下/岩浆里时天空/雾色交给 UnderwaterFX，避免互相覆盖
    const world = getActiveWorld();
    const headBlock = world
      ? world.getBlock(
          Math.floor(camera.position.x),
          Math.floor(camera.position.y),
          Math.floor(camera.position.z),
        )
      : 0;
    const immersed = isWaterId(headBlock) || isLavaId(headBlock);
    if (!immersed) {
      (scene.background as Color | null)?.copy(sky);
      (scene.fog as Fog | null)?.color.copy(sky);
    }

    // 光照随昼夜与天气渐变；闪电瞬间打亮
    sunDir.set(Math.cos(a), elevation, 0.25).normalize();
    const dir = dirRef.current;
    if (dir) {
      dir.intensity = (0.15 + dayFactor * 0.95) * dim + weather.flash * 2.2;
      dir.position.set(
        camera.position.x + sunDir.x * 120,
        camera.position.y + sunDir.y * 120,
        camera.position.z + sunDir.z * 120,
      );
    }
    const amb = ambRef.current;
    if (amb) amb.intensity = (0.35 + dayFactor * 0.45) * (0.55 + 0.45 * dim) + weather.flash * 0.7;

    // 太阳 / 月亮沿轨道（跟随相机，保持视距）；雨雪天被云遮住
    const sun = sunRef.current;
    if (sun) {
      sun.visible = weather.kind === 'clear';
      sun.position.set(
        camera.position.x + sunDir.x * ORBIT_RADIUS,
        camera.position.y + sunDir.y * ORBIT_RADIUS,
        camera.position.z + sunDir.z * ORBIT_RADIUS,
      );
    }
    const moon = moonRef.current;
    if (moon) {
      moon.visible = weather.kind === 'clear';
      moon.position.set(
        camera.position.x - sunDir.x * ORBIT_RADIUS,
        camera.position.y - sunDir.y * ORBIT_RADIUS,
        camera.position.z - sunDir.z * ORBIT_RADIUS,
      );
    }

    // 云层跟随相机平移 + 纹理漂移；雨雪天云层变灰变厚
    const cloud = cloudRef.current;
    if (cloud) {
      cloud.position.set(camera.position.x, CLOUD_Y, camera.position.z);
      const mat = cloud.material as MeshBasicMaterial;
      const gray = 0.45 + 0.55 * dim;
      mat.color.setRGB(gray, gray, gray);
      mat.opacity = weather.kind === 'clear' ? 0.55 : 0.85;
      const map = mat.map;
      if (map) map.offset.x = (map.offset.x + (dt * CLOUD_SPEED) / 100) % 1;
    }
  });

  return (
    <>
      <ambientLight ref={ambRef} intensity={0.8} />
      <directionalLight ref={dirRef} position={[80, 120, 60]} intensity={1.0} />
      {mats && (
        <>
          <sprite ref={sunRef} material={mats.sun as unknown as SpriteMaterial} scale={[BODY_SIZE, BODY_SIZE, 1]} />
          <sprite ref={moonRef} material={mats.moon as unknown as SpriteMaterial} scale={[BODY_SIZE * 0.7, BODY_SIZE * 0.7, 1]} />
          <mesh ref={cloudRef} material={mats.cloud} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[CLOUD_SIZE, CLOUD_SIZE]} />
          </mesh>
        </>
      )}
    </>
  );
}
