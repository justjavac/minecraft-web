// 放置与破坏动作：鼠标（Player）与触屏按钮（TouchControls）共用

import { Vector3 } from 'three';
import { AIR, BLOCKS, BLOCK_BY_KEY, CRAFTING_TABLE, DIRT, FURNACE, GRASS, WHEAT_CROP_0, type BlockId } from './blocks';
import { dropFurnaceContents, FOODS } from './furnace';
import { isWheatCropId } from './crops';
import { cameraRef, breakParticles, dayFactorAt, getActiveWorld, playerPosition, worldClock } from './game';
import { spawnBlockDrop, spawnMaterialDrop } from './items';
import { setSaplingDropHandler } from './saplings';
import { raycastBlock } from './raycast';
import { breedMob, firePlayerArrow, MOB_DEFS, mobInReach, mobs } from './mobs';
import { playSound } from './sound';
import { dropStorageContents } from './storage';
import { useGameStore } from './store';
import { igniteTnt } from './tnt';
import { TOOLS } from './tools';
import { WORLD_HEIGHT, type World } from './world';

// 树叶凋零掉的树苗走方块掉落物管线
setSaplingDropHandler((id, x, y, z) => spawnBlockDrop(id, x, y, z));

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
    } else if (isWheatCropId(oldId)) {
      // 小麦收割：成熟（第 7 阶段）掉 1 小麦 + 0-2 种子；未熟只掉 1 种子
      if (oldId >= WHEAT_CROP_0 + 7) {
        spawnMaterialDrop('wheat', x + 0.5, y + 0.4, z + 0.5, 1);
        const seeds = Math.floor(Math.random() * 3);
        if (seeds > 0) spawnMaterialDrop('wheat_seeds', x + 0.5, y + 0.4, z + 0.5, seeds);
      } else {
        spawnMaterialDrop('wheat_seeds', x + 0.5, y + 0.4, z + 0.5, 1);
      }
    } else if (oldId === BLOCK_BY_KEY.short_grass.id || oldId === BLOCK_BY_KEY.fern.id) {
      // 草丛/蕨：25% 掉小麦种子（MC 种草得种子的途径）
      if (Math.random() < 0.25) spawnMaterialDrop('wheat_seeds', x + 0.5, y + 0.4, z + 0.5, 1);
    } else if (tierOk) {
      spawnBlockDrop(def.dropBlock ?? oldId, x + 0.5, y + 0.4, z + 0.5);
    }
    // 熔炉被破坏：炉内容物一并掉落
    if (oldId === FURNACE) dropFurnaceContents(`${x},${y},${z}`, x, y, z);
    // 容器被破坏：内容物一并掉落
    if (oldId === BLOCK_BY_KEY.chest.id || oldId === BLOCK_BY_KEY.barrel.id) {
      dropStorageContents(`${x},${y},${z}`, x, y, z);
    }
    // 耕地被破坏：上面的作物弹出为 1 种子
    if (oldId === BLOCK_BY_KEY.farmland.id && isWheatCropId(world.getBlock(x, y + 1, z))) {
      world.setBlock(x, y + 1, z, AIR);
      spawnMaterialDrop('wheat_seeds', x + 0.5, y + 1.4, z + 0.5, 1);
    }
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
    // 手持弓右键：射箭（消耗 1 支箭 + 1 点耐久），无需准星目标
    if (held?.kind === 'tool' && held.tool === 'bow') {
      if (s.consumeMaterial('arrow', 1)) {
        camera.getWorldDirection(dir);
        firePlayerArrow(
          { x: camera.position.x, y: camera.position.y - 0.15, z: camera.position.z },
          { x: dir.x, y: dir.y, z: dir.z },
        );
        s.damageHeldTool(1);
        playSound('place');
        lastPlace = now;
      } else {
        s.setNotice('没有箭了');
      }
      return false;
    }
    // 手持小麦右键：喂养视线内的成年动物并繁殖（MC 小麦繁殖）
    if (held?.kind === 'material' && held.material === 'wheat') {
      camera.getWorldDirection(dir);
      const mob = mobInReach(world, camera.position.x, camera.position.y, camera.position.z, dir.x, dir.y, dir.z, REACH);
      if (mob && !MOB_DEFS[mob.type].hostile && !mob.baby) {
        if (mobs.length >= 40) {
          s.setNotice('动物太多了');
          return false;
        }
        if (s.consumeMaterial('wheat', 1)) {
          breedMob(mob);
          playSound('place');
          s.setNotice('繁殖成功');
          lastPlace = now;
          return false;
        }
      }
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
  // 生存模式手持物的整地/播种（拿的是工具/材料而非方块，先于常规放置判定）
  const heldSlot = s.worldMode === 'survival' ? s.hotbarSlots[s.selectedSlot] : null;
  // 锄头整地：右键草方块/泥土 → 耕地
  if (heldSlot?.kind === 'tool' && TOOLS[heldSlot.tool].kind === 'hoe' && (hitId === GRASS || hitId === DIRT)) {
    world.setBlock(bx, by, bz, BLOCK_BY_KEY.farmland.id);
    playSound('dig_dirt');
    s.damageHeldTool(1);
    lastPlace = now;
    return false;
  }
  // 播种：手持小麦种子右键耕地 → 种上小麦（第 0 阶段）
  if (
    heldSlot?.kind === 'material' &&
    heldSlot.material === 'wheat_seeds' &&
    hitId === BLOCK_BY_KEY.farmland.id &&
    world.getBlock(bx, by + 1, bz) === AIR
  ) {
    world.setBlock(bx, by + 1, bz, WHEAT_CROP_0);
    s.consumeMaterial('wheat_seeds', 1);
    playSound('place');
    lastPlace = now;
    return true;
  }
  if (hitId === CRAFTING_TABLE) {
    s.setCraftingOpen(true, true);
    return false;
  }
  if (hitId === FURNACE) {
    s.setFurnaceOpen(`${bx},${by},${bz}`);
    return false;
  }
  // 箱子/木桶：右键打开容器界面
  if (hitId === BLOCK_BY_KEY.chest.id || hitId === BLOCK_BY_KEY.barrel.id) {
    s.setStorageOpen(`${bx},${by},${bz}`);
    return false;
  }
  // 床：夜晚右键睡觉——跳到日出并把重生点设到床边；白天拒绝
  if (hitId === BLOCK_BY_KEY.red_bed.id) {
    if (dayFactorAt(worldClock.t) < 0.4) {
      worldClock.t = 0;
      s.setSpawnPoint({ x: bx + 0.5, y: by + 1, z: bz + 0.5 });
      s.setNotice('重生点已设置');
      playSound('place');
    } else {
      s.setNotice('只能在夜晚睡觉');
    }
    lastPlace = now;
    return false;
  }
  // TNT：右键点燃（MC 打火石点燃），生成引信实体而非放置
  if (hitId === BLOCK_BY_KEY.tnt.id) {
    world.setBlock(bx, by, bz, AIR);
    igniteTnt(bx, by, bz);
    lastPlace = now;
    return true;
  }
  // 门：右键切换开/关（上下两格同步；注册序每朝向 [bottom, top, open_bottom, open_top]）
  const hitDef = BLOCKS[hitId];
  if (hitDef?.shape === 'door') {
    const f = hitDef.facing!;
    const bottomY = hitDef.doorHalf === 'top' ? by - 1 : by;
    const baseId = BLOCK_BY_KEY.oak_door_bottom_n.id + f * 4;
    const open = !hitDef.doorOpen;
    world.setBlock(bx, bottomY, bz, baseId + (open ? 2 : 0));
    world.setBlock(bx, bottomY + 1, bz, baseId + (open ? 3 : 1));
    playSound('place_hard');
    lastPlace = now;
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
  const def = BLOCKS[id];
  if (!def) return false;

  // —— 形状放置规则 ——
  if (def.shape === 'slab') {
    // 点击同类台阶本身：合并成完整方块（MC 规则；无 fullBlock 的台阶形方块如床不合并）
    if (hitDef?.shape === 'slab' && hitDef.fullBlock !== undefined && hitDef.fullBlock === def.fullBlock) {
      world.setBlock(bx, by, bz, hitDef.fullBlock!);
      playSound(hitDef.placeSound);
      lastPlace = now;
      return true;
    }
    // 点在方块底面：放上半台阶（注册顺序底/顶相邻；无上半变体的如床除外）
    if (fy === -1 && def.fullBlock !== undefined) id = id + 1;
  } else if (def.shape === 'cross') {
    // 花草：下方必须是不透明的支撑方块
    if (!BLOCKS[world.getBlock(px, py - 1, pz)]?.opaque) return false;
  } else if (def.shape === 'door') {
    // 门：需不透明支撑且上方为空；朝向随玩家视线（注册序：bottom, top, open_bottom, open_top 每朝向 4 连）
    if (!BLOCKS[world.getBlock(px, py - 1, pz)]?.opaque) return false;
    if (world.getBlock(px, py + 1, pz) !== AIR) return false;
    const facing = Math.abs(dir.x) > Math.abs(dir.z) ? (dir.x > 0 ? 1 : 3) : dir.z > 0 ? 2 : 0;
    const baseId = BLOCK_BY_KEY.oak_door_bottom_n.id + facing * 4;
    world.setBlock(px, py, pz, baseId);
    world.setBlock(px, py + 1, pz, baseId + 1);
    playSound(def.placeSound);
    lastPlace = now;
    return true;
  } else if (def.shape === 'stairs') {
    // 楼梯：按玩家视线朝向决定背向（顶半在远处）；点在方块底面则倒置（注册序：正立×4 → 倒置×4）
    const facing = Math.abs(dir.x) > Math.abs(dir.z) ? (dir.x > 0 ? 1 : 3) : dir.z > 0 ? 2 : 0;
    id = id + (fy === -1 ? 4 + facing : facing);
  } else if (id === BLOCK_BY_KEY.torch.id && (fx !== 0 || fz !== 0) && hitDef?.opaque) {
    // 火把点在方块侧面：转墙上火把（朝向 = 墙面外法线）
    const wallKey = fx === 1 ? 'torch_wall_e' : fx === -1 ? 'torch_wall_w' : fz === 1 ? 'torch_wall_s' : 'torch_wall_n';
    id = BLOCK_BY_KEY[wallKey].id;
  }
  world.setBlock(px, py, pz, id);
  playSound(BLOCKS[id]?.placeSound ?? 'place');
  lastPlace = now;
  return true;
}
