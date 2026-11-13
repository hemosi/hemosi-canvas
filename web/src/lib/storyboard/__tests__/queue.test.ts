import { describe, expect, test } from 'bun:test';
import { StoryboardQueue, buildDependencyKey } from '../queue';

describe('StoryboardQueue', () => {
  test('本机任务严格串行(1)，远程任务并发(3)', async () => {
    const q = new StoryboardQueue(3, 1);
    let activeLocal = 0;
    let maxLocal = 0;
    let activeRemote = 0;
    let maxRemote = 0;

    const makeTask = (key: string, isLocal: boolean) => ({
      key,
      rowId: key,
      role: 'video' as const,
      isLocal,
      execute: async () => {
        if (isLocal) {
          activeLocal++;
          maxLocal = Math.max(maxLocal, activeLocal);
        } else {
          activeRemote++;
          maxRemote = Math.max(maxRemote, activeRemote);
        }
        await new Promise((r) => setTimeout(r, 20));
        if (isLocal) activeLocal--;
        else activeRemote--;
      },
    });

    q.enqueue(makeTask('l1', true));
    q.enqueue(makeTask('l2', true));
    q.enqueue(makeTask('r1', false));
    q.enqueue(makeTask('r2', false));
    q.enqueue(makeTask('r3', false));
    q.enqueue(makeTask('r4', false));

    await new Promise((r) => setTimeout(r, 90));
    expect(maxLocal).toBe(1);
    expect(maxRemote).toBeLessThanOrEqual(3);
    expect(maxRemote).toBeGreaterThanOrEqual(2);
  });

  test('接续镜头等待上游完成后才执行', async () => {
    const q = new StoryboardQueue(3, 1);
    const order: string[] = [];

    q.enqueue({
      key: 'r1:video',
      rowId: 'r1',
      role: 'video',
      isLocal: false,
      execute: async () => {
        await new Promise((r) => setTimeout(r, 25));
        order.push('r1:video');
      },
    });

    q.enqueue({
      key: 'r2:frame',
      rowId: 'r2',
      role: 'frame',
      isLocal: false,
      dependsOnKey: 'r1:video',
      execute: async () => {
        order.push('r2:frame');
      },
    });

    await new Promise((r) => setTimeout(r, 60));
    expect(order).toEqual(['r1:video', 'r2:frame']);
  });

  test('buildDependencyKey 正确识别首帧与接续依赖', () => {
    const rows = [
      { id: 'r1', mode: 'frame' as const, cont: false },
      { id: 'r2', mode: 'frame' as const, cont: true },
    ];
    expect(buildDependencyKey(rows, 0, 'video')).toBe('r1:frame');
    expect(buildDependencyKey(rows, 1, 'frame')).toBe('r1:video');
  });
});
