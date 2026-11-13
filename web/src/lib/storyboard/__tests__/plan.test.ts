import { describe, expect, test } from 'bun:test';
import { commitState, createHistoryStack, undoState } from '../history';
import { previewPlan } from '../plan';
import { Plan, PlanSchema } from '../plan-schema';
import { Anchor, Desk, RowNode, rowNodeKey } from '../types';

const makeDesk = (): Desk => ({
  id: 'd1',
  title: '测试片',
  budgetSec: 15,
  rows: [
    { id: 'r1', desc: '开场', line: '', dur: 5, size: '全景', roles: ['a1'], voice: 'none', mode: 'frame', cont: false },
    { id: 'r2', desc: '对话', line: '原台词', dur: 5, size: '中景', roles: ['a1'], voice: 'dub', mode: 'frame', cont: true },
    { id: 'r3', desc: '结尾', line: '', dur: 4, size: '近景', roles: [], voice: 'none', mode: 'direct', cont: false },
  ],
});

const anchors: Anchor[] = [
  { id: 'a1', kind: 'character', name: '女主', text: '红衣', imageKeys: [] },
];

describe('Agent Plan schema & previewPlan', () => {
  test('zod 校验合法 Plan 并拒绝缺字段', () => {
    const valid = PlanSchema.safeParse({
      summary: '修改台词并加一镜',
      changes: [
        { id: 'c1', kind: 'row.update', rowId: 'r2', patch: { line: '新台词' } },
      ],
    });
    expect(valid.success).toBe(true);

    const invalid = PlanSchema.safeParse({
      summary: '',
      changes: [{ id: 'c1', kind: 'row.update' }],
    });
    expect(invalid.success).toBe(false);
  });

  test('取消勾选某条 Change 时预览与局部应用一致', () => {
    const desk = makeDesk();
    const plan: Plan = {
      summary: '改镜2台词并在最后加一镜',
      changes: [
        { id: 'c1', kind: 'row.update', rowId: 'r2', patch: { line: '改后台词' } },
        { id: 'c2', kind: 'row.add', row: { desc: '新增回头', dur: 3, size: '特写' } },
      ],
    };

    // 只勾选 c1，不勾选 c2
    const res = previewPlan(desk, anchors, {}, plan, ['c1'], (p) => `${p}_new`);
    expect(res.nextDesk.rows.length).toBe(3);
    expect(res.nextDesk.rows[1].line).toBe('改后台词');
    expect(res.diff.addedRows.length).toBe(0);
    expect(res.diff.updatedRows['r2']?.after.line).toBe('改后台词');
  });

  test('目标行不存在、接续对象被删、超预算、已脱离节点均产出 warning 不抛错', () => {
    const desk = makeDesk();
    const nodes: Record<string, RowNode> = {
      [rowNodeKey('r3', 'video')]: {
        rowId: 'r3',
        role: 'video',
        takes: [],
        detached: true,
      },
    };
    const plan: Plan = {
      summary: '边界测试',
      changes: [
        { id: 'c1', kind: 'row.update', rowId: 'not_exist', patch: { desc: 'x' } },
        { id: 'c2', kind: 'row.remove', rowId: 'r1' },
        { id: 'c3', kind: 'row.update', rowId: 'r3', patch: { desc: '试图改已脱离' } },
        { id: 'c4', kind: 'row.add', row: { desc: '超长镜头', dur: 20 } },
      ],
    };

    const res = previewPlan(
      desk,
      anchors,
      nodes,
      plan,
      ['c1', 'c2', 'c3', 'c4'],
      (p) => `${p}_1`
    );
    const codes = res.warnings.map((w) => w.code);
    expect(codes).toContain('ROW_NOT_FOUND');
    expect(codes).toContain('CONTINUE_TARGET_REMOVED');
    expect(codes).toContain('DETACHED_SKIPPED');
    expect(codes).toContain('BUDGET_EXCEEDED');
    // r3 已脱离，desc 保持原样
    expect(res.nextDesk.rows.find((r) => r.id === 'r3')?.desc).toBe('结尾');
  });

  test('applyPlan 作为单条事务入栈，一次撤销完整回退', () => {
    let doc = { desk: makeDesk(), anchors };
    let stack = createHistoryStack();
    const plan: Plan = {
      summary: '加两镜',
      changes: [
        { id: 'c1', kind: 'row.add', row: { desc: '新A', dur: 2 } },
        { id: 'c2', kind: 'row.add', row: { desc: '新B', dur: 3 } },
      ],
    };

    const committed = commitState(
      doc,
      stack,
      (d) => {
        const res = previewPlan(d.desk, d.anchors, {}, plan, ['c1', 'c2']);
        d.desk = res.nextDesk;
        d.anchors = res.nextAnchors;
      },
      { label: 'applyPlan' }
    );
    doc = committed.state;
    stack = committed.stack;
    expect(doc.desk.rows.length).toBe(5);

    const undone = undoState(doc, stack);
    expect(undone.state.desk.rows.length).toBe(3);
  });
});
