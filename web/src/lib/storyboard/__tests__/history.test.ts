import { describe, expect, test } from 'bun:test';
import {
  commitState,
  createHistoryStack,
  redoState,
  undoState,
} from '../history';

interface DummyState {
  title: string;
  items: string[];
}

describe('storyboard history stack', () => {
  test('单次事务撤销与重做', () => {
    let state: DummyState = { title: 'A', items: ['1', '2'] };
    let stack = createHistoryStack();

    const r1 = commitState(
      state,
      stack,
      (d) => {
        d.title = 'B';
        d.items.push('3');
      },
      { label: 'agent-plan' }
    );
    state = r1.state;
    stack = r1.stack;
    expect(state).toEqual({ title: 'B', items: ['1', '2', '3'] });

    const u1 = undoState(state, stack);
    expect(u1.state).toEqual({ title: 'A', items: ['1', '2'] });

    const re1 = redoState(u1.state, u1.stack);
    expect(re1.state).toEqual({ title: 'B', items: ['1', '2', '3'] });
  });

  test('500ms 内连续文本输入自动合并为一条事务', () => {
    let state: DummyState = { title: '', items: [] };
    let stack = createHistoryStack();

    const r1 = commitState(state, stack, (d) => { d.title = '你'; }, {
      label: 'edit',
      mergeKey: 'title',
      now: 1000,
    });
    const r2 = commitState(r1.state, r1.stack, (d) => { d.title = '你好'; }, {
      label: 'edit',
      mergeKey: 'title',
      now: 1200,
    });
    const r3 = commitState(r2.state, r2.stack, (d) => { d.title = '你好吗'; }, {
      label: 'edit',
      mergeKey: 'title',
      now: 1400,
    });

    expect(r3.stack.past.length).toBe(1);
    expect(r3.state.title).toBe('你好吗');

    // 一次撤销回到最初空字符串
    const undone = undoState(r3.state, r3.stack);
    expect(undone.state.title).toBe('');
  });
});
