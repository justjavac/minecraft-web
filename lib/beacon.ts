// 信标：矿物块金字塔（1-4 层）+ 信标激活，消耗矿物锭选效果，范围内玩家持续获得增益（MC 规则）
//
// 金字塔：第 n 层是信标正下方 y-n 处 (2n+1)×(2n+1) 的实心矿物块（铁/金/钻石/绿宝石块）。
// 层数决定可选效果与范围：1 层 速度/急迫（20 格），2 层 +抗性/跳跃（30），3 层 +力量（40），4 层 范围 50。
// 4 层副效果（MC：生命恢复 或 主效果 II 级）简化为：主效果自动 II 级——生效等级写在 beaconTiers 供消费端读取。

import { BLOCK_BY_KEY, BLOCKS } from './blocks';
import { effects, type Effects } from './effects';
import { WORLD_HEIGHT, type World } from './world';

/** 可搭建金字塔的矿物块（MC：铁块/金块/钻石块/绿宝石块） */
const PYRAMID_IDS = new Set(
  (['iron_block', 'gold_block', 'diamond_block', 'emerald_block'] as const).map((k) => BLOCK_BY_KEY[k].id),
);

/** 可选效果：minLevel 为解锁所需金字塔层数（MC 层级表） */
export const BEACON_EFFECTS: { minLevel: number; key: keyof Effects; name: string }[] = [
  { minLevel: 1, key: 'speed', name: '速度' },
  { minLevel: 1, key: 'haste', name: '急迫' },
  { minLevel: 2, key: 'resistance', name: '抗性提升' },
  { minLevel: 2, key: 'jumpBoost', name: '跳跃提升' },
  { minLevel: 3, key: 'strength', name: '力量' },
];

/** MC 范围：1-4 层对应 20/30/40/50 格（水平半径，垂直向上不限） */
export const BEACON_RANGE = [0, 20, 30, 40, 50];

/** 用于激活/支付的矿物锭（MC：铁锭/金锭/钻石/绿宝石/下界合金锭任一） */
export const BEACON_PAYMENTS = new Set(['iron_ingot', 'gold_ingot', 'diamond', 'emerald', 'netherite_ingot']);

/** 信标上方是否无遮挡见天空（MC：被不透明方块遮挡即失效；玻璃等透明方块不算遮挡）。
 *  只沿本列向上查（同 chunk），不会触发未加载 chunk 生成 */
export function hasSkyAccess(world: World, x: number, y: number, z: number): boolean {
  for (let ty = y + 1; ty < WORLD_HEIGHT; ty++) {
    if (BLOCKS[world.getBlock(x, ty, z)]?.opaque) return false;
  }
  return true;
}

/** 扫描信标 (x,y,z) 下方金字塔层数（0-4）；逐层向外扩，缺一块即止；上方无天空视野视为 0（MC） */
export function scanPyramid(world: World, x: number, y: number, z: number): number {
  if (!hasSkyAccess(world, x, y, z)) return 0;
  let level = 0;
  for (let n = 1; n <= 4; n++) {
    const ly = y - n;
    let ok = true;
    for (let dx = -n; dx <= n && ok; dx++) {
      for (let dz = -n; dz <= n; dz++) {
        if (!PYRAMID_IDS.has(world.getBlock(x + dx, ly, z + dz))) {
          ok = false;
          break;
        }
      }
    }
    if (!ok) break;
    level = n;
  }
  return level;
}

export interface ActiveBeacon {
  x: number;
  y: number;
  z: number;
  effect: keyof Effects;
}

/** 已激活的信标：posKey → 所选效果（内存态；重进游戏金字塔仍在，右击重激活即可） */
export const activeBeacons = new Map<string, ActiveBeacon>();

/** 光柱渲染等监听激活表变更的版本号（React 订阅用） */
export const beaconVersion = { v: 0 };

/** 4 层金字塔副效果（MC 简化：主效果自动 II 级）：玩家在范围内时由 tickBeacons 刷新为 2，否则无条目（=I 级）。
 *  消费端（Player 速度/跳跃/力量、store 抗性、挖掘急迫）读此表把 I 级幅度升为 II 级。 */
export const beaconTiers = new Map<keyof Effects, 1 | 2>();

export function beaconKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/** 右击信标：未激活→消耗 1 矿物锭激活默认效果；已激活→在金字塔层数允许的列表中循环切换（不再耗锭）。
 *  heldMaterial 为当前手持材料名（无则 null）。返回提示文案，null 表示无需提示。 */
export function interactBeacon(
  world: World,
  x: number,
  y: number,
  z: number,
  heldMaterial: string | null,
): { notice: string; consume: string | null; ok: boolean } {
  const level = scanPyramid(world, x, y, z);
  if (level === 0) return { notice: '信标需要矿物块金字塔（铁/金/钻石/绿宝石块）', consume: null, ok: false };
  const key = beaconKey(x, y, z);
  const cur = activeBeacons.get(key);
  const avail = BEACON_EFFECTS.filter((e) => e.minLevel <= level);
  if (cur) {
    // 若金字塔加高解锁了更多效果，切换列表也随之变长
    const idx = avail.findIndex((e) => e.key === cur.effect);
    const next = avail[(idx + 1) % avail.length];
    cur.effect = next.key;
    return { notice: `信标：${next.name}${level >= 4 ? ' II' : ''}`, consume: null, ok: true };
  }
  if (!heldMaterial || !BEACON_PAYMENTS.has(heldMaterial)) {
    return { notice: `金字塔 ${level} 层——手持铁锭/金锭/钻石/绿宝石/下界合金锭右击激活`, consume: null, ok: false };
  }
  activeBeacons.set(key, { x, y, z, effect: avail[0].key });
  beaconVersion.v++;
  return { notice: `信标激活：${avail[0].name}${level >= 4 ? ' II' : ''}`, consume: heldMaterial, ok: true };
}

/** 每 tick：校验激活信标的金字塔仍在（损坏则失效），范围内玩家刷新所选效果（MC 每 4s 施加 11s，简化为持续刷新 5s）；
 *  4 层金字塔的主效果登记为 II 级（beaconTiers，MC 副效果简化） */
export function tickBeacons(world: World, px: number, py: number, pz: number): void {
  const tiers = new Map<keyof Effects, 1 | 2>();
  for (const [key, b] of activeBeacons) {
    const level = world.getBlock(b.x, b.y, b.z) !== BLOCK_BY_KEY.beacon.id ? 0 : scanPyramid(world, b.x, b.y, b.z);
    if (level === 0) {
      activeBeacons.delete(key);
      beaconVersion.v++;
      continue;
    }
    const r = BEACON_RANGE[level];
    // MC：水平半径 r，垂直向下 r、向上直到建筑限高
    if (Math.abs(px - b.x - 0.5) <= r && Math.abs(pz - b.z - 0.5) <= r && py >= b.y - r) {
      effects[b.effect] = Math.max(effects[b.effect], 5);
      if (level >= 4) tiers.set(b.effect, 2); // 4 层副效果：主效果 II 级（多只 4 层信标同效果同为 II）
    }
  }
  beaconTiers.clear();
  for (const [k, v] of tiers) beaconTiers.set(k, v);
}

/** 清空（测试/重置用） */
export function clearBeacons(): void {
  activeBeacons.clear();
  beaconTiers.clear();
  beaconVersion.v++;
}
