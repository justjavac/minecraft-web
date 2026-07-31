// 生成高度图（PPM）：亮度=高度，红色叠加=与邻居高差≥4 的陡坎（用于排查峡谷/断崖）
// 用法：pnpm tsx scripts/height-map.ts [种子] [输出.ppm]
import { writeFileSync } from 'node:fs';
import { createTerrain } from '../lib/noise';

const seed = process.argv[2] ?? 's0';
const outPath = process.argv[3] ?? 'height-map.ppm';
const t = createTerrain(seed);

const S = 512;
const AREA = 2048;
const buf: number[] = [];
let deepCuts = 0;
for (let py = 0; py < S; py++) {
  for (let px = 0; px < S; px++) {
    const x = Math.floor((px / S - 0.5) * AREA);
    const z = Math.floor((py / S - 0.5) * AREA);
    const h = t.heightAt(x, z);
    // 高度→灰度（y 20..110 映射到 0..255）
    const g = Math.max(0, Math.min(255, Math.round(((h - 20) / 90) * 255)));
    let r = g, b = g;
    // 邻域最大落差（4 方向）
    const drop = Math.max(
      h - t.heightAt(x + 4, z),
      h - t.heightAt(x - 4, z),
      h - t.heightAt(x, z + 4),
      h - t.heightAt(x, z - 4),
    );
    if (drop >= 12 && h > 45) {
      // 深谷底部（比 4 格外邻居低 12+）：红色标记
      r = 255; b = 0;
      deepCuts++;
    } else if (drop >= 6) {
      r = Math.min(255, g + 90); // 较浅沟壑：橙色
    }
    buf.push(r, g, b);
  }
}
const header = Buffer.from(`P6\n${S} ${S}\n255\n`);
writeFileSync(outPath, Buffer.concat([header, Buffer.from(buf)]));
console.log(`written ${outPath}  deepCutCells=${deepCuts} (${((deepCuts / (S * S)) * 100).toFixed(1)}%)`);
