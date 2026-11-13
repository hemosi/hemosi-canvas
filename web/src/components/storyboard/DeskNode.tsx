import React, { useRef } from 'react';
import { Plus } from 'lucide-react';
import { LaneLayoutResult } from '@/lib/storyboard/layout';
import {
  computeInputsHash,
  deriveNodeHealth,
  getEffectivePrompt,
  getPickedTake,
  rowNodeKey,
} from '@/lib/storyboard/types';
import { useStoryboardStore } from '@/stores/storyboard/use-storyboard-store';
import { DeskRow } from './DeskRow';

interface DeskNodeProps {
  layout: LaneLayoutResult;
  onRegenStale?: () => void;
}

export const DeskNode: React.FC<DeskNodeProps> = ({ layout, onRegenStale }) => {
  const desk = useStoryboardStore((s) => s.desk);
  const anchors = useStoryboardStore((s) => s.anchors);
  const nodes = useStoryboardStore((s) => s.nodes);
  const templates = useStoryboardStore((s) => s.templates);
  const activeTemplateId = useStoryboardStore((s) => s.activeTemplateId);
  const selectedRowId = useStoryboardStore((s) => s.selectedRowId);
  const addRow = useStoryboardStore((s) => s.addRow);
  const moveRow = useStoryboardStore((s) => s.moveRow);

  const dragIndexRef = useRef<number | null>(null);
  const activeTemplate = templates.find((t) => t.id === activeTemplateId) ?? null;

  const totalSec = desk.rows.reduce((acc, r) => acc + r.dur, 0);
  const overBudget = totalSec > desk.budgetSec;

  const getHealth = (rowIndex: number, role: 'frame' | 'video') => {
    const row = desk.rows[rowIndex];
    const node = nodes[rowNodeKey(row.id, role)];
    const picked = getPickedTake(node);
    const modelLabel = picked?.model ?? 'default';
    const prompt = getEffectivePrompt(row, node, anchors, activeTemplate);
    const refKeys = anchors
      .filter((a) => row.roles.includes(a.id))
      .flatMap((a) => a.imageKeys);
    let upstreamTakeId: string | undefined;
    if (role === 'frame' && row.cont && rowIndex > 0) {
      const prevVideo = nodes[rowNodeKey(desk.rows[rowIndex - 1].id, 'video')];
      upstreamTakeId = getPickedTake(prevVideo)?.id;
    }
    const hash = computeInputsHash({
      effectivePrompt: prompt,
      refImageKeys: refKeys,
      model: modelLabel,
      size: row.size,
      upstreamTakeId,
    });
    return deriveNodeHealth(node, hash);
  };

  const videoOkCount = desk.rows.filter(
    (_, idx) => getHealth(idx, 'video') === 'ok'
  ).length;
  const staleCount = desk.rows.filter(
    (r, idx) =>
      getHealth(idx, 'video') === 'stale' ||
      (r.mode === 'frame' && getHealth(idx, 'frame') === 'stale')
  ).length;

  return (
    <div
      data-node-interactive="true"
      style={{
        left: layout.desk.x,
        top: layout.desk.y,
        width: layout.desk.w,
        height: layout.desk.h,
      }}
      className="absolute z-[2] overflow-hidden rounded-[11px] border border-stone-300/70 bg-[#fbfaf7] text-stone-900 dark:border-stone-700/70 dark:bg-[#1c1a17] dark:text-stone-100"
    >
      <div className="flex h-[44px] items-center justify-between gap-2 border-b border-stone-300/60 px-3 dark:border-stone-700/70">
        <div className="flex items-center gap-2">
          <b className="text-[12.5px]">分镜表</b>
          <span
            className={`rounded px-1.5 py-0.5 text-[10.5px] ${
              overBudget
                ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
            }`}
          >
            {totalSec} / {desk.budgetSec} 秒
          </span>
          <span className="rounded bg-stone-200/70 px-1.5 py-0.5 text-[10.5px] text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            {videoOkCount}/{desk.rows.length} 有视频
          </span>
        </div>

        <div className="flex items-center gap-1">
          {staleCount > 0 && onRegenStale && (
            <button
              type="button"
              onClick={onRegenStale}
              className="rounded-md bg-amber-500/15 px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-500/25 dark:text-amber-300"
            >
              重生过期 {staleCount}
            </button>
          )}
          <button
            type="button"
            onClick={() => addRow()}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] hover:bg-black/5 dark:hover:bg-white/10"
          >
            <Plus className="h-3.5 w-3.5" />
            加一镜
          </button>
        </div>
      </div>

      <div>
        {desk.rows.map((row, idx) => {
          const fHealth = row.mode === 'frame' ? getHealth(idx, 'frame') : 'idle';
          const vHealth = getHealth(idx, 'video');
          const vNode = nodes[rowNodeKey(row.id, 'video')];
          const fNode = nodes[rowNodeKey(row.id, 'frame')];
          return (
            <DeskRow
              key={row.id}
              row={row}
              index={idx}
              expanded={row.id === selectedRowId}
              frameHealth={fHealth}
              videoHealth={vHealth}
              detached={Boolean(vNode?.detached || fNode?.detached)}
              onDragStartRow={(i) => {
                dragIndexRef.current = i;
              }}
              onDropOnRow={(targetIdx) => {
                const from = dragIndexRef.current;
                dragIndexRef.current = null;
                if (from !== null && from !== targetIdx) {
                  moveRow(from, targetIdx);
                }
              }}
            />
          );
        })}
      </div>
    </div>
  );
};
