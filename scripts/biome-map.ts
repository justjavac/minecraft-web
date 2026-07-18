// 生成群系分布图（PPM）：验证/调试群系形状与覆盖
// 用法：pnpm tsx scripts/biome-map.ts [种子] [输出.ppm]
import { writeFileSync } from 'node:fs';
import { createTerrain, type Biome } from '../lib/noise';

const seed = process.argv[2] ?? 's0';
const outPath = process.argv[3] ?? 'biome-map.ppm';
const t = createTerrain(seed);

const COLORS: Record<Biome, [number, number, number]> = {
  plains: [103, 168, 68],
  forest: [46, 107, 38],
  desert: [226, 211, 160],
  ice: [232, 240, 244],
  ocean: [43, 79, 158],
  river: [63, 127, 212],
  basin: [138, 158, 80],
};

const S = 512;
const AREA = 2048;
const buf: number[] = [];
for (let py = 0; py < S; py++) {
  for (let px = 0; px < S; px++) {
    const x = Math.floor((px / S - 0.5) * AREA);
    const z = Math.floor((py / S - 0.5) * AREA);
    const [r, g, b] = COLORS[t.biomeAt(x, z)];
    buf.push(r, g, b);
  }
}
// 出生点红色标记
for (let dy = -3; dy <= 3; dy++) {
  for (let dx = -3; dx <= 3; dx++) {
    const i = ((S / 2 + dy) * S + S / 2 + dx) * 3;
    buf[i] = 255; buf[i + 1] = 34; buf[i + 2] = 34;
  }
}
const header = Buffer.from(`P6\n${S} ${S}\n255\n`);
writeFileSync(outPath, Buffer.concat([header, Buffer.from(buf)]));
console.log(`written ${outPath}`);
