import type { NextConfig } from "next";

// 子路径部署（GitHub Pages 项目页）时由环境变量注入，如 NEXT_PUBLIC_BASE_PATH=/minecraft-web；
// 默认空串 = 根路径部署，产物行为完全不变
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  // 纯静态导出：build 产物 out/ 可直接部署到任意静态托管（Vercel/Netlify/GitHub Pages）
  output: "export",
  basePath,
  assetPrefix: basePath || undefined,
};

export default nextConfig;
