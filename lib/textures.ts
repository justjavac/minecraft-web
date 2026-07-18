// 浏览器端把贴图拼成 atlas（CanvasTexture + NearestFilter 保持像素风）
// 默认贴图为内置的 public/textures/pack/（Faithful 32x，许可见 pack/LICENSE.txt）；
// 设置里导入的自定义包（lib/texturepack.ts，localStorage）可整格覆盖对应 tile，分辨率随包

import * as THREE from 'three';
import {
  ATLAS_COLS,
  ATLAS_ROWS,
  ICON_TILE_COUNT,
  ICON_TILE_START,
  TILE_STEMS,
  TILE_PX as DEFAULT_TILE_PX,
  tileOf,
} from './blocks';
import { mulberry32 } from './noise';
import { loadCustomPack } from './texturepack';

/** 当前 atlas 的单格分辨率（默认 32，随导入的自定义贴图包变化） */
export let tilePx = DEFAULT_TILE_PX;

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

/** 部分 tile 在贴图基础上用 canvas 叠加绘制（工作台/熔炉/皮革/装备/食物图标，格号见 ICON_TILE_START） */
const TEXTURE_OVERLAYS: Record<number, (ctx: CanvasRenderingContext2D, dx: number, dy: number) => void> = {
  // 工作台顶：深色边框 + 2×2 网格
  [ICON_TILE_START + 0]: (ctx, dx, dy) => {
    ctx.fillStyle = '#5a4326';
    ctx.fillRect(dx, dy, 16, 2);
    ctx.fillRect(dx, dy + 14, 16, 2);
    ctx.fillRect(dx, dy, 2, 16);
    ctx.fillRect(dx + 14, dy, 2, 16);
    ctx.fillRect(dx + 7, dy + 2, 2, 12);
    ctx.fillRect(dx + 2, dy + 7, 12, 2);
  },
  // 工作台侧：深色边框 + 中央凹槽
[ICON_TILE_START + 1]: (ctx, dx, dy) => {
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
[ICON_TILE_START + 2]: (ctx, dx, dy) => {
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
[ICON_TILE_START + 3]: (ctx, dx, dy) => speckle(ctx, dx, dy, LEATHER, LEATHER_DARK, 16),
  // 皮革头盔：顶部帽檐 + 两侧护耳
[ICON_TILE_START + 4]: (ctx, dx, dy) => {
    ctx.fillStyle = LEATHER;
    ctx.fillRect(dx + 3, dy + 3, 10, 5);
    ctx.fillRect(dx + 3, dy + 8, 2, 5);
    ctx.fillRect(dx + 11, dy + 8, 2, 5);
    ctx.fillStyle = LEATHER_DARK;
    ctx.fillRect(dx + 3, dy + 7, 10, 1);
  },
  // 皮革胸甲：躯干 + 短袖
[ICON_TILE_START + 5]: (ctx, dx, dy) => {
    ctx.fillStyle = LEATHER;
    ctx.fillRect(dx + 4, dy + 3, 8, 10);
    ctx.fillRect(dx + 2, dy + 3, 2, 5);
    ctx.fillRect(dx + 12, dy + 3, 2, 5);
    ctx.fillStyle = LEATHER_DARK;
    ctx.fillRect(dx + 4, dy + 6, 8, 1);
  },
  // 皮革护腿：两条腿 + 腰带
[ICON_TILE_START + 6]: (ctx, dx, dy) => {
    ctx.fillStyle = LEATHER;
    ctx.fillRect(dx + 4, dy + 2, 8, 3);
    ctx.fillRect(dx + 4, dy + 5, 3, 9);
    ctx.fillRect(dx + 9, dy + 5, 3, 9);
    ctx.fillStyle = LEATHER_DARK;
    ctx.fillRect(dx + 4, dy + 4, 8, 1);
  },
  // 皮革靴子：两只靴子
[ICON_TILE_START + 7]: (ctx, dx, dy) => {
    ctx.fillStyle = LEATHER;
    ctx.fillRect(dx + 3, dy + 7, 5, 7);
    ctx.fillRect(dx + 8, dy + 7, 5, 7);
    ctx.fillStyle = LEATHER_DARK;
    ctx.fillRect(dx + 3, dy + 12, 5, 2);
    ctx.fillRect(dx + 8, dy + 12, 5, 2);
  },
  // 木棍：两条斜棍
[ICON_TILE_START + 8]: (ctx, dx, dy) => {
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
[ICON_TILE_START + 9]: (ctx, dx, dy) => speckle(ctx, dx, dy, '#1a1a1a', '#5a5a5a', 22),
  // 生/熟 猪排、牛肉、鸡肉
[ICON_TILE_START + 10]: (ctx, dx, dy) => drawMeat(ctx, dx, dy, '#e88a94', '#c05a64', 23),
[ICON_TILE_START + 11]: (ctx, dx, dy) => drawMeat(ctx, dx, dy, '#8a5a2b', '#6b4420', 24),
[ICON_TILE_START + 12]: (ctx, dx, dy) => drawMeat(ctx, dx, dy, '#c04848', '#903030', 25),
[ICON_TILE_START + 13]: (ctx, dx, dy) => drawMeat(ctx, dx, dy, '#7a4a22', '#5a3416', 26),
[ICON_TILE_START + 14]: (ctx, dx, dy) => drawMeat(ctx, dx, dy, '#e8d0b0', '#c0a880', 27),
[ICON_TILE_START + 15]: (ctx, dx, dy) => drawMeat(ctx, dx, dy, '#c09040', '#987028', 28),
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
  const pack = loadCustomPack();
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * tilePx;
  canvas.height = ATLAS_ROWS * tilePx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 canvas 2d 上下文');

  // 整格覆盖贴图（按 stem 匹配）：设置里导入的包（localStorage）> 内置默认 pack/（Faithful 32x）
  const custom: Partial<Record<string, HTMLImageElement>> = {};
  if (pack) {
    tilePx = pack.tilePx;
    await Promise.all(
      Object.entries(pack.tiles).map(async ([stem, url]) => {
        custom[stem] = await loadImage(url);
      }),
    );
  } else {
    tilePx = DEFAULT_TILE_PX;
  }

  // 预载全部贴图：默认从单文件 atlas 裁格（一次请求）；导入包按 stem 整格覆盖
  const atlas = await loadImage('/textures/atlas.png');
  const drawTile = (i: number, dx: number, dy: number) => {
    const stem = TILE_STEMS[i];
    const img = custom[stem];
    if (img) {
      ctx.drawImage(img, dx, dy, tilePx, tilePx);
      return;
    }
    const sx = (i % ATLAS_COLS) * DEFAULT_TILE_PX;
    const sy = Math.floor(i / ATLAS_COLS) * DEFAULT_TILE_PX;
    ctx.drawImage(atlas, sx, sy, DEFAULT_TILE_PX, DEFAULT_TILE_PX, dx, dy, tilePx, tilePx);
  };
  for (let i = 0; i < TILE_STEMS.length; i++) {
    drawTile(i, (i % ATLAS_COLS) * tilePx, Math.floor(i / ATLAS_COLS) * tilePx);
  }

  // 图标格（ICON_TILE_START..+15）：工作台/熔炉先铺木板/圆石底座，再叠加绘制
  ctx.imageSmoothingEnabled = false;
  for (let k = 0; k < ICON_TILE_COUNT; k++) {
    const cell = ICON_TILE_START + k;
    const dx = (cell % ATLAS_COLS) * tilePx;
    const dy = Math.floor(cell / ATLAS_COLS) * tilePx;
    const baseStem = k <= 1 ? 'oak_planks' : k === 2 ? 'cobblestone' : null;
    if (baseStem) drawTile(tileOf(baseStem), dx, dy);
    // 叠加绘制（工作台/熔炉/装备/食物图标）按 16px 坐标系编写，随分辨率缩放
    const overlay = TEXTURE_OVERLAYS[cell];
    if (overlay) {
      ctx.save();
      ctx.scale(tilePx / 16, tilePx / 16);
      overlay(ctx, (cell % ATLAS_COLS) * 16, Math.floor(cell / ATLAS_COLS) * 16);
      ctx.restore();
    }
  }

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
