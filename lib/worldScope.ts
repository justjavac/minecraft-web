// 世界作用域 registry：各世界系统（生物/容器/熔炉/流体/红石……）在模块内自注册
// clear（必需）与 snapshot/restore（可选，跨维度暂存与存档持久化用）。
// World.tsx 的卸载清理、维度切换暂存/恢复、存档 extras 收集全部遍历 registry——
// 新增系统只需在模块内 register 一次，「忘了清理/暂存/落盘」由结构保证而非人肉清单。

/** 一个世界作用域系统。S 为快照数据类型（跨维度暂存/存档用；无持久状态的系统不提供 snapshot/restore） */
export interface WorldScope<S = unknown> {
  /** 系统名（registry 内唯一；furnace/brewing/storage 三个名字与存档 dims 字段映射，见 lib/persistence.ts） */
  name: string;
  /** 清空全部世界作用域状态（卸载/切维度/开新世界时调用） */
  clear: () => void;
  /** 快照当前状态（维度切换暂存、存档收集用） */
  snapshot?: () => S;
  /** 用快照整体替换当前状态（restore 语义 = clear + 填入） */
  restore?: (state: S) => void;
}

/** 内部存储：快照类型擦除为 unknown（各系统类型在注册处由泛型保证） */
interface RegisteredScope {
  name: string;
  clear: () => void;
  snapshot?: () => unknown;
  restore?: (state: unknown) => void;
}

const scopes = new Map<string, RegisteredScope>();

/** 注册世界作用域系统（模块加载时自注册）。返回注销函数（测试用；业务模块忽略返回值） */
export function registerWorldScope<S>(scope: WorldScope<S>): () => void {
  scopes.set(scope.name, scope as RegisteredScope);
  return () => {
    // 仅当仍是自己时才注销（防止测试重复注册互相误删）
    if (scopes.get(scope.name) === (scope as RegisteredScope)) scopes.delete(scope.name);
  };
}

/** 已注册系统名（测试/调试用） */
export function worldScopeNames(): string[] {
  return [...scopes.keys()];
}

/** 清空所有已注册系统（世界卸载、维度切换、开新世界） */
export function clearWorldScopes(): void {
  for (const s of scopes.values()) s.clear();
}

/** 快照所有提供 snapshot 的系统：name → 状态（无 snapshot 的系统无可暂存状态，自动跳过） */
export function snapshotWorldScopes(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of scopes.values()) {
    if (s.snapshot) out[s.name] = s.snapshot();
  }
  return out;
}

/** 从快照恢复：快照里有的系统整体替换，快照里缺失（但可恢复）的系统清空——保证不残留上一维度的状态 */
export function restoreWorldScopes(states: Record<string, unknown>): void {
  for (const s of scopes.values()) {
    if (!s.restore) continue;
    if (s.name in states) s.restore(states[s.name]);
    else s.clear();
  }
}
