// 触屏 GUI 手势判定（纯函数，无 DOM 依赖，供 components/game/McGui.tsx 的触屏协调层使用）。
// 一次按压在按下时无法区分「点按 / 长按 / 拖动」，故先挂起（resolved=null），由三个事件中的先到者定案：
//   pressTimeout（按住达 LONG_PRESS_MS 未移动）→ 右键（半取/单放）
//   pressMove（位移超 MOVE_CANCEL_PX）        → 左键（立即结算按下，随后进入拖动分发）
//   pressUp（抬起时仍待定）                   → 点按 = 左键

/** 长按判右键的按住时长（ms） */
export const LONG_PRESS_MS = 400;
/** 判「移动」的位移阈值（px）：超过即取消长按、转为左键 + 拖动 */
export const MOVE_CANCEL_PX = 12;

/** 触屏只能产出左键（0）或右键（2） */
export type TouchButton = 0 | 2;

/** 一次触屏按压的判定状态；resolved 为 null 表示待定 */
export interface TouchPressState {
  resolved: TouchButton | null;
}

export function createTouchPress(): TouchPressState {
  return { resolved: null };
}

/** 定案：首次有效，返回应分发的按键；已定案返回 null（同一按压不重复分发） */
function resolve(p: TouchPressState, button: TouchButton): TouchButton | null {
  if (p.resolved !== null) return null;
  p.resolved = button;
  return button;
}

/** 长按计时到点：右键（调用方保证只在未移动时触发） */
export function pressTimeout(p: TouchPressState): TouchButton | null {
  return resolve(p, 2);
}

/** 指针移动：位移超阈值则定案左键（返回 0）；阈值内返回 null（仍待定，不取消长按） */
export function pressMove(p: TouchPressState, dx: number, dy: number): TouchButton | null {
  if (Math.hypot(dx, dy) <= MOVE_CANCEL_PX) return null;
  return resolve(p, 0);
}

/** 抬起时仍待定：点按 = 左键 */
export function pressUp(p: TouchPressState): TouchButton | null {
  return resolve(p, 0);
}
