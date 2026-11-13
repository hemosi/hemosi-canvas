import { nanoid } from 'nanoid';
import { Change, Plan } from './plan-schema';
import {
  Anchor,
  Desk,
  DeskRow,
  RowNode,
  rowNodeKey,
} from './types';

export interface PlanWarning {
  changeId?: string;
  code:
    | 'ROW_NOT_FOUND'
    | 'CONTINUE_TARGET_REMOVED'
    | 'BUDGET_EXCEEDED'
    | 'DETACHED_SKIPPED'
    | 'REMOVE_OVER_LIMIT';
  message: string;
}

export interface PlanDiff {
  addedRows: Array<{ changeId: string; atIndex: number; row: DeskRow }>;
  updatedRows: Record<string, { before: DeskRow; after: DeskRow }>;
  removedRowIds: string[];
  movedRowIds: string[];
  addedAnchors: Anchor[];
}

export interface PreviewPlanResult {
  nextDesk: Desk;
  nextAnchors: Anchor[];
  diff: PlanDiff;
  warnings: PlanWarning[];
}

function isRowDetached(
  rowId: string,
  nodes: Record<string, RowNode>
): boolean {
  return Boolean(
    nodes[rowNodeKey(rowId, 'frame')]?.detached ||
      nodes[rowNodeKey(rowId, 'video')]?.detached
  );
}

export function previewPlan(
  desk: Desk,
  anchors: Anchor[],
  nodes: Record<string, RowNode>,
  plan: Plan,
  enabledIds: Set<string> | string[],
  idGenerator: (prefix: string) => string = (p) => `${p}_${nanoid(6)}`
): PreviewPlanResult {
  const enabled =
    enabledIds instanceof Set ? enabledIds : new Set(enabledIds);

  const nextRows: DeskRow[] = desk.rows.map((r) => ({
    ...r,
    roles: [...r.roles],
  }));
  const nextAnchors: Anchor[] = anchors.map((a) => ({
    ...a,
    imageKeys: [...a.imageKeys],
  }));
  const warnings: PlanWarning[] = [];
  const diff: PlanDiff = {
    addedRows: [],
    updatedRows: {},
    removedRowIds: [],
    movedRowIds: [],
    addedAnchors: [],
  };

  let removeCount = 0;
  const activeChanges: Change[] = plan.changes.filter((c) => enabled.has(c.id));

  for (const ch of activeChanges) {
    if (ch.kind === 'anchor.add') {
      const exists = nextAnchors.find((a) => a.name === ch.anchor.name);
      if (!exists) {
        const created: Anchor = {
          id: idGenerator('anc'),
          kind: ch.anchor.kind,
          name: ch.anchor.name,
          text: ch.anchor.text,
          imageKeys: [],
        };
        nextAnchors.push(created);
        diff.addedAnchors.push(created);
      }
      continue;
    }

    if (ch.kind === 'row.add') {
      const created: DeskRow = {
        id: idGenerator('row'),
        desc: ch.row.desc ?? '',
        line: ch.row.line ?? '',
        dur: ch.row.dur ?? 5,
        size: ch.row.size ?? '中景',
        roles: ch.row.roles ? [...ch.row.roles] : [],
        voice: ch.row.voice ?? 'none',
        mode: ch.row.mode ?? 'frame',
        cont: ch.row.cont ?? false,
      };
      const idx =
        typeof ch.at === 'number' && ch.at >= 0 && ch.at <= nextRows.length
          ? ch.at
          : nextRows.length;
      nextRows.splice(idx, 0, created);
      diff.addedRows.push({ changeId: ch.id, atIndex: idx, row: created });
      continue;
    }

    const rowIdx = nextRows.findIndex((r) => r.id === ch.rowId);
    if (rowIdx < 0) {
      warnings.push({
        changeId: ch.id,
        code: 'ROW_NOT_FOUND',
        message: `目标镜头 ${ch.rowId} 不存在，已跳过`,
      });
      continue;
    }

    if (ch.kind === 'row.update') {
      if (isRowDetached(ch.rowId, nodes)) {
        warnings.push({
          changeId: ch.id,
          code: 'DETACHED_SKIPPED',
          message: `镜头 ${ch.rowId} 已脱离，跳过自动修改`,
        });
        continue;
      }
      const before = { ...nextRows[rowIdx], roles: [...nextRows[rowIdx].roles] };
      const after: DeskRow = {
        ...before,
        ...ch.patch,
        roles: ch.patch.roles ? [...ch.patch.roles] : before.roles,
      };
      if (after.mode === 'direct') after.cont = false;
      nextRows[rowIdx] = after;
      diff.updatedRows[ch.rowId] = {
        before: diff.updatedRows[ch.rowId]?.before ?? before,
        after,
      };
      continue;
    }

    if (ch.kind === 'row.remove') {
      removeCount += 1;
      // 检查下一镜是否接续了被删行
      const nextRow = nextRows[rowIdx + 1];
      if (nextRow?.cont) {
        warnings.push({
          changeId: ch.id,
          code: 'CONTINUE_TARGET_REMOVED',
          message: `镜 ${String(rowIdx + 2).padStart(2, '0')} 原本接续被删镜头，已自动取消接续`,
        });
        nextRows[rowIdx + 1] = { ...nextRow, cont: false };
      }
      nextRows.splice(rowIdx, 1);
      diff.removedRowIds.push(ch.rowId);
      continue;
    }

    if (ch.kind === 'row.move') {
      const targetIdx = Math.max(0, Math.min(nextRows.length - 1, ch.to));
      if (targetIdx !== rowIdx) {
        const [moved] = nextRows.splice(rowIdx, 1);
        nextRows.splice(targetIdx, 0, moved);
        diff.movedRowIds.push(ch.rowId);
      }
      continue;
    }

    if (ch.kind === 'row.roles') {
      if (isRowDetached(ch.rowId, nodes)) {
        warnings.push({
          changeId: ch.id,
          code: 'DETACHED_SKIPPED',
          message: `镜头 ${ch.rowId} 已脱离，跳过角色关联`,
        });
        continue;
      }
      const before = { ...nextRows[rowIdx], roles: [...nextRows[rowIdx].roles] };
      const roleIds: string[] = [];
      for (const name of ch.anchorNames) {
        let anchor = nextAnchors.find((a) => a.name === name);
        if (!anchor) {
          anchor = {
            id: idGenerator('anc'),
            kind: 'character',
            name,
            text: '',
            imageKeys: [],
          };
          nextAnchors.push(anchor);
          diff.addedAnchors.push(anchor);
        }
        if (!roleIds.includes(anchor.id)) roleIds.push(anchor.id);
      }
      const after = { ...before, roles: roleIds };
      nextRows[rowIdx] = after;
      diff.updatedRows[ch.rowId] = {
        before: diff.updatedRows[ch.rowId]?.before ?? before,
        after,
      };
    }
  }

  if (removeCount > 3) {
    warnings.push({
      code: 'REMOVE_OVER_LIMIT',
      message: `本次方案删除了 ${removeCount} 镜（超过 3 镜），请仔细确认`,
    });
  }

  const totalSec = nextRows.reduce((acc, r) => acc + r.dur, 0);
  if (totalSec > desk.budgetSec) {
    warnings.push({
      code: 'BUDGET_EXCEEDED',
      message: `预计总时长 ${totalSec}s，已超过预算 ${desk.budgetSec}s`,
    });
  }

  return {
    nextDesk: { ...desk, rows: nextRows },
    nextAnchors,
    diff,
    warnings,
  };
}
