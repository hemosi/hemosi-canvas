import { RowNodeRole, rowNodeKey } from './types';

export interface GenerationTask {
  key: string; // `${rowId}:${role}`
  rowId: string;
  role: RowNodeRole;
  isLocal: boolean;
  dependsOnKey?: string; // 接续镜头依赖上游 video 或同镜 frame
  execute: (signal: AbortSignal) => Promise<void>;
}

export interface QueueStatus {
  queuedKeys: string[];
  runningKeys: string[];
}

export class StoryboardQueue {
  private tasks = new Map<
    string,
    { task: GenerationTask; controller: AbortController; status: 'queued' | 'running' }
  >();
  private completedKeys = new Set<string>();
  private listeners = new Set<(status: QueueStatus) => void>();

  constructor(
    private readonly remoteConcurrency = 3,
    private readonly localConcurrency = 1
  ) {}

  subscribe(fn: (status: QueueStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const status = this.getStatus();
    this.listeners.forEach((fn) => fn(status));
  }

  getStatus(): QueueStatus {
    const queuedKeys: string[] = [];
    const runningKeys: string[] = [];
    this.tasks.forEach((v, k) => {
      if (v.status === 'queued') queuedKeys.push(k);
      else runningKeys.push(k);
    });
    return { queuedKeys, runningKeys };
  }

  markCompleted(key: string) {
    this.completedKeys.add(key);
    this.pump();
  }

  enqueue(task: GenerationTask) {
    // 如果同一节点已在队列或运行中，先取消旧的
    this.cancel(task.key);
    this.completedKeys.delete(task.key);
    this.tasks.set(task.key, {
      task,
      controller: new AbortController(),
      status: 'queued',
    });
    this.emit();
    this.pump();
  }

  cancel(key: string) {
    const entry = this.tasks.get(key);
    if (!entry) return;
    entry.controller.abort();
    this.tasks.delete(key);
    this.emit();
    this.pump();
  }

  cancelAll() {
    this.tasks.forEach((entry) => entry.controller.abort());
    this.tasks.clear();
    this.emit();
  }

  private pump() {
    const runningEntries = Array.from(this.tasks.values()).filter(
      (e) => e.status === 'running'
    );
    const runningLocal = runningEntries.filter((e) => e.task.isLocal).length;
    const runningRemote = runningEntries.filter((e) => !e.task.isLocal).length;

    for (const [key, entry] of this.tasks.entries()) {
      if (entry.status !== 'queued') continue;

      // 8G 显存本机模型一次只开一个（串行 1）；远程渠道并发 3
      if (entry.task.isLocal && runningLocal >= this.localConcurrency) continue;
      if (!entry.task.isLocal && runningRemote >= this.remoteConcurrency) continue;

      // 依赖上游：如果上游仍在队列/运行中且未完成，暂不启动
      if (
        entry.task.dependsOnKey &&
        this.tasks.has(entry.task.dependsOnKey) &&
        !this.completedKeys.has(entry.task.dependsOnKey)
      ) {
        continue;
      }

      entry.status = 'running';
      this.emit();

      entry.task
        .execute(entry.controller.signal)
        .then(() => {
          this.completedKeys.add(key);
        })
        .catch(() => {
          // 错误状态由 execute 内部写入 store
        })
        .finally(() => {
          this.tasks.delete(key);
          this.emit();
          this.pump();
        });

      // 刚启动了一个任务，重新检查并发上限
      if (entry.task.isLocal) break;
    }
  }
}

export function buildDependencyKey(
  rows: Array<{ id: string; mode: 'frame' | 'direct'; cont: boolean }>,
  rowIndex: number,
  role: RowNodeRole
): string | undefined {
  const row = rows[rowIndex];
  if (!row) return undefined;
  if (role === 'video' && row.mode === 'frame') {
    return rowNodeKey(row.id, 'frame');
  }
  if (role === 'frame' && row.cont && rowIndex > 0) {
    return rowNodeKey(rows[rowIndex - 1].id, 'video');
  }
  return undefined;
}
