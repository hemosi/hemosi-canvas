import React, { useEffect, useMemo, useState } from 'react';
import { Undo2, Redo2, LayoutGrid, Maximize2, Plus, Flame } from 'lucide-react';
import { laneLayout } from '@/lib/storyboard/layout';
import { PreviewPlanResult } from '@/lib/storyboard/plan';
import { enqueueGenerationTargets } from '@/lib/storyboard/queue-runner';
import {
  RowNodeRole,
  computeInputsHash,
  deriveNodeHealth,
  estimateDubSeconds,
  getEffectivePrompt,
  getPickedTake,
  rowNodeKey,
} from '@/lib/storyboard/types';
import { useStoryboardStore } from '@/stores/storyboard/use-storyboard-store';
import { AnchorNode } from './AnchorNode';
import { DeskNode } from './DeskNode';
import { ConfirmGenTarget, GenerateConfirmModal } from './GenerateConfirmModal';
import { GhostLayer } from './GhostLayer';
import { MediaPreviewModal } from './MediaPreviewModal';
import { MiniMap } from './MiniMap';
import { RowNode } from './RowNode';
import { Wires } from './Wires';
import { useCamera } from './use-camera';

interface StoryboardStageProps {
  preview?: PreviewPlanResult | null;
  externalConfirmTargets?: ConfirmGenTarget[];
  onClearExternalConfirm?: () => void;
  onOpenAnchorModal?: () => void;
  onOpenViralClone?: () => void;
}

export const StoryboardStage: React.FC<StoryboardStageProps> = ({
  preview = null,
  externalConfirmTargets,
  onClearExternalConfirm,
  onOpenAnchorModal,
  onOpenViralClone,
}) => {
  const desk = useStoryboardStore((s) => s.desk);
  const anchors = useStoryboardStore((s) => s.anchors);
  const nodes = useStoryboardStore((s) => s.nodes);
  const templates = useStoryboardStore((s) => s.templates);
  const activeTemplateId = useStoryboardStore((s) => s.activeTemplateId);
  const selectedRowId = useStoryboardStore((s) => s.selectedRowId);
  const hoveredRowId = useStoryboardStore((s) => s.hoveredRowId);
  const selectRow = useStoryboardStore((s) => s.selectRow);
  const tidyLayout = useStoryboardStore((s) => s.tidyLayout);
  const addAnchor = useStoryboardStore((s) => s.addAnchor);
  const undo = useStoryboardStore((s) => s.undo);
  const redo = useStoryboardStore((s) => s.redo);
  const canUndo = useStoryboardStore((s) => s.history.past.length > 0);
  const canRedo = useStoryboardStore((s) => s.history.future.length > 0);

  const { cam, lod, stageRef, zoomBy, fit, handlers } = useCamera();
  const [confirmTargets, setConfirmTargets] = useState<ConfirmGenTarget[]>([]);
  const [previewMedia, setPreviewMedia] = useState<{
    url: string;
    role: RowNodeRole;
  } | null>(null);
  const activeTemplate = templates.find((t) => t.id === activeTemplateId) ?? null;

  const layout = useMemo(
    () => laneLayout(desk, anchors, nodes, selectedRowId),
    [desk, anchors, nodes, selectedRowId]
  );

  // Cmd/Ctrl+Z 与 Cmd/Ctrl+Shift+Z 快捷键
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if (isInput) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  const hoveredRow = useMemo(
    () => desk.rows.find((r) => r.id === hoveredRowId) ?? null,
    [desk.rows, hoveredRowId]
  );

  const totalSec = desk.rows.reduce((acc, r) => acc + r.dur, 0);

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

  const requestGenerateNode = (rowId: string, role: RowNodeRole) => {
    const idx = desk.rows.findIndex((r) => r.id === rowId);
    if (idx < 0) return;
    const row = desk.rows[idx];
    const node = nodes[rowNodeKey(rowId, role)];
    const prompt = getEffectivePrompt(row, node, anchors, activeTemplate);
    setConfirmTargets([
      { rowId, rowIndex: idx, role, prompt, size: row.size, dur: row.dur },
    ]);
  };

  const requestRegenStale = () => {
    const targets: ConfirmGenTarget[] = [];
    desk.rows.forEach((row, idx) => {
      (['frame', 'video'] as RowNodeRole[]).forEach((role) => {
        if (role === 'frame' && row.mode !== 'frame') return;
        if (getHealth(idx, role) === 'stale') {
          const node = nodes[rowNodeKey(row.id, role)];
          targets.push({
            rowId: row.id,
            rowIndex: idx,
            role,
            prompt: getEffectivePrompt(row, node, anchors, activeTemplate),
            size: row.size,
            dur: row.dur,
          });
        }
      });
    });
    if (targets.length > 0) setConfirmTargets(targets);
  };

  return (
    <div
      ref={stageRef}
      data-lod={lod}
      {...handlers}
      className="relative flex-1 cursor-grab overflow-hidden bg-[#f5f3ee] select-none active:cursor-grabbing dark:bg-[#141311]"
      style={{
        backgroundImage:
          'radial-gradient(rgba(120,113,108,0.18) 1px, transparent 1px)',
        backgroundSize: '22px 22px',
        touchAction: 'none',
      }}
    >
      <style>{`
        [data-lod="mid"] .xm { display: none; }
        [data-lod="low"] .xm, [data-lod="low"] .xl { display: none; }
        [data-lod="low"] b { font-size: 16px; }
      `}</style>
      {/* 极简扁平左上工具条 */}
      <div
        data-node-interactive="true"
        className="absolute top-3 left-3 z-10 flex items-center gap-1 text-[11.5px] text-stone-700 dark:text-stone-300"
      >
        <button
          type="button"
          onClick={() =>
            onOpenAnchorModal
              ? onOpenAnchorModal()
              : addAnchor({
                  kind: 'character',
                  name: `设定 ${anchors.length + 1}`,
                  text: '',
                  imageKeys: [],
                })
          }
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10"
        >
          <Plus className="h-3.5 w-3.5" />
          加锚点
        </button>
        <button
          type="button"
          onClick={tidyLayout}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          整理
        </button>
        <button
          type="button"
          onClick={() => fit(1360, layout.boardHeight)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          适应窗口
        </button>
        <button
          type="button"
          disabled={!canUndo}
          onClick={undo}
          title="撤销 (Ctrl/Cmd+Z)"
          className="rounded-md p-1.5 hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={!canRedo}
          onClick={redo}
          title="重做 (Ctrl/Cmd+Shift+Z)"
          className="rounded-md p-1.5 hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </button>
        {onOpenViralClone && (
          <button
            type="button"
            onClick={onOpenViralClone}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-amber-600 hover:bg-black/5 dark:text-amber-400 dark:hover:bg-white/10"
          >
            <Flame className="h-3.5 w-3.5" />
            爆款复刻
          </button>
        )}
      </div>

      {/* 画布变换层 */}
      <div
        style={{
          width: 1400,
          height: layout.boardHeight,
          transformOrigin: '0 0',
          transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`,
        }}
        className="absolute top-0 left-0"
      >
        <Wires wires={layout.wires} hoveredRowId={hoveredRowId} />

        {layout.anchors.map((aLayout) => {
          const anchor = anchors.find((a) => a.id === aLayout.anchorId);
          if (!anchor) return null;
          const usedCount = desk.rows.filter((r) =>
            r.roles.includes(anchor.id)
          ).length;
          const dimmed = Boolean(
            hoveredRow && !hoveredRow.roles.includes(anchor.id)
          );
          return (
            <AnchorNode
              key={anchor.id}
              anchor={anchor}
              layout={aLayout}
              usedCount={usedCount}
              dimmed={dimmed}
            />
          );
        })}

        <DeskNode layout={layout} onRegenStale={requestRegenStale} />

        {desk.rows.map((row, idx) => {
          const expanded = row.id === selectedRowId;
          const dimmed = Boolean(hoveredRowId && hoveredRowId !== row.id);
          const fKey = rowNodeKey(row.id, 'frame');
          const vKey = rowNodeKey(row.id, 'video');
          const fLayout = layout.nodes[fKey];
          const vLayout = layout.nodes[vKey];

          return (
            <React.Fragment key={row.id}>
              {row.mode === 'frame' && fLayout && (
                <RowNode
                  layout={fLayout}
                  row={row}
                  index={idx}
                  node={nodes[fKey]}
                  health={getHealth(idx, 'frame')}
                  expanded={expanded}
                  dimmed={dimmed}
                  scale={cam.k}
                  onRequestGenerate={requestGenerateNode}
                  onPreviewMedia={(url, role) => setPreviewMedia({ url, role })}
                />
              )}
              {vLayout && (
                <RowNode
                  layout={vLayout}
                  row={row}
                  index={idx}
                  node={nodes[vKey]}
                  health={getHealth(idx, 'video')}
                  expanded={expanded}
                  dimmed={dimmed}
                  scale={cam.k}
                  onRequestGenerate={requestGenerateNode}
                  onPreviewMedia={(url, role) => setPreviewMedia({ url, role })}
                />
              )}
            </React.Fragment>
          );
        })}

        <GhostLayer preview={preview} layout={layout} />
      </div>

      {/* 小地图 */}
      <MiniMap layout={layout} cam={cam} />

      {/* 底部提示与缩放控制 */}
      <div className="pointer-events-none absolute bottom-14 left-3 z-10 text-[10.5px] text-stone-400">
        拖空白处平移 · 滚轮平移 · ⌘/Ctrl＋滚轮缩放 · 点一镜展开
      </div>

      <div
        data-node-interactive="true"
        className="absolute right-3 bottom-14 z-10 flex items-center gap-0.5 rounded-lg border border-stone-300/70 bg-[#fbfaf7] p-0.5 text-[11px] dark:border-stone-700/70 dark:bg-[#1c1a17]"
      >
        <button
          type="button"
          onClick={() => zoomBy(0.85)}
          className="rounded px-2 py-0.5 hover:bg-black/5 dark:hover:bg-white/10"
        >
          －
        </button>
        <button
          type="button"
          onClick={() => fit(1360, layout.boardHeight)}
          className="rounded px-2 py-0.5 hover:bg-black/5 dark:hover:bg-white/10"
        >
          {Math.round(cam.k * 100)}%
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1.18)}
          className="rounded px-2 py-0.5 hover:bg-black/5 dark:hover:bg-white/10"
        >
          ＋
        </button>
      </div>

      {/* 底部时间条 */}
      <div
        data-node-interactive="true"
        className="absolute right-3 bottom-2.5 left-3 z-10 flex h-[38px] items-center gap-2 rounded-[9px] border border-stone-300/70 bg-[#fbfaf7] px-2.5 dark:border-stone-700/70 dark:bg-[#1c1a17]"
      >
        <span className="text-[10.5px] text-stone-400">时间条</span>
        <div className="flex h-[22px] flex-1 gap-0.5">
          {desk.rows.map((r, i) => {
            const vHealth = getHealth(i, 'video');
            const isOver =
              r.voice === 'dub' &&
              r.line.trim().length > 0 &&
              (r.dubDurationSec ?? estimateDubSeconds(r.line)) > r.dur;
            const bgCls =
              vHealth === 'ok'
                ? 'bg-emerald-500/20'
                : vHealth === 'stale'
                  ? 'bg-amber-500/25'
                  : vHealth === 'error'
                    ? 'bg-red-500/20'
                    : vHealth === 'running'
                      ? 'bg-blue-500/20'
                      : 'bg-stone-200/70 dark:bg-stone-800';
            return (
              <div
                key={r.id}
                onClick={() => selectRow(r.id)}
                style={{ flex: r.dur }}
                title={`镜 ${String(i + 1).padStart(2, '0')} · ${r.dur}s`}
                className={`grid cursor-pointer place-items-center rounded text-[10.5px] text-stone-600 dark:text-stone-300 ${bgCls} ${
                  r.id === selectedRowId ? 'outline-[1.5px] outline-amber-600' : ''
                } ${isOver ? 'border-b-[3px] border-red-500' : ''}`}
              >
                {String(i + 1).padStart(2, '0')}
              </div>
            );
          })}
        </div>
        <span className="text-[11px] text-stone-500">{totalSec}s</span>
      </div>

      <GenerateConfirmModal
        targets={
          externalConfirmTargets && externalConfirmTargets.length > 0
            ? externalConfirmTargets
            : confirmTargets
        }
        onCancel={() => {
          setConfirmTargets([]);
          onClearExternalConfirm?.();
        }}
        onConfirm={() => {
          const list =
            externalConfirmTargets && externalConfirmTargets.length > 0
              ? externalConfirmTargets
              : confirmTargets;
          enqueueGenerationTargets(list);
          setConfirmTargets([]);
          onClearExternalConfirm?.();
        }}
      />

      <MediaPreviewModal
        url={previewMedia?.url ?? null}
        role={previewMedia?.role ?? 'frame'}
        onClose={() => setPreviewMedia(null)}
      />
    </div>
  );
};
