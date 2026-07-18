// chunk 网格化：隐藏面剔除 + 逐顶点环境光遮蔽（AO）+ atlas UV，输出纯数据（不依赖 three，可单测）

import { AIR, ATLAS_COLS, ATLAS_ROWS, BLOCKS, WATER } from './blocks';
import { CHUNK_SIZE, WORLD_HEIGHT, type Chunk, type World } from './world';

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

  addFace(x: number, y: number, z: number, face: Face, tile: number, ao: readonly number[], topY = 1): void {
    const ndx = this.positions.length / 3;
    const col = tile % ATLAS_COLS;
    const row = Math.floor(tile / ATLAS_COLS);
    for (let i = 0; i < 4; i++) {
      const c = face.corners[i];
      // 水面顶边可下沉（topY < 1 时顶面顶点 y 用 topY）
      const py = c.pos[1] === 1 ? topY : c.pos[1];
      this.positions.push(x + c.pos[0], y + py, z + c.pos[2]);
      this.normals.push(face.dir[0], face.dir[1], face.dir[2]);
      // CanvasTexture flipY=true：atlas 第 0 行在 v 顶部
      const u = (col + c.uv[0]) / ATLAS_COLS;
      const v = 1 - (row + 1 - c.uv[1]) / ATLAS_ROWS;
      this.uvs.push(u, v);
      const b = AO_CURVE[ao[i]];
      this.colors.push(b, b, b);
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
}

const aoScratch = [0, 0, 0, 0];

/** 不透明查找表（id → 1/0）：替代热路径上的 BLOCKS[id]?.opaque 属性链访问 */
const OPAQUE = new Uint8Array(BLOCKS.length);
for (const d of BLOCKS) OPAQUE[d.id] = d.opaque ? 1 : 0;

// 3×3 chunk 邻居网格（48×48 截面 + 上下各 1 格缓冲），模块级复用避免逐次分配
// （JS 单线程：主线程/每个 worker 各自持有独立模块实例，无共享冲突）
const GW = 48;
const GH = WORLD_HEIGHT + 2;
const idGrid = new Uint16Array(GW * GW * GH);
const opGrid = new Uint8Array(idGrid.length);
const gidx = (x: number, y: number, z: number): number => ((y + 1) * GW + (z + CHUNK_SIZE)) * GW + (x + CHUNK_SIZE);

/**
 * 纯数据网格化：输入 3×3 邻居 chunk 的方块数据（datas[9]，索引 (gz+1)*3+(gx+1)，可为 null），
 * 输出几何。与 World/Chunk 解耦，主线程与 Web Worker 共用
 */
export function buildFromGrid(cx: number, cz: number, datas: (Uint16Array | null)[]): { solid: GeometryData; water: GeometryData } {
  const solid = new GeometryBuilder();
  const water = new GeometryBuilder();

  // 把 3×3 chunk 数据摊平进邻居网格：热路径全部变成无闭包的直接数组读
  idGrid.fill(0);
  for (let gz = -1; gz <= 1; gz++) {
    for (let gx = -1; gx <= 1; gx++) {
      const c = datas[(gz + 1) * 3 + (gx + 1)];
      if (!c) continue;
      for (let y = 0; y < WORLD_HEIGHT; y++) {
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
          const src = c.subarray((y * CHUNK_SIZE + lz) * CHUNK_SIZE, (y * CHUNK_SIZE + lz + 1) * CHUNK_SIZE);
          idGrid.set(src, ((y + 1) * GW + (gz + 1) * CHUNK_SIZE + lz) * GW + (gx + 1) * CHUNK_SIZE);
        }
      }
    }
  }
  for (let i = 0; i < idGrid.length; i++) opGrid[i] = OPAQUE[idGrid[i]];
  const isOpaque = (x: number, y: number, z: number): boolean => opGrid[gidx(x, y, z)] === 1;
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const id = idGrid[gidx(x, y, z)];
        if (id === AIR) continue;
        const def = BLOCKS[id];
        if (!def) continue; // 未知 id（如旧版本存档），按空气处理
        const wx = baseX + x;
        const wz = baseZ + z;
        for (const face of FACES) {
          const n = idGrid[gidx(x + face.dir[0], y + face.dir[1], z + face.dir[2])];
          // 同类透明方块之间不画（玻璃-玻璃、树叶-树叶、水-水）；不透明邻居挡住的面剔除
          const visible = id === WATER ? n !== WATER && opGrid[gidx(x + face.dir[0], y + face.dir[1], z + face.dir[2])] !== 1 : opGrid[gidx(x + face.dir[0], y + face.dir[1], z + face.dir[2])] !== 1 && n !== id;
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
          // 水面略低于方块顶（上方还有水则保持满格）
          const topY = id === WATER && idGrid[gidx(x, y + 1, z)] !== WATER ? 0.875 : 1;
          (id === WATER ? water : solid).addFace(wx, y, wz, face, tile, aoScratch, topY);
        }
      }
    }
  }
  return { solid: solid.build(), water: water.build() };
}

export function buildChunkGeometry(world: World, chunk: Chunk): { solid: GeometryData; water: GeometryData } {
  const datas: (Uint16Array | null)[] = [];
  for (let gz = -1; gz <= 1; gz++) {
    for (let gx = -1; gx <= 1; gx++) {
      datas.push(world.chunks.get(`${chunk.cx + gx},${chunk.cz + gz}`)?.data ?? null);
    }
  }
  return buildFromGrid(chunk.cx, chunk.cz, datas);
}

const FULL_AO = [3, 3, 3, 3];

/** 单个方块的原点几何（全 6 面、满亮度），用于放置预览 ghost block */
export function buildBlockGeometry(id: number): GeometryData {
  const builder = new GeometryBuilder();
  const def = BLOCKS[id];
  if (def && id !== AIR && id !== WATER) {
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
