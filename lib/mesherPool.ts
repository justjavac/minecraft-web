// 网格化 Worker 池：chunk mesh 在后台线程构建，流式加载期间主线程保持流畅
// 同 key 重复请求只保留最新（排队中的旧版本直接丢弃）

import type { GeometryData } from './mesher';
import type { MeshRequest, MeshResponse } from './mesher.worker';

const POOL_SIZE = Math.max(2, Math.min(4, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 4 : 4) - 1));

interface Pending {
  key: string;
  version: number;
  resolve: (r: MeshResponse) => void;
  /** 看门狗计时器：请求发给 worker 后启动（排队中不启动） */
  watchdog?: ReturnType<typeof setTimeout>;
  /** 已发给 worker（busy）——同 key 新请求不得清它的看门狗（worker 卡死时槽位靠看门狗回收） */
  watchdogBusy?: boolean;
}

interface Queued {
  req: MeshRequest;
  pending: Pending;
}

/** worker 无响应判定超时（毫秒）：正常单个 chunk 建网 ~10-30ms，3s 不响应即视为卡死 */
const WATCHDOG_MS = 3000;
/** 连续卡死次数达到即永久禁用池（回退主线程建网） */
const MAX_FAILURES = 2;

class MesherPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private busy = new Map<Worker, Pending>();
  private queue: Queued[] = [];
  private byKey = new Map<string, Pending>();
  private failures = 0;

  constructor() {
    for (let i = 0; i < POOL_SIZE; i++) {
      const w = new Worker(new URL('./mesher.worker.ts', import.meta.url));
      w.onmessage = (e: MessageEvent<MeshResponse>) => this.done(w, e.data);
      w.onerror = (err) => {
        console.warn('[mesher] worker 出错，该请求回退主线程', err.message ?? err);
        this.done(w, null);
      };
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  /** 池是否已被看门狗禁用（worker 持续无响应时回退主线程） */
  get disabled(): boolean {
    return this.failures >= MAX_FAILURES;
  }

  build(key: string, version: number, cx: number, cz: number, datas: (Uint16Array | null)[], lights: (Uint8Array | null)[], skys: (Uint8Array | null)[], biomes?: Uint8Array | null): Promise<MeshResponse> {
    // 同 key 排队中的旧请求作废：版本已被更新取代，结果必然过期。
    // 注意：已发给 worker 的旧请求不清 watchdog——worker 若卡死，槽位要靠看门狗回收
    const prev = this.byKey.get(key);
    if (prev) {
      if (!prev.watchdogBusy) {
        if (prev.watchdog) clearTimeout(prev.watchdog);
      }
      prev.resolve({ key, version: prev.version, solid: EMPTY, water: EMPTY });
      this.byKey.delete(key);
    }
    return new Promise<MeshResponse>((resolve) => {
      const pending: Pending = { key, version, resolve };
      this.byKey.set(key, pending);
      this.queue.push({ req: { key, version, cx, cz, datas, lights, skys, biomes }, pending });
      this.pump();
    });
  }

  /** 取消排队中的请求（chunk 卸载时调用，省掉必然被丢弃的计算） */
  cancel(key: string): void {
    const pending = this.byKey.get(key);
    if (!pending) return;
    this.byKey.delete(key);
    // busy 中的请求保留看门狗（worker 卡死时槽位需回收），重复 resolve 无害
    if (pending.watchdog && !pending.watchdogBusy) clearTimeout(pending.watchdog);
    pending.resolve({ key, version: pending.version, solid: EMPTY, water: EMPTY });
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const { req, pending } = this.queue.shift()!;
      // 已被同 key 新请求取代的排队任务跳过
      if (this.byKey.get(req.key) !== pending) continue;
      const w = this.idle.pop()!;
      this.busy.set(w, pending);
      // 看门狗：worker 卡死（模块挂起/永不响应）时按空结果释放请求，让调用方回退主线程；
      // 连续卡死达到上限则永久禁用池（dev 模式某些运行时 worker 会挂起，不能拖死整个建网管线）
      pending.watchdogBusy = true;
      pending.watchdog = setTimeout(() => {
        console.warn(`[mesher] worker ${WATCHDOG_MS}ms 无响应，该请求回退主线程建网`);
        this.failures += 1;
        w.terminate();
        this.busy.delete(w);
        this.workers = this.workers.filter((x) => x !== w); // 已终止，不回 idle
        if (this.byKey.get(pending.key) === pending) this.byKey.delete(pending.key);
        pending.resolve({ key: pending.key, version: pending.version, solid: EMPTY, water: EMPTY });
        if (this.failures >= MAX_FAILURES) {
          console.warn('[mesher] worker 连续无响应，永久回退主线程建网');
          for (const ww of this.workers) ww.terminate();
          this.workers.length = 0;
          this.idle.length = 0;
          for (const [, p] of this.byKey) {
            if (p.watchdog) clearTimeout(p.watchdog);
            p.resolve({ key: p.key, version: p.version, solid: EMPTY, water: EMPTY });
          }
          this.byKey.clear();
          this.queue.length = 0;
        }
        this.pump();
      }, WATCHDOG_MS);
      // 请求体含 3×3 邻居的方块/光照/天空光数组（约 1.9MB）：复制为一次性快照后以 transferable 转交，
      // 省掉 structured-clone 的对象图序列化。原数组是主线程在用的 chunk 数据，不能直接转交（转交即失效），
      // 这里的拷贝同时就是 worker 所需的快照（建网期间主线程可能继续 setBlock）；biomes 是请求方新建的小数组，直接转交
      const transfer: Transferable[] = [];
      const snap16 = (a: Uint16Array | null): Uint16Array | null => {
        if (!a) return null;
        const c = new Uint16Array(a);
        transfer.push(c.buffer);
        return c;
      };
      const snap8 = (a: Uint8Array | null): Uint8Array | null => {
        if (!a) return null;
        const c = new Uint8Array(a);
        transfer.push(c.buffer);
        return c;
      };
      if (req.biomes) transfer.push(req.biomes.buffer);
      w.postMessage(
        { ...req, datas: req.datas.map(snap16), lights: req.lights.map(snap8), skys: req.skys.map(snap8) },
        transfer,
      );
    }
  }

  private done(w: Worker, r: MeshResponse | null): void {
    const pending = this.busy.get(w);
    this.busy.delete(w);
    if (this.workers.includes(w)) this.idle.push(w);
    if (pending) {
      if (pending.watchdog) clearTimeout(pending.watchdog);
      // 若在等待期间又有更新版本，返回空结果让调用方丢弃
      const stale = r !== null && this.byKey.get(pending.key) !== pending;
      // 只在自己仍是注册者时删除——等待期间同 key 的新请求已重新注册，误删会让新请求被 pump 永久跳过
      if (this.byKey.get(pending.key) === pending) this.byKey.delete(pending.key);
      pending.resolve(stale || r === null ? { key: pending.key, version: pending.version, solid: EMPTY, water: EMPTY } : r);
    }
    this.pump();
  }
}

const EMPTY: GeometryData = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  uvs: new Float32Array(0),
  colors: new Float32Array(0),
  indices: new Uint32Array(0),
};

let pool: MesherPool | null = null;
let poolFailed = false;

/** 全局网格化池（浏览器端惰性创建；Worker 创建失败时返回 null，调用方回退主线程构建） */
export function getMesherPool(): MesherPool | null {
  if (typeof Worker === 'undefined' || poolFailed) return null;
  // 调试逃生口：localStorage.mc-no-worker=1 时强制主线程建网（排查 worker 问题用）
  if (typeof localStorage !== 'undefined' && localStorage.getItem('mc-no-worker')) return null;
  if (!pool) {
    try {
      pool = new MesherPool();
    } catch (err) {
      console.warn('网格化 Worker 池创建失败，回退主线程建网', err);
      poolFailed = true;
      return null;
    }
  }
  // 看门狗已禁用（worker 连续无响应）：直接回退主线程
  if (pool.disabled) return null;
  // 开发环境调试暴露（自动化实测用）
  if (process.env.NODE_ENV === 'development') (window as unknown as { __pool?: unknown }).__pool = pool;
  return pool;
}
