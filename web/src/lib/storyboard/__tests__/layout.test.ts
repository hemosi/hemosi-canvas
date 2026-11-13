import { describe, expect, test } from 'bun:test';
import { LAYOUT_CONSTANTS, laneLayout } from '../layout';
import { Anchor, Desk, RowNode, rowNodeKey } from '../types';

const makeDesk = (): Desk => ({
  id: 'd1',
  title: '测试分镜',
  budgetSec: 30,
  rows: [
    { id: 'r1', desc: '镜头1', line: '', dur: 5, size: '全景', roles: ['a1'], voice: 'none', mode: 'frame', cont: false },
    { id: 'r2', desc: '镜头2', line: '', dur: 4, size: '中景', roles: ['a1'], voice: 'none', mode: 'frame', cont: true },
    { id: 'r3', desc: '镜头3', line: '', dur: 6, size: '近景', roles: [], voice: 'none', mode: 'direct', cont: false },
  ],
});

const anchors: Anchor[] = [
  { id: 'a1', kind: 'character', name: '主角', text: '黑衣', imageKeys: [] },
];

describe('laneLayout', () => {
  test('折叠行高 60，选中行高 262，下游节点按 rowId 对齐', () => {
    const desk = makeDesk();
    const res = laneLayout(desk, anchors, {}, 'r2');

    expect(res.rows[0].h).toBe(LAYOUT_CONSTANTS.ROW_COLLAPSED_H);
    expect(res.rows[1].h).toBe(LAYOUT_CONSTANTS.ROW_EXPANDED_H);
    expect(res.rows[2].h).toBe(LAYOUT_CONSTANTS.ROW_COLLAPSED_H);

    // r2 展开后，r3 的 y 必须顺延
    expect(res.rows[2].localY).toBe(
      LAYOUT_CONSTANTS.DESK_HEADER_H + LAYOUT_CONSTANTS.ROW_COLLAPSED_H + LAYOUT_CONSTANTS.ROW_EXPANDED_H
    );

    // r3 是 direct 模式，只有 video 节点，没有 frame 节点
    expect(res.nodes[rowNodeKey('r3', 'frame')]).toBeUndefined();
    expect(res.nodes[rowNodeKey('r3', 'video')].y).toBe(res.rows[2].absY + 5);

    // r2 有接续连线
    expect(res.wires.some((w) => w.kind === 'continue' && w.rowId === 'r2')).toBe(true);
  });

  test('manual 节点保持原位不被自动排布覆盖', () => {
    const desk = makeDesk();
    const nodes: Record<string, RowNode> = {
      [rowNodeKey('r1', 'video')]: {
        rowId: 'r1',
        role: 'video',
        takes: [],
        manual: { x: 1500, y: 888 },
      },
    };
    const res = laneLayout(desk, anchors, nodes, 'r1');
    const vNode = res.nodes[rowNodeKey('r1', 'video')];
    expect(vNode.x).toBe(1500);
    expect(vNode.y).toBe(888);
    expect(vNode.isManual).toBe(true);
  });
});
