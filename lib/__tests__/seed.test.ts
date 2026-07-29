// 种子字符串 → 数值的 MC 规则（数字按 long 解析，非数字按 Java String.hashCode）
import { describe, expect, it } from 'vitest';
import { hashString } from '../noise';

describe('种子哈希（MC 规则）', () => {
  it('整数字符串按数值解析', () => {
    expect(hashString('0')).toBe(0);
    expect(hashString('123')).toBe(123);
    expect(hashString('-1')).toBe(-1);
    expect(hashString(' 42 ')).toBe(42);
  });

  it('超长数字不丢精度（取低 32 位）', () => {
    expect(hashString('4294967297')).toBe(1); // 2^32 + 1
  });

  it('非数字按 Java String.hashCode', () => {
    // Java: "abc".hashCode() == 96354，"hello".hashCode() == 99162322
    expect(hashString('abc')).toBe(96354);
    expect(hashString('hello')).toBe(99162322);
  });
});
