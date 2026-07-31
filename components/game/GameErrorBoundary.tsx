'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  /** 未捕获渲染错误时（如 WebGL 上下文创建失败）的兜底界面 */
  fallback: ReactNode;
  children: ReactNode;
};

type State = { hasError: boolean };

/**
 * 游戏区错误边界：GameCanvas 的 WebGL 上下文创建失败（无 GPU/驱动异常/禁用硬件加速）
 * 会击穿整个 React 树导致白屏，这里兜底为可操作的错误界面（重试/回主菜单）。
 */
export class GameErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('游戏渲染崩溃：', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}
