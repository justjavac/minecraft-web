// chunk 网格化：隐藏面剔除 + 逐顶点环境光遮蔽（AO）+ atlas UV + 群系草色顶点色，输出纯数据（不依赖 three，可单测）

import { AIR, atlasUV, BLOCKS, isWaterId, WATER, WATER_FLOW_1, type BlockDef } from './blocks';
import { FOLIAGE_TINT_KEYS, FOLIAGE_TINT_RATIO, GRASS_TINT_KEYS, GRASS_TINT_RATIO } from './biomes';
import { BIOME_LIST, biomeIndex, type Terrain } from './noise';
// 常量取叶子模块 grid（保持 worker 包最小）。
// 注意：不要从 './world' 引入任何东西——即便是 type-only 引用，某些打包器/版本也不会擦除模块边，
// 会把 world 的依赖链（react/store/idb）拖进 mesher worker 包致其初始化挂死。改用下面的结构化类型
import { CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT } from './grid';

/** buildChunkGeometry/chunkBiomes 需要的世界结构（与 lib/world.ts 的 World 结构化兼容，无模块边） */
export interface MesherWorld {
  terrain: Terrain;
  chunks: Map<string, { data: Uint16Array; light: Uint8Array; sky: Uint8Array } | undefined>;
}
/** 与 lib/world.ts 的 Chunk 结构化兼容 */
export interface MesherChunk {
  cx: number;
  cz: number;
  data: Uint16Array;
  light: Uint8Array;
  sky: Uint8Array;
}

export interface GeometryData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** 逐顶点 AO 亮度（顶点色，与材质颜色相乘） */
  colors: Float32Array;
  indices: Uint32Array;
}

type Vec3 = [number, number, number];

interface FaceCorner {
  pos: Vec3;
  uv: [number, number];
  /** AO 探测偏移：该顶点在邻层内沿两条切轴的侧边邻居方向 */
  side1: Vec3;
  side2: Vec3;
}

interface Face {
  dir: Vec3;
  corners: FaceCorner[];
}

/** AO 亮度曲线：遮蔽等级 0..3 → 顶点色 */
const AO_CURVE = [0.45, 0.65, 0.82, 1];

/** 面方向明暗（MC 经典规则：顶 1.0 / 底 0.5 / 东西 0.6 / 南北 0.8）——立体观感的关键 */
function faceShade(dir: Vec3): number {
  if (dir[1] > 0) return 1;
  if (dir[1] < 0) return 0.5;
  return dir[0] !== 0 ? 0.6 : 0.8;
}

// 每个面 4 个角，外法线方向逆时针；三角剖分见 GeometryBuilder.addFace
const RAW_FACES: { dir: Vec3; corners: { pos: Vec3; uv: [number, number] }[] }[] = [
  { dir: [-1, 0, 0], corners: [
    { pos: [0, 1, 0], uv: [0, 1] }, { pos: [0, 0, 0], uv: [0, 0] },
    { pos: [0, 1, 1], uv: [1, 1] }, { pos: [0, 0, 1], uv: [1, 0] },
  ] },
  { dir: [1, 0, 0], corners: [
    { pos: [1, 1, 1], uv: [0, 1] }, { pos: [1, 0, 1], uv: [0, 0] },
    { pos: [1, 1, 0], uv: [1, 1] }, { pos: [1, 0, 0], uv: [1, 0] },
  ] },
  { dir: [0, -1, 0], corners: [
    { pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 0, 1], uv: [0, 0] },
    { pos: [1, 0, 0], uv: [1, 1] }, { pos: [0, 0, 0], uv: [0, 1] },
  ] },
  { dir: [0, 1, 0], corners: [
    { pos: [0, 1, 1], uv: [1, 1] }, { pos: [1, 1, 1], uv: [0, 1] },
    { pos: [0, 1, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 0] },
  ] },
  { dir: [0, 0, -1], corners: [
    { pos: [1, 0, 0], uv: [0, 0] }, { pos: [0, 0, 0], uv: [1, 0] },
    { pos: [1, 1, 0], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 1] },
  ] },
  { dir: [0, 0, 1], corners: [
    { pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 1], uv: [1, 0] },
    { pos: [0, 1, 1], uv: [0, 1] }, { pos: [1, 1, 1], uv: [1, 1] },
  ] },
];

/** 预计算每个面每个顶点的 AO 探测方向（法线的两条切轴 × 顶点所在侧） */
const FACES: Face[] = RAW_FACES.map(({ dir, corners }) => {
  const [ta, tb] = ([0, 1, 2] as const).filter((i) => dir[i] === 0);
  return {
    dir,
    corners: corners.map(({ pos, uv }) => {
      const side1: Vec3 = [0, 0, 0];
      const side2: Vec3 = [0, 0, 0];
      side1[ta] = pos[ta] === 1 ? 1 : -1;
      side2[tb] = pos[tb] === 1 ? 1 : -1;
      return { pos, uv, side1, side2 };
    }),
  };
});

/** 经典体素 AO：两侧边都被挡住时最暗，否则按遮挡数递减 */
function aoValue(s1: boolean, s2: boolean, c: boolean): number {
  if (s1 && s2) return 0;
  return 3 - ((s1 ? 1 : 0) + (s2 ? 1 : 0) + (c ? 1 : 0));
}

class GeometryBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private colors: number[] = [];
  private indices: number[] = [];

  addFace(x: number, y: number, z: number, face: Face, tile: number, ao: readonly number[], topY = 1, light = 0, sky = 1, tint?: readonly [number, number, number]): void {
    const ndx = this.positions.length / 3;
    for (let i = 0; i < 4; i++) {
      const c = face.corners[i];
      // 水面顶边可下沉（topY < 1 时顶面顶点 y 用 topY）
      const py = c.pos[1] === 1 ? topY : c.pos[1];
      this.positions.push(x + c.pos[0], y + py, z + c.pos[2]);
      this.normals.push(face.dir[0], face.dir[1], face.dir[2]);
      if (tile === WATER_UV_TILE) {
        // 独立 water strip 纹理：单帧 v∈[0,1/32]（动画由纹理 offset 驱动）
        this.uvs.push(c.uv[0], c.uv[1] / 32);
      } else {
        // CanvasTexture flipY=true：atlas 第 0 行在 v 顶部；格内 uv 含 PAD 挤出偏移
        const [u, v] = atlasUV(tile, c.uv[0], c.uv[1]);
        this.uvs.push(u, v);
      }
      const b = Math.max(AO_CURVE[ao[i]] * sky * faceShade(face.dir), light);
      if (tint) this.colors.push(b * tint[0], b * tint[1], b * tint[2]);
      else this.colors.push(b, b, b);
    }
    // AO 各向异性修正：按两条对角线的亮度选择翻转三角剖分
    if (ao[0] + ao[3] < ao[1] + ao[2]) {
      this.indices.push(ndx, ndx + 1, ndx + 3, ndx, ndx + 3, ndx + 2);
    } else {
      this.indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
    }
  }

  build(): GeometryData {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      uvs: new Float32Array(this.uvs),
      colors: new Float32Array(this.colors),
      indices: new Uint32Array(this.indices),
    };
  }

  /** 单面（朝上）补面：楼梯前缘顶面等专用，区域 [x0,z0]-[x1,z1] */
  addFlatTop(x: number, y: number, z: number, rect: [number, number, number, number], tile: number, ao: readonly number[], light = 0, sky = 1): void {
    const [x0, z0, x1, z1] = rect;
    const corners: [number, number, number, number][] = [
      [x0, z0, 0, 1],
      [x1, z0, 1, 1],
      [x0, z1, 0, 0],
      [x1, z1, 1, 0],
    ];
    const ndx = this.positions.length / 3;
    for (const [px, pz, u, v] of corners) {
      this.positions.push(x + px, y, z + pz);
      this.normals.push(0, 1, 0);
      this.uvs.push(...atlasUV(tile, u, v));
      const b = Math.max(AO_CURVE[ao[3]] * sky, light);
      this.colors.push(b, b, b);
    }
    // 绕序与声明法线一致（+Y 朝上，否则被背面剔除）
    this.indices.push(ndx, ndx + 2, ndx + 1, ndx + 1, ndx + 2, ndx + 3);
  }

  /** 单面（朝下）补面：倒置楼梯的前缘底面，区域 [x0,z0]-[x1,z1] */
  addFlatBottom(x: number, y: number, z: number, rect: [number, number, number, number], tile: number, ao: readonly number[], light = 0, sky = 1): void {
    const [x0, z0, x1, z1] = rect;
    const corners: [number, number, number, number][] = [
      [x0, z0, 0, 0],
      [x0, z1, 0, 1],
      [x1, z0, 1, 0],
      [x1, z1, 1, 1],
    ];
    const ndx = this.positions.length / 3;
    for (const [px, pz, u, v] of corners) {
      this.positions.push(x + px, y, z + pz);
      this.normals.push(0, -1, 0);
      this.uvs.push(...atlasUV(tile, u, v));
      const b = Math.max(AO_CURVE[ao[0]] * sky, light);
      this.colors.push(b, b, b);
    }
    // 绕序与声明法线一致（-Y 朝下，否则被背面剔除）
    this.indices.push(ndx, ndx + 2, ndx + 1, ndx + 1, ndx + 2, ndx + 3);
  }

  /** 任意轴对齐盒（台阶半高/楼梯双箱/栅栏柱臂），UV 每面全贴图 */
  addBox(
    x: number, y: number, z: number,
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
    def: BlockDef,
    ao: readonly number[],
    cull: (dir: Vec3) => boolean,
    lightFor: (dir: Vec3) => [number, number] = () => [0, 1],
  ): void {
    for (const face of FACES) {
      if (cull(face.dir)) continue;
      const d = face.dir;
      const tile = d[1] === 1 ? def.top : d[1] === -1 ? def.bottom : def.side;
      const [light, sky] = lightFor(d);
      const ndx = this.positions.length / 3;
      for (let i = 0; i < 4; i++) {
        const c = face.corners[i];
        const px = d[0] === 0 ? (c.pos[0] === 0 ? minX : maxX) : d[0] === 1 ? maxX : minX;
        const py = d[1] === 0 ? (c.pos[1] === 0 ? minY : maxY) : d[1] === 1 ? maxY : minY;
        const pz = d[2] === 0 ? (c.pos[2] === 0 ? minZ : maxZ) : d[2] === 1 ? maxZ : minZ;
        this.positions.push(x + px, y + py, z + pz);
        this.normals.push(d[0], d[1], d[2]);
        const [u, v] = atlasUV(tile, c.uv[0], c.uv[1]);
        this.uvs.push(u, v);
        const b = Math.max(AO_CURVE[ao[i]] * sky, light);
        this.colors.push(b, b, b);
      }
      if (ao[0] + ao[3] < ao[1] + ao[2]) {
        this.indices.push(ndx, ndx + 1, ndx + 3, ndx, ndx + 3, ndx + 2);
      } else {
        this.indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
      }
    }
  }

  /** 花草十字面片（双面成对发射以兼容 FrontSide 材质，朝上法线满亮度；可偏移/缩放用于墙上火把） */
  addCross(x: number, y: number, z: number, tile: number, light = 0.04, ox = 0, oz = 0, scale = 1, tint?: readonly [number, number, number]): void {
    const lo = 0.5 - 0.4 * scale;
    const hi = 0.5 + 0.4 * scale;
    const quads: [number, number, number, number][][] = [
      // 两条对角面片（每片双向）
      [[lo + ox, 0, lo + oz, 0], [hi + ox, 0, hi + oz, 1], [hi + ox, 1, hi + oz, 1], [lo + ox, 1, lo + oz, 0]],
      [[hi + ox, 0, lo + oz, 0], [lo + ox, 0, hi + oz, 1], [lo + ox, 1, hi + oz, 1], [hi + ox, 1, lo + oz, 0]],
    ];
    for (const q of quads) {
      for (const flip of [false, true]) {
        const ndx = this.positions.length / 3;
        for (const [px, py, pz, u] of q) {
          this.positions.push(x + px, y + py, z + pz);
          this.normals.push(0, 1, 0);
          this.uvs.push(...atlasUV(tile, u, py as number));
          if (tint) this.colors.push(light * tint[0], light * tint[1], light * tint[2]);
          else this.colors.push(light, light, light);
        }
        if (flip) this.indices.push(ndx, ndx + 2, ndx + 1, ndx, ndx + 3, ndx + 2);
        else this.indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
      }
    }
  }
}

const aoScratch = [0, 0, 0, 0];

/** 不透明查找表（id → 1/0）：替代热路径上的 BLOCKS[id]?.opaque 属性链访问 */
const OPAQUE = new Uint8Array(BLOCKS.length);
for (const d of BLOCKS) OPAQUE[d.id] = d.opaque ? 1 : 0;

/** 群系顶点色种类表（id → 0 无 / 1 草色 / 2 叶色） */
const TINT_KIND = new Uint8Array(BLOCKS.length);
for (const d of BLOCKS) {
  if (GRASS_TINT_KEYS.has(d.key)) TINT_KIND[d.id] = 1;
  else if (FOLIAGE_TINT_KEYS.has(d.key)) TINT_KIND[d.id] = 2;
}

/** tintFor 复用的输出槽（addFace 立即读值，无需每面分配） */
const tintScratch: [number, number, number] = [0, 0, 0];

/** 水面高度表（源 0.875，流水 1-7 逐级变浅） */
const WATER_TOP = [0.875, 0.766, 0.656, 0.547, 0.437, 0.328, 0.219, 0.109];
/** addFace 的 tile 特殊值：水系方块，UV 写到独立 water strip 纹理空间 */
const WATER_UV_TILE = -2;

// 3×3 chunk 邻居网格（48×48 截面 + 上下各 1 格缓冲），模块级复用避免逐次分配
// （JS 单线程：主线程/每个 worker 各自持有独立模块实例，无共享冲突）
const GW = 48;
const GH = WORLD_HEIGHT + 2;
const idGrid = new Uint16Array(GW * GW * GH);
const opGrid = new Uint8Array(idGrid.length);
/** 光照网格（与 idGrid 同布局，0-15） */
const ltGrid = new Uint8Array(idGrid.length);
/** 天空光网格（与 idGrid 同布局，0-15） */
const skGrid = new Uint8Array(idGrid.length);
const gidx = (x: number, y: number, z: number): number => ((y + 1) * GW + (z + CHUNK_SIZE)) * GW + (x + CHUNK_SIZE);

/**
 * 纯数据网格化：输入 3×3 邻居 chunk 的方块数据（datas[9]，索引 (gz+1)*3+(gx+1)，可为 null），
 * 输出几何。与 World/Chunk 解耦，主线程与 Web Worker 共用
 */
export function buildFromGrid(cx: number, cz: number, datas: (Uint16Array | null)[], lights: (Uint8Array | null)[], skys: (Uint8Array | null)[], biomes?: Uint8Array | null): { solid: GeometryData; water: GeometryData } {
  const solid = new GeometryBuilder();
  const water = new GeometryBuilder();

  // 把 3×3 chunk 数据摊平进邻居网格：热路径全部变成无闭包的直接数组读
  idGrid.fill(0);
  ltGrid.fill(0);
  skGrid.fill(0);
  for (let gz = -1; gz <= 1; gz++) {
    for (let gx = -1; gx <= 1; gx++) {
      const k = (gz + 1) * 3 + (gx + 1);
      const c = datas[k];
      const cl = lights[k];
      const cs = skys[k];
      for (let y = 0; y < WORLD_HEIGHT; y++) {
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
          const off = ((y + 1) * GW + (gz + 1) * CHUNK_SIZE + lz) * GW + (gx + 1) * CHUNK_SIZE;
          if (c) idGrid.set(c.subarray((y * CHUNK_SIZE + lz) * CHUNK_SIZE, (y * CHUNK_SIZE + lz + 1) * CHUNK_SIZE), off);
          if (cl) ltGrid.set(cl.subarray((y * CHUNK_SIZE + lz) * CHUNK_SIZE, (y * CHUNK_SIZE + lz + 1) * CHUNK_SIZE), off);
          if (cs) skGrid.set(cs.subarray((y * CHUNK_SIZE + lz) * CHUNK_SIZE, (y * CHUNK_SIZE + lz + 1) * CHUNK_SIZE), off);
        }
      }
    }
  }
  for (let i = 0; i < idGrid.length; i++) opGrid[i] = OPAQUE[idGrid[i]];
  const isOpaque = (x: number, y: number, z: number): boolean => opGrid[gidx(x, y, z)] === 1;
  const idAt = (x: number, y: number, z: number): number => idGrid[gidx(x, y, z)];
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;
  /** 群系顶点色（biomes 为 18×18 群系索引（中心 chunk + 1 格环）；按 3×3 列平均做边界平滑；草方块只染顶面） */
  const tintFor = (id: number, x: number, z: number, dirY: number): readonly [number, number, number] | null => {
    const kind = TINT_KIND[id];
    if (kind === 0) return null;
    if (kind === 1 && BLOCKS[id].key === 'grass' && dirY !== 1) return null;
    const table = kind === 1 ? GRASS_TINT_RATIO : FOLIAGE_TINT_RATIO;
    if (!biomes) return table.plains;
    // MC 群系边界颜色平滑过渡：3×3 列取平均倍率
    let r = 0;
    let g = 0;
    let b = 0;
    for (let dz = 0; dz < 3; dz++) {
      for (let dx = 0; dx < 3; dx++) {
        const t = table[BIOME_LIST[biomes[(z + dz) * 18 + (x + dx)]] ?? 'plains'];
        r += t[0];
        g += t[1];
        b += t[2];
      }
    }
    tintScratch[0] = r / 9;
    tintScratch[1] = g / 9;
    tintScratch[2] = b / 9;
    return tintScratch;
  };
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const id = idAt(x, y, z);
        if (id === AIR) continue;
        const def = BLOCKS[id];
        if (!def) continue; // 未知 id（如旧版本存档），按空气处理
        const wx = baseX + x;
        const wz = baseZ + z;

        // ——— 非立方体形状 ———
        if (def.shape === 'cross') {
          // 花草原地十字；墙上火把按朝向贴墙偏移并缩小
          const f = def.facing;
          const ox = f === 1 ? 0.25 : f === 3 ? -0.25 : 0;
          const oz = f === 2 ? 0.25 : f === 0 ? -0.25 : 0;
          const wall = f !== undefined;
          solid.addCross(wx, y, wz, def.side, Math.max(ltGrid[gidx(x, y, z)] / 15, skGrid[gidx(x, y, z)] / 15, 0.04), ox, oz, wall ? 0.75 : 1, tintFor(id, x, z, 1) ?? undefined);
          continue;
        }
        if (def.shape === 'panel') {
          // 藤蔓：贴墙薄片（box3 即薄片盒；附着面贴到不透明墙时剔除）
          const [x0, y0, z0, x1, y1, z1] = def.box3!;
          const f = def.facing ?? 0;
          const [ax, az] = f === 0 ? [0, -1] : f === 1 ? [1, 0] : f === 2 ? [0, 1] : [-1, 0];
          solid.addBox(wx, y, wz, x0, y0, z0, x1, y1, z1, def, FULL_AO,
            (dir) => dir[0] === ax && dir[2] === az && isOpaque(x + ax, y, z + az),
            (dir) => [ltGrid[gidx(x + dir[0], y + dir[1], z + dir[2])] / 15, skGrid[gidx(x + dir[0], y + dir[1], z + dir[2])] / 15]);
          continue;
        }
        if (def.shape === 'slab') {
          // 台阶：半高盒（耕地 15/16 高也走这里，box3 决定实际高度）；底面看下方、顶面看上方、侧面看邻居与同型
          const [y0, y1] = def.box3 ? [def.box3[1], def.box3[4]] : def.slabTop ? [0.5, 1] : [0, 0.5];
          solid.addBox(wx, y, wz, 0, y0, 0, 1, y1, 1, def, FULL_AO, (dir) => {
            if (dir[1] === -1) {
              const n = idAt(x, y - 1, z);
              return isOpaque(x, y - 1, z) || (!def.slabTop && BLOCKS[n]?.slabTop === true);
            }
            if (dir[1] === 1) {
              const n = idAt(x, y + 1, z);
              return isOpaque(x, y + 1, z) || (def.slabTop === true && BLOCKS[n]?.shape === 'slab' && !BLOCKS[n]?.slabTop);
            }
            const n = idAt(x + dir[0], y, z + dir[2]);
            return isOpaque(x + dir[0], y, z + dir[2]) || n === id;
          }, (dir) => [ltGrid[gidx(x + dir[0], y + dir[1], z + dir[2])] / 15, skGrid[gidx(x + dir[0], y + dir[1], z + dir[2])] / 15]);
          continue;
        }
        if (def.shape === 'stairs') {
          // 楼梯：正立=底半满铺+背向顶半；倒置=顶半满铺+背向底半（前缘由 addFlatBottom 补）
          const f = def.facing ?? 0;
          const sideCull = (dir: Vec3): boolean => {
            if (dir[1] !== 0) return false;
            return isOpaque(x + dir[0], y, z + dir[2]) || idAt(x + dir[0], y, z + dir[2]) === id;
          };
          const [hx0, hz0, hx1, hz1] = f === 0 ? [0, 0, 1, 0.5] : f === 1 ? [0.5, 0, 1, 1] : f === 2 ? [0, 0.5, 1, 1] : [0, 0, 0.5, 1];
          if (def.slabTop) {
            // 倒置：顶箱满铺（底面整面剔除）+ 背向底箱（顶面整面剔除）+ 前缘底面
            solid.addBox(wx, y, wz, 0, 0.5, 0, 1, 1, 1, def, FULL_AO, (dir) => {
              if (dir[1] === -1) return true;
              if (dir[1] === 1) return isOpaque(x, y + 1, z);
              return sideCull(dir);
            }, (dir) => [ltGrid[gidx(x + dir[0], y + dir[1], z + dir[2])] / 15, skGrid[gidx(x + dir[0], y + dir[1], z + dir[2])] / 15]);
            solid.addBox(wx, y, wz, hx0, 0, hz0, hx1, 0.5, hz1, def, FULL_AO, (dir) => {
              if (dir[1] === 1) return true;
              if (dir[1] === -1) return isOpaque(x, y - 1, z);
              return sideCull(dir);
            }, (dir) => [ltGrid[gidx(x + dir[0], y + dir[1], z + dir[2])] / 15, skGrid[gidx(x + dir[0], y + dir[1], z + dir[2])] / 15]);
            solid.addFlatBottom(wx, y + 0.5, wz, f === 0 ? [0, 0.5, 1, 1] : f === 1 ? [0, 0, 0.5, 1] : f === 2 ? [0, 0, 1, 0.5] : [0.5, 0, 1, 1], def.bottom, FULL_AO, ltGrid[gidx(x, y - 1, z)] / 15, skGrid[gidx(x, y - 1, z)] / 15);
          } else {
            // 正立：底箱满铺（顶面整面剔除）+ 背向顶箱（底面整面剔除）+ 前缘顶面
            solid.addBox(wx, y, wz, 0, 0, 0, 1, 0.5, 1, def, FULL_AO, (dir) => {
              if (dir[1] === 1) return true;
              if (dir[1] === -1) return isOpaque(x, y - 1, z);
              return sideCull(dir);
            }, (dir) => [ltGrid[gidx(x + dir[0], y + dir[1], z + dir[2])] / 15, skGrid[gidx(x + dir[0], y + dir[1], z + dir[2])] / 15]);
            solid.addBox(wx, y, wz, hx0, 0.5, hz0, hx1, 1, hz1, def, FULL_AO, (dir) => {
              if (dir[1] === -1) return true;
              if (dir[1] === 1) return false;
              return sideCull(dir);
            }, (dir) => [ltGrid[gidx(x + dir[0], y + dir[1], z + dir[2])] / 15, skGrid[gidx(x + dir[0], y + dir[1], z + dir[2])] / 15]);
            solid.addFlatTop(wx, y + 0.5, wz, f === 0 ? [0, 0.5, 1, 1] : f === 1 ? [0, 0, 0.5, 1] : f === 2 ? [0, 0, 1, 0.5] : [0.5, 0, 1, 1], def.top, FULL_AO, ltGrid[gidx(x, y + 1, z)] / 15, skGrid[gidx(x, y + 1, z)] / 15);
          }
          continue;
        }
        if (def.shape === 'door') {
          // 门：闭合/打开的薄面板（box3 即面板盒），不剔除
          const [x0, y0, z0, x1, y1, z1] = def.box3!;
          solid.addBox(wx, y, wz, x0, y0, z0, x1, y1, z1, def, FULL_AO, () => false, (dir) => [ltGrid[gidx(x + dir[0], y + dir[1], z + dir[2])] / 15, skGrid[gidx(x + dir[0], y + dir[1], z + dir[2])] / 15]);
          continue;
        }
        if (def.shape === 'fence') {
          // 栅栏：中柱 + 向实心/同型邻居伸臂（臂两端剔除避免重叠）
          solid.addBox(wx, y, wz, 0.375, 0, 0.375, 0.625, 1, 0.625, def, FULL_AO, () => false, (dir) => [ltGrid[gidx(x + dir[0], y + dir[1], z + dir[2])] / 15, skGrid[gidx(x + dir[0], y + dir[1], z + dir[2])] / 15]);
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const n = idAt(x + dx, y, z + dz);
            const sameFence = n === id;
            // 同型栅栏之间的臂只向 +x/+z 方向出（避免双向重复造成 z-fight）
            if (sameFence && (dx === -1 || dz === -1)) continue;
            if (!isOpaque(x + dx, y, z + dz) && !sameFence) continue;
            const [ax0, az0, ax1, az1] =
              dx === 1 ? [0.625, 0.4375, 1, 0.5625] :
              dx === -1 ? [0, 0.4375, 0.375, 0.5625] :
              dz === 1 ? [0.4375, 0.625, 0.5625, 1] : [0.4375, 0, 0.5625, 0.375];
            solid.addBox(wx, y, wz, ax0, 0.4375, az0, ax1, 0.5625, az1, def, FULL_AO, (dir) => {
              // 朝柱端与朝邻居端剔除（避免与柱面/邻居重叠），其余保留
              if (dx !== 0 && dir[0] !== 0) return true;
              if (dz !== 0 && dir[2] !== 0) return true;
              return false;
            }, (dir) => [ltGrid[gidx(x + dir[0], y + dir[1], z + dir[2])] / 15, skGrid[gidx(x + dir[0], y + dir[1], z + dir[2])] / 15]);
          }
          continue;
        }

        for (const face of FACES) {
          const n = idAt(x + face.dir[0], y + face.dir[1], z + face.dir[2]);
          // 同类透明方块之间不画（玻璃-玻璃、树叶-树叶、水-水）；不透明邻居挡住的面剔除
          const visible = isWaterId(id)
            ? !isWaterId(n) && opGrid[gidx(x + face.dir[0], y + face.dir[1], z + face.dir[2])] !== 1
            : opGrid[gidx(x + face.dir[0], y + face.dir[1], z + face.dir[2])] !== 1 && n !== id;
          if (!visible) continue;
          const tile = face.dir[1] === 1 ? def.top : face.dir[1] === -1 ? def.bottom : def.side;
          // 逐顶点 AO：探测邻层（面外侧那一格）的两个侧边与对角
          const bx = x + face.dir[0];
          const by = y + face.dir[1];
          const bz = z + face.dir[2];
          for (let i = 0; i < 4; i++) {
            const c = face.corners[i];
            const s1 = isOpaque(bx + c.side1[0], by + c.side1[1], bz + c.side1[2]);
            const s2 = isOpaque(bx + c.side2[0], by + c.side2[1], bz + c.side2[2]);
            const cc = isOpaque(
              bx + c.side1[0] + c.side2[0],
              by + c.side1[1] + c.side2[1],
              bz + c.side1[2] + c.side2[2],
            );
            aoScratch[i] = aoValue(s1, s2, cc);
          }
          // 水面按水位下沉；上方还有水则满格
          const level = id === WATER ? 0 : id - WATER_FLOW_1 + 1;
          const topY = isWaterId(id) ? (isWaterId(idGrid[gidx(x, y + 1, z)]) ? 1 : WATER_TOP[level]) : 1;
          (isWaterId(id) ? water : solid).addFace(wx, y, wz, face, isWaterId(id) ? WATER_UV_TILE : tile, aoScratch, topY, ltGrid[gidx(bx, by, bz)] / 15, skGrid[gidx(bx, by, bz)] / 15, tintFor(id, x, z, face.dir[1]) ?? undefined);
        }
      }
    }
  }
  return { solid: solid.build(), water: water.build() };
}

// ——— 邻居边界切片快照（worker 请求的瘦身传输格式）———
// buildFromGrid 对邻居 chunk 的访问严格不越界 ±1 格：面剔除看 x±dir，AO 探测的 side1/side2
// 分别只作用于两条切轴（各 ±1，法线轴上为 0），panel/fence/slab/stairs 的 cull 与 lightFor 也均为 ±1。
// 因此跨线程快照只需传中心整块 + 每个边邻居邻中心的 1 格厚切片 + 每个角邻居的 1×1 角柱，
// worker 端用 expandBorders 重组成零填充整块后走原 buildFromGrid（未读区域本就恒为 0，与 null 一致）。

/** 边邻居槽位（顺序 -x,+x,-z,+z，即 datas 索引 3/5/1/7）：取该邻居靠中心侧的 1 格厚切片 */
export const EDGE_SLOTS = [
  { k: 3, axis: 'x', at: CHUNK_SIZE - 1 },
  { k: 5, axis: 'x', at: 0 },
  { k: 1, axis: 'z', at: CHUNK_SIZE - 1 },
  { k: 7, axis: 'z', at: 0 },
] as const;

/** 角邻居槽位（顺序 (-x,-z),(+x,-z),(-x,+z),(+x,+z)，即 datas 索引 0/2/6/8）：取靠中心的 1×1 角柱 */
export const CORNER_SLOTS = [
  { k: 0, x: CHUNK_SIZE - 1, z: CHUNK_SIZE - 1 },
  { k: 2, x: 0, z: CHUNK_SIZE - 1 },
  { k: 6, x: CHUNK_SIZE - 1, z: 0 },
  { k: 8, x: 0, z: 0 },
] as const;

/** 中心整块 + 邻居边界切片的紧凑快照（MeshRequest 的数据部分；切片布局见下） */
export interface BorderSnapshot {
  /** 中心 chunk 完整方块数据 */
  data: Uint16Array | null;
  light: Uint8Array | null;
  sky: Uint8Array | null;
  /** 边邻居 1 格厚切片（顺序同 EDGE_SLOTS），布局 [y*CHUNK_SIZE + i]（i 为沿边坐标），null=邻居缺失 */
  edgeDatas: (Uint16Array | null)[];
  edgeLights: (Uint8Array | null)[];
  edgeSkys: (Uint8Array | null)[];
  /** 角邻居 1×1 角柱（顺序同 CORNER_SLOTS），布局 [y]，null=邻居缺失 */
  cornerDatas: (Uint16Array | null)[];
  cornerLights: (Uint8Array | null)[];
  cornerSkys: (Uint8Array | null)[];
}

type AnyArr = Uint16Array | Uint8Array;

/** 抽取边邻居靠中心侧的 1 格厚切片（新数组即快照拷贝） */
function sliceEdge<T extends AnyArr>(src: T, axis: 'x' | 'z', at: number): T {
  const out = new (src.constructor as new (n: number) => T)(CHUNK_SIZE * WORLD_HEIGHT);
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let i = 0; i < CHUNK_SIZE; i++) {
      out[y * CHUNK_SIZE + i] = src[(y * CHUNK_SIZE + (axis === 'z' ? at : i)) * CHUNK_SIZE + (axis === 'x' ? at : i)];
    }
  }
  return out;
}

/** 抽取角邻居靠中心的 1×1 角柱 */
function sliceCorner<T extends AnyArr>(src: T, x: number, z: number): T {
  const out = new (src.constructor as new (n: number) => T)(WORLD_HEIGHT);
  for (let y = 0; y < WORLD_HEIGHT; y++) out[y] = src[(y * CHUNK_SIZE + z) * CHUNK_SIZE + x];
  return out;
}

/** 把边切片写回整块（workers 端重组用；dst 必须零填充，未写区域恒 0 与 null 邻居语义一致） */
function pasteEdge(dst: AnyArr, slice: AnyArr, axis: 'x' | 'z', at: number): void {
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let i = 0; i < CHUNK_SIZE; i++) {
      dst[(y * CHUNK_SIZE + (axis === 'z' ? at : i)) * CHUNK_SIZE + (axis === 'x' ? at : i)] = slice[y * CHUNK_SIZE + i];
    }
  }
}

/** 把角柱写回整块 */
function pasteCorner(dst: AnyArr, slice: AnyArr, x: number, z: number): void {
  for (let y = 0; y < WORLD_HEIGHT; y++) dst[(y * CHUNK_SIZE + z) * CHUNK_SIZE + x] = slice[y];
}

/** 3×3 整块 → 紧凑边界快照（主线程组 worker 请求用；所有输出数组均为新拷贝，可作 transferable） */
export function sliceBorders(datas: (Uint16Array | null)[], lights: (Uint8Array | null)[], skys: (Uint8Array | null)[]): BorderSnapshot {
  return {
    data: datas[4] ? new Uint16Array(datas[4]) : null,
    light: lights[4] ? new Uint8Array(lights[4]) : null,
    sky: skys[4] ? new Uint8Array(skys[4]) : null,
    edgeDatas: EDGE_SLOTS.map(({ k, axis, at }) => {
      const a = datas[k];
      return a ? sliceEdge(a, axis, at) : null;
    }),
    edgeLights: EDGE_SLOTS.map(({ k, axis, at }) => {
      const a = lights[k];
      return a ? sliceEdge(a, axis, at) : null;
    }),
    edgeSkys: EDGE_SLOTS.map(({ k, axis, at }) => {
      const a = skys[k];
      return a ? sliceEdge(a, axis, at) : null;
    }),
    cornerDatas: CORNER_SLOTS.map(({ k, x, z }) => {
      const a = datas[k];
      return a ? sliceCorner(a, x, z) : null;
    }),
    cornerLights: CORNER_SLOTS.map(({ k, x, z }) => {
      const a = lights[k];
      return a ? sliceCorner(a, x, z) : null;
    }),
    cornerSkys: CORNER_SLOTS.map(({ k, x, z }) => {
      const a = skys[k];
      return a ? sliceCorner(a, x, z) : null;
    }),
  };
}

/** 紧凑快照 → buildFromGrid 期望的 3×3 整块布局（worker 端重组；邻居为切片区域外恒 0 的整块） */
export function expandBorders(snap: BorderSnapshot): { datas: (Uint16Array | null)[]; lights: (Uint8Array | null)[]; skys: (Uint8Array | null)[] } {
  const datas: (Uint16Array | null)[] = new Array<Uint16Array | null>(9).fill(null);
  const lights: (Uint8Array | null)[] = new Array<Uint8Array | null>(9).fill(null);
  const skys: (Uint8Array | null)[] = new Array<Uint8Array | null>(9).fill(null);
  datas[4] = snap.data;
  lights[4] = snap.light;
  skys[4] = snap.sky;
  EDGE_SLOTS.forEach(({ k, axis, at }, e) => {
    const d = snap.edgeDatas[e];
    if (d) {
      const full = new Uint16Array(CHUNK_VOLUME);
      pasteEdge(full, d, axis, at);
      datas[k] = full;
    }
    const l = snap.edgeLights[e];
    if (l) {
      const full = new Uint8Array(CHUNK_VOLUME);
      pasteEdge(full, l, axis, at);
      lights[k] = full;
    }
    const s = snap.edgeSkys[e];
    if (s) {
      const full = new Uint8Array(CHUNK_VOLUME);
      pasteEdge(full, s, axis, at);
      skys[k] = full;
    }
  });
  CORNER_SLOTS.forEach(({ k, x, z }, c) => {
    const d = snap.cornerDatas[c];
    if (d) {
      const full = new Uint16Array(CHUNK_VOLUME);
      pasteCorner(full, d, x, z);
      datas[k] = full;
    }
    const l = snap.cornerLights[c];
    if (l) {
      const full = new Uint8Array(CHUNK_VOLUME);
      pasteCorner(full, l, x, z);
      lights[k] = full;
    }
    const s = snap.cornerSkys[c];
    if (s) {
      const full = new Uint8Array(CHUNK_VOLUME);
      pasteCorner(full, s, x, z);
      skys[k] = full;
    }
  });
  return { datas, lights, skys };
}

export function buildChunkGeometry(world: MesherWorld, chunk: MesherChunk): { solid: GeometryData; water: GeometryData } {
  const datas: (Uint16Array | null)[] = [];
  const lights: (Uint8Array | null)[] = [];
  const skys: (Uint8Array | null)[] = [];
  for (let gz = -1; gz <= 1; gz++) {
    for (let gx = -1; gx <= 1; gx++) {
      const c = world.chunks.get(`${chunk.cx + gx},${chunk.cz + gz}`);
      datas.push(c?.data ?? null);
      lights.push(c?.light ?? null);
      skys.push(c?.sky ?? null);
    }
  }
  return buildFromGrid(chunk.cx, chunk.cz, datas, lights, skys, chunkBiomes(world, chunk.cx, chunk.cz));
}

/** 中心 chunk 及 1 格环共 18×18 列的群系索引（群系顶点色 3×3 平滑用） */
export function chunkBiomes(world: MesherWorld, cx: number, cz: number): Uint8Array {
  const biomes = new Uint8Array(18 * 18);
  for (let z = -1; z <= CHUNK_SIZE; z++) {
    for (let x = -1; x <= CHUNK_SIZE; x++) {
      biomes[(z + 1) * 18 + (x + 1)] = cachedBiomeIndex(world.terrain, cx * CHUNK_SIZE + x, cz * CHUNK_SIZE + z);
    }
  }
  return biomes;
}

/**
 * 群系列查询缓存：biomeAt 每次含 heightAt+classify 约 20+ 次噪声求值，而建网的 18×18 群系环
 * 在相邻 chunk 间大量重叠（同列跨 chunk 重复求值），按 (x,z) 列缓存查询结果（不改生成逻辑，种子确定性不变）。
 * 按 Terrain 实例隔离（WeakMap：换维度/弃档的旧地形随 GC 回收），LRU 上限防止飞行时无界增长
 */
const BIOME_CACHE_MAX = 8192;
const biomeCache = new WeakMap<Terrain, Map<string, number>>();

function cachedBiomeIndex(terrain: Terrain, x: number, z: number): number {
  let m = biomeCache.get(terrain);
  if (!m) {
    m = new Map();
    biomeCache.set(terrain, m);
  }
  const k = `${x},${z}`;
  const hit = m.get(k);
  if (hit !== undefined) {
    // LRU：命中提到最新位置（Map 保持插入序）
    m.delete(k);
    m.set(k, hit);
    return hit;
  }
  const v = biomeIndex(terrain.biomeAt(x, z));
  m.set(k, v);
  if (m.size > BIOME_CACHE_MAX) m.delete(m.keys().next().value!);
  return v;
}

const FULL_AO = [3, 3, 3, 3];

/** 单个方块的原点几何（全 6 面、满亮度），用于放置预览 ghost block */
export function buildBlockGeometry(id: number): GeometryData {
  const builder = new GeometryBuilder();
  const def = BLOCKS[id];
  if (def && id !== AIR && !isWaterId(id)) {
    for (const face of FACES) {
      const tile = face.dir[1] === 1 ? def.top : face.dir[1] === -1 ? def.bottom : def.side;
      builder.addFace(0, 0, 0, face, tile, FULL_AO);
    }
  }
  return builder.build();
}

/** 指定 tile 的单方块原点几何（掉落物中材料/工具的图标块） */
export function buildTileGeometry(tile: number): GeometryData {
  const builder = new GeometryBuilder();
  for (const face of FACES) {
    builder.addFace(0, 0, 0, face, tile, FULL_AO);
  }
  return builder.build();
}
