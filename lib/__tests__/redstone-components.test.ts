// 红石元件：按钮脉冲（石 1s/木 1.5s）、压力板检测、侦测器脉冲、音符盒发声、标靶脉冲

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../sound', () => ({
  noteBlock: vi.fn(),
  noteFreq: (n: number) => 261.63 * Math.pow(2, n / 12),
  boom: vi.fn(),
  playSound: vi.fn(),
  preloadSounds: vi.fn(),
}));

import { AIR, BLOCK_BY_KEY, BLOCKS, STONE } from '../blocks';
import { playerPosition } from '../game';
import { clearMobs, mobs, type Mob } from '../mobs';
import { VOID_TERRAIN } from '../noise';
import {
  clearRedstone,
  dustPowerAt,
  notePitchAt,
  observerIdFor,
  pressButton,
  strikeTarget,
  tickRedstone,
  toggleLever,
  tuneNoteBlock,
} from '../redstone';
import { noteBlock } from '../sound';
import { World } from '../world';

const K = (k: string) => BLOCK_BY_KEY[k].id;
const mockNote = vi.mocked(noteBlock);

function setup(): World {
  clearRedstone();
  clearMobs();
  playerPosition.x = 0.5;
  playerPosition.y = 60;
  playerPosition.z = 0.5; // 默认远离测试区域
  return new World('rs-comp-test', undefined, VOID_TERRAIN);
}

beforeEach(() => {
  clearRedstone();
  clearMobs();
  mockNote.mockClear();
  playerPosition.x = 0.5;
  playerPosition.y = 60;
  playerPosition.z = 0.5;
});

describe('按钮', () => {
  it('石头按钮：按下供电 1s 后回弹（MC）', () => {
    const w = setup();
    w.setBlock(4, 30, 4, STONE);
    w.setBlock(4, 31, 4, K('stone_button'));
    w.setBlock(5, 30, 4, STONE);
    w.setBlock(5, 31, 4, K('redstone_dust'));
    expect(pressButton(w, 4, 31, 4)).toBe(true);
    expect(w.getBlock(4, 31, 4)).toBe(K('stone_button_on'));
    expect(dustPowerAt(5, 31, 4)).toBe(15);
    tickRedstone(w, 0.9); // 未到 1s
    expect(w.getBlock(4, 31, 4)).toBe(K('stone_button_on'));
    tickRedstone(w, 0.2); // 过 1s → 回弹断供
    expect(w.getBlock(4, 31, 4)).toBe(K('stone_button'));
    expect(dustPowerAt(5, 31, 4)).toBe(0);
  });

  it('橡木按钮：脉冲 1.5s（MC 木质更长）；已按下时重复按无效', () => {
    const w = setup();
    w.setBlock(4, 30, 4, STONE);
    w.setBlock(4, 31, 4, K('oak_button'));
    w.setBlock(5, 30, 4, STONE);
    w.setBlock(5, 31, 4, K('redstone_dust'));
    pressButton(w, 4, 31, 4);
    expect(pressButton(w, 4, 31, 4)).toBe(false); // 已按下：MC 按住不重复触发
    tickRedstone(w, 1.0);
    expect(w.getBlock(4, 31, 4)).toBe(K('oak_button_on')); // 1s 时木按钮仍在
    tickRedstone(w, 0.4);
    expect(w.getBlock(4, 31, 4)).toBe(K('oak_button_on')); // 1.4s 仍未到
    tickRedstone(w, 0.2); // 1.6s → 回弹
    expect(w.getBlock(4, 31, 4)).toBe(K('oak_button'));
    expect(dustPowerAt(5, 31, 4)).toBe(0);
  });

  it('按钮弱充能支撑块：隔着石块点灯（灯不贴着按钮）', () => {
    const w = setup();
    w.setBlock(4, 30, 4, STONE);
    w.setBlock(4, 31, 4, K('oak_button'));
    w.setBlock(3, 30, 4, K('redstone_lamp')); // 贴着石块，距按钮两格
    pressButton(w, 4, 31, 4);
    expect(w.getBlock(3, 30, 4)).toBe(K('redstone_lamp_lit'));
  });

  it('非按钮方块 pressButton 返回 false', () => {
    const w = setup();
    w.setBlock(4, 30, 4, STONE);
    expect(pressButton(w, 4, 30, 4)).toBe(false);
  });
});

describe('压力板', () => {
  it('玩家踩上供电（15 级），离开断供', () => {
    const w = setup();
    w.setBlock(4, 30, 4, STONE);
    w.setBlock(4, 31, 4, K('oak_pressure_plate'));
    w.setBlock(5, 30, 4, STONE);
    w.setBlock(5, 31, 4, K('redstone_dust'));
    tickRedstone(w, 0.1); // 玩家远离
    expect(dustPowerAt(5, 31, 4)).toBe(0);
    playerPosition.x = 4.5;
    playerPosition.y = 31;
    playerPosition.z = 4.5; // 站上板（脚踩进板格）
    tickRedstone(w, 0.1);
    expect(dustPowerAt(5, 31, 4)).toBe(15);
    playerPosition.x = 0.5;
    playerPosition.y = 60;
    playerPosition.z = 0.5; // 离开
    tickRedstone(w, 0.1);
    expect(dustPowerAt(5, 31, 4)).toBe(0);
  });

  it('生物也能踩动石头压力板（MC：木/石板都响应生物）', () => {
    const w = setup();
    w.setBlock(4, 30, 4, STONE);
    w.setBlock(4, 31, 4, K('stone_pressure_plate'));
    w.setBlock(5, 30, 4, STONE);
    w.setBlock(5, 31, 4, K('redstone_dust'));
    mobs.push({ x: 4.5, y: 31, z: 4.5 } as unknown as Mob);
    tickRedstone(w, 0.1);
    expect(dustPowerAt(5, 31, 4)).toBe(15);
    clearMobs();
    tickRedstone(w, 0.1);
    expect(dustPowerAt(5, 31, 4)).toBe(0);
  });

  it('压力板弱充能下方块：隔着石块点灯（MC）', () => {
    const w = setup();
    w.setBlock(4, 30, 4, STONE);
    w.setBlock(4, 31, 4, K('stone_pressure_plate'));
    w.setBlock(3, 30, 4, K('redstone_lamp')); // 贴着石块，不贴着板
    playerPosition.x = 4.5;
    playerPosition.y = 31;
    playerPosition.z = 4.5;
    tickRedstone(w, 0.1);
    expect(w.getBlock(3, 30, 4)).toBe(K('redstone_lamp_lit'));
    playerPosition.x = 0.5;
    playerPosition.y = 60;
    playerPosition.z = 0.5;
    tickRedstone(w, 0.1);
    expect(w.getBlock(3, 30, 4)).toBe(K('redstone_lamp'));
  });
});

describe('侦测器', () => {
  it('面朝格方块变化 → 背面输出约 0.1s 定向脉冲（MC）；放置不触发', () => {
    const w = setup();
    w.setBlock(4, 31, 4, K('observer_n')); // 检测 -z（面朝 (4,31,3)），输出 +z
    w.setBlock(4, 30, 5, STONE);
    w.setBlock(4, 31, 5, K('redstone_dust')); // 背面输出端
    w.setBlock(5, 30, 4, STONE);
    w.setBlock(5, 31, 4, K('redstone_dust')); // 侧向（不应带电）
    tickRedstone(w, 0.1);
    expect(dustPowerAt(4, 31, 5)).toBe(0); // 放置/加载不触发（MC Java）
    w.setBlock(4, 31, 3, STONE); // 面朝格变化
    tickRedstone(w, 0.1); // tick 比对触发
    expect(dustPowerAt(4, 31, 5)).toBe(15); // 背面输出 15
    expect(dustPowerAt(5, 31, 4)).toBe(0); // 定向：侧向不带电
    tickRedstone(w, 0.1); // 0.1s 脉冲到期
    expect(dustPowerAt(4, 31, 5)).toBe(0);
  });

  it('无变化不触发；再次变化再次触发；被挖后不再触发', () => {
    const w = setup();
    w.setBlock(4, 31, 4, K('observer_n'));
    w.setBlock(4, 30, 5, STONE);
    w.setBlock(4, 31, 5, K('redstone_dust'));
    tickRedstone(w, 0.1);
    tickRedstone(w, 0.1);
    expect(dustPowerAt(4, 31, 5)).toBe(0); // 无变化不触发
    w.setBlock(4, 31, 3, STONE);
    tickRedstone(w, 0.1);
    expect(dustPowerAt(4, 31, 5)).toBe(15);
    tickRedstone(w, 0.1);
    expect(dustPowerAt(4, 31, 5)).toBe(0);
    w.setBlock(4, 31, 3, K('dirt')); // 再次变化（不同方块 id）
    tickRedstone(w, 0.1);
    expect(dustPowerAt(4, 31, 5)).toBe(15); // 再次触发
    tickRedstone(w, 0.1);
    w.setBlock(4, 31, 4, AIR); // 挖掉侦测器
    w.setBlock(4, 31, 3, STONE);
    tickRedstone(w, 0.1);
    expect(dustPowerAt(4, 31, 5)).toBe(0);
  });

  it('observerIdFor 覆盖 6 朝向且 facing 与活塞一致', () => {
    for (let f = 0; f <= 5; f++) {
      expect(BLOCKS[observerIdFor(f)].facing).toBe(f);
    }
    expect(observerIdFor(0)).toBe(K('observer_n'));
    expect(observerIdFor(4)).toBe(K('observer_u'));
  });
});

describe('音符盒', () => {
  it('充能上升沿发声一次；持续供电不重复；断供后再供重新发声', () => {
    const w = setup();
    w.setBlock(4, 31, 4, K('note_block'));
    w.setBlock(3, 31, 4, K('lever'));
    toggleLever(w, 3, 31, 4); // 开：上升沿
    expect(mockNote).toHaveBeenCalledTimes(1);
    expect(mockNote).toHaveBeenCalledWith(0); // 默认 0 = C4
    w.setBlock(5, 30, 4, STONE); // 附近变动触发重算，仍供电：不重复发声
    w.setBlock(5, 31, 4, K('redstone_dust'));
    expect(mockNote).toHaveBeenCalledTimes(1);
    toggleLever(w, 3, 31, 4); // 关
    toggleLever(w, 3, 31, 4); // 再开：新的上升沿
    expect(mockNote).toHaveBeenCalledTimes(2);
  });

  it('右击调音：升半音、24 半音循环（MC），充能后按新音高发声', () => {
    const w = setup();
    w.setBlock(4, 31, 4, K('note_block'));
    expect(tuneNoteBlock(4, 31, 4)).toBe(1);
    expect(notePitchAt(4, 31, 4)).toBe(1);
    expect(mockNote).toHaveBeenLastCalledWith(1); // 调音即试听
    for (let i = 0; i < 23; i++) tuneNoteBlock(4, 31, 4);
    expect(notePitchAt(4, 31, 4)).toBe(0); // 24 半音循环回 C4
    for (let i = 0; i < 5; i++) tuneNoteBlock(4, 31, 4);
    w.setBlock(3, 31, 4, K('lever'));
    toggleLever(w, 3, 31, 4);
    expect(mockNote).toHaveBeenLastCalledWith(5); // 按调后音高发声
  });
});

describe('标靶', () => {
  it('命中发 1s 全向 15 脉冲；重复命中刷新时长（MC 简化满级）', () => {
    const w = setup();
    w.setBlock(4, 31, 4, K('target'));
    w.setBlock(5, 30, 4, STONE);
    w.setBlock(5, 31, 4, K('redstone_dust'));
    expect(strikeTarget(w, 4, 31, 4)).toBe(true);
    expect(dustPowerAt(5, 31, 4)).toBe(15);
    tickRedstone(w, 0.6);
    expect(dustPowerAt(5, 31, 4)).toBe(15);
    expect(strikeTarget(w, 4, 31, 4)).toBe(true); // 重复命中刷新
    tickRedstone(w, 0.6); // 距首次 1.2s，距刷新 0.6s → 仍供电
    expect(dustPowerAt(5, 31, 4)).toBe(15);
    tickRedstone(w, 0.5); // 距刷新 1.1s → 断供
    expect(dustPowerAt(5, 31, 4)).toBe(0);
    expect(strikeTarget(w, 9, 31, 9)).toBe(false); // 非标靶返回 false
  });
});
