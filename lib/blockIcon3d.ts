// MC Java 式等轴 3D 方块图标：运行时从 atlas 画布把「整块立方体」渲染成 顶+左/右侧 三面图标。
// 投影用 canvas 平行四边形变换（经典做法）：
//   top:  transform(1,-0.5, 1, 0.5)   —— 菱形顶面
//   left: transform(1, 0.5, 0, 1  )   —— 左侧面
//   right:transform(1,-0.5, 0, 1  )   —— 右侧面
// 光照近似 Java 物品渲染：顶面 1.0 / 左面 0.8 / 右面 0.6（multiply 罩色 + destination-in 裁回 alpha，
// 玻璃/树叶等镂空像素不被罩黑）。imageSmoothingEnabled=false 保持像素风。
// 非整块立方体（花/火把十字、台阶、楼梯、门、压力板等）在 Java 里是独立 3D 模型，
// 这里不建模型系统，保持平面 tile 图标（可接受近似），由 isFullCubeBlock 判定。
// 生成结果按方块 id 缓存（Map），atlas 版本变化（贴图包重载）时整体失效重建。

import { ATLAS_COLS, ATLAS_PAD_RATIO, BLOCKS, type BlockId } from './blocks';
import { atlasCanvas, atlasVersion, tilePx } from './textures';

/** 是否整块立方体（实心、无特殊形状、非流体）：只有它走 3D 图标 */
export function isFullCubeBlock(id: BlockId): boolean {
  const d = BLOCKS[id];
  return !!d && d.solid && d.shape === undefined && !d.fluid && !d.lava;
}

/** 从 atlas 画布裁出一格内容（可选亮度罩色），输出 tilePx×tilePx 的面画布 */
function faceCanvas(atlas: HTMLCanvasElement, tile: number, brightness: number): HTMLCanvasElement | null {
  const padPx = Math.max(1, Math.round(tilePx * ATLAS_PAD_RATIO));
  const cellPx = tilePx + padPx * 2;
  const sx = (tile % ATLAS_COLS) * cellPx + padPx;
  const sy = Math.floor(tile / ATLAS_COLS) * cellPx + padPx;
  const c = document.createElement('canvas');
  c.width = tilePx;
  c.height = tilePx;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(atlas, sx, sy, tilePx, tilePx, 0, 0, tilePx, tilePx);
  if (brightness < 1) {
    // multiply 罩灰变暗后按原图 alpha 裁回（镂空不被填色），同 textures.ts 的染绿手法
    const v = Math.round(brightness * 255);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(0, 0, tilePx, tilePx);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(atlas, sx, sy, tilePx, tilePx, 0, 0, tilePx, tilePx);
  }
  return c;
}

/** 渲染一个方块的等轴 3D 图标，输出 dataURL；atlas 未就绪或 canvas 失败返回 null */
function renderIcon(id: BlockId): string | null {
  const atlas = atlasCanvas;
  if (!atlas) return null;
  const d = BLOCKS[id];
  // 顶面用 top tile、两侧面用 side tile；bottom 在背包视角不可见，用不上
  const top = faceCanvas(atlas, d.top, 1.0);
  const left = faceCanvas(atlas, d.side, 0.8);
  const right = faceCanvas(atlas, d.side, 0.6);
  if (!top || !left || !right) return null;
  // 输出 S×S：三面各占 S/2 宽的区域，立方体恰好铺满方框（与同 size 平面图标视觉大小一致）
  const S = tilePx * 2;
  const s = S / 2;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  // 左面：四边形 (0,S/4) (s,S/2) (s,S) (0,3S/4)
  ctx.setTransform(1, 0.5, 0, 1, 0, S / 4);
  ctx.drawImage(left, 0, 0, s, s);
  // 右面：四边形 (s,S/2) (S,S/4) (S,3S/4) (s,S)
  ctx.setTransform(1, -0.5, 0, 1, s, S / 2);
  ctx.drawImage(right, 0, 0, s, s);
  // 顶面：菱形 (0,S/4) (s,0) (S,S/4) (s,S/2)
  ctx.setTransform(1, -0.5, 1, 0.5, 0, S / 4);
  ctx.drawImage(top, 0, 0, s, s);
  return c.toDataURL();
}

/** id → dataURL 缓存（方块总数有限，不设上限）；缓存时的 atlas 版本号 */
const cache = new Map<BlockId, string>();
let cachedVersion = -1;

/** 整块立方体方块的等轴 3D 图标 dataURL；非整块 / atlas 未就绪 / SSR 返回 null（调用方回退平面 tile） */
export function blockIcon3dUrl(id: BlockId): string | null {
  if (typeof document === 'undefined') return null;
  if (!atlasCanvas) return null;
  if (cachedVersion !== atlasVersion) {
    cache.clear();
    cachedVersion = atlasVersion;
  }
  if (!isFullCubeBlock(id)) return null;
  let url = cache.get(id);
  if (url === undefined) {
    const rendered = renderIcon(id);
    if (!rendered) return null;
    url = rendered;
    cache.set(id, url);
  }
  return url;
}
