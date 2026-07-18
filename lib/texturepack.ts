// 自定义贴图包：用户本地导入（zip 或文件夹），贴图仅存用户浏览器 localStorage
// ——「自带资产」模式：项目不分发任何第三方贴图，用户对自己合法获得的贴图行使私人使用权

import { unzipSync } from 'fflate';

export interface CustomPack {
  name: string;
  /** 贴图分辨率（16/32/64…，取导入图片的最大宽度，封顶 64） */
  tilePx: number;
  /** tile 索引 → PNG dataURL（已裁成正方形，动画条带取首帧） */
  tiles: Record<number, string>;
}

export interface ImportResult {
  name: string;
  found: number;
  tilePx: number;
}

const PACK_KEY = 'kimi-mc-texturepack';

/** tile 索引 → 现代 MC 包结构（assets/minecraft/textures/block/）里的候选文件名 */
const TILE_NAMES: { index: number; names: string[] }[] = [
  { index: 0, names: ['grass_block_top', 'grass_top'] },
  { index: 1, names: ['grass_block_side', 'grass_side'] },
  { index: 2, names: ['dirt'] },
  { index: 3, names: ['stone'] },
  { index: 4, names: ['cobblestone', 'cobble'] },
  { index: 5, names: ['sand'] },
  { index: 6, names: ['oak_log', 'log', 'tree_side'] },
  { index: 7, names: ['oak_log_top', 'log_top', 'tree_top'] },
  { index: 8, names: ['oak_planks', 'planks', 'wood'] },
  { index: 9, names: ['oak_leaves', 'leaves'] },
  { index: 10, names: ['glass'] },
  { index: 11, names: ['bricks', 'brick'] },
  { index: 12, names: ['water_still', 'water'] },
];

const NAME_SET = new Set(TILE_NAMES.flatMap((t) => t.names));
/** 13 张中至少识别到的张数，否则判定为不支持的包 */
const MIN_FOUND = 10;

export function loadCustomPack(): CustomPack | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PACK_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as CustomPack;
    return p && typeof p.tilePx === 'number' && p.tiles ? p : null;
  } catch {
    return null;
  }
}

export function clearCustomPack(): void {
  window.localStorage.removeItem(PACK_KEY);
}

const baseName = (path: string): string =>
  path.split('/').pop()!.replace(/\.png$/i, '').toLowerCase();

/** 按候选文件名匹配各 tile 的图片路径，/textures/block/ 下的优先（导出供单测） */
export function matchTiles(paths: string[]): Map<number, string> {
  const score = (p: string) => (p.includes('/textures/block/') ? 0 : p.includes('/block/') ? 1 : 2);
  const entries = paths.map((p) => ({ p, base: baseName(p), s: score(p) }));
  const byTile = new Map<number, string>();
  for (const { index, names } of TILE_NAMES) {
    let best: { p: string; s: number } | null = null;
    for (const e of entries) {
      if (!names.includes(e.base)) continue;
      if (!best || e.s < best.s) best = e;
    }
    if (best) byTile.set(index, best.p);
  }
  return byTile;
}

/** PNG 数据 → 正方形 dataURL（water_still 等动画条带取顶部首帧），返回宽度供分辨率探测 */
async function toDataUrl(blob: Blob): Promise<{ url: string; width: number }> {
  const bmp = await createImageBitmap(blob);
  const size = bmp.width;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 canvas 2d 上下文');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return { url: canvas.toDataURL('image/png'), width: size };
}

async function finishImport(name: string, matched: Map<number, string>, read: (path: string) => Promise<Blob>): Promise<ImportResult> {
  if (matched.size < MIN_FOUND) {
    throw new Error(`无法识别的贴图包：仅匹配到 ${matched.size}/13 张方块贴图（需要现代 MC 包结构）`);
  }
  const tiles: Record<number, string> = {};
  let tilePx = 16;
  for (const [index, path] of matched) {
    const { url, width } = await toDataUrl(await read(path));
    tiles[index] = url;
    tilePx = Math.max(tilePx, width);
  }
  tilePx = Math.min(tilePx, 64); // 防止超大贴图撑爆 atlas
  const pack: CustomPack = { name, tilePx, tiles };
  window.localStorage.setItem(PACK_KEY, JSON.stringify(pack));
  return { name, found: matched.size, tilePx };
}

/** 导入 zip 贴图包（如 Faithful 32x 官方 zip） */
export async function importPackZip(file: File): Promise<ImportResult> {
  const buf = new Uint8Array(await file.arrayBuffer());
  // 只解压候选文件名的 PNG，避免整包（数千张）解压占内存
  const entries = unzipSync(buf, {
    filter: (f) => f.name.toLowerCase().endsWith('.png') && NAME_SET.has(baseName(f.name)),
  });
  const matched = matchTiles(Object.keys(entries));
  return finishImport(file.name.replace(/\.zip$/i, ''), matched, async (p) => {
    const data = entries[p];
    return new Blob([data.slice().buffer], { type: 'image/png' });
  });
}

/** 导入已解压的贴图包文件夹（webkitdirectory 多选） */
export async function importPackFolder(files: FileList): Promise<ImportResult> {
  const arr = Array.from(files).filter((f) => f.name.toLowerCase().endsWith('.png'));
  const byPath = new Map(
    arr.map((f) => [((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).replace(/\\/g, '/'), f] as const),
  );
  const matched = matchTiles([...byPath.keys()]);
  const first = arr[0] as (File & { webkitRelativePath?: string }) | undefined;
  const root = first?.webkitRelativePath?.split('/')[0] ?? '自定义贴图包';
  return finishImport(root, matched, async (p) => byPath.get(p)!);
}
