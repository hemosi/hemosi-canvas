import React from 'react';
import {
  DeskRow as DeskRowModel,
  RowNodeHealth,
  estimateDubSeconds,
} from '@/lib/storyboard/types';
import { LAYOUT_CONSTANTS } from '@/lib/storyboard/layout';
import { useStoryboardStore } from '@/stores/storyboard/use-storyboard-store';
import { DeskRowExpanded } from './DeskRowExpanded';

interface DeskRowProps {
  row: DeskRowModel;
  index: number;
  expanded: boolean;
  frameHealth: RowNodeHealth;
  videoHealth: RowNodeHealth;
  detached: boolean;
  onDragStartRow: (index: number) => void;
  onDropOnRow: (index: number) => void;
}

const PIP_CLASS: Record<RowNodeHealth, string> = {
  ok: 'bg-emerald-500',
  stale: 'bg-amber-500',
  error: 'bg-red-500',
  running: 'bg-blue-500 animate-pulse',
  idle: 'bg-stone-300 dark:bg-stone-600',
};

export const DeskRow: React.FC<DeskRowProps> = ({
  row,
  index,
  expanded,
  frameHealth,
  videoHealth,
  detached,
  onDragStartRow,
  onDropOnRow,
}) => {
  const anchors = useStoryboardStore((s) => s.anchors);
  const hoveredRowId = useStoryboardStore((s) => s.hoveredRowId);
  const selectRow = useStoryboardStore((s) => s.selectRow);
  const hoverRow = useStoryboardStore((s) => s.hoverRow);

  const isHovered = hoveredRowId === row.id;
  const estSec = row.dubDurationSec ?? estimateDubSeconds(row.line);
  const isOver = row.voice === 'dub' && row.line.trim().length > 0 && estSec > row.dur;
  const usedAnchors = anchors.filter((a) => row.roles.includes(a.id));

  return (
    <div
      data-r={row.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStartRow(index);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropOnRow(index);
      }}
      onMouseEnter={() => hoverRow(row.id)}
      onMouseLeave={() => hoverRow(null)}
      onClick={() => selectRow(row.id)}
      style={{
        height: expanded
          ? LAYOUT_CONSTANTS.ROW_EXPANDED_H
          : LAYOUT_CONSTANTS.ROW_COLLAPSED_H,
      }}
      className={`relative overflow-hidden border-b border-stone-300/50 transition-colors dark:border-stone-700/60 ${
        expanded
          ? 'bg-white shadow-[inset_3px_0_0_#d97706] dark:bg-stone-900'
          : isHovered
            ? 'bg-black/5 dark:bg-white/5'
            : ''
      }`}
    >
      <div
        style={{ height: LAYOUT_CONSTANTS.ROW_COLLAPSED_H }}
        className="flex cursor-pointer items-center gap-2.5 px-2.5"
      >
        <span
          className="cursor-grab select-none tracking-[-2px] text-stone-400"
          title="拖动排序"
        >
          ⋮⋮
        </span>
        <b className="whitespace-nowrap text-[12px]">
          镜 {String(index + 1).padStart(2, '0')}
        </b>
        <span className="xl min-w-0 flex-1 truncate text-[12px] text-stone-500 dark:text-stone-400">
          {row.desc || '点击展开填写画面描述...'}
        </span>
        <span className="xm whitespace-nowrap text-[11px] text-stone-400">
          {row.dur}s · {row.size}
        </span>

        {usedAnchors.length > 0 && (
          <span className="xm flex pl-1">
            {usedAnchors.map((a) => (
              <i
                key={a.id}
                title={a.name}
                className="-ml-1 inline-grid h-4.5 w-4.5 place-items-center rounded-full border border-white bg-amber-600 text-[10px] not-italic text-white dark:border-stone-900"
              >
                {a.name.slice(0, 1)}
              </i>
            ))}
          </span>
        )}

        {isOver && (
          <span className="xm rounded bg-red-500/15 px-1.5 py-0.5 text-[10.5px] text-red-500">
            配音超时
          </span>
        )}
        {detached && (
          <span className="xm rounded bg-amber-500/15 px-1.5 py-0.5 text-[10.5px] text-amber-600">
            已脱离
          </span>
        )}

        <span className="flex items-center gap-1">
          {row.mode === 'frame' && (
            <>
              <i className={`inline-block h-2.5 w-2.5 rounded-full ${PIP_CLASS[frameHealth]}`} />
              <u className="w-2 border-t-[1.5px] border-stone-300 dark:border-stone-600" />
            </>
          )}
          <i className={`inline-block h-2.5 w-2.5 rounded-full ${PIP_CLASS[videoHealth]}`} />
        </span>
      </div>

      {expanded && <DeskRowExpanded row={row} index={index} />}
    </div>
  );
};
