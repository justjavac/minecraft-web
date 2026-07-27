// 放置与破坏动作：鼠标（Player）与触屏按钮（TouchControls）共用

import { Vector3 } from 'three';
import { AIR, BLOCKS, BLOCK_BY_KEY, CRAFTING_TABLE, DIRT, FURNACE, GRASS, isColumnPlantId, WHEAT_CROP_0, type BlockId } from './blocks';
import { dropFurnaceContents, FOODS } from './furnace';
import { dropBrewingContents, POTIONS } from './brewing';
import { effects } from './effects';
import { isFarmlandId, isWheatCropId } from './crops';
import { cameraRef, breakParticles, dayFactorAt, getActiveWorld, playerPosition, worldClock } from './game';
import { setGrowthDropHandler } from './growth';
import { spawnBlockDrop, spawnMaterialDrop } from './items';
import { setSaplingDropHandler } from './saplings';
import { raycastBlock } from './raycast';
import { clearBrokenPortals, tryIgnitePortal } from './portal';
import { interactBeacon } from './beacon';
import { trySummonWither } from './wither';
import { pistonIdFor } from './pistons';
import { cycleRepeaterDelay, isComparatorId, isRepeaterId, toggleComparatorMode, toggleLever } from './redstone';
import { XP_ORE } from './xp';
import { BREED_FOOD, feedMob, fireEnderPearl, fireEyeOfEnder, firePlayerArrow, MOB_DEFS, mobInReach, woolBlockId } from './mobs';
import { fillPortalFrame, nearestStronghold } from './stronghold';
import { playSound } from './sound';
import { dropStorageContents } from './storage';
import { useGameStore, MAX_HEALTH } from './store';
import { igniteTnt } from './tnt';
import { TOOLS } from './tools';
import { WORLD_HEIGHT, type World } from './world';

// 树叶凋零掉的树苗走方块掉落物管线
setSaplingDropHandler((id, x, y, z) => spawnBlockDrop(id, x, y, z));
// 仙人掌邻贴实心破坏的掉落同理
setGrowthDropHandler((id, x, y, z) => spawnBlockDrop(id, x, y, z));

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
  // 门：破坏一半时另一半同步消失（不掉落，否则 1 扇门拆出 2 扇）
  if (def?.shape === 'door') {
    const otherY = def.doorHalf === 'top' ? y - 1 : y + 1;
    if (BLOCKS[world.getBlock(x, otherY, z)]?.shape === 'door') {
      world.setBlock(x, otherY, z, AIR);
    }
  }
  // 双格高植物：破坏任一段另一段同步消失（顶段不掉落，dropBlock 已归底段）
  if (def?.twoHigh && BLOCKS[world.getBlock(x, y + 1, z)]?.plantTop) world.setBlock(x, y + 1, z, AIR);
  if (def?.plantTop && BLOCKS[world.getBlock(x, y - 1, z)]?.twoHigh) world.setBlock(x, y - 1, z, AIR);
  // 柱状植物（仙人掌/甘蔗/竹子）：破坏任一节，上方各节一并掉落（MC 规则）
  if (isColumnPlantId(oldId)) {
    let cy = y + 1;
    while (isColumnPlantId(world.getBlock(x, cy, z))) {
      const aid = world.getBlock(x, cy, z);
      world.setBlock(x, cy, z, AIR);
      if (useGameStore.getState().worldMode === 'survival') spawnBlockDrop(BLOCKS[aid].dropBlock ?? aid, x + 0.5, cy + 0.4, z + 0.5);
      cy++;
    }
  }
  // 传送门联动：邻近门块的框若已不完整，整片门熄灭
  clearBrokenPortals(world, x, y, z);
  // 耕地被破坏：上面的作物一律清掉（创造模式也清，否则留浮空作物）；种子掉落物只在生存模式产生
  if (isFarmlandId(oldId) && isWheatCropId(world.getBlock(x, y + 1, z))) {
    world.setBlock(x, y + 1, z, AIR);
    if (useGameStore.getState().worldMode === 'survival') {
      spawnMaterialDrop('wheat_seeds', x + 0.5, y + 1.4, z + 0.5, 1);
    }
  }
  if (def && useGameStore.getState().worldMode === 'survival') {
    const s = useGameStore.getState();
    // MC：石头系/矿石/金属块挖掘需要镐（needsPick 任意镐；pickTier 限定最低层级）
    const TIER_ORDER = ['wood', 'stone', 'iron', 'diamond'] as const;
    const held = s.hotbarSlots[s.selectedSlot];
    const heldPick = held?.kind === 'tool' && TOOLS[held.tool].kind === 'pickaxe' ? TOOLS[held.tool].tier : null;
    const needTier = def.pickTier ?? (def.needsPick ? 0 : null);
    const tierOk = needTier === null || (heldPick !== null && TIER_ORDER.indexOf(heldPick) >= needTier);
    if (def.drop) {
      // 矿石类：镐达标才掉材料（如钻石矿需铁镐以上）；时运附魔加掉、矿物掉经验（MC）
      if (tierOk) {
        const [min, max] = def.drop.count;
        const fortune = held?.kind === 'tool' ? (held.ench?.fortune ?? 0) : 0;
        const bonus = fortune > 0 ? Math.floor(Math.random() * (fortune + 1)) : 0;
        spawnMaterialDrop(def.drop.material, x + 0.5, y + 0.4, z + 0.5, min + Math.floor(Math.random() * (max - min + 1)) + bonus);
        const xpRange = XP_ORE[def.drop.material];
        if (xpRange) s.addXp(xpRange[0] + Math.floor(Math.random() * (xpRange[1] - xpRange[0] + 1)));
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
    } else if (oldId === BLOCK_BY_KEY.short_grass.id || oldId === BLOCK_BY_KEY.fern.id || oldId === BLOCK_BY_KEY.tall_grass.id || oldId === BLOCK_BY_KEY.large_fern.id) {
      // 草丛/蕨/高草丛/大型蕨：25% 掉小麦种子（MC 种草得种子的途径）
      if (Math.random() < 0.25) spawnMaterialDrop('wheat_seeds', x + 0.5, y + 0.4, z + 0.5, 1);
    } else if (oldId === BLOCK_BY_KEY.gravel.id) {
      // MC：砂砾 10% 掉燧石，否则掉砂砾自身
      if (Math.random() < 0.1) spawnMaterialDrop('flint', x + 0.5, y + 0.4, z + 0.5, 1);
      else spawnBlockDrop(oldId, x + 0.5, y + 0.4, z + 0.5);
    } else if (tierOk) {
      spawnBlockDrop(def.dropBlock ?? oldId, x + 0.5, y + 0.4, z + 0.5);
    }
    // 熔炉被破坏：炉内容物一并掉落
    if (oldId === FURNACE) dropFurnaceContents(`${x},${y},${z}`, x, y, z);
    // 酿造台被破坏：台内容物一并掉落
    if (oldId === BLOCK_BY_KEY.brewing_stand.id) dropBrewingContents(`${x},${y},${z}`, x, y, z);
    // 容器被破坏：内容物一并掉落
    if (oldId === BLOCK_BY_KEY.chest.id || oldId === BLOCK_BY_KEY.barrel.id) {
      dropStorageContents(`${x},${y},${z}`, x, y, z);
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
    // 手持药水右键：饮用（水瓶/粗制药水无效果）
    if (held?.kind === 'material' && POTIONS[held.material]) {
      const pot = POTIONS[held.material];
      if (!pot.effect) {
        s.setNotice('没什么味道…');
      } else {
        if (pot.effect === 'healing') s.setHealth(Math.min(MAX_HEALTH, s.health + 4));
        else effects[pot.effect] = pot.duration;
        s.consumeMaterial(held.material, 1);
        playSound('place');
      }
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
    // 手持末影珍珠右键：投掷，落点传送 + 2 伤害（MC）
    if (held?.kind === 'material' && held.material === 'ender_pearl') {
      if (s.consumeMaterial('ender_pearl', 1)) {
        camera.getWorldDirection(dir);
        fireEnderPearl(
          { x: camera.position.x, y: camera.position.y - 0.15, z: camera.position.z },
          { x: dir.x, y: dir.y, z: dir.z },
        );
        playSound('place');
        lastPlace = now;
        return false;
      }
    }
    // 手持末影之眼右键：投掷，朝最近要塞方向直飞（MC 定位要塞）；瞄准空门框架时除外（走下方嵌眼）
    if (held?.kind === 'material' && held.material === 'eye_of_ender') {
      camera.getWorldDirection(dir);
      const aim = raycastBlock(world, camera.position.x, camera.position.y, camera.position.z, dir.x, dir.y, dir.z, REACH);
      const aimFrame = aim !== null && world.getBlock(aim.block[0], aim.block[1], aim.block[2]) === BLOCK_BY_KEY.end_portal_frame.id;
      if (!aimFrame && s.consumeMaterial('eye_of_ender', 1)) {
        const spot = nearestStronghold(world.seedHash, playerPosition.x, playerPosition.z);
        fireEyeOfEnder(
          { x: camera.position.x, y: camera.position.y - 0.15, z: camera.position.z },
          spot.x,
          spot.z,
        );
        playSound('place');
        lastPlace = now;
        return false;
      }
    }
    // 右键村民：打开交易界面（MC；不看手持物，优先于繁殖判定）
    camera.getWorldDirection(dir);
    const mobForTrade = mobInReach(world, camera.position.x, camera.position.y, camera.position.z, dir.x, dir.y, dir.z, REACH);
    if (mobForTrade?.type === 'villager') {
      s.setTradeMob(mobForTrade.id);
      playSound('place');
      lastPlace = now;
      return false;
    }
    // 剪刀剪羊毛：羊在准星内且未剪过 → 掉同色羊毛 1-3（MC）
    if (held?.kind === 'tool' && held.tool === 'shears') {
      if (mobForTrade?.type === 'sheep' && !mobForTrade.sheared) {
        mobForTrade.sheared = true;
        spawnBlockDrop(woolBlockId(mobForTrade.woolColor ?? 'white'), mobForTrade.x, mobForTrade.y + 0.3, mobForTrade.z, 1 + Math.floor(Math.random() * 3));
        s.damageHeldTool(1);
        playSound('place');
        lastPlace = now;
        return false;
      }
    }
    // 骨头驯狼：1/3 概率驯服（MC 驯狼）
    if (held?.kind === 'material' && held.material === 'bone') {
      if (mobForTrade?.type === 'wolf' && !mobForTrade.tamed) {
        if (s.consumeMaterial('bone', 1)) {
          if (Math.random() < 1 / 3) {
            mobForTrade.tamed = true;
            mobForTrade.aggroTimer = 0;
            s.setNotice('狼成为了你的伙伴');
          }
          playSound('place');
          lastPlace = now;
          return false;
        }
      }
    }
    // 手持繁殖食物右键：喂养视线内的成年动物（MC：进入恋爱模式，两只恋爱个体才产仔）
    if (held?.kind === 'material') {
      camera.getWorldDirection(dir);
      const mob = mobInReach(world, camera.position.x, camera.position.y, camera.position.z, dir.x, dir.y, dir.z, REACH);
      if (mob && !MOB_DEFS[mob.type].hostile && !mob.baby && BREED_FOOD[mob.type] === held.material) {
        if ((mob.breedCd ?? 0) > 0) {
          s.setNotice('刚繁殖过，让它缓缓');
          lastPlace = now;
          return false;
        }
        if (s.consumeMaterial(held.material, 1)) {
          feedMob(mob);
          playSound('place');
          s.setNotice('它在寻找伴侣…');
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
  // 玻璃瓶对准水源/身处水中右键：装成水瓶（MC 取水）
  const heldMat = s.worldMode === 'survival' ? s.hotbarSlots[s.selectedSlot] : null;
  if (heldMat?.kind === 'material' && heldMat.material === 'glass_bottle') {
    const camBlock = world.getBlock(Math.floor(camera.position.x), Math.floor(camera.position.y), Math.floor(camera.position.z));
    const eyeInWater = camBlock === BLOCK_BY_KEY.water.id;
    const hitWater = hit !== null && world.getBlock(hit.block[0], hit.block[1], hit.block[2]) === BLOCK_BY_KEY.water.id;
    if (eyeInWater || hitWater) {
      s.consumeMaterial('glass_bottle', 1);
      s.addStack({ kind: 'material', material: 'water_bottle' }, 1);
      playSound('place');
      lastPlace = now;
      return true;
    }
  }
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
  // 播种：手持小麦种子右键耕地（干/湿均可）→ 种上小麦（第 0 阶段）
  if (
    heldSlot?.kind === 'material' &&
    heldSlot.material === 'wheat_seeds' &&
    isFarmlandId(hitId) &&
    world.getBlock(bx, by + 1, bz) === AIR
  ) {
    world.setBlock(bx, by + 1, bz, WHEAT_CROP_0);
    s.consumeMaterial('wheat_seeds', 1);
    playSound('place');
    lastPlace = now;
    return true;
  }
  // 骨粉：催熟小麦（+1~2 阶段）；点草方块催出花草（湿润耕地也可播种）
  if (heldSlot?.kind === 'material' && heldSlot.material === 'bonemeal') {
    if (isWheatCropId(hitId) && hitId < WHEAT_CROP_0 + 7) {
      world.setBlock(bx, by, bz, Math.min(hitId + 1 + Math.floor(Math.random() * 2), WHEAT_CROP_0 + 7));
      s.consumeMaterial('bonemeal', 1);
      breakParticles.push({ x: bx, y: by, z: bz, tile: BLOCKS[hitId].side });
      playSound('place');
      lastPlace = now;
      return true;
    }
    if (hitId === GRASS) {
      let grown = 0;
      for (let t = 0; t < 24 && grown < 4; t++) {
        const px = bx + Math.floor(Math.random() * 7) - 3;
        const pz = bz + Math.floor(Math.random() * 7) - 3;
        if (world.getBlock(px, by + 1, pz) !== AIR) continue;
        if (world.getBlock(px, by, pz) !== GRASS) continue;
        const pick = Math.random();
        world.setBlock(px, by + 1, pz, pick < 0.6 ? BLOCK_BY_KEY.short_grass.id : pick < 0.8 ? BLOCK_BY_KEY.dandelion.id : BLOCK_BY_KEY.poppy.id);
        grown++;
      }
      if (grown > 0) {
        s.consumeMaterial('bonemeal', 1);
        playSound('place');
        lastPlace = now;
        return true;
      }
    }
  }
  if (hitId === CRAFTING_TABLE) {
    s.setCraftingOpen(true, true);
    return false;
  }
  if (hitId === FURNACE) {
    s.setFurnaceOpen(`${bx},${by},${bz}`);
    return false;
  }
  // 酿造台：右键打开酿造界面
  if (hitId === BLOCK_BY_KEY.brewing_stand.id) {
    s.setBrewingOpen(`${bx},${by},${bz}`);
    return false;
  }
  // 附魔台：右键打开附魔界面
  if (hitId === BLOCK_BY_KEY.enchanting_table.id) {
    s.setEnchantOpen(`${bx},${by},${bz}`);
    return false;
  }
  // 信标：矿物块金字塔 + 手持矿物锭（铁/金/钻石/绿宝石）激活；已激活则右击循环切换效果
  if (hitId === BLOCK_BY_KEY.beacon.id) {
    const heldM = s.hotbarSlots[s.selectedSlot];
    // 创造模式免支付（MC 创造直接激活）
    const mat = s.worldMode === 'survival' ? (heldM?.kind === 'material' ? heldM.material : null) : 'iron_ingot';
    const res = interactBeacon(world, bx, by, bz, mat);
    if (res.consume && s.worldMode === 'survival') s.consumeMaterial(res.consume, 1);
    if (res.ok) playSound('place');
    s.setNotice(res.notice);
    lastPlace = now;
    return false;
  }
  // 末地门框架：手持末影之眼右击嵌入；12 框全嵌眼则激活末地传送门（MC）
  if (hitId === BLOCK_BY_KEY.end_portal_frame.id) {
    const heldEye = s.hotbarSlots[s.selectedSlot];
    if (heldEye?.kind === 'material' && heldEye.material === 'eye_of_ender') {
      const r = fillPortalFrame(world, bx, by, bz);
      if (r !== 'invalid') {
        if (s.worldMode === 'survival') s.consumeMaterial('eye_of_ender', 1);
        s.setNotice(r === 'activated' ? '末地传送门激活！' : '末影之眼已嵌入框架');
        playSound('place');
        lastPlace = now;
      }
    }
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
  // 拉杆：右键切换开/关（供能网络随之重算）
  if (hitId === BLOCK_BY_KEY.lever.id || hitId === BLOCK_BY_KEY.lever_on.id) {
    toggleLever(world, bx, by, bz);
    playSound('place');
    lastPlace = now;
    return true;
  }
  // 中继器：右键调延迟档（1-4 档 × 0.1s，MC）
  if (isRepeaterId(hitId)) {
    const d = cycleRepeaterDelay(bx, by, bz);
    s.setNotice(`中继器延迟 ${(d * 0.1).toFixed(1)}s`);
    playSound('place');
    lastPlace = now;
    return true;
  }
  // 比较器：右键切换模式（比较 ↔ 减法，MC）
  if (isComparatorId(hitId)) {
    const sub = toggleComparatorMode(bx, by, bz);
    s.setNotice(sub ? '比较器：减法模式' : '比较器：比较模式');
    playSound('place');
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
  // 打火石：右键黑曜石框内侧，点燃下界传送门
  if (heldSlot?.kind === 'material' && heldSlot.material === 'flint_and_steel' && hitId === BLOCK_BY_KEY.obsidian.id) {
    if (tryIgnitePortal(world, px, py, pz)) {
      playSound('place');
      lastPlace = now;
      return true;
    }
  }
  if (py < 0 || py >= WORLD_HEIGHT) return false; // 世界高度外不可放置（先检查再扣物品）
  if (intersectsPlayer(px, py, pz)) return false;
  let id: BlockId | null;
  if (s.worldMode === 'survival') {
    // 生存模式：先「看」选中方块不扣减，形状/支撑校验全部通过后才真正消耗（否则校验失败吞物品）
    const held = s.hotbarSlots[s.selectedSlot];
    id = held?.kind === 'block' && held.count > 0 ? held.id : null;
    if (id === null) return false;
  } else {
    id = s.hotbarBlocks[s.selectedSlot];
  }
  const def = BLOCKS[id];
  if (!def) return false;

  // —— 形状放置规则 ——
  if (def.shape === 'slab') {
    // 雪层/红石粉：下方必须是实心方块（MC 规则，不能悬空放）
    if ((id === BLOCK_BY_KEY.snow_layer.id || id === BLOCK_BY_KEY.redstone_dust.id) && !BLOCKS[world.getBlock(px, py - 1, pz)]?.solid) return false;
    // 点击同类台阶本身：合并成完整方块（MC 规则；无 fullBlock 的台阶形方块如床不合并）
    if (hitDef?.shape === 'slab' && hitDef.fullBlock !== undefined && hitDef.fullBlock === def.fullBlock) {
      if (s.worldMode === 'survival' && s.consumeSelectedBlock() === null) return false;
      world.setBlock(bx, by, bz, hitDef.fullBlock!);
      playSound(hitDef.placeSound);
      lastPlace = now;
      return true;
    }
    // 点在方块底面：放上半台阶（注册顺序底/顶相邻；无上半变体的如床除外）
    if (fy === -1 && def.fullBlock !== undefined) id = id + 1;
  } else if (def.shape === 'cross') {
    // 花草：默认需底面不透明支撑；悬挂植物（洞穴藤蔓）需顶面不透明
    if (def.hang) {
      if (!BLOCKS[world.getBlock(px, py + 1, pz)]?.opaque) return false;
    } else if (!BLOCKS[world.getBlock(px, py - 1, pz)]?.opaque) return false;
    // 双格高植物：上方须为空，两段一次放齐（顶段注册序相邻）
    if (def.twoHigh) {
      if (py + 1 >= WORLD_HEIGHT || world.getBlock(px, py + 1, pz) !== AIR) return false;
      if (s.worldMode === 'survival' && s.consumeSelectedBlock() === null) return false;
      world.setBlock(px, py, pz, id);
      world.setBlock(px, py + 1, pz, id + 1);
      playSound(def.placeSound);
      lastPlace = now;
      return true;
    }
  } else if (def.shape === 'panel') {
    // 藤蔓：点在实心墙面才成立，朝向 = 贴附方向（选块界面只有 n 款基础型）
    if (fy !== 0 || !hitDef?.opaque) return false;
    id = BLOCK_BY_KEY[fx === 1 ? 'vine_w' : fx === -1 ? 'vine_e' : fz === 1 ? 'vine_n' : 'vine_s'].id;
  } else if (def.shape === 'door') {
    // 门：需不透明支撑且上方为空；朝向随玩家视线（注册序：bottom, top, open_bottom, open_top 每朝向 4 连）
    if (!BLOCKS[world.getBlock(px, py - 1, pz)]?.opaque) return false;
    if (world.getBlock(px, py + 1, pz) !== AIR) return false;
    if (s.worldMode === 'survival' && s.consumeSelectedBlock() === null) return false;
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
  } else if (id === BLOCK_BY_KEY.piston_n.id || id === BLOCK_BY_KEY.piston_sticky_n.id) {
    // 活塞：正面朝玩家（MC），按视线主轴定 6 向之一
    const ax = Math.abs(dir.x);
    const ay = Math.abs(dir.y);
    const az = Math.abs(dir.z);
    const sticky = id === BLOCK_BY_KEY.piston_sticky_n.id;
    const facing = ay >= ax && ay >= az ? (dir.y > 0 ? 5 : 4) : ax >= az ? (dir.x > 0 ? 3 : 1) : dir.z > 0 ? 0 : 2;
    id = pistonIdFor(sticky, facing);
  } else if (id === BLOCK_BY_KEY.repeater_n.id) {
    // 中继器：输出方向 = 玩家视线水平朝向（MC：面向放置方向）
    id = BLOCK_BY_KEY[`repeater_${Math.abs(dir.x) > Math.abs(dir.z) ? (dir.x > 0 ? 'e' : 'w') : dir.z > 0 ? 's' : 'n'}`].id;
  } else if (id === BLOCK_BY_KEY.comparator_n.id) {
    // 比较器：输出方向 = 玩家视线水平朝向（同中继器）
    id = BLOCK_BY_KEY[`comparator_${Math.abs(dir.x) > Math.abs(dir.z) ? (dir.x > 0 ? 'e' : 'w') : dir.z > 0 ? 's' : 'n'}`].id;
  } else if (id === BLOCK_BY_KEY.torch.id && (fx !== 0 || fz !== 0) && hitDef?.opaque) {
    // 火把点在方块侧面：转墙上火把（朝向 = 墙面外法线）
    const wallKey = fx === 1 ? 'torch_wall_e' : fx === -1 ? 'torch_wall_w' : fz === 1 ? 'torch_wall_s' : 'torch_wall_n';
    id = BLOCK_BY_KEY[wallKey].id;
  }
  // 校验全部通过：扣减并放置
  if (s.worldMode === 'survival' && s.consumeSelectedBlock() === null) return false;
  world.setBlock(px, py, pz, id);
  // 凋灵骷髅头放下：检测 T 形召唤（MC 凋灵仪式）
  if (id === BLOCK_BY_KEY.wither_skeleton_skull.id) trySummonWither(world, px, py, pz, (d) => s.damagePlayer(d));
  playSound(BLOCKS[id]?.placeSound ?? 'place');
  lastPlace = now;
  return true;
}
