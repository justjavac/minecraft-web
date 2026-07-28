import { createTerrain } from '../lib/noise';
const t = createTerrain('bench-seed');
let exposed = 0, n = 0;
for (let x = -200; x < 200; x++) {
  for (let z = -200; z < 200; z++) {
    const h = t.heightAt(x, z);
    if (h < 10) continue;
    n++;
    for (let y = h - 2; y <= h; y++) {
      if (t.caveAt(x, y, z, h)) {
        exposed++;
        break;
      }
    }
  }
}
console.log(`近地表 3 层破洞的列: ${(exposed / n * 100).toFixed(1)}%`);
