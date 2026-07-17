// 浏览器端把 16px PNG 拼成贴图 atlas（CanvasTexture + NearestFilter 保持像素风）

import * as THREE from 'three';
import { ATLAS_COLS, ATLAS_ROWS, TILE_FILES, TILE_PX } from './blocks';
import { mulberry32 } from './noise';

const LEATHER = '#a06830';
const LEATHER_DARK = '#6b4420';

/** 填充 16×16 底色 + 确定性噪点 */
function speckle(ctx: CanvasRenderingContext2D, dx: number, dy: number, base: string, dark: string, seed: number): void {
  ctx.fillStyle = base;
  ctx.fillRect(dx, dy, 16, 16);
  const rand = mulberry32(seed);
  ctx.fillStyle = dark;
  for (let i = 0; i < 24; i++) {
    ctx.fillRect(dx + Math.floor(rand() * 16), dy + Math.floor(rand() * 16), 2, 1);
  }
}

/** 肉块图标：主体色块 + 深色噪点 + 白色骨头尖 */
function drawMeat(ctx: CanvasRenderingContext2D, dx: number, dy: number, base: string, dark: string, seed: number): void {
  ctx.fillStyle = base;
  ctx.fillRect(dx + 3, dy + 5, 9, 8);
  ctx.fillRect(dx + 4, dy + 4, 7, 10);
  const rand = mulberry32(seed);
  ctx.fillStyle = dark;
  for (let i = 0; i < 8; i++) {
    ctx.fillRect(dx + 3 + Math.floor(rand() * 8), dy + 5 + Math.floor(rand() * 7), 2, 1);
  }
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(dx + 11, dy + 2, 3, 3);
  ctx.fillRect(dx + 12, dy + 4, 2, 2);
}

/** 部分 tile 在贴图基础上用 canvas 叠加绘制（工作台/熔炉/皮革/装备/食物图标） */
const TEXTURE_OVERLAYS: Record<number, (ctx: CanvasRenderingContext2D, dx: number, dy: number) => void> = {
  // 工作台顶：深色边框 + 2×2 网格
  13: (ctx, dx, dy) => {
    ctx.fillStyle = '#5a4326';
    ctx.fillRect(dx, dy, 16, 2);
    ctx.fillRect(dx, dy + 14, 16, 2);
    ctx.fillRect(dx, dy, 2, 16);
    ctx.fillRect(dx + 14, dy, 2, 16);
    ctx.fillRect(dx + 7, dy + 2, 2, 12);
    ctx.fillRect(dx + 2, dy + 7, 12, 2);
  },
  // 工作台侧：深色边框 + 中央凹槽
  14: (ctx, dx, dy) => {
    ctx.fillStyle = '#5a4326';
    ctx.fillRect(dx, dy, 16, 2);
    ctx.fillRect(dx, dy + 14, 16, 2);
    ctx.fillRect(dx, dy, 2, 16);
    ctx.fillRect(dx + 14, dy, 2, 16);
    ctx.fillRect(dx + 4, dy + 4, 8, 8);
    ctx.fillStyle = '#7a5c33';
    ctx.fillRect(dx + 5, dy + 5, 6, 6);
  },
  // 熔炉：深色边框 + 黑色炉口 + 底部亮条
  15: (ctx, dx, dy) => {
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(dx, dy, 16, 2);
    ctx.fillRect(dx, dy + 14, 16, 2);
    ctx.fillRect(dx, dy, 2, 16);
    ctx.fillRect(dx + 14, dy, 2, 16);
    ctx.fillStyle = '#141414';
    ctx.fillRect(dx + 4, dy + 5, 8, 6);
    ctx.fillStyle = '#7a7a7a';
    ctx.fillRect(dx + 4, dy + 12, 8, 2);
  },
  // 皮革
  16: (ctx, dx, dy) => speckle(ctx, dx, dy, LEATHER, LEATHER_DARK, 16),
  // 皮革头盔：顶部帽檐 + 两侧护耳
  17: (ctx, dx, dy) => {
    ctx.fillStyle = LEATHER;
    ctx.fillRect(dx + 3, dy + 3, 10, 5);
    ctx.fillRect(dx + 3, dy + 8, 2, 5);
    ctx.fillRect(dx + 11, dy + 8, 2, 5);
    ctx.fillStyle = LEATHER_DARK;
    ctx.fillRect(dx + 3, dy + 7, 10, 1);
  },
  // 皮革胸甲：躯干 + 短袖
  18: (ctx, dx, dy) => {
    ctx.fillStyle = LEATHER;
    ctx.fillRect(dx + 4, dy + 3, 8, 10);
    ctx.fillRect(dx + 2, dy + 3, 2, 5);
    ctx.fillRect(dx + 12, dy + 3, 2, 5);
    ctx.fillStyle = LEATHER_DARK;
    ctx.fillRect(dx + 4, dy + 6, 8, 1);
  },
  // 皮革护腿：两条腿 + 腰带
  19: (ctx, dx, dy) => {
    ctx.fillStyle = LEATHER;
    ctx.fillRect(dx + 4, dy + 2, 8, 3);
    ctx.fillRect(dx + 4, dy + 5, 3, 9);
    ctx.fillRect(dx + 9, dy + 5, 3, 9);
    ctx.fillStyle = LEATHER_DARK;
    ctx.fillRect(dx + 4, dy + 4, 8, 1);
  },
  // 皮革靴子：两只靴子
  20: (ctx, dx, dy) => {
    ctx.fillStyle = LEATHER;
    ctx.fillRect(dx + 3, dy + 7, 5, 7);
    ctx.fillRect(dx + 8, dy + 7, 5, 7);
    ctx.fillStyle = LEATHER_DARK;
    ctx.fillRect(dx + 3, dy + 12, 5, 2);
    ctx.fillRect(dx + 8, dy + 12, 5, 2);
  },
  // 木棍：两条斜棍
  21: (ctx, dx, dy) => {
    ctx.strokeStyle = LEATHER_DARK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(dx + 4, dy + 13);
    ctx.lineTo(dx + 12, dy + 3);
    ctx.stroke();
    ctx.strokeStyle = '#9a7a4a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(dx + 5, dy + 13);
    ctx.lineTo(dx + 13, dy + 3);
    ctx.stroke();
  },
  // 木炭：黑色块 + 灰点
  22: (ctx, dx, dy) => speckle(ctx, dx, dy, '#1a1a1a', '#5a5a5a', 22),
  // 生/熟 猪排、牛肉、鸡肉
  23: (ctx, dx, dy) => drawMeat(ctx, dx, dy, '#e88a94', '#c05a64', 23),
  24: (ctx, dx, dy) => drawMeat(ctx, dx, dy, '#8a5a2b', '#6b4420', 24),
  25: (ctx, dx, dy) => drawMeat(ctx, dx, dy, '#c04848', '#903030', 25),
  26: (ctx, dx, dy) => drawMeat(ctx, dx, dy, '#7a4a22', '#5a3416', 26),
  27: (ctx, dx, dy) => drawMeat(ctx, dx, dy, '#e8d0b0', '#c0a880', 27),
  28: (ctx, dx, dy) => drawMeat(ctx, dx, dy, '#c09040', '#987028', 28),
};

/** atlas 画布的 dataURL（HUD 图标裁剪用），build 完成后可用 */
export let atlasDataUrl = '';

/** 渲染器类型（由 renderer-kind.tsx 的 Context 下发） */
export type RendererKind = 'webgl' | 'webgpu';

export interface MaterialOptions {
  color?: string;
  map?: THREE.Texture | null;
  transparent?: boolean;
  opacity?: number;
  alphaTest?: number;
  vertexColors?: boolean;
  depthWrite?: boolean;
  fog?: boolean;
  side?: THREE.Side;
}

export interface AtlasMaterials {
  kind: RendererKind;
  texture: THREE.Texture;
  /** chunk 不透明材质（alphaTest 镂空 + 顶点色 AO） */
  solid: THREE.Material;
  /** chunk 半透明水 */
  water: THREE.Material;
  /** Lambert 纯色材质（生物模型等） */
  lambert: (opts?: MaterialOptions) => THREE.Material;
  /** Basic 材质（裂纹/云/粒子） */
  basic: (opts?: MaterialOptions) => THREE.Material;
  /** Sprite 材质（太阳/月亮） */
  sprite: (opts?: MaterialOptions) => THREE.Material;
  /** Line 材质（选框高亮） */
  line: (opts?: MaterialOptions) => THREE.Material;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`加载贴图失败: ${src}`));
    img.src = src;
  });
}

const cache = new Map<RendererKind, Promise<AtlasMaterials>>();

export function getAtlasMaterials(kind: RendererKind = 'webgl'): Promise<AtlasMaterials> {
  let p = cache.get(kind);
  if (!p) {
    p = build(kind);
    cache.set(kind, p);
  }
  return p;
}

async function build(kind: RendererKind): Promise<AtlasMaterials> {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * TILE_PX;
  canvas.height = ATLAS_ROWS * TILE_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 canvas 2d 上下文');
  ctx.imageSmoothingEnabled = false;

  await Promise.all(
    TILE_FILES.map(async (files, i) => {
      const dx = (i % ATLAS_COLS) * TILE_PX;
      const dy = Math.floor(i / ATLAS_COLS) * TILE_PX;
      // 多文件按顺序叠加（草侧面 = dirt + grass_side 透明层）
      for (const f of files) {
        const img = await loadImage(`/textures/${f}`);
        ctx.drawImage(img, dx, dy);
      }
      TEXTURE_OVERLAYS[i]?.(ctx, dx, dy);
    }),
  );

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  atlasDataUrl = canvas.toDataURL();

  if (kind === 'webgpu') {
    // WebGPU 节点材质（three/webgpu 动态加载，不进默认包）
    const webgpu = await import('three/webgpu');
    const lambert = (o: MaterialOptions = {}) =>
      new webgpu.MeshLambertNodeMaterial({
        color: o.color ?? '#ffffff',
        map: o.map ?? null,
        transparent: o.transparent ?? false,
        opacity: o.opacity ?? 1,
        alphaTest: o.alphaTest ?? 0,
        vertexColors: o.vertexColors ?? false,
        depthWrite: o.depthWrite ?? true,
        side: o.side ?? THREE.FrontSide,
        fog: o.fog ?? true,
      }) as unknown as THREE.Material;
    const basic = (o: MaterialOptions = {}) =>
      new webgpu.MeshBasicNodeMaterial({
        color: o.color ?? '#ffffff',
        map: o.map ?? null,
        transparent: o.transparent ?? false,
        opacity: o.opacity ?? 1,
        alphaTest: o.alphaTest ?? 0,
        vertexColors: o.vertexColors ?? false,
        depthWrite: o.depthWrite ?? true,
        side: o.side ?? THREE.FrontSide,
        fog: o.fog ?? true,
      }) as unknown as THREE.Material;
    const sprite = (o: MaterialOptions = {}) =>
      new webgpu.SpriteNodeMaterial({
        color: o.color ?? '#ffffff',
        map: o.map ?? null,
        transparent: o.transparent ?? true,
        opacity: o.opacity ?? 1,
        depthWrite: o.depthWrite ?? true,
        fog: o.fog ?? true,
      }) as unknown as THREE.Material;
    const line = (o: MaterialOptions = {}) =>
      new webgpu.LineBasicNodeMaterial({ color: o.color ?? '#ffffff' }) as unknown as THREE.Material;
    return {
      kind,
      texture,
      solid: lambert({ map: texture, alphaTest: 0.5, vertexColors: true }),
      water: lambert({ map: texture, transparent: true, opacity: 0.7, depthWrite: false, vertexColors: true }),
      lambert,
      basic,
      sprite,
      line,
    };
  }

  const lambert = (o: MaterialOptions = {}) =>
    new THREE.MeshLambertMaterial({
      color: o.color ?? '#ffffff',
      map: o.map ?? null,
      transparent: o.transparent ?? false,
      opacity: o.opacity ?? 1,
      alphaTest: o.alphaTest ?? 0,
      vertexColors: o.vertexColors ?? false,
      depthWrite: o.depthWrite ?? true,
      side: o.side ?? THREE.FrontSide,
      fog: o.fog ?? true,
    });
  const basic = (o: MaterialOptions = {}) =>
    new THREE.MeshBasicMaterial({
      color: o.color ?? '#ffffff',
      map: o.map ?? null,
      transparent: o.transparent ?? false,
      opacity: o.opacity ?? 1,
      alphaTest: o.alphaTest ?? 0,
      vertexColors: o.vertexColors ?? false,
      depthWrite: o.depthWrite ?? true,
      side: o.side ?? THREE.FrontSide,
      fog: o.fog ?? true,
    });
  const sprite = (o: MaterialOptions = {}) =>
    new THREE.SpriteMaterial({
      color: o.color ?? '#ffffff',
      map: o.map ?? null,
      transparent: o.transparent ?? true,
      opacity: o.opacity ?? 1,
      depthWrite: o.depthWrite ?? true,
      fog: o.fog ?? true,
    });
  const line = (o: MaterialOptions = {}) => new THREE.LineBasicMaterial({ color: o.color ?? '#ffffff' });
  return {
    kind,
    texture,
    solid: lambert({ map: texture, alphaTest: 0.5, vertexColors: true }),
    water: lambert({ map: texture, transparent: true, opacity: 0.7, depthWrite: false, vertexColors: true }),
    lambert,
    basic,
    sprite,
    line,
  };
}
