// 子路径部署（如 GitHub Pages 项目页）支持：值在构建期由 NEXT_PUBLIC_BASE_PATH 内联，
// 与 next.config.ts 的 basePath 保持同一来源；默认 '' = 根路径部署，行为完全不变
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** 给根绝对路径（如 '/textures/atlas.png'）加 basePath 前缀；根路径部署时原样返回 */
export function withBase(path: string): string {
  return `${BASE}${path}`;
}
