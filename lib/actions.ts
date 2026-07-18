// 放置与破坏动作：鼠标（Player）与触屏按钮（TouchControls）共用

import { Vector3 } from 'three';
import { AIR, BLOCKS, CRAFTING_TABLE, FURNACE, type BlockId } from './blocks';
import { dropFurnaceContents, FOODS } from './furnace';
import { cameraRef, breakParticles, getActiveWorld, playerPosition } from './game';
import { spawnBlockDrop, spawnMaterialDrop } from './items';
import { raycastBlock } from './raycast';
import { playSound } from './sound';
import { useGameStore } from './store';
import { TOOLS } from './tools';
import { WORLD_HEIGHT, type World } from './world';

const REACH = 6; // 挖掘/放置距离
const PLACE_COOLDOWN = 150; // ms
const HALF_W = 0.3; // 玩家半宽
const HEIGHT = 1.8; // 玩家高度

let lastPlace = 0;
const dir = new Vector3();

/** 待放置方块是否与玩家 AABB 重叠 */
function intersectsPlayer(bx: number, by: number, bz: number): boolean {
  const p = playerPosition;
  return (
    bx + 1 > p.x - HALF_W &&
    bx < p.x + HALF_W &&
    bz + 1 > p.z - HALF_W &&
    bz < p.z + HALF_W &&
    by + 1 > p.y &&
    by < p.y + HEIGHT
  );
}

/** 破坏指定方块并播放音效、生成碎块粒子；生存模式按 MC 规则掉落（石头系需镐），创造模式无掉落 */
export function breakBlock(world: World, x: number, y: number, z: number): void {
  const oldId = world.getBlock(x, y, z);
  world.setBlock(x, y, z, AIR);
  const def = BLOCKS[oldId];
  if (def?.digSound) playSound(def.digSound);
  if (def) breakParticles.push({ x, y, z, tile: def.side });
  if (def && useGameStore.getState().worldMode === 'survival') {
    const s = useGameStore.getState();
    // MC：石头系/矿石/金属块挖掘需要镐（needsPick 任意镐；pickTier 限定最低层级）
    const TIER_ORDER = ['wood', 'stone', 'iron', 'diamond'] as const;
    const held = s.hotbarSlots[s.selectedSlot];
    const heldPick = held?.kind === 'tool' && TOOLS[held.tool].kind === 'pickaxe' ? TOOLS[held.tool].tier : null;
    const needTier = def.pickTier ?? (def.needsPick ? 0 : null);
    const tierOk = needTier === null || (heldPick !== null && TIER_ORDER.indexOf(heldPick) >= needTier);
    if (def.drop) {
      // 矿石类：镐达标才掉材料（如钻石矿需铁镐以上）
      if (tierOk) {
        const [min, max] = def.drop.count;
        spawnMaterialDrop(def.drop.material, x + 0.5, y + 0.4, z + 0.5, min + Math.floor(Math.random() * (max - min + 1)));
      }
    } else if (tierOk) {
      spawnBlockDrop(oldId, x + 0.5, y + 0.4, z + 0.5);
    }
    // 熔炉被破坏：炉内容物一并掉落
    if (oldId === FURNACE) dropFurnaceContents(`${x},${y},${z}`, x, y, z);
  }
}

/** 从准星射线放置当前热键栏选中的方块；手持食物则进食；命中工作台/熔炉则打开对应界面。返回是否成功放置 */
export function tryPlace(): boolean {
  const world = getActiveWorld();
  const camera = cameraRef.current;
  if (!world || !camera) return false;
  const now = performance.now();
  if (now - lastPlace < PLACE_COOLDOWN) return false;
  const s = useGameStore.getState();
  // 手持装备右键：穿上；手持食物右键：进食（均无需准星目标）
  if (s.worldMode === 'survival') {
    const held = s.hotbarSlots[s.selectedSlot];
    if (held?.kind === 'armor' && s.equipSelectedArmor()) {
      lastPlace = now;
      return false;
    }
    if (held?.kind === 'material' && FOODS[held.material] && s.eatSelectedFood()) {
      lastPlace = now;
      return false;
    }
  }
  camera.getWorldDirection(dir);
  const hit = raycastBlock(
    world,
    camera.position.x, camera.position.y, camera.position.z,
    dir.x, dir.y, dir.z,
    REACH,
  );
  if (!hit) return false;
  const [fx, fy, fz] = hit.face;
  if (fx === 0 && fy === 0 && fz === 0) return false; // 原点在方块内，无法确定放置面
  const [bx, by, bz] = hit.block;
  // 与功能方块交互：打开对应界面而非放置
  const hitId = world.getBlock(bx, by, bz);
  if (hitId === CRAFTING_TABLE) {
    s.setCraftingOpen(true, true);
    return false;
  }
  if (hitId === FURNACE) {
    s.setFurnaceOpen(`${bx},${by},${bz}`);
    return false;
  }
  const px = bx + fx;
  const py = by + fy;
  const pz = bz + fz;
  if (py < 0 || py >= WORLD_HEIGHT) return false; // 世界高度外不可放置（先检查再扣物品）
  if (intersectsPlayer(px, py, pz)) return false;
  let id: BlockId | null;
  if (s.worldMode === 'survival') {
    // 生存模式：消耗选中槽位的方块，空槽/非方块则拒绝
    id = s.consumeSelectedBlock();
    if (id === null) return false;
  } else {
    id = s.hotbarBlocks[s.selectedSlot];
  }
  world.setBlock(px, py, pz, id);
  playSound(BLOCKS[id]?.placeSound ?? 'place');
  lastPlace = now;
  return true;
}
