import { createTerrain } from '../lib/noise';
const t = createTerrain('bench-seed');
let step1 = 0, step2p = 0, flat = 0, n = 0;
for (let x = -200; x < 200; x++) {
  for (let z = -200; z < 200; z++) {
    const h = t.heightAt(x, z);
    const dx = Math.abs(h - t.heightAt(x + 1, z));
    const dz = Math.abs(h - t.heightAt(x, z + 1));
    n += 2;
    if (dx === 1) step1++;
    if (dz === 1) step1++;
    if (dx >= 2) step2p++;
    if (dz >= 2) step2p++;
    if (dx === 0) flat++;
    if (dz === 0) flat++;
  }
}
console.log(`平坦邻对: ${(flat / n * 100).toFixed(1)}%  1格台阶: ${(step1 / n * 100).toFixed(1)}%  ≥2格陡坎: ${(step2p / n * 100).toFixed(1)}%`);
