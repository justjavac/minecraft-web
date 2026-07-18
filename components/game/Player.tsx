'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';
import { Euler, PerspectiveCamera, Vector3 } from 'three';
import { BLOCKS, WATER } from '@/lib/blocks';
import { breakBlock, tryPlace } from '@/lib/actions';
import { cameraRef, debugInfo, digState, getActiveWorld, playerPosition, survivalStats, targetBlock, touchInput } from '@/lib/game';
import { raycastBlock } from '@/lib/raycast';
import { damageMob, mobInReach } from '@/lib/mobs';
import { SEA_LEVEL } from '@/lib/noise';
import { aabbFree, collideAxis, type Aabb } from '@/lib/physics';
import { playSound } from '@/lib/sound';
import { useGameStore } from '@/lib/store';
import { resetSurvivalMem, tickSurvival, type SurvivalMem } from '@/lib/survival';
import { TOOLS } from '@/lib/tools';
import { WORLD_HEIGHT, type World } from '@/lib/world';

const HALF_W = 0.3; // 玩家半宽
const HEIGHT = 1.8; // 玩家高度
const EYE = 1.62; // 视点高度
const WALK_SPEED = 4.3;
const FLY_SPEED = 11;
const JUMP_VEL = 9;
const GRAVITY = 26;
const REACH = 6; // 挖掘/放置距离
const LOOK_SENSITIVITY = 0.0045; // 触屏视角灵敏度（弧度/像素）
const SPAWN = { x: 8.5, z: 8.5 };

/**
 * 出生点脚部高度：从地表向上找到能容纳玩家的连续 2 格非实心方块。
 * heightAt 不含树木/玩家放置的方块，直接用它可能卡进树干。
 */
function findSpawnY(world: World): number {
  const bx = Math.floor(SPAWN.x);
  const bz = Math.floor(SPAWN.z);
  let y = Math.max(world.terrain.heightAt(bx, bz), SEA_LEVEL) + 1;
  while (
    y < WORLD_HEIGHT - 2 &&
    (BLOCKS[world.getBlock(bx, y, bz)]?.solid || BLOCKS[world.getBlock(bx, y + 1, bz)]?.solid)
  ) {
    y++;
  }
  return y;
}

export function Player() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const touchMode = useGameStore((s) => s.touchMode);
  const fov = useGameStore((s) => s.settings.fov);
  const sensitivity = useGameStore((s) => s.settings.sensitivity);
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
  /** 触屏模式的相机角度（桌面由 PointerLockControls 维护） */
  const yawPitch = useRef({ yaw: 0, pitch: 0 });
  /** 脚步声：累计水平位移，每 2.2 格一步 */
  const stepAcc = useRef(0);
  const prevStep = useRef({ x: 0, z: 0 });
  /** 已应用到相机的 FOV，变化时在帧循环里同步 */
  const appliedFov = useRef(0);
  /** 生存：下落/憋气/回血计时（逻辑在 lib/survival.ts） / 攻击冷却 / 死亡边沿 */
  const survivalMem = useRef<SurvivalMem>({ fallDist: 0, air: 15, regenTick: 0 });
  const attackCd = useRef(0);
  const wasDead = useRef(false);

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
      keys.current[e.code] = true;
      if (e.repeat) return;
      if (e.code === 'KeyF') useGameStore.getState().toggleFly();
      if (e.code === 'KeyE') {
        const s = useGameStore.getState();
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
      }
    };
    document.addEventListener('pointerlockchange', onLockChange);
    onLockChange();
    return () => document.removeEventListener('pointerlockchange', onLockChange);
  }, [gl, touchMode]);

  // 鼠标：左键按住挖掘，右键放置（触屏走 TouchControls）
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (document.pointerLockElement !== gl.domElement) return;
      if (e.button === 0) digHeld.current = true;
      else if (e.button === 2) tryPlace();
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) digHeld.current = false;
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

    // FOV 设置变化时同步到相机
    if (appliedFov.current !== fov) {
      appliedFov.current = fov;
      const cam = state.camera as PerspectiveCamera;
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    // 触屏：用拖动增量驱动相机偏航/俯仰
    if (touchMode) {
      const yp = yawPitch.current;
      yp.yaw -= touchInput.lookDX * LOOK_SENSITIVITY * sensitivity;
      yp.pitch = Math.min(
        Math.max(yp.pitch - touchInput.lookDY * LOOK_SENSITIVITY * sensitivity, -Math.PI / 2 + 0.01),
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
        : { x: SPAWN.x, y: findSpawnY(world), z: SPAWN.z };
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

    // 重生传送（dead → alive 边沿）：回出生点并重置生存状态
    if (wasDead.current && !gs.dead) {
      const sp = gs.spawnPoint;
      p.x = sp?.x ?? SPAWN.x;
      p.z = sp?.z ?? SPAWN.z;
      p.y = sp?.y ?? findSpawnY(world);
      velY.current = 0;
      resetSurvivalMem(survivalMem.current);
      survivalStats.exhaustion = 0;
      prevStep.current = { x: p.x, z: p.z };
    }
    wasDead.current = gs.dead;
    // 死亡：冻结等待重生界面操作
    if (gs.dead) return;
    // Esc 暂停（指针解锁）：物理/挖掘/生存 tick 全部冻结；触屏 paused 恒 false 不受影响
    if (gs.paused) return;

    // 水体检测：脚或头在水中（飞行时忽略）
    const inWater =
      world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.1), Math.floor(p.z)) === WATER ||
      world.getBlock(Math.floor(p.x), Math.floor(p.y + EYE), Math.floor(p.z)) === WATER;

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
    // 前进 = (fx, fz)，右 = 前进 × up = (-fz, fx)
    let mx = fx * f - fz * r;
    let mz = fz * f + fx * r;
    const mLen = Math.hypot(mx, mz);
    const speed = flying ? FLY_SPEED : inWater ? WALK_SPEED * 0.6 : WALK_SPEED;
    // 摇杆为模拟量：mLen ≤ 1 时保留力度，超过 1（键盘对角线）才归一化
    const scale = mLen > 1 ? speed / mLen : speed;
    mx *= scale;
    mz *= scale;
    const wantX = p.x + mx * dt;
    const wantZ = p.z + mz * dt;
    p.x = wantX;
    const hitX = collideAxis(world, p, 0, mx * dt, HALF_W, HEIGHT);
    p.z = wantZ;
    const hitZ = collideAxis(world, p, 2, mz * dt, HALF_W, HEIGHT);

    // 台阶辅助：着地行走被 1 格高障碍挡住时自动抬上去（天花板下不触发）
    if ((hitX || hitZ) && !flying && onGround.current) {
      const stepY = p.y + 1;
      const groundLevel = Math.floor(stepY) - 1; // 台阶顶面所在方块层
      const groundSolid = BLOCKS[world.getBlock(Math.floor(wantX), groundLevel, Math.floor(wantZ))]?.solid;
      if (groundSolid && aabbFree(world, wantX, stepY, wantZ, HALF_W, HEIGHT)) {
        p.x = wantX;
        p.z = wantZ;
        p.y = stepY;
        velY.current = 0;
        onGround.current = true;
      }
    }

    // 垂直方向
    if (flying) {
      const up = (space ? 1 : 0) - (shift ? 1 : 0);
      velY.current = up * FLY_SPEED;
      onGround.current = false;
    } else if (inWater) {
      // 游泳：弱化重力缓慢下沉，按住空格持续上浮；站在水底时可小跳上岸
      velY.current -= GRAVITY * 0.35 * dt;
      if (space) {
        if (onGround.current) velY.current = JUMP_VEL * 0.7;
        else velY.current += GRAVITY * 1.1 * dt;
      }
      velY.current = Math.min(Math.max(velY.current, -3), 4);
    } else {
      velY.current = Math.max(velY.current - GRAVITY * dt, -50);
      if (space && onGround.current) {
        velY.current = JUMP_VEL;
        onGround.current = false;
        if (gs.worldMode === 'survival') survivalStats.exhaustion += 0.05; // MC：跳跃消耗
      }
    }
    const dy = velY.current * dt;
    p.y += dy;
    const hitY = collideAxis(world, p, 1, dy, HALF_W, HEIGHT);
    if (hitY) {
      if (dy < 0) onGround.current = true;
      velY.current = 0;
    } else if (dy !== 0) {
      onGround.current = false;
    }

    // —— 生存模式数值（掉落/溺水/消耗度/回血，逻辑在 lib/survival.ts） ——
    const headInWater =
      world.getBlock(Math.floor(p.x), Math.floor(p.y + EYE), Math.floor(p.z)) === WATER;
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

    // 脚步声：着地行走时按实际位移触发（顶墙走不响）
    const hDist = Math.hypot(p.x - prevStep.current.x, p.z - prevStep.current.z);
    prevStep.current = { x: p.x, z: p.z };
    // MC 消耗度：步行 0.01/格，游泳 0.015/格
    if (gs.worldMode === 'survival') {
      survivalStats.exhaustion += hDist * (inWater ? 0.015 : 0.01);
    }
    if (!flying && !inWater && onGround.current && hDist > 0.001) {
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

    // 掉出世界 → 回出生点
    if (p.y < -20) {
      const sp = useGameStore.getState().spawnPoint;
      p.x = sp?.x ?? SPAWN.x;
      p.z = sp?.z ?? SPAWN.z;
      p.y = sp?.y ?? findSpawnY(world);
      velY.current = 0;
      survivalMem.current.fallDist = 0; // 重置坠落累计，避免传送后按累计落差结算摔伤
      survivalMem.current.air = 15;
      prevStep.current = { x: p.x, z: p.z }; // 重置脚步位移，避免传送后误响
    }

    state.camera.position.set(p.x, p.y + EYE, p.z);
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

    // 长按：生存模式优先攻击准星附近的僵尸（有冷却），否则挖掘方块
    attackCd.current = Math.max(0, attackCd.current - dt);
    if (digHeld.current || touchInput.dig) {
      let attacked = false;
      if (gs.worldMode === 'survival' && attackCd.current <= 0) {
        const mob = mobInReach(
          world,
          camera.position.x, camera.position.y, camera.position.z,
          rayDir.x, rayDir.y, rayDir.z,
          REACH,
        );
        if (mob) {
          const held = gs.hotbarSlots[gs.selectedSlot];
          const tool = held?.kind === 'tool' ? TOOLS[held.tool] : null;
          attackCd.current = tool?.attackCd ?? 0.25; // MC 拳头 4 攻速，剑 1.6
          damageMob(mob, tool?.attackDamage ?? 1, playerPosition); // 拳头 1 点（半心）
          if (tool) gs.damageHeldTool(tool.kind === 'sword' ? 1 : 2); // MC：剑耗 1，工具作武器耗 2
          playSound('dig_choppy', 0.8);
          survivalStats.exhaustion += 0.1; // MC：攻击消耗
          attacked = true;
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
            // 基岩/强化深板岩：生存不可破坏（MC 规则），不显示裂纹进度
            digState.target = null;
            digState.progress = 0;
          } else {
            const digTime = BLOCKS[blockId]?.digTime ?? 1;
            // 持有对应工具时按倍率加速（MC：木 2x 石 4x）
            const held = gs.hotbarSlots[gs.selectedSlot];
            let speedMul = 1;
            if (held?.kind === 'tool') {
              const def = TOOLS[held.tool];
              if (def.kind !== 'sword' && BLOCKS[blockId]?.tool === def.kind) {
                speedMul = def.speed;
              }
            }
            digState.progress += (dt * speedMul) / digTime;
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

  // 触屏模式不启用指针锁，相机由上面的拖动逻辑维护
  return touchMode ? null : <PointerLockControls makeDefault pointerSpeed={sensitivity} />;
}
