// 扫描 public/ 生成 SW install 期 precache 清单：public/sw-precache-manifest.js
// 范围：贴图（atlas/水面条带/GUI 图）、全部音效、像素字体
// 不含 textures/pack/（逐 tile 文件仅供构建 atlas 与设置页预览，运行时走 atlas）；
// 不含 _next/ hashed chunk（文件名构建期才知道，保持运行时 cache-first）
// 用法：node scripts/gen-sw-precache.mjs（build 前由 prebuild 自动执行）

import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));

/** 递归收集 dir 下符合 ext 的文件（返回相对 public/ 的 URL 路径，无前导 /，由 SW 相对 scope 解析） */
function walk(dir, exts) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(...walk(p, exts));
    } else if (exts.some((e) => name.endsWith(e))) {
      out.push(relative(PUBLIC, p).split('/').join('/'));
    }
  }
  return out;
}

const urls = [
  'textures/atlas.png',
  'textures/atlas.json',
  'textures/water_still.png',
  ...walk(join(PUBLIC, 'textures/gui'), ['.png']),
  ...walk(join(PUBLIC, 'sounds'), ['.ogg']),
  ...walk(join(PUBLIC, 'fonts'), ['.woff2', '.ttf']),
].sort();

const body = `// 本文件由 scripts/gen-sw-precache.mjs 自动生成，请勿手改
// SW install 期 precache 清单（${urls.length} 项；相对路径，由 SW 相对 registration.scope 解析，兼容子路径部署）
self.__PRECACHE_MANIFEST__ = ${JSON.stringify(urls, null, 1)};
`;

writeFileSync(join(PUBLIC, 'sw-precache-manifest.js'), body);
console.log(`sw-precache-manifest.js: ${urls.length} 项`);
