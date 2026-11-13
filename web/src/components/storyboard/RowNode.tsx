import React, { useEffect, useRef, useState } from 'react';
import { NodeLayoutItem } from '@/lib/storyboard/layout';
import { getMediaUrl, saveMediaBlob } from '@/lib/storyboard/media-store';
import { cancelNodeGeneration } from '@/lib/storyboard/queue-runner';
import {
  DeskRow,
  RowNode as RowNodeModel,
  RowNodeHealth,
  RowNodeRole,
  getPickedTake,
} from '@/lib/storyboard/types';
import { useStoryboardStore } from '@/stores/storyboard/use-storyboard-store';

interface RowNodeProps {
  layout: NodeLayoutItem;
  row: DeskRow;
  index: number;
  node?: RowNodeModel;
  health: RowNodeHealth;
  expanded: boolean;
  dimmed: boolean;
  scale?: number;
  onRequestGenerate: (rowId: string, role: RowNodeRole) => void;
  onPreviewMedia: (url: string, role: RowNodeRole) => void;
}

const HEALTH_BADGE: Record<RowNodeHealth, { label: string; cls: string }> = {
  ok: { label: '已出', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  stale: { label: '过期', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  error: { label: '失败', cls: 'bg-red-500/15 text-red-600 dark:text-red-400' },
  running: { label: '生成中', cls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  idle: { label: '未生成', cls: 'bg-stone-200/70 text-stone-500 dark:bg-stone-800 dark:text-stone-400' },
};

export const RowNode: React.FC<RowNodeProps> = ({
  layout,
  row,
  index,
  node,
  health,
  expanded,
  dimmed,
  scale = 1,
  onRequestGenerate,
  onPreviewMedia,
}) => {
  const selectRow = useStoryboardStore((s) => s.selectRow);
  const hoverRow = useStoryboardStore((s) => s.hoverRow);
  const pickTake = useStoryboardStore((s) => s.pickTake);
  const addTake = useStoryboardStore((s) => s.addTake);
  const setManualNodePos = useStoryboardStore((s) => s.setManualNodePos);

  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragPosRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    dragPosRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: layout.x,
      origY: layout.y,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragPosRef.current) return;
    const dx = (e.clientX - dragPosRef.current.startX) / scale;
    const dy = (e.clientY - dragPosRef.current.startY) / scale;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      setManualNodePos(layout.key, {
        x: Math.round(dragPosRef.current.origX + dx),
        y: Math.round(dragPosRef.current.origY + dy),
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragPosRef.current) return;
    dragPosRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const isFrame = layout.role === 'frame';
  const label = `镜 ${String(index + 1).padStart(2, '0')} · ${isFrame ? '首帧' : '视频'}`;
  const badge = HEALTH_BADGE[health];
  const picked = getPickedTake(node);
  const takeCount = node?.takes.length ?? 0;
  const currentIdx = picked ? node!.takes.findIndex((t) => t.id === picked.id) : -1;

  useEffect(() => {
    let active = true;
    if (!picked?.storageKey) {
      setMediaUrl(null);
      return;
    }
    getMediaUrl(picked.storageKey).then((url) => {
      if (active) setMediaUrl(url);
    });
    return () => {
      active = false;
    };
  }, [picked?.storageKey]);

  const handleDropFile = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const isValid = isFrame
      ? file.type.startsWith('image/')
      : file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mp4');
    if (!isValid) return;
    const storageKey = await saveMediaBlob(file);
    addTake(row.id, layout.role, storageKey, '本地导入');
  };

  const borderCls = dragOver
    ? 'border-amber-500 ring-2 ring-amber-500/30'
    : health === 'error'
      ? 'border-red-500/70'
      : health === 'stale'
        ? 'border-amber-500/70'
        : 'border-stone-300/70 dark:border-stone-700/70';

  return (
    <div
      data-node-interactive="true"
      data-row={row.id}
      onClick={() => selectRow(row.id)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onMouseEnter={() => hoverRow(row.id)}
      onMouseLeave={() => hoverRow(null)}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDropFile}
      style={{
        left: layout.x,
        top: layout.y,
        width: layout.w,
        height: layout.h,
      }}
      className={`absolute rounded-[11px] border bg-[#fbfaf7] transition-opacity duration-150 dark:bg-[#1c1a17] ${borderCls} ${
        dimmed ? 'opacity-30' : 'opacity-100'
      } ${expanded ? 'flex flex-col' : 'flex items-center gap-2.5 px-2.5 py-1'}`}
    >
      {!expanded ? (
        <>
          <div className="grid h-[40px] w-[27px] flex-none place-items-center overflow-hidden rounded-[5px] bg-stone-200 text-[11px] text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            {mediaUrl && isFrame ? (
              <img src={mediaUrl} alt="" className="h-full w-full object-cover" />
            ) : mediaUrl && !isFrame ? (
              <video src={mediaUrl} className="h-full w-full object-cover" muted />
            ) : health === 'ok' || health === 'stale' ? (
              isFrame ? '图' : '▶'
            ) : (
              ''
            )}
          </div>
          <div className="flex min-w-0 flex-col items-start gap-0.5">
            <b className="truncate text-[11px]">{label}</b>
            <span className={`rounded px-1.5 py-0.5 text-[10px] ${badge.cls}`}>
              {badge.label}
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 text-[11px]">
            <b className="truncate">{label}</b>
            <span className={`rounded px-1.5 py-0.5 text-[10px] ${badge.cls}`}>
              {badge.label}
            </span>
          </div>

          <div
            onClick={(e) => {
              if (mediaUrl) {
                e.stopPropagation();
                onPreviewMedia(mediaUrl, layout.role);
              }
            }}
            className={`mx-2 flex flex-1 flex-col items-center justify-center gap-1 overflow-hidden rounded-[7px] bg-[#efece4] p-1 text-center text-[11px] text-stone-500 dark:bg-[#2c2823] dark:text-stone-400 ${
              mediaUrl ? 'cursor-zoom-in' : ''
            }`}
          >
            {health === 'error' ? (
              <div className="px-2 text-red-500">
                <div>生成失败</div>
                <div className="mt-0.5 line-clamp-2 text-[10px] opacity-80">
                  {node?.run?.error || '请检查提示词或通道后重试'}
                </div>
              </div>
            ) : health === 'running' ? (
              <>
                <span>{node?.run?.state === 'queued' ? '排队中…' : '生成中…'}</span>
                <div className="h-[3px] w-4/5 overflow-hidden rounded bg-stone-300 dark:bg-stone-700">
                  <div className="h-full w-3/5 animate-pulse bg-blue-500" />
                </div>
              </>
            ) : mediaUrl ? (
              isFrame ? (
                <img
                  src={mediaUrl}
                  alt=""
                  className="aspect-[9/16] h-full rounded-[5px] object-cover"
                />
              ) : (
                <video
                  src={mediaUrl}
                  className="aspect-[9/16] h-full rounded-[5px] object-cover"
                  muted
                />
              )
            ) : (
              <span>
                {isFrame && row.cont
                  ? `接续：取镜 ${String(index).padStart(2, '0')} 末帧`
                  : `拖入${isFrame ? '图片' : 'MP4'}或点击生成`}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between px-2.5 py-1.5 text-[10.5px] text-stone-500">
            {takeCount > 0 && currentIdx >= 0 ? (
              <span className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const prev = (currentIdx - 1 + takeCount) % takeCount;
                    pickTake(row.id, layout.role, node!.takes[prev].id);
                  }}
                  className="px-1 hover:text-stone-900 dark:hover:text-stone-100"
                >
                  ‹
                </button>
                <span>
                  {currentIdx + 1}/{takeCount}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = (currentIdx + 1) % takeCount;
                    pickTake(row.id, layout.role, node!.takes[next].id);
                  }}
                  className="px-1 hover:text-stone-900 dark:hover:text-stone-100"
                >
                  ›
                </button>
              </span>
            ) : (
              <span className="opacity-60">
                {node?.detached ? '已脱离' : '同步自导演台'}
              </span>
            )}

            {health === 'running' ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  cancelNodeGeneration(row.id, layout.role);
                }}
                className="rounded bg-stone-200 px-1.5 py-0.5 text-[10px] text-stone-700 hover:bg-stone-300 dark:bg-stone-700 dark:text-stone-200"
              >
                取消
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRequestGenerate(row.id, layout.role);
                }}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  health === 'error'
                    ? 'bg-red-500/15 text-red-600 hover:bg-red-500/25'
                    : health === 'stale'
                      ? 'bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-300'
                      : 'hover:bg-black/5 dark:hover:bg-white/10'
                }`}
              >
                {health === 'error' ? '重试' : health === 'stale' ? '重生' : '生成'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};
