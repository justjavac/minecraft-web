// three r183 起弃用 THREE.Clock（构造时打印一次弃用警告），而 @react-three/fiber 9.x
// 仍在内部 store 里 `new THREE.Clock()`（每个 Canvas 实例一次），应用侧无法避免。
// 这里精确过滤这一条已知无害的上游警告，其余警告不受影响；fiber 改用 Timer 后可删除本模块。

if (typeof window !== 'undefined') {
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('THREE.Clock: This module has been deprecated')) {
      return;
    }
    originalWarn(...args);
  };
}
