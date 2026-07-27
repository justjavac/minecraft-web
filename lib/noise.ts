// 程序化地形：多噪声场（大陆/山丘/山脊/奇异/温度/湿度/侵蚀/河流/台地/蘑菇岛）
// + MC 1.18 风格多噪声群系判定 + 分群系树木分布 + 3D 噪声洞穴（意面隧道 + 奶酪洞腔）

import { createNoise2D, createNoise3D } from 'simplex-noise';

export const SEA_LEVEL = 40;

/** 地形高度上限（world.WORLD_HEIGHT - 10；此处不 import world 避免循环依赖） */
const MAX_TERRAIN_H = 118;

/** 生物群系（主世界 16 种） */
export type Biome =
  | 'plains'
  | 'forest'
  | 'birch_forest'
  | 'dark_forest'
  | 'taiga'
  | 'snowy'
  | 'desert'
  | 'savanna'
  | 'jungle'
  | 'swamp'
  | 'badlands'
  | 'mountains'
  | 'mushroom_fields'
  | 'ocean'
  | 'river'
  | 'basin';

/** 群系稳定枚举（网格化/存档按索引传递） */
export const BIOME_LIST: Biome[] = [
  'plains', 'forest', 'birch_forest', 'dark_forest', 'taiga', 'snowy',
  'desert', 'savanna', 'jungle', 'swamp', 'badlands', 'mountains',
  'mushroom_fields', 'ocean', 'river', 'basin',
];

/** 群系 → 稳定索引（BIOME_LIST 下标） */
export const biomeIndex = (b: Biome): number => BIOME_LIST.indexOf(b);

/** 树木种类（对应 blocks 中的 <type>_log / <type>_leaves；橡木为 log/leaves） */
export type TreeKind = 'oak' | 'birch' | 'spruce' | 'jungle' | 'acacia' | 'dark_oak' | 'cherry';

export interface Terrain {
  /** 世界列高度（地表方块的 y 坐标），-1 表示虚空 */
  heightAt(x: number, z: number): number;
  /** 该列的群系（确定性） */
  biomeAt(x: number, z: number): Biome;
  /** 该列长什么树（null = 无树，按群系密度与种类） */
  treeAt(x: number, z: number): TreeKind | null;
  /** 该位置是否被洞穴雕刻（3D 噪声：意面隧道 + 奶酪洞腔）；h 传入已算好的列高度可跳过内部重算 */
  caveAt(x: number, y: number, z: number, h?: number): boolean;
  /** 雪线：山地列 y ≥ 此值地表积雪/封冻；非山地列为 Infinity */
  snowlineAt(x: number, z: number): number;
  /** 地下洞穴群系区（2D 场 + 深度在调用处把关）：dripstone 滴水石洞 / lush 繁茂洞穴 / null 普通 */
  undergroundAt(x: number, z: number): 'dripstone' | 'lush' | null;
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 列级确定性哈希 → [0, 1) */
export function hash2(seed: number, x: number, z: number): number {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** 河流通道阈值（|riverNoise| 小于它就是河） */
export const RIVER_WIDTH = 0.045;

export function createTerrain(seed: string): Terrain {
  const sh = hashString(seed);
  // 各噪声场独立播种（互不影响，便于分别调参）
  const nCont = createNoise2D(mulberry32(sh ^ 0x1a2b3c));
  const nHill = createNoise2D(mulberry32(sh ^ 0x4d5e6f));
  const nRiver = createNoise2D(mulberry32(sh ^ 0x708192));
  const nEro = createNoise2D(mulberry32(sh ^ 0xa3b4c5));
  const nTemp = createNoise2D(mulberry32(sh ^ 0xd6e7f8));
  const nHumid = createNoise2D(mulberry32(sh ^ 0x091a2b));
  // 复刻新增：奇异度（山地遮罩）、山脊、恶地台地、蘑菇岛
  const nWeird = createNoise2D(mulberry32(sh ^ 0x2c4d6e));
  const nRidge = createNoise2D(mulberry32(sh ^ 0x8f1b3d));
  const nMesa = createNoise2D(mulberry32(sh ^ 0x5e7a9c));
  const nMush = createNoise2D(mulberry32(sh ^ 0x3d6e8f));
  // 洞穴群系场（滴水石/繁茂洞穴分区）
  const nCaveBio = createNoise2D(mulberry32(sh ^ 0x6a1c4e));
  // 洞穴 3D 噪声：意面隧道双场 + 奶酪洞腔
  const nCaveA = createNoise3D(mulberry32(sh ^ 0x1f2e3d));
  const nCaveB = createNoise3D(mulberry32(sh ^ 0x4c5a6b));
  const nCheese = createNoise3D(mulberry32(sh ^ 0x7d8e9f));

  const contField = (x: number, z: number) => nCont(x * 0.0028, z * 0.0028);
  const riverField = (x: number, z: number) => nRiver(x * 0.004, z * 0.004);
  const erosion = (x: number, z: number) => nEro(x * 0.0015, z * 0.0015);
  const temperature = (x: number, z: number) => nTemp(x * 0.0009, z * 0.0009);
  const humidity = (x: number, z: number) => nHumid(x * 0.0009, z * 0.0009);
  const weirdField = (x: number, z: number) => nWeird(x * 0.0018, z * 0.0018);

  /** 山地遮罩 0..1（奇异度高且为陆地；MC 1.18 的 peaks 简化） */
  function mountainMask(x: number, z: number): number {
    return smoothstep(0.22, 0.55, weirdField(x, z)) * smoothstep(-0.02, 0.3, contField(x, z));
  }

  /** 恶地台地遮罩 0..1（独立噪声场，避免与温度绑死出现频率过高） */
  function mesaMask(x: number, z: number): number {
    return smoothstep(0.3, 0.52, nMesa(x * 0.0016, z * 0.0016)) * smoothstep(-0.05, 0.25, contField(x, z));
  }

  /** 蘑菇岛遮罩 0..1（深海中的稀有岛屿） */
  function mushroomMask(x: number, z: number): number {
    const oceanic = smoothstep(-0.35, -0.55, contField(x, z));
    return smoothstep(0.68, 0.82, nMush(x * 0.0012, z * 0.0012)) * oceanic;
  }

  function heightAt(x: number, z: number): number {
    const cont = contField(x, z);
    const hills = nHill(x * 0.015, z * 0.015);
    const detail = nHill(x * 0.06, z * 0.06);
    let h = 44 + cont * 10 + hills * 4 + detail * 1.5;
    const mush = mushroomMask(x, z);
    // 蘑菇岛：深海区域抬升成岛（须在海洋下压之前，且抑制下压）
    if (mush > 0) {
      const island = 44 + hills * 3 + mush * 6;
      h = h * (1 - mush) + island * mush;
    }
    const m = mountainMask(x, z);
    const mesa = mesaMask(x, z);
    // 山地：山脊噪声（1-|n| 出尖峰）+ 细节脊，抬升到 y≈75–115
    if (m > 0 && mush < 0.3) {
      const ridge = 1 - Math.abs(nRidge(x * 0.008, z * 0.008));
      const ridge2 = 1 - Math.abs(nRidge(x * 0.021 + 300, z * 0.021 + 300));
      h += m * (ridge * 36 + ridge2 * 10 + 16);
    }
    // 恶地：抬升为 3 格阶梯的台地（mesa 层次感）
    if (mesa > 0 && mush < 0.3) {
      const plateau = 58 + Math.floor((hills * 4 + detail * 2 + 8) / 3) * 3;
      h = h * (1 - mesa) + plateau * mesa;
    }
    // 盆地：侵蚀值低的区域下沉压平（低洼积水成湖）；山地/台地不做
    if (m < 0.3 && mesa < 0.3) {
      const basin = smoothstep(-0.18, -0.5, erosion(x, z));
      h = h * (1 - basin * 0.5) + 34 * basin * 0.5 - basin * 3;
    }
    // 海洋：大陆值很低的区域进一步下压成深海（蘑菇岛处按权重减轻）
    if (cont < -0.45) h -= (-0.45 - cont) * 22 * (1 - mush);
    // 河流：只雕刻近海平面的平缓陆地（山地/台地/蘑菇岛不雕，避免深渊切山）
    if (m < 0.3 && mesa < 0.3 && mush < 0.3) {
      const rv = Math.abs(riverField(x, z));
      if (rv < RIVER_WIDTH && h > SEA_LEVEL - 6) {
        const depth = 1 - rv / RIVER_WIDTH;
        h = Math.min(h, SEA_LEVEL - 1 - Math.floor(depth * 3));
      }
    }
    return Math.max(1, Math.min(MAX_TERRAIN_H, Math.floor(h)));
  }

  function snowlineAt(x: number, z: number): number {
    if (mountainMask(x, z) < 0.35) return Infinity;
    // 基准雪线 y≈92，温度越低雪线越低（寒带山脚也积雪）
    return Math.floor(92 + temperature(x, z) * 18);
  }

  /** 洞穴群系分区：场值高为滴水石洞，低为繁茂洞穴，中段为普通洞穴 */
  function undergroundAt(x: number, z: number): 'dripstone' | 'lush' | null {
    const v = nCaveBio(x * 0.0016, z * 0.0016);
    if (v > 0.38) return 'dripstone';
    if (v < -0.38) return 'lush';
    return null;
  }

  function caveAt(x: number, y: number, z: number, h?: number): boolean {
    if (y < 4) return false; // 基岩层保护区
    const hh = h ?? heightAt(x, z);
    // 意面隧道：双 3D 噪声叠加出蜿蜒通道，埋藏在地下
    if (y <= hh - 3) {
      const t = Math.abs(nCaveA(x * 0.03, y * 0.03, z * 0.03) + nCaveB(x * 0.03 + 500, y * 0.03, z * 0.03 + 500));
      if (t < 0.11) return true;
    }
    // 奶酪洞腔：大型洞窟偶尔破出地表；深层（y<20）阈值放宽，洞腔更大（MC 深层大洞观感）
    if (y <= hh - 1 && nCheese(x * 0.011, y * 0.02, z * 0.011) > (y < 20 ? 0.66 : 0.72)) return true;
    return false;
  }

  /** 群系分类（heightAt 由调用方算好传入，避免重复求值）；MC 1.18 多噪声分类的简化版 */
  function classify(x: number, z: number, h: number): Biome {
    // 蘑菇岛：深海抬升区整体（含浅滩岸）
    if (mushroomMask(x, z) > 0.5) return 'mushroom_fields';
    // 深海（海床明显低于海平面；判在河流之前，深水道归海洋）
    if (h <= SEA_LEVEL - 4) return 'ocean';
    const m = mountainMask(x, z);
    const mesa = mesaMask(x, z);
    // 河流水域及两岸浅滩（与 heightAt 的雕刻条件一致）
    if (m < 0.3 && mesa < 0.3) {
      const rv = Math.abs(riverField(x, z));
      if (rv < RIVER_WIDTH && h <= SEA_LEVEL + 1) return 'river';
    }
    // 山地（足够高且遮罩强；山脚缓坡归下方温度/湿度分类）
    if (h >= 62 && m > 0.4) return 'mountains';
    // 恶地台地
    if (mesa > 0.5) return 'badlands';
    const temp = temperature(x, z);
    const humid = humidity(x, z);
    // 寒带：湿冷针叶林，干冷雪原
    if (temp < -0.28) return humid > 0.25 ? 'taiga' : 'snowy';
    // 热带：干沙漠 / 半干热带草原 / 湿丛林
    if (temp > 0.35) {
      if (humid < -0.05) return 'desert';
      if (humid < 0.25) return 'savanna';
      return 'jungle';
    }
    // 温带低洼湿地
    if (humid > 0.4 && h <= SEA_LEVEL + 3) return 'swamp';
    // 温带湿润林：奇异度分出黑森林/白桦林
    if (humid > 0.22) {
      const w = weirdField(x, z);
      if (w > 0.22) return 'dark_forest';
      if (w < -0.22) return 'birch_forest';
      return 'forest';
    }
    if (erosion(x, z) < -0.3) return 'basin';
    return 'plains';
  }

  function biomeAt(x: number, z: number): Biome {
    return classify(x, z, heightAt(x, z));
  }

  /** 各群系树木密度与种类（kinds 数组重复元素即加权） */
  function treeAt(x: number, z: number): TreeKind | null {
    const h = heightAt(x, z);
    if (h <= SEA_LEVEL + 1) return null; // 水下/水边不长树
    const biome = classify(x, z, h);
    if (biome === 'mountains') {
      // 山地：雪线以上不长树；山麓点缀云杉与樱花（MC 樱花林在山地）
      if (h >= snowlineAt(x, z)) return null;
      const r = hash2(sh ^ 0x5a3c1e, x, z);
      if (r < 0.004) return 'spruce';
      if (r < 0.007) return 'cherry';
      return null;
    }
    let chance = 0;
    let kinds: TreeKind[] = [];
    switch (biome) {
      case 'forest':
        chance = 0.03;
        kinds = ['oak', 'oak', 'birch'];
        break;
      case 'birch_forest':
        chance = 0.035;
        kinds = ['birch'];
        break;
      case 'dark_forest':
        chance = 0.05;
        kinds = ['dark_oak', 'dark_oak', 'birch'];
        break;
      case 'taiga':
        chance = 0.03;
        kinds = ['spruce'];
        break;
      case 'snowy':
        chance = 0.006;
        kinds = ['spruce'];
        break;
      case 'jungle':
        chance = 0.045;
        kinds = ['jungle', 'jungle', 'jungle', 'oak'];
        break;
      case 'savanna':
        chance = 0.008;
        kinds = ['acacia'];
        break;
      case 'swamp':
        chance = 0.02;
        kinds = ['oak'];
        break;
      case 'plains':
      case 'basin':
        chance = 0.005;
        kinds = ['oak'];
        break;
      default:
        return null; // desert / badlands / mushroom_fields / ocean / river 不长树
    }
    const r = hash2(sh ^ 0x7ee5a1c3, x, z);
    if (r >= chance) return null;
    return kinds[Math.floor(hash2(sh ^ 0x31c8d2, x, z) * kinds.length)];
  }

  return { heightAt, biomeAt, treeAt, caveAt, snowlineAt, undergroundAt };
}

/** 全空地形，供测试使用 */
export const VOID_TERRAIN: Terrain = {
  heightAt: () => -1,
  biomeAt: () => 'plains',
  treeAt: () => null,
  caveAt: () => false,
  snowlineAt: () => Infinity,
  undergroundAt: () => null,
};
