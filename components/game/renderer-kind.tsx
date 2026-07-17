'use client';

import { createContext, useContext } from 'react';

export type RendererKind = 'webgl' | 'webgpu';

/**
 * 本次会话实际使用的渲染器（GameCanvas 检测后通过 Context 下发）。
 * 材质工厂据此产出经典材质或 WebGPU 节点材质。
 */
export const RendererKindContext = createContext<RendererKind>('webgl');

export function useRendererKind(): RendererKind {
  return useContext(RendererKindContext);
}
