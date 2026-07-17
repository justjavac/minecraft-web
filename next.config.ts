import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 纯静态导出：build 产物 out/ 可直接部署到任意静态托管（Vercel/Netlify/GitHub Pages）
  output: "export",
};

export default nextConfig;
