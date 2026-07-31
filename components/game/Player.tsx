'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Euler, PerspectiveCamera, Vector3 } from 'three';
import { AIR, BLOCK_BY_KEY, BLOCKS, isLavaId, isWaterId } from '@/lib/blocks';
import { breakBlock, cancelEating, eatState, sweepAround, tickEating, tryPlace, useButton } from '@/lib/actions';
import { isFarmlandId, isWheatCropId } from '@/lib/crops';
import { effectiveDigTime } from '@/lib/dig';
import { attackState, cameraRef, debugInfo, digState, getActiveWorld, hurtState, panelUnlock, pearlTeleport, playerPosition, survivalStats, targetBlock, teleportState, touchInput, worldClock } from '@/lib/game';
import { itemDrops } from '@/lib/items';
import { otherDimension } from '@/lib/dimension';
import { END_SPAWN } from '@/lib/end';
import { isPortalId } from '@/lib/portal';
import { outerHeightAt, pickOuterIsland } from '@/lib/end';
import { gatewayState } from '@/lib/endfight';
import { spawnMaterialDrop } from '@/lib/items';
import { raycastBlock } from '@/lib/raycast';
import { resolveAnchorRespawn } from '@/lib/respawnanchor';
import { arrows, checkEndermanStare, damageMob, mobInReach, mobs, spawnMobAt, type Arrow } from '@/lib/mobs';
import { crystalInReach, hitCrystal, tickCrystals } from '@/lib/endfight';
import { tickFishing } from '@/lib/fishing';
import { SEA_LEVEL, type Biome } from '@/lib/noise';
import { aabbFree, collideAxis, PLAYER_HALF_W, PLAYER_HEIGHT, type Aabb } from '@/lib/physics';
import { playSound } from '@/lib/sound';
import { useGameStore } from '@/lib/store';
import { anyPanelOpen } from '@/lib/store-types';
import { resetSurvivalMem, tickSurvival, type SurvivalMem } from '@/lib/survival';
import { effects, effectLvls, tickEffects } from '@/lib/effects';
import { beaconTiers, tickBeacons } from '@/lib/beacon';
import { attackCooldownScale, TOOLS } from '@/lib/tools';
import { WORLD_HEIGHT, type World } from '@/lib/world';

const EYE = 1.62; // 视点高度
const WALK_SPEED = 4.3;
const FLY_SPEED = 11;
// 跳跃初速：跳高 = JUMP_VEL²/(2·GRAVITY)。对齐 MC 跳高 1.25 格（原值 9 跳出 1.56 格，能上 1.5 格方块，与 MC 不符）
const JUMP_VEL = 8.07;
const GRAVITY = 26;
const REACH = 6; // 挖掘/放置距离
const LOOK_SENSITIVITY = 0.0045; // 触屏视角灵敏度（弧度/像素）
const SPAWN = { x: 8.5, z: 8.5 };

/** 出生点避让：海洋/河流/蘑菇岛/山地（含雪顶）不适合出生（MC 出生点在平缓陆地） */
const BAD_SPAWN: Biome[] = ['ocean', 'river', 'mushroom_fields', 'mountains'];
const spawnCache = new WeakMap<World, { x: number; z: number }>();

/** 螺旋外扩找最近的平缓陆地列（8 格步进；结果按世界缓存，出生/重生一致） */
function resolveSpawnXZ(world: World): { x: number; z: number } {
  const hit = spawnCache.get(world);
  if (hit) return hit;
  let s = { x: Math.floor(SPAWN.x), z: Math.floor(SPAWN.z) };
  outer: for (let r = 0; r <= 48; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const bx = Math.floor(SPAWN.x) + dx * 8;
        const bz = Math.floor(SPAWN.z) + dz * 8;
        const h = world.terrain.heightAt(bx, bz);
        if (h <= SEA_LEVEL || h > 85) continue;
        if (BAD_SPAWN.includes(world.terrain.biomeAt(bx, bz))) continue;
        s = { x: bx, z: bz };
        break outer;
      }
    }
  }
  spawnCache.set(world, s);
  return s;
}

/**
 * 出生点：避开不宜居群系后，从地表向上找到能容纳玩家的连续 2 格非实心方块。
 * heightAt 不含树木/玩家放置的方块，直接用它可能卡进树干。
 */
function findSpawn(world: World): { x: number; y: number; z: number } {
  const { x: bx, z: bz } = resolveSpawnXZ(world);
  let y = Math.max(world.terrain.heightAt(bx, bz), SEA_LEVEL) + 1;
  while (
    y < WORLD_HEIGHT - 2 &&
    (BLOCKS[world.getBlock(bx, y, bz)]?.solid || BLOCKS[world.getBlock(bx, y + 1, bz)]?.solid)
  ) {
    y++;
  }
  return { x: bx + 0.5, y, z: bz + 0.5 };
}

/** 准星 reach 内最近的恶魂爆裂球（近战可打回的；已打回的视为玩家弹射物不再判定） */
function fireballInReach(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, reach: number): Arrow | null {
  let best: Arrow | null = null;
  let bestT = reach;
  for (const a of arrows) {
    if (a.kind !== 'ghast' || a.fromPlayer) continue;
    const t = (a.x - ox) * dx + (a.y - oy) * dy + (a.z - oz) * dz;
    if (t < 0 || t > bestT) continue;
    const px = ox + dx * t;
    const py = oy + dy * t;
    const pz = oz + dz * t;
    if (Math.hypot(a.x - px, a.y - py, a.z - pz) < 1.2) {
      best = a;
      bestT = t;
    }
  }
  return best;
}

export function Player() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const touchMode = useGameStore((s) => s.touchMode);
  const fov = useGameStore((s) => s.settings.fov);
  const sensitivity = useGameStore((s) => s.settings.sensitivity);
  const touchSensitivity = useGameStore((s) => s.settings.touchSensitivity);
  const invertY = useGameStore((s) => s.settings.invertY);
  const autoJump = useGameStore((s) => s.settings.autoJump);
  const pos = useRef<Aabb | null>(null);
  const velY = useRef(0);
  const onGround = useRef(false);
  const keys = useRef<Record<string, boolean>>({});
  /** 左键按住挖掘中（桌面端） */
  const digHeld = useRef(false);
  const rayDir = useMemo(() => new Vector3(), []);
  const euler = useMemo(() => new Euler(0, 0, 0, 'YXZ'), []);
  /** 相机水平朝向（单位向量），垂直看时沿用上一帧 */
  const forward = useRef({ x: 0, z: -1 });
  /** 触屏模式的相机角度（桌面由下方 mousemove 监听维护） */
  const yawPitch = useRef({ yaw: 0, pitch: 0 });
  /** 脚步声：累计水平位移，每 2.2 格一步 */
  const stepAcc = useRef(0);
  /** 台阶辅助上台动画（150ms 平滑升起，避免瞬移突兀/起跳弹循环） */
  const stepAnim = useRef<{ from: number; to: number; t: number } | null>(null);
  const prevStep = useRef({ x: 0, z: 0 });
  /** 已应用到相机的 FOV，变化时在帧循环里同步 */
  const appliedFov = useRef(0);
  /** 生存：下落/憋气/回血计时（逻辑在 lib/survival.ts） / 攻击冷却 / 死亡边沿 */
  const survivalMem = useRef<SurvivalMem>({ fallDist: 0, air: 15, regenTick: 0, witherTick: 0, regenPotionTick: 0 });
  /** 岩浆灼烧累计（满 1 点扣 1 血） */
  const lavaAcc = useRef(0);
  const voidAcc = useRef(0);
  /** 着火计时（离开岩浆后续烧，MC 约 15s）与着火 DoT 累计 */
  const fireAcc = useRef(0);
  const fireDmgAcc = useRef(0);
  const attackCd = useRef(0);
  /** 当前武器的攻击总冷却 T（= 1/攻速），冷却进度条与伤害缩放用 */
  const attackCdTotal = useRef(0.25);
  /** 上一帧挖掘键按住状态（点按边沿检测：冷却未满时点击仍可出手，MC 1.9） */
  const digWasHeld = useRef(false);
  /** 冲刺击退后的冲刺中断剩余秒数（MC：冲刺命中后中断冲刺；限时恢复，触屏冲刺开关不被卡死） */
  const sprintBreak = useRef(0);
  /** 创造模式即时破坏的上次时间戳（200ms 冷却，防止按住左键每帧破一块） */
  const lastCreativeBreak = useRef(0);
  const wasDead = useRef(false);
  /** 下界传送门：门内停留计时（生存 4 秒 = MC 80 tick 触发传送；创造进立传） */
  const portalAcc = useRef(0);
  /** 末影人对视检查计时 */
  const stareAcc = useRef(0);

  // 维度切换：重置位置状态（落点由 WorldRenderer 经 spawnPoint 下发）
  const dimension = useGameStore((s) => s.dimension);
  useEffect(() => {
    pos.current = null;
    velY.current = 0;
    portalAcc.current = 0;
  }, [dimension]);

  // 相机共享给触屏挖/放动作（lib/actions.ts）
  useEffect(() => {
    cameraRef.current = camera;
    return () => {
      cameraRef.current = null;
    };
  }, [camera]);

  // 键盘：移动键状态 + F 飞行 + F3 调试 + 数字键选槽
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // 输入框聚焦时不劫持按键（选块搜索框等），否则 e/f/数字会触发关界面/飞行/切槽
      if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      keys.current[e.code] = true;
      if (e.repeat) return;
      if (e.code === 'KeyF') useGameStore.getState().toggleFly();
      if (e.code === 'KeyE') {
        const s = useGameStore.getState();
        if (s.dead) return; // 死亡后不响应交互键
        if (s.worldMode === 'survival') {
          // MC 的背包键：切换随身 2×2 合成界面
          if (s.craftingOpen) s.setCraftingOpen(false);
          else s.setCraftingOpen(true, false);
        } else {
          // 创造模式：切换选块界面
          s.setPickerOpen(!s.pickerOpen);
        }
      }
      if (e.code === 'F3') {
        e.preventDefault();
        useGameStore.getState().toggleDebug();
      }
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 9) useGameStore.getState().setSlot(n - 1);
      }
    };
    const up = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // 滚轮切换热键栏：累计 deltaY 过阈值才切一格，避免触控板连跳
  useEffect(() => {
    const THRESHOLD = 40;
    const IDLE_RESET = 300; // ms
    let acc = 0;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      if (document.pointerLockElement !== gl.domElement) return;
      const now = performance.now();
      if (now - last > IDLE_RESET) acc = 0;
      last = now;
      acc += e.deltaY;
      if (Math.abs(acc) < THRESHOLD) return;
      const s = useGameStore.getState();
      s.setSlot((s.selectedSlot + (acc > 0 ? 1 : -1) + 9) % 9);
      acc = 0;
    };
    window.addEventListener('wheel', onWheel);
    return () => window.removeEventListener('wheel', onWheel);
  }, [gl]);

  // 指针锁状态 → 暂停遮罩；解锁时清空按键防止卡住。触屏模式无指针锁，不追踪
  useEffect(() => {
    if (touchMode) {
      useGameStore.getState().setPaused(false);
      return;
    }
    const onLockChange = () => {
      const locked = document.pointerLockElement === gl.domElement;
      useGameStore.getState().setPaused(!locked);
      if (locked) useGameStore.getState().setHasLocked(true);
      if (!locked) {
        keys.current = {};
        digHeld.current = false;
        useButton.held = false; // 退锁视同松开右键：进食读条随下一帧 tickEating 取消
      }
    };
    document.addEventListener('pointerlockchange', onLockChange);
    onLockChange();
    return () => document.removeEventListener('pointerlockchange', onLockChange);
  }, [gl, touchMode]);

  // 桌面鼠标视角：指针锁内 mousemove → 相机欧拉角（YXZ，俯仰限 ±90°，同 three PointerLockControls，
  // 但支持反转 Y——drei/three 的 PointerLockControls 无此选项，故自实现）。触屏走 useFrame 里的拖动逻辑
  useEffect(() => {
    if (touchMode) return;
    const lookEuler = new Euler(0, 0, 0, 'YXZ');
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== gl.domElement) return;
      lookEuler.setFromQuaternion(camera.quaternion);
      lookEuler.y -= e.movementX * 0.002 * sensitivity;
      lookEuler.x -= e.movementY * 0.002 * sensitivity * (invertY ? -1 : 1);
      lookEuler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, lookEuler.x));
      camera.quaternion.setFromEuler(lookEuler);
    };
    document.addEventListener('mousemove', onMove);
    return () => document.removeEventListener('mousemove', onMove);
  }, [camera, gl, sensitivity, invertY, touchMode]);

  // 面板全关后自动回指针锁（MC：关背包直接回游戏，无需再点「继续游戏」）。
  // 仅当退锁原因是「打开面板」（panelUnlock.pending）时回锁；用户主动 Esc 暂停无此标记，仍出暂停遮罩
  const panelOpen = useGameStore(anyPanelOpen);
  useEffect(() => {
    if (touchMode || panelOpen || !panelUnlock.pending) return;
    panelUnlock.pending = false;
    const gs = useGameStore.getState();
    // 死亡/已回菜单/已有锁的场景不回锁（死亡与暂停界面需要光标）
    if (gs.dead || gs.screen !== 'playing' || document.pointerLockElement) return;
    const canvas = gl.domElement;
    const request = () => canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    // Chrome 在退锁后 ~1.25s 内会拒绝再次锁定（同 Hud PauseOverlay 的冷却处理）：被拒则冷却结束后再试一次
    request()?.catch(() => {
      setTimeout(() => {
        const s = useGameStore.getState();
        if (document.pointerLockElement || anyPanelOpen(s) || s.dead || s.screen !== 'playing') return;
        request()?.catch(() => {
          // 仍被拒：保持暂停遮罩，玩家可手动点「继续游戏」
        });
      }, 1300);
    });
  }, [panelOpen, gl, touchMode]);

  // 鼠标：左键按住挖掘，右键放置（触屏走 TouchControls）
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (document.pointerLockElement !== gl.domElement) return;
      if (e.button === 0) digHeld.current = true;
      else if (e.button === 2) {
        useButton.held = true; // 进食读条等的「按住使用」状态（lib/actions.ts）
        tryPlace();
      } else if (e.button === 1) {
        // 中键选块（MC pick block）：取准星方块到手上
        e.preventDefault(); // 阻止浏览器中键自动滚动
        const hit = targetBlock.hit;
        const w = getActiveWorld();
        const id = hit && w ? w.getBlock(hit.block[0], hit.block[1], hit.block[2]) : undefined;
        if (id !== undefined) useGameStore.getState().pickBlock(id);
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) digHeld.current = false;
      else if (e.button === 2) useButton.held = false;
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [gl]);

  // 物理与移动
  useFrame((state, delta) => {
    const world = getActiveWorld();
    if (!world) return;
    const dt = Math.min(delta, 0.05);

    // 调试钩子（自动化实测用；开发环境，或生产带 ?mcdebug 时暴露——正常用户不可见）
    if (process.env.NODE_ENV === 'development' || window.location.search.includes('mcdebug')) {
      (window as unknown as { __mc?: unknown }).__mc = {
        pos: { x: playerPosition.x, y: playerPosition.y, z: playerPosition.z },
        pp: playerPosition, // 可写：测试传送（实际玩家状态在下方 tp）
        tp: pos.current, // 当前帧的物理状态对象（重生等重赋值后会变）
        tpTo: (x: number, y: number, z: number) => {
          // 传送（对当前 pos.current 写字段；重生重赋值也安全）
          if (!pos.current) return;
          pos.current.x = x;
          pos.current.y = y;
          pos.current.z = z;
        },        camera: state.camera,
        scene: state.scene,
        gl: state.gl,
        fps: debugInfo.fps,
        store: useGameStore,
        world,
        touch: touchInput,
        mobs, // 生物列表（只读排查用）
        clock: worldClock, // 昼夜时钟（可写）
        yawPitch: yawPitch.current, // 触屏视角（可写：自动化对准）
        digState, // 挖掘进度（排障用）
        targetBlock, // 准星命中（排障用）
        drops: itemDrops, // 掉落物实体（排障用）
        spawn: spawnMobAt, // 生成生物（实测用）
        tryPlace, // 右键交互（实测用）
        mobInReach, // 准星内生物（实测用）
      };
    }

    // FOV：设置基准值 + 冲刺时 +10%（MC 冲刺视角），平滑过渡
    {
      const cam = state.camera as PerspectiveCamera;
      const sprintKey = keys.current['ControlLeft'] || keys.current['ControlRight'] || touchInput.sprint;
      const targetFov = fov * (sprintKey ? 1.1 : 1);
      if (Math.abs(cam.fov - targetFov) > 0.05) {
        cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 10);
        cam.updateProjectionMatrix();
      }
      appliedFov.current = cam.fov;
    }

    // 触屏：用拖动增量驱动相机偏航/俯仰（独立灵敏度 touchSensitivity；反转 Y 与鼠标共用 invertY 设置，同 MC PE）
    if (touchMode) {
      const yp = yawPitch.current;
      yp.yaw -= touchInput.lookDX * LOOK_SENSITIVITY * touchSensitivity;
      yp.pitch = Math.min(
        Math.max(yp.pitch - touchInput.lookDY * LOOK_SENSITIVITY * touchSensitivity * (invertY ? -1 : 1), -Math.PI / 2 + 0.01),
        Math.PI / 2 - 0.01,
      );
      touchInput.lookDX = 0;
      touchInput.lookDY = 0;
      camera.quaternion.setFromEuler(euler.set(yp.pitch, yp.yaw, 0));
    }

    if (pos.current === null) {
      // 继续游戏回上次位置，新游戏用默认出生点
      const sp = useGameStore.getState().spawnPoint;
      pos.current = sp
        ? { x: sp.x, y: sp.y, z: sp.z }
        : findSpawn(world);
      prevStep.current = { x: pos.current.x, z: pos.current.z };
      // 预生成出生点附近 chunk，保证落地有碰撞体
      const scx = Math.floor(pos.current.x / 16);
      const scz = Math.floor(pos.current.z / 16);
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) world.getChunk(scx + dx, scz + dz);
      }
    }
    const p = pos.current;
    const flying = useGameStore.getState().flying;
    const gs = useGameStore.getState();

    // 重生传送（dead → alive 边沿）：回床/重生锚设的重生点（未设回世界出生点，MC）并重置生存状态
    if (wasDead.current && !gs.dead) {
      let sp = gs.respawnPoint;
      if (sp) {
        // 重生锚（MC）：锚在且有剩余档位 → 耗 1 档在锚旁重生；档尽/锚失效 → 重生点失效
        const ar = resolveAnchorRespawn(world, sp);
        if (ar === 'exhausted') {
          // 本次仍回锚旁（耗掉最后一档），此后重生点失效
          gs.setRespawnPoint(null);
          gs.setNotice('重生锚能量耗尽，重生点已失效');
        } else if (ar === 'depleted') {
          gs.setRespawnPoint(null);
          gs.setNotice('重生锚没有能量，重生点已失效');
          sp = null;
        }
      }
      const fb = findSpawn(world);
      p.x = sp?.x ?? fb.x;
      p.z = sp?.z ?? fb.z;
      p.y = sp?.y ?? fb.y;
      velY.current = 0;
      resetSurvivalMem(survivalMem.current);
      survivalStats.exhaustion = 0;
      prevStep.current = { x: p.x, z: p.z };
    }
    wasDead.current = gs.dead;
    // 死亡：冻结等待重生界面操作
    if (gs.dead) {
      useButton.held = false;
      if (eatState.active) cancelEating(); // 死亡打断进食读条（MC：死亡取消使用动作）
      return;
    }
    // Esc 暂停（指针解锁）：物理/挖掘/生存 tick 全部冻结；触屏 paused 恒 false 不受影响
    if (gs.paused) return;

    // 水体检测：脚或头在水中（飞行时忽略）
    const inWater =
      isWaterId(world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.1), Math.floor(p.z))) ||
      isWaterId(world.getBlock(Math.floor(p.x), Math.floor(p.y + EYE), Math.floor(p.z)));
    // 岩浆检测：接触即受伤，泳动比水更粘滞
    const inLava =
      isLavaId(world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.1), Math.floor(p.z))) ||
      isLavaId(world.getBlock(Math.floor(p.x), Math.floor(p.y + EYE), Math.floor(p.z)));
    const inFluid = inWater || inLava;

    // 按相机实际朝向（投影到水平面）计算移动方向。
    // 注意不能读 camera.rotation.y：rotation 是 XYZ 欧拉角分解，俯仰时 .y 不是真实偏航角
    camera.getWorldDirection(rayDir);
    const fLen = Math.hypot(rayDir.x, rayDir.z);
    if (fLen > 1e-4) {
      // 垂直看时退化，沿用上一帧的水平朝向
      forward.current.x = rayDir.x / fLen;
      forward.current.z = rayDir.z / fLen;
    }
    const fx = forward.current.x;
    const fz = forward.current.z;

    // 输入合并：键盘 + 触屏摇杆/按钮
    const space = keys.current['Space'] || touchInput.jump;
    const shift = keys.current['ShiftLeft'] || keys.current['ShiftRight'] || touchInput.down;
    const f = (keys.current['KeyW'] ? 1 : 0) - (keys.current['KeyS'] ? 1 : 0) + touchInput.moveY;
    const r = (keys.current['KeyD'] ? 1 : 0) - (keys.current['KeyA'] ? 1 : 0) + touchInput.moveX;
    // MC 潜行：地面按 Shift（水中/飞行时是下降键）；冲刺：Ctrl（MC Java 同款）。触屏对应 touchInput.sneak/sprint 切换开关
    const sneaking = (shift || touchInput.sneak) && !flying && !inFluid;
    // 冲刺：Ctrl（MC Java 同款）。饥饿 ≤6（3 格）禁止冲刺（MC 门禁）；冲刺命中后的中断期内也不冲刺
    const sprinting =
      (keys.current['ControlLeft'] || keys.current['ControlRight'] || touchInput.sprint) &&
      !sneaking && !flying && sprintBreak.current <= 0 &&
      (gs.worldMode !== 'survival' || gs.hunger > 6);
    // 前进 = (fx, fz)，右 = 前进 × up = (-fz, fx)
    let mx = fx * f - fz * r;
    let mz = fz * f + fx * r;
    const mLen = Math.hypot(mx, mz);
    const speed =
      (flying ? FLY_SPEED : inFluid ? WALK_SPEED * (inLava ? 0.4 : 0.6) : WALK_SPEED) *
      (effects.speed > 0 ? 1 + 0.2 * Math.max(effectLvls.speed, beaconTiers.get('speed') ?? 1) : 1) * // 迅捷药水 +20%/级（II 级 +40%）
      (sneaking ? 0.3 : sprinting ? 1.3 : 1) * // MC 潜行 ~30%、冲刺 ~130% 走速
      (eatState.active ? 0.3 : 1); // MC Java：进食中移动速度大减（≈潜行速度）
    // 摇杆为模拟量：mLen ≤ 1 时保留力度，超过 1（键盘对角线）才归一化
    const scale = mLen > 1 ? speed / mLen : speed;
    mx *= scale;
    mz *= scale;
    // 鞘翅滑翔（MC）：空中按住跳跃键且胸甲槽为鞘翅 → 朝视线方向推进，缓降（俯仰调制：俯视加速、仰视拉升）
    const gliding =
      !flying &&
      !onGround.current &&
      velY.current <= 0.01 &&
      space &&
      !inFluid &&
      gs.armorSlots.chestplate?.material === 'elytra';
    if (gliding) {
      const pitch = Math.atan2(rayDir.y, Math.max(fLen, 1e-4)); // 上正下负
      const glideSpeed = 10 + Math.min(Math.max(-pitch, -0.9), 0.9) * 6; // ~5 到 ~15
      mx = fx * glideSpeed;
      mz = fz * glideSpeed;
      velY.current = Math.max(velY.current - GRAVITY * 0.12 * dt, -3);
      if (pitch > 0.35) velY.current = Math.min(velY.current + 3 * dt, 0.5); // 仰视拉升
    }
    let wantX = p.x + mx * dt;
    let wantZ = p.z + mz * dt;
    // MC 潜行防跌落：着地潜行时，目标轴向前沿脚下无实体支撑则取消该轴移动
    if (sneaking && onGround.current) {
      const floorY = Math.floor(p.y) - 1;
      const hasFloor = (ex: number, ez: number): boolean =>
        BLOCKS[world.getBlock(Math.floor(ex), floorY, Math.floor(ez))]?.solid === true;
      if (mx !== 0 && !hasFloor(wantX + Math.sign(mx) * (PLAYER_HALF_W + 0.05), p.z)) wantX = p.x;
      if (mz !== 0 && !hasFloor(wantX, wantZ + Math.sign(mz) * (PLAYER_HALF_W + 0.05))) wantZ = p.z;
    }
    p.x = wantX;
    const hitX = collideAxis(world, p, 0, mx * dt, PLAYER_HALF_W, PLAYER_HEIGHT);
    p.z = wantZ;
    const hitZ = collideAxis(world, p, 2, mz * dt, PLAYER_HALF_W, PLAYER_HEIGHT);

    // 台阶辅助（设置「自动跳跃」，MC 辅助功能）：着地行走被 1 格高障碍挡住时启动 150ms 上台动画
    //（平滑升起 + 前冲，观感是快速小跳——不是瞬移闪现，也不会像起跳那样弹回）
    if (autoJump && !flying && onGround.current && !stepAnim.current && (hitX || hitZ)) {
      // 障碍格在被挡方向的下一格（不是玩家自身格——wantX/wantZ 被碰撞推回后仍在原地，查自身格恒为空导致辅助失效）
      const tryStep = (ax: number, az: number): boolean => {
        const bx = Math.floor(p.x) + ax;
        const bz = Math.floor(p.z) + az;
        const groundLevel = Math.floor(p.y + 1) - 1; // 台阶顶面所在方块层
        if (!BLOCKS[world.getBlock(bx, groundLevel, bz)]?.solid) return false;
        // 台阶顶上方需容得下玩家（天花板下不触发）
        if (!aabbFree(world, p.x + ax * 0.4, p.y + 1, p.z + az * 0.4, PLAYER_HALF_W, PLAYER_HEIGHT)) return false;
        stepAnim.current = { from: p.y, to: p.y + 1, t: 0 };
        onGround.current = false;
        return true;
      };
      if (hitX && tryStep(Math.sign(mx), 0)) {
        // stepping
      } else if (hitZ) tryStep(0, Math.sign(mz));
    }
    // 上台动画推进：150ms 平滑升到台阶顶（期间保持前冲；动画里不做重力）
    if (stepAnim.current) {
      const a = stepAnim.current;
      a.t += dt / 0.15;
      if (a.t >= 1) {
        p.y = a.to;
        stepAnim.current = null;
        velY.current = 0;
        onGround.current = true;
      } else {
        const k = a.t * a.t * (3 - 2 * a.t); // smoothstep
        p.y = a.from + (a.to - a.from) * k;
        velY.current = 0;
        onGround.current = false;
      }
    }

    // 垂直方向
    if (flying) {
      const up = (space ? 1 : 0) - (shift ? 1 : 0);
      velY.current = up * FLY_SPEED;
      onGround.current = false;
    } else if (inFluid) {
      // 游泳：弱化重力缓慢下沉，按住空格持续上浮；站在底面时可小跳上岸（岩浆里更粘）
      const visc = inLava ? 0.55 : 1;
      velY.current -= GRAVITY * 0.35 * visc * dt;
      if (space) {
        if (onGround.current) velY.current = JUMP_VEL * 0.7;
        else velY.current += GRAVITY * 1.1 * visc * dt;
      }
      velY.current = Math.min(Math.max(velY.current, -3), 4);
    } else if (stepAnim.current) {
      // 上台动画期间：y 由动画驱动，重力/跳跃不干预
      velY.current = 0;
    } else {
      if (effects.levitation > 0) {
        // 漂浮：匀速上浮（MC 潜影贝弹命中效果；期间跳跃/重力不生效）
        velY.current = 1.8;
        onGround.current = false;
      } else if (!gliding) {
        velY.current = Math.max(velY.current - GRAVITY * dt, -50);
        if (space && onGround.current) {
          velY.current = JUMP_VEL * (effects.jumpBoost > 0 ? 1 + 0.2 * (beaconTiers.get('jumpBoost') ?? 1) : 1); // 跳跃提升（信标）：I 级约 1.8 格（MC 跳跃 I），II 级更高
          onGround.current = false;
          if (gs.worldMode === 'survival') survivalStats.exhaustion += sprinting ? 0.2 : 0.05; // MC：冲刺跳 0.2/次，普通跳跃 0.05
        }
      }
    }
    const dy = velY.current * dt;
    p.y += dy;
    const hitY = collideAxis(world, p, 1, dy, PLAYER_HALF_W, PLAYER_HEIGHT);
    if (hitY) {
      if (dy < 0) {
        onGround.current = true;
        // 踩踏耕地：跳起/跌落到耕地上会踩回泥土（MC 规则），上面的作物弹出
        if (velY.current <= -7 && !flying) {
          const tx = Math.floor(p.x);
          const ty = Math.floor(p.y - 0.01);
          const tz = Math.floor(p.z);
          if (isFarmlandId(world.getBlock(tx, ty, tz))) {
            world.setBlock(tx, ty, tz, BLOCK_BY_KEY.dirt.id);
            if (isWheatCropId(world.getBlock(tx, ty + 1, tz))) {
              world.setBlock(tx, ty + 1, tz, AIR);
              if (gs.worldMode === 'survival') spawnMaterialDrop('wheat_seeds', tx + 0.5, ty + 1.4, tz + 0.5, 1);
            }
            playSound('dig_dirt');
          }
        }
      }
      velY.current = 0;
    } else if (dy !== 0) {
      onGround.current = false;
    }

    // —— 生存模式数值（掉落/溺水/消耗度/回血，逻辑在 lib/survival.ts） ——
    // 鞘翅滑翔中不累计摔落高度（MC：滑翔着陆无摔落伤害）
    if (gliding) survivalMem.current.fallDist = 0;
    const headInWater = isWaterId(
      world.getBlock(Math.floor(p.x), Math.floor(p.y + EYE), Math.floor(p.z)),
    );
    tickSurvival(
      { dt, flying, inWater, headInWater, onGround: onGround.current, velY: velY.current },
      survivalMem.current,
      { worldMode: gs.worldMode, health: gs.health, hunger: gs.hunger, saturation: gs.saturation },
      {
        damagePlayer: gs.damagePlayer,
        setHealth: gs.setHealth,
        setHunger: gs.setHunger,
        setSaturation: gs.setSaturation,
      },
    );
    survivalStats.air = survivalMem.current.air; // 镜像给 HUD 气泡条（氧气 15s，见 lib/survival.ts）

    // 岩浆灼烧：接触即掉血（4 心/秒，MC；抗火药水免疫）；离开后再烧 ~15s（着火 1 点/秒，入水熄灭）
    if (inLava && gs.worldMode === 'survival' && effects.fireRes <= 0) {
      fireAcc.current = 15;
      lavaAcc.current += dt * 8;
      const dmg = Math.floor(lavaAcc.current);
      // damagePlayer 在 500ms 受击无敌帧内返回 false：伤害被拒时不扣累计（否则 DoT 被无敌帧吞掉，实际 DPS 减半）
      if (dmg > 0 && gs.damagePlayer(dmg)) {
        lavaAcc.current -= dmg;
      }
    } else {
      lavaAcc.current = 0;
      if (inWater || gs.worldMode !== 'survival' || effects.fireRes > 0) {
        fireAcc.current = 0;
        fireDmgAcc.current = 0;
      } else if (fireAcc.current > 0) {
        fireAcc.current -= dt;
        fireDmgAcc.current += dt;
        const fd = Math.floor(fireDmgAcc.current);
        if (fd > 0 && gs.damagePlayer(fd)) fireDmgAcc.current -= fd;
      }
    }
    // 虚空伤害（y < -20）：MC Java 每次受击 4 点、约 0.5s 一击（damagePlayer 的 HURT_COOLDOWN 无敌帧自然节流，等效 ~8/s），
    // bypassArmor 不吃护甲。死亡走正常死亡流程（掉落 + 死亡界面），不再传送回重生点
    if (p.y < -20 && !gs.dead) {
      voidAcc.current += dt * 8;
      const vd = Math.floor(voidAcc.current);
      if (vd > 0) {
        if (gs.worldMode === 'creative') {
          // MC Java：虚空伤害创造模式同样致死——damagePlayer 对创造直接豁免（return false），虚空路径在此绕过该门禁（Java 语义），
          // 借 hurtState 同款 500ms 无敌帧节流；创造死亡不掉落（MC：创造无背包惩罚），只进死亡界面
          const now = performance.now();
          if (now - hurtState.lastAt >= 500) {
            hurtState.lastAt = now;
            voidAcc.current -= vd;
            const health = Math.max(0, gs.health - vd);
            gs.setHealth(health);
            if (health <= 0) gs.setDead(true);
          }
        } else if (gs.damagePlayer(vd, { bypassArmor: true })) {
          voidAcc.current -= vd;
        }
      }
    } else {
      voidAcc.current = 0;
    }
    // 药水效果计时（创造模式也递减，MC 一致）
    tickEffects(dt);
    // 进食读条推进（MC Java 按住右键 1.61s；取消/结算逻辑在 lib/actions.ts）
    tickEating(dt);
    // 信标：校验金字塔并给范围内玩家刷新所选效果（MC）
    tickBeacons(world, p.x, p.y, p.z);
    // 末影水晶：龙在存活水晶附近时缓慢回血（MC 治疗光束）
    tickCrystals(mobs.find((m) => m.type === 'ender_dragon') ?? null, dt);
    // 钓鱼浮标：飞行/漂浮/咬钩推进
    tickFishing(world, dt);
    // 末影人对视激怒：准星盯上末影人即激怒（MC 规则，每秒检查一次）
    stareAcc.current += dt;
    if (stareAcc.current >= 1) {
      stareAcc.current = 0;
      const cam = cameraRef.current;
      if (cam) {
        const d = new Vector3();
        cam.getWorldDirection(d);
        checkEndermanStare(world, cam.position.x, cam.position.y, cam.position.z, d.x, d.y, d.z);
      }
    }

    // 打回的恶魂爆裂球：接近恶魂即秒杀（MC：反射火球对恶魂 1000 伤害）。
    // mobs 的通用玩家弹射物命中只有 9 伤且判定盒 0.55（恶魂 MC 体型 4×4×4），这里按体型放宽提前结算
    for (let i = arrows.length - 1; i >= 0; i--) {
      const a = arrows[i];
      if (a.kind !== 'ghast' || !a.fromPlayer) continue;
      const ghast = mobs.find((m) => m.type === 'ghast' && Math.hypot(m.x - a.x, m.y + 1.5 - a.y, m.z - a.z) < 3);
      if (ghast) {
        damageMob(ghast, 1000, playerPosition, 0, world);
        arrows.splice(i, 1);
      }
    }

    // 脚步声：着地行走时按实际位移触发（顶墙走不响）
    const hDist = Math.hypot(p.x - prevStep.current.x, p.z - prevStep.current.z);
    prevStep.current = { x: p.x, z: p.z };
    // MC 消耗度：步行不消耗（MC Java），冲刺 0.1/格，游泳 0.01/格
    if (gs.worldMode === 'survival') {
      survivalStats.exhaustion += hDist * (inFluid ? 0.01 : sprinting ? 0.1 : 0);
    }
    if (!flying && !inFluid && onGround.current && hDist > 0.001) {
      stepAcc.current += hDist;
      if (stepAcc.current >= 2.2) {
        stepAcc.current = 0;
        const stepSound =
          BLOCKS[world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.01), Math.floor(p.z))]?.stepSound;
        if (stepSound) playSound(stepSound, 0.9);
      }
    } else {
      stepAcc.current = 0;
    }

    // 掉出世界底部不再传送回重生点：由上方虚空伤害致死（MC Java），死亡走正常死亡流程

    // 下界传送门：MC Java 生存站门内 4 秒（80 tick）触发跨维度传送，创造模式进立传（无读秒）
    {
      const feet = world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      const eye = world.getBlock(Math.floor(p.x), Math.floor(p.y) + 1, Math.floor(p.z));
      // 折跃门：末地内接触即传送到外岛（MC；判定优先于返回门——折跃门中心也是 end_portal 方块）
      if (gs.dimension === 'end' && gatewayState.active) {
        const gd = Math.hypot(p.x - gatewayState.x, p.y + 0.5 - gatewayState.y, p.z - gatewayState.z);
        if (gd < 1.4) {
          const isle = pickOuterIsland(world.seedHash);
          if (isle) {
            p.x = isle.x + 0.5;
            p.y = outerHeightAt(world.seedHash, isle.x, isle.z) + 1;
            p.z = isle.z + 0.5;
            velY.current = 0;
            survivalMem.current.fallDist = 0;
            prevStep.current = { x: p.x, z: p.z };
            return;
          }
        }
      }
      // 末地传送门：接触即传送（MC 即时，无读秒）；主世界→末地落固定出生平台，末地→主世界回维度暂存位（MC 返回门）
      if (feet === BLOCK_BY_KEY.end_portal.id || eye === BLOCK_BY_KEY.end_portal.id) {
        if (gs.dimension === 'end') {
          teleportState.pending = { x: p.x, y: p.y, z: p.z, fromEnd: true };
          gs.setDimension('overworld');
        } else {
          teleportState.pending = { ...END_SPAWN };
          gs.setDimension('end');
        }
        return;
      }
      if (isPortalId(feet) || isPortalId(eye)) {
        portalAcc.current += dt;
        if (gs.worldMode === 'creative' || portalAcc.current >= 4) { // MC：生存读秒 4s（80 tick），创造秒传
          portalAcc.current = 0;
          teleportState.pending = { x: p.x, y: p.y, z: p.z };
          gs.setDimension(otherDimension(gs.dimension));
          return;
        }
      } else {
        portalAcc.current = 0;
      }
    }

    // 末影珍珠落点传送（mobs 命中写入，本帧消费）
    if (pearlTeleport.pending) {
      pos.current = { ...pearlTeleport.pending };
      pearlTeleport.pending = null;
      velY.current = 0;
      prevStep.current = { x: pos.current.x, z: pos.current.z };
    }

    state.camera.position.set(p.x, p.y + (sneaking ? EYE - 0.12 : EYE), p.z); // MC 潜行视点略降
    playerPosition.x = p.x;
    playerPosition.y = p.y;
    playerPosition.z = p.z;

    // 每帧一次的准星射线（rayDir 上面已算好），高亮/预览/挖掘共用
    targetBlock.hit = raycastBlock(
      world,
      camera.position.x, camera.position.y, camera.position.z,
      rayDir.x, rayDir.y, rayDir.z,
      REACH,
    );

    // 长按/点按：优先攻击准星附近的生物（MC 1.9 攻击冷却），否则挖掘方块
    attackCd.current = Math.max(0, attackCd.current - dt);
    sprintBreak.current = Math.max(0, sprintBreak.current - dt);
    // 蓄力进度 → Hud 准星下方蓄力条（1 = 冷却走满，满时隐藏）
    attackState.progress = attackCd.current <= 0 ? 1 : Math.min(1, 1 - attackCd.current / attackCdTotal.current);
    const digNow = digHeld.current || touchInput.dig;
    // MC 1.9：冷却走满（含按住连发）满额出手；冷却未满时点按仍可出手，但伤害按冷却进度缩放
    const clickEdge = digNow && !digWasHeld.current;
    digWasHeld.current = digNow;
    if (digNow) {
      let attacked = false;
      // 近战攻击：创造模式也可（MC 创造左键可杀怪；伤害按手持，创造徒手 1 点，不耗耐久——damageHeldTool 创造已豁免）
      if (attackCd.current <= 0 || clickEdge) {
        // 恶魂爆裂球：挥击打回（MC 标志玩法）——沿视线掉头反飞，命中恶魂即秒杀（结算见下方每帧检查）
        const fb = fireballInReach(
          camera.position.x, camera.position.y, camera.position.z,
          rayDir.x, rayDir.y, rayDir.z,
          REACH,
        );
        if (fb) {
          attackCd.current = 0.25;
          attackCdTotal.current = 0.25;
          const sp = Math.hypot(fb.vx, fb.vy, fb.vz); // 保持原速，掉头飞向视线方向（MC 反射球）
          fb.vx = rayDir.x * sp;
          fb.vy = rayDir.y * sp;
          fb.vz = rayDir.z * sp;
          fb.age = 0; // 重置寿命，保证能飞回远处恶魂
          fb.fromPlayer = true; // 视为玩家弹射物：不再伤玩家、可命中生物（tickArrows 规则）
          playSound('dig_choppy', 0.8);
          survivalStats.exhaustion += 0.1; // MC：攻击消耗
          attacked = true;
        } else {
        const mob = mobInReach(
          world,
          camera.position.x, camera.position.y, camera.position.z,
          rayDir.x, rayDir.y, rayDir.z,
          REACH,
        );
        if (mob) {
          const held = gs.hotbarSlots[gs.selectedSlot];
          const tool = held?.kind === 'tool' ? TOOLS[held.tool] : null;
          const T = tool?.attackCd ?? 0.25; // 总冷却 = 1/攻速（MC 拳头 4，剑 1.6，斧 0.8-1.0）
          const fullCharge = attackCd.current <= 0; // 冷却全满（横扫判定用，须在重置冷却前捕获）
          // MC 1.9 冷却伤害缩放：0.2 + ((t+0.5)/T)²×0.8（t=冷却已走过时间；走满=1 满额）
          const cdScale = fullCharge ? 1 : attackCooldownScale(T - attackCd.current, T);
          attackCd.current = T;
          attackCdTotal.current = T;
          // MC 暴击：下落中（velY<0、不着地、非水中/飞行/滑翔）命中伤害 ×1.5
          const crit = velY.current < 0 && !onGround.current && !inFluid && !flying && !gliding;
          // 击退：MC 近战命中本就有基础击退（怪会后退），击退附魔在此之上增强；原仅附魔才击退导致普通攻击打不动怪
          const kbEnch = held?.kind === 'tool' ? (held.ench?.knockback ?? 0) : 0;
          // MC 冲刺击退：冲刺中命中击退加成（约 3 格量级，≈ MC 击退 I），命中后中断冲刺
          let kb = kbEnch > 0 ? kbEnch : 0.3;
          if (sprinting) {
            kb += 0.5;
            sprintBreak.current = 0.3;
          }
          const baseDmg = (tool?.attackDamage ?? 1) + (held?.kind === 'tool' ? ((held.ench?.sharpness ?? 0) * 0.5 + ((held.ench?.sharpness ?? 0) > 0 ? 0.5 : 0)) : 0) + (effects.strength > 0 ? 3 * Math.max(effectLvls.strength, beaconTiers.get('strength') ?? 1) : 0); // 拳头 1 点（半心），锋利 +0.5×级+0.5（MC Java），力量药水 +3/级（MC）
          damageMob(mob, baseDmg * cdScale * (crit ? 1.5 : 1), playerPosition, held?.kind === 'tool' ? (held.ench?.looting ?? 0) : 0, world, kb); // 抢夺加掉落
          // MC Java 横扫攻击：剑 + 冷却全满 + 非冲刺命中时，主目标周围 1 格内其他敌对生物各受 1 点横扫伤害
          if (tool?.kind === 'sword' && fullCharge && !sprinting) sweepAround(mob, playerPosition, world);
          if (tool) gs.damageHeldTool(tool.kind === 'sword' ? 1 : 2); // MC：剑耗 1，工具作武器耗 2
          playSound('dig_choppy', 0.8);
          survivalStats.exhaustion += 0.1; // MC：攻击消耗
          attacked = true;
        } else {
          // 末影水晶：准星指向且 reach 内 → 击爆（MC 近战可击毁）
          const c = crystalInReach(camera.position, rayDir, REACH);
          if (c) {
            attackCd.current = 0.25;
            attackCdTotal.current = 0.25;
            hitCrystal(c, world, playerPosition, (d) => {
              if (!gs.dead) gs.damagePlayer(d);
            });
            attacked = true;
          }
        }
        }
      }
      if (attacked) {
        digState.target = null;
        digState.progress = 0;
      } else {
        const hit = targetBlock.hit;
        if (hit) {
          const [bx, by, bz] = hit.block;
          const t = digState.target;
          if (!t || t[0] !== bx || t[1] !== by || t[2] !== bz) {
            digState.target = [bx, by, bz];
            digState.progress = 0;
          }
          const blockId = world.getBlock(bx, by, bz);
          if (BLOCKS[blockId]?.unbreakable) {
            // 基岩/强化深板岩：不可破坏（MC 规则），不显示裂纹进度
            digState.target = null;
            digState.progress = 0;
          } else if (gs.worldMode === 'creative') {
            // 创造模式：即时破坏（MC 一致），无挖掘计时；200ms 冷却避免按住左键 60 块/秒（触屏连点同路径生效）
            const now = performance.now();
            if (now - lastCreativeBreak.current >= 200) {
              lastCreativeBreak.current = now;
              breakBlock(world, bx, by, bz);
            }
            digState.target = null;
            digState.progress = 0;
          } else {
            // MC 挖掘时间：工具匹配且采掘层级达标时切硬度×1.5 基值（需镐方块 = digTime×0.3）再除工具速度；
            // 效率附魔仅匹配生效，水中/悬空（onGround=false）各 ×5 慢（lib/dig.ts）
            const held = gs.hotbarSlots[gs.selectedSlot];
            digState.progress += dt / effectiveDigTime(blockId, held, effects.haste > 0 ? (beaconTiers.get('haste') ?? 1) : 0, headInWater, onGround.current);
            if (digState.progress >= 1) {
              breakBlock(world, bx, by, bz);
              if (gs.worldMode === 'survival') {
                survivalStats.exhaustion += 0.005; // MC：挖掘消耗
                if (held?.kind === 'tool') gs.damageHeldTool(1); // MC：挖掘耗 1 点耐久
              }
              digState.target = null;
              digState.progress = 0;
            }
          }
        } else {
          digState.target = null;
          digState.progress = 0;
        }
      }
    } else if (digState.target) {
      digState.target = null;
      digState.progress = 0;
    }

    // F3 调试数据
    debugInfo.fps = debugInfo.fps * 0.9 + (1 / Math.max(delta, 1e-4)) * 0.1;
    debugInfo.x = p.x;
    debugInfo.y = p.y;
    debugInfo.z = p.z;
    debugInfo.yaw = ((Math.atan2(-fx, -fz) * 180) / Math.PI + 360) % 360;
  });

  // 触屏模式不启用指针锁；桌面鼠标视角由上面的 mousemove 监听维护（组件本身只挂 effect，无渲染输出）
  return null;
}
