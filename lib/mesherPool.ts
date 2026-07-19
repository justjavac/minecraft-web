// 网格化 Worker 池：chunk mesh 在后台线程构建，流式加载期间主线程保持流畅
// 同 key 重复请求只保留最新（排队中的旧版本直接丢弃）

import type { GeometryData } from './mesher';
import type { MeshRequest, MeshResponse } from './mesher.worker';

const POOL_SIZE = Math.max(2, Math.min(4, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 4 : 4) - 1));

interface Pending {
  key: string;
  version: number;
  resolve: (r: MeshResponse) => void;
}

interface Queued {
  req: MeshRequest;
  pending: Pending;
}

class MesherPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private busy = new Map<Worker, Pending>();
  private queue: Queued[] = [];
  private byKey = new Map<string, Pending>();

  constructor() {
    for (let i = 0; i < POOL_SIZE; i++) {
      const w = new Worker(new URL('./mesher.worker.ts', import.meta.url));
      w.onmessage = (e: MessageEvent<MeshResponse>) => this.done(w, e.data);
      w.onerror = () => this.done(w, null);
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  build(key: string, version: number, cx: number, cz: number, datas: (Uint16Array | null)[], lights: (Uint8Array | null)[], skys: (Uint8Array | null)[]): Promise<MeshResponse> {
    // 同 key 排队中的旧请求作废：版本已被更新取代，结果必然过期
    const prev = this.byKey.get(key);
    if (prev) {
      prev.resolve({ key, version: prev.version, solid: EMPTY, water: EMPTY });
      this.byKey.delete(key);
    }
    return new Promise<MeshResponse>((resolve) => {
      const pending: Pending = { key, version, resolve };
      this.byKey.set(key, pending);
      this.queue.push({ req: { key, version, cx, cz, datas, lights, skys }, pending });
      this.pump();
    });
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const { req, pending } = this.queue.shift()!;
      // 已被同 key 新请求取代的排队任务跳过
      if (this.byKey.get(req.key) !== pending) continue;
      const w = this.idle.pop()!;
      this.busy.set(w, pending);
      w.postMessage(req);
    }
  }

  private done(w: Worker, r: MeshResponse | null): void {
    const pending = this.busy.get(w);
    this.busy.delete(w);
    this.idle.push(w);
    if (pending) {
      // 若在等待期间又有更新版本，返回空结果让调用方丢弃
      const stale = r !== null && this.byKey.get(pending.key) !== pending;
      this.byKey.delete(pending.key);
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

/** 全局网格化池（浏览器端惰性创建；Worker 不可用时返回 null，调用方回退主线程构建） */
export function getMesherPool(): MesherPool | null {
  if (typeof Worker === 'undefined') return null;
  pool ??= new MesherPool();
  return pool;
}
