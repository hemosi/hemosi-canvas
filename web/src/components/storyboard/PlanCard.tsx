import React from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import { Change, Plan } from '@/lib/storyboard/plan-schema';
import { PlanWarning } from '@/lib/storyboard/plan';
import { DeskRow } from '@/lib/storyboard/types';

interface PlanCardProps {
  plan: Plan;
  rows: DeskRow[];
  enabledIds: Set<string>;
  warnings: PlanWarning[];
  onToggleChange: (id: string) => void;
  onApply: () => void;
  onDiscard: () => void;
  onSuggestRun?: (rowIds: string[], kind: 'image' | 'video') => void;
}

function describeChange(ch: Change, rows: DeskRow[]): { tag: string; text: string } {
  const rowIndex = (id: string) => {
    const i = rows.findIndex((r) => r.id === id);
    return i >= 0 ? `镜 ${String(i + 1).padStart(2, '0')}` : id;
  };

  switch (ch.kind) {
    case 'row.add':
      return {
        tag: '新增',
        text: `${ch.row.desc || '新镜头'}（${ch.row.dur ?? 5}s · ${ch.row.size ?? '中景'}）`,
      };
    case 'row.update': {
      const parts: string[] = [];
      if (ch.patch.desc !== undefined) parts.push(`画面: ${ch.patch.desc}`);
      if (ch.patch.line !== undefined) parts.push(`台词: ${ch.patch.line || '无'}`);
      if (ch.patch.dur !== undefined) parts.push(`时长: ${ch.patch.dur}s`);
      if (ch.patch.size !== undefined) parts.push(`景别: ${ch.patch.size}`);
      return {
        tag: '修改',
        text: `${rowIndex(ch.rowId)} · ${parts.join(' / ') || '更新属性'}`,
      };
    }
    case 'row.remove':
      return { tag: '删除', text: `移除 ${rowIndex(ch.rowId)}` };
    case 'row.move':
      return { tag: '排序', text: `将 ${rowIndex(ch.rowId)} 移至第 ${ch.to + 1} 镜` };
    case 'anchor.add':
      return { tag: '锚点', text: `新增${ch.anchor.kind}：${ch.anchor.name}` };
    case 'row.roles':
      return {
        tag: '出镜',
        text: `${rowIndex(ch.rowId)} 绑定：${ch.anchorNames.join('、')}`,
      };
  }
}

export const PlanCard: React.FC<PlanCardProps> = ({
  plan,
  rows,
  enabledIds,
  warnings,
  onToggleChange,
  onApply,
  onDiscard,
  onSuggestRun,
}) => {
  const enabledCount = plan.changes.filter((c) => enabledIds.has(c.id)).length;

  return (
    <div className="flex flex-col gap-2 rounded-[9px] border border-stone-300/70 bg-white p-2.5 text-[11.5px] leading-relaxed dark:border-stone-700/70 dark:bg-stone-900">
      <div className="font-medium text-stone-900 dark:text-stone-100">
        {plan.summary}
      </div>

      <div className="flex flex-col gap-1.5">
        {plan.changes.map((ch) => {
          const checked = enabledIds.has(ch.id);
          const { tag, text } = describeChange(ch, rows);
          return (
            <label
              key={ch.id}
              className="grid cursor-pointer grid-cols-[16px_34px_1fr] items-start gap-1.5 rounded-[7px] bg-[#efece4] px-2 py-1.5 text-[11px] dark:bg-[#2c2823]"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggleChange(ch.id)}
                className="mt-0.5 accent-amber-600"
              />
              <span
                className={`font-semibold ${
                  ch.kind === 'row.add' || ch.kind === 'anchor.add'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : ch.kind === 'row.remove'
                      ? 'text-red-500'
                      : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {tag}
              </span>
              <span className={checked ? '' : 'line-through opacity-50'}>
                {text}
              </span>
            </label>
          );
        })}
      </div>

      {warnings.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md bg-amber-500/10 p-2 text-[10.5px] text-amber-700 dark:text-amber-300">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={onDiscard}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-stone-500 hover:bg-black/5 dark:hover:bg-white/10"
        >
          <X className="h-3.5 w-3.5" />
          不要
        </button>

        <div className="flex items-center gap-1.5">
          {plan.suggestRun && plan.suggestRun.rowIds.length > 0 && (
            <button
              type="button"
              onClick={() =>
                onSuggestRun?.(plan.suggestRun!.rowIds, plan.suggestRun!.kind)
              }
              className="rounded-md border border-stone-300 px-2 py-1 text-[11px] hover:bg-black/5 dark:border-stone-700 dark:hover:bg-white/10"
            >
              建议生成 ({plan.suggestRun.rowIds.length})
            </button>
          )}
          <button
            type="button"
            disabled={enabledCount === 0}
            onClick={onApply}
            className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-700 disabled:opacity-40"
          >
            <Check className="h-3.5 w-3.5" />
            应用所选 ({enabledCount})
          </button>
        </div>
      </div>
    </div>
  );
};
