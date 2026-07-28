// 音符盒合成音：音高函数（C4 基准、八度倍频、半音等比）与无手势环境静默安全

import { describe, expect, it } from 'vitest';
import { noteBlock, noteFreq } from '../sound';

describe('音符盒音高', () => {
  it('C4=261.63Hz 基准；12 半音翻倍（C5），24 半音四倍（C6）', () => {
    expect(noteFreq(0)).toBeCloseTo(261.63, 2);
    expect(noteFreq(12)).toBeCloseTo(261.63 * 2, 1);
    expect(noteFreq(24)).toBeCloseTo(261.63 * 4, 1);
  });

  it('半音等比：相邻半音比 2^(1/12)；9 半音到 A4=440Hz', () => {
    expect(noteFreq(1) / noteFreq(0)).toBeCloseTo(Math.pow(2, 1 / 12), 5);
    expect(noteFreq(9)).toBeCloseTo(440, 0);
    expect(noteFreq(4)).toBeCloseTo(329.63, 1); // E4
  });

  it('无 AudioContext（无用户手势/非浏览器）时静默不抛错', () => {
    expect(() => noteBlock(0)).not.toThrow();
    expect(() => noteBlock(23)).not.toThrow();
  });
});
