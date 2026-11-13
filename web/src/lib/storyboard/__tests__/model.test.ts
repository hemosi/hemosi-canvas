import { describe, expect, test } from 'bun:test';
import {
  composePrompt,
  computeInputsHash,
  deriveNodeHealth,
  estimateDubSeconds,
  RowNode,
  DeskRow,
  Anchor,
} from '../types';

const sampleRow: DeskRow = {
  id: 'r1',
  desc: '雨夜破庙门口推门半开',
  line: '别开门',
  dur: 6,
  size: '全景',
  roles: ['a1'],
  voice: 'dub',
  mode: 'frame',
  cont: false,
};

const sampleAnchors: Anchor[] = [
  { id: 'a1', kind: 'character', name: '女主', text: '红披风', imageKeys: ['img1'] },
];

describe('storyboard model & health', () => {
  test('health 派生优先级: error/running > idle > stale > ok', () => {
    const hash = computeInputsHash({
      effectivePrompt: composePrompt(sampleRow, sampleAnchors),
      refImageKeys: ['img1'],
      model: 'm1',
      size: '全景',
    });

    expect(deriveNodeHealth(undefined, hash)).toBe('idle');

    const okNode: RowNode = {
      rowId: 'r1',
      role: 'frame',
      takes: [{ id: 't1', storageKey: 'k1', inputsHash: hash, prompt: '', model: 'm1', createdAt: 1 }],
      pickedTakeId: 't1',
    };
    expect(deriveNodeHealth(okNode, hash)).toBe('ok');

    // inputsHash 变化自动变 stale
    expect(deriveNodeHealth(okNode, 'other-hash')).toBe('stale');

    // running 优先于 stale / ok
    expect(deriveNodeHealth({ ...okNode, run: { state: 'running' } }, 'other-hash')).toBe('running');

    // error 优先于一切
    expect(deriveNodeHealth({ ...okNode, run: { state: 'error', error: 'fail' } }, hash)).toBe('error');
  });

  test('支持用户自定义底板动态拼装提示词', () => {
    const prompt = composePrompt(sampleRow, sampleAnchors, {
      id: 'tpl-1',
      name: '自定义',
      body: '[{{size}}] {{desc}} | 角色: {{roles}}',
    });
    expect(prompt).toBe('[全景] 雨夜破庙门口推门半开 | 角色: 女主：红披风');
  });

  test('配音时长估算', () => {
    expect(estimateDubSeconds('“外面不是人，别出声。”')).toBeGreaterThan(1.5);
    expect(estimateDubSeconds('')).toBe(0);
  });
});
