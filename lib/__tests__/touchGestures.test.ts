// 触屏 GUI 手势判定（lib/touchGestures.ts）：一次按压由点按/长按/移动三事件先到者定案，且只分发一次。
import { describe, expect, it } from 'vitest';
import { createTouchPress, LONG_PRESS_MS, MOVE_CANCEL_PX, pressMove, pressTimeout, pressUp } from '../touchGestures';

describe('touchGestures 按压判定', () => {
  it('阈值与 MC 习惯一致：长按 400ms、移动取消 12px', () => {
    expect(LONG_PRESS_MS).toBe(400);
    expect(MOVE_CANCEL_PX).toBe(12);
  });

  it('快速点按（抬起时仍待定）= 左键', () => {
    const p = createTouchPress();
    expect(pressUp(p)).toBe(0);
    expect(p.resolved).toBe(0);
  });

  it('长按（计时到点未移动）= 右键，且这次按压不再算左键', () => {
    const p = createTouchPress();
    expect(pressTimeout(p)).toBe(2);
    expect(pressUp(p)).toBeNull(); // 长按后的抬起不再分发
  });

  it('位移超阈值 = 左键（进入拖动），之后的长按计时无效', () => {
    const p = createTouchPress();
    expect(pressMove(p, MOVE_CANCEL_PX + 1, 0)).toBe(0);
    expect(pressTimeout(p)).toBeNull();
    expect(pressUp(p)).toBeNull();
  });

  it('阈值内移动不定案、不取消长按', () => {
    const p = createTouchPress();
    expect(pressMove(p, MOVE_CANCEL_PX, 0)).toBeNull(); // 恰好阈值：不算移动
    expect(pressMove(p, 3, 4)).toBeNull(); // hypot=5
    expect(p.resolved).toBeNull();
    expect(pressTimeout(p)).toBe(2); // 长按仍有效
  });

  it('对角位移按欧氏距离判定', () => {
    const p = createTouchPress();
    // 9+9 的 hypot ≈ 12.7 > 12：算移动
    expect(pressMove(p, 9, 9)).toBe(0);
  });

  it('同一按压只分发一次（重复事件全部落空）', () => {
    const p = createTouchPress();
    expect(pressTimeout(p)).toBe(2);
    expect(pressTimeout(p)).toBeNull();
    expect(pressMove(p, 100, 0)).toBeNull();
    expect(pressUp(p)).toBeNull();
  });
});
