import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 本机负载高时物理/生成类测试会偶发超过默认 5s，统一放宽
    testTimeout: 20000,
  },
});
