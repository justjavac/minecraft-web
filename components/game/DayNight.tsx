'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  Object3D,
  RepeatWrapping,
  Vector3,
  type AmbientLight,
  type DirectionalLight,
  type Fog,
  type Group,
  type Material,
  type Sprite,
  type SpriteMaterial,
} from 'three';
import { isLavaId, isWaterId } from '@/lib/blocks';
import { atmosphere, debugInfo, getActiveWorld, playerPosition, worldClock } from '@/lib/game';
import { bolts, BOLT_TTL, tickLightning } from '@/lib/lightning';
import { mulberry32, smoothstep } from '@/lib/noise';
import { useGameStore } from '@/lib/store';
import { getAtlasMaterials, tickWaterTexture } from '@/lib/textures';
import { tickWeather, weather, weatherDim } from '@/lib/weather';
import { useRendererKind } from './renderer-kind';

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

/** 闪电 bolt 共享资源（模块级，同本文件 sky/sunDir 惯例：避免 hook 内可变值争议） */
const boltGeom = new BoxGeometry(0.22, 1, 0.22);
const boltMat = new MeshBasicMaterial({ color: '#f4f8ff', transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false });
const boltSegDir = new Vector3();
const boltUp = new Vector3(0, 1, 0);

/** 闪电 bolt 渲染：白色竖直分段折线（细长方体段，加法混合），存活 ~0.2s 淡出；数据来自 lib/lightning.ts */
function LightningBolts() {
  const groupRef = useRef<Group>(null);
  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    g.clear();
    let strongest = 0;
    for (const bolt of bolts) {
      strongest = Math.max(strongest, bolt.ttl);
      for (let i = 0; i < bolt.points.length - 1; i++) {
        const a = bolt.points[i];
        const b = bolt.points[i + 1];
        boltSegDir.set(b.x - a.x, b.y - a.y, b.z - a.z);
        const len = boltSegDir.length();
        if (len < 0.01) continue;
        const seg = new Mesh(boltGeom, boltMat);
        seg.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        seg.scale.set(1, len, 1);
        seg.quaternion.setFromUnitVectors(boltUp, boltSegDir.normalize());
        g.add(seg);
      }
    }
    g.visible = bolts.length > 0;
    boltMat.opacity = Math.min(1, (strongest / BOLT_TTL) * 1.2);
  });
  return <group ref={groupRef} />;
}

/** 昼夜循环：太阳/月亮轨道、云层漂移、光照与雾色随时间渐变 */
export function DayNight() {
  const sunRef = useRef<Sprite>(null);
  const moonRef = useRef<Sprite>(null);
  const cloudRef = useRef<Mesh>(null);
  const dirRef = useRef<DirectionalLight>(null);
  const ambRef = useRef<AmbientLight>(null);
  /** 平行光目标：每帧跟随相机，使光照方向只由 sunDir 决定（默认 target 固定在原点，方向会随玩家位置漂移） */
  const [lightTarget] = useState(() => new Object3D());
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
    // 昼夜时钟由 lib/sim.ts 的统一模拟循环推进（game.ts 共享 worldClock，随存档持久化；暂停时冻结）；这里只读 t 做视觉
    if (!useGameStore.getState().paused) {
      tickWeather(weather, delta);
      // 闪电实体（雷暴落雷）：与天气同处推进（sim.ts 收口之外的既有天气入口），命中/雷声/ bolt 生命周期一并结算
      const w = getActiveWorld();
      if (w) {
        tickLightning(w, delta, playerPosition, (dmg) => {
          const s = useGameStore.getState();
          if (s.worldMode === 'survival' && !s.dead) s.damagePlayer(dmg);
        });
      }
    }
    const t = worldClock.t;
    const a = t * Math.PI * 2;
    const elevation = Math.sin(a);

    // 昼夜系数与黄昏系数（日出日落附近）；天气压暗，雷暴闪电瞬间增亮
    const dayFactor = smoothstep(-0.12, 0.15, elevation);
    const duskFactor = Math.max(0, 1 - Math.abs(elevation) / 0.22) * 0.55;
    // 维度：末地恒暗、下界恒暗红（MC 两维度均无昼夜与天气）
    const dimension = useGameStore.getState().dimension;
    const isEnd = dimension === 'end';
    const isNether = dimension === 'nether';
    const overworld = !isEnd && !isNether;
    const dim = overworld ? weatherDim(weather.kind) : 1;
    const flash = overworld ? weather.flash : 0;
    sky.lerpColors(SKY_NIGHT, SKY_DAY, dayFactor);
    sky.lerp(SKY_DUSK, duskFactor);
    sky.multiplyScalar(dim);
    if (flash > 0) sky.lerp(SKY_FLASH, flash * 0.75);
    if (isEnd) sky.setRGB(0.012, 0.006, 0.024);
    if (isNether) sky.setRGB(0.13, 0.03, 0.018); // MC 下界：暗红环境光
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

    // 光照随昼夜与天气渐变；闪电瞬间打亮（下界/末地恒定，MC 无昼夜）
    sunDir.set(Math.cos(a), elevation, 0.25).normalize();
    const dir = dirRef.current;
    if (dir) {
      dir.intensity = (isEnd ? 0.32 : isNether ? 0.45 : (0.15 + dayFactor * 0.95) * dim) + flash * 2.2;
      dir.position.set(
        camera.position.x + sunDir.x * 120,
        camera.position.y + sunDir.y * 120,
        camera.position.z + sunDir.z * 120,
      );
      // target 跟随相机：光源与目标同步平移，光照方向只由 sunDir 决定
      lightTarget.position.copy(camera.position);
      lightTarget.updateMatrixWorld();
      dir.target = lightTarget;
    }
    const amb = ambRef.current;
    if (amb) amb.intensity = isNether ? 0.65 : (0.35 + dayFactor * 0.45) * (0.55 + 0.45 * dim) + flash * 0.7;

    // 太阳 / 月亮沿轨道（跟随相机，保持视距）；雨雪天被云遮住（下界/末地无日月，MC）
    const sun = sunRef.current;
    if (sun) {
      sun.visible = overworld && weather.kind === 'clear';
      sun.position.set(
        camera.position.x + sunDir.x * ORBIT_RADIUS,
        camera.position.y + sunDir.y * ORBIT_RADIUS,
        camera.position.z + sunDir.z * ORBIT_RADIUS,
      );
    }
    const moon = moonRef.current;
    if (moon) {
      moon.visible = overworld && weather.kind === 'clear';
      moon.position.set(
        camera.position.x - sunDir.x * ORBIT_RADIUS,
        camera.position.y - sunDir.y * ORBIT_RADIUS,
        camera.position.z - sunDir.z * ORBIT_RADIUS,
      );
    }

    // 云层跟随相机平移 + 纹理漂移；雨雪天云层变灰变厚；设置里可关闭云（MC 云开关）；下界/末地无云（MC）
    const cloud = cloudRef.current;
    if (cloud) {
      cloud.visible = overworld && useGameStore.getState().settings.clouds;
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
      <primitive object={lightTarget} />
      <LightningBolts />
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
