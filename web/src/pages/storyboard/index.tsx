import React, { useEffect, useMemo, useState } from 'react';
import { Clapperboard, PanelRight, Pause, Play, Square } from 'lucide-react';
import { AgentPanel } from '@/components/storyboard/AgentPanel';
import { CommandItem, CommandPalette } from '@/components/storyboard/CommandPalette';
import { ConfirmGenTarget } from '@/components/storyboard/GenerateConfirmModal';
import { PreviewStitchModal } from '@/components/storyboard/PreviewStitchModal';
import { StoryboardStage } from '@/components/storyboard/StoryboardStage';
import {
  AutopilotMode,
  AutopilotProgress,
  autopilotRunner,
} from '@/lib/storyboard/autopilot';
import { probeLocalServices } from '@/lib/storyboard/local-services';
import { previewPlan } from '@/lib/storyboard/plan';
import { Plan } from '@/lib/storyboard/plan-schema';
import { getEffectivePrompt, rowNodeKey } from '@/lib/storyboard/types';
import { useStoryboardSettingsStore } from '@/stores/storyboard/use-storyboard-settings-store';
import { useStoryboardStore } from '@/stores/storyboard/use-storyboard-store';

export default function StoryboardPage() {
  const desk = useStoryboardStore((s) => s.desk);
  const anchors = useStoryboardStore((s) => s.anchors);
  const nodes = useStoryboardStore((s) => s.nodes);
  const setDeskMeta = useStoryboardStore((s) => s.setDeskMeta);
  const applyPlan = useStoryboardStore((s) => s.applyPlan);
  const addRow = useStoryboardStore((s) => s.addRow);
  const tidyLayout = useStoryboardStore((s) => s.tidyLayout);
  const undo = useStoryboardStore((s) => s.undo);
  const redo = useStoryboardStore((s) => s.redo);

  const localEndpoints = useStoryboardSettingsStore((s) => s.localEndpoints);
  const setLocalHealth = useStoryboardSettingsStore((s) => s.setLocalHealth);

  const [showAgent, setShowAgent] = useState(true);
  const [agentTab, setAgentTab] = useState<'chat' | 'props' | 'clone'>('chat');
  const [pendingPlan, setPendingPlan] = useState<Plan | null>(null);
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());
  const [stitchOpen, setStitchOpen] = useState(false);

  const [mode, setMode] = useState<AutopilotMode>('manual');
  const [autoConfirmOpen, setAutoConfirmOpen] = useState(false);
  const [autoQc, setAutoQc] = useState(false);
  const [autoProgress, setAutoProgress] = useState<AutopilotProgress | null>(null);
  const [suggestTargets, setSuggestTargets] = useState<ConfirmGenTarget[]>([]);

  // 启动时静默探测本机服务
  useEffect(() => {
    probeLocalServices(localEndpoints).then(setLocalHealth).catch(() => {});
  }, [localEndpoints, setLocalHealth]);

  const preview = useMemo(() => {
    if (!pendingPlan) return null;
    return previewPlan(desk, anchors, nodes, pendingPlan, enabledIds);
  }, [desk, anchors, nodes, pendingPlan, enabledIds]);

  const handlePlanReady = (plan: Plan) => {
    if (mode === 'semi' || mode === 'auto') {
      applyPlan(
        plan,
        plan.changes.map((c) => c.id)
      );
      setPendingPlan(null);
      setEnabledIds(new Set());
      return;
    }
    setPendingPlan(plan);
    setEnabledIds(new Set(plan.changes.map((c) => c.id)));
  };

  const handleToggleChange = (id: string) => {
    setEnabledIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApplyPlan = () => {
    if (!pendingPlan) return;
    applyPlan(pendingPlan, Array.from(enabledIds));
    setPendingPlan(null);
    setEnabledIds(new Set());
  };

  const handleDiscardPlan = () => {
    setPendingPlan(null);
    setEnabledIds(new Set());
  };

  const startAutopilot = () => {
    setAutoConfirmOpen(false);
    autopilotRunner.run('', (p) => setAutoProgress(p), { autoQc });
  };

  const handleSuggestRun = (rowIds: string[], kind: 'image' | 'video') => {
    const role = kind === 'image' ? 'frame' : 'video';
    const targets: ConfirmGenTarget[] = [];
    desk.rows.forEach((r, idx) => {
      if (!rowIds.includes(r.id)) return;
      if (role === 'frame' && r.mode !== 'frame') return;
      const node = nodes[rowNodeKey(r.id, role)];
      targets.push({
        rowId: r.id,
        rowIndex: idx,
        role,
        prompt: getEffectivePrompt(r, node, anchors, null),
        size: r.size,
        dur: r.dur,
      });
    });
    if (targets.length > 0) setSuggestTargets(targets);
  };

  const commands: CommandItem[] = [
    { id: 'add-row', label: '添加一镜', hint: '分镜表', run: () => addRow() },
    { id: 'tidy', label: '整理画布布局', hint: '排版', run: tidyLayout },
    { id: 'stitch', label: '预览拼接 / 导出成片', hint: 'P3', run: () => setStitchOpen(true) },
    {
      id: 'clone',
      label: '打开爆款复刻',
      hint: 'P4',
      run: () => {
        setShowAgent(true);
        setAgentTab('clone');
      },
    },
    { id: 'undo', label: '撤销上一步', hint: 'Cmd/Ctrl+Z', run: undo },
    { id: 'redo', label: '重做', hint: 'Cmd/Ctrl+Shift+Z', run: redo },
  ];

  const isRunningAuto =
    autoProgress &&
    ['plan', 'frames', 'videos', 'dub'].includes(autoProgress.phase);

  return (
    <div className="flex h-[calc(100vh-48px)] w-full flex-col overflow-hidden bg-[#f5f3ee] text-stone-900 dark:bg-[#141311] dark:text-stone-100">
      <header className="flex h-[42px] shrink-0 items-center justify-between border-b border-stone-300/60 px-3.5 dark:border-stone-800">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={desk.title}
            onChange={(e) => setDeskMeta({ title: e.target.value })}
            className="w-44 rounded bg-transparent px-1.5 py-0.5 text-[13px] font-semibold outline-none hover:bg-black/5 focus:bg-white dark:hover:bg-white/10 dark:focus:bg-stone-900"
          />
          <span className="rounded bg-stone-200/70 px-1.5 py-0.5 text-[10.5px] text-stone-500 dark:bg-stone-800 dark:text-stone-400">
            已本地保存
          </span>
        </div>

        <div className="flex items-center gap-2 text-[11.5px]">
          <div className="inline-flex rounded-md bg-stone-200/70 p-0.5 text-[10.5px] dark:bg-stone-800">
            {(
              [
                ['manual', '手动'],
                ['semi', '半自动'],
                ['auto', '全自动'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setMode(k)}
                className={`rounded px-2 py-0.5 transition ${
                  mode === k
                    ? 'bg-white font-medium text-stone-900 shadow-xs dark:bg-stone-700 dark:text-stone-100'
                    : 'text-stone-500 hover:text-stone-800 dark:text-stone-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'auto' && (
            <button
              type="button"
              onClick={() => setAutoConfirmOpen(true)}
              className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-700"
            >
              <Play className="h-3 w-3" />
              一键出片
            </button>
          )}

          <button
            type="button"
            onClick={() => setStitchOpen(true)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-stone-600 hover:bg-black/5 dark:text-stone-300 dark:hover:bg-white/10"
          >
            <Clapperboard className="h-3.5 w-3.5" />
            预览拼接
          </button>

          <button
            type="button"
            onClick={() => setShowAgent((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-stone-600 hover:bg-black/5 dark:text-stone-300 dark:hover:bg-white/10"
          >
            <PanelRight className="h-3.5 w-3.5" />
            Agent 面板
          </button>
        </div>
      </header>

      {/* 全自动进度条 */}
      {autoProgress && (
        <div className="flex shrink-0 items-center justify-between border-b border-stone-300/60 bg-amber-500/10 px-4 py-1.5 text-[11px] dark:border-stone-800">
          <span>
            <b>一键出片：</b>
            {autoProgress.message}（{autoProgress.completedShots}/
            {autoProgress.totalShots}）
          </span>
          <div className="flex items-center gap-1.5">
            {isRunningAuto ? (
              <button
                type="button"
                onClick={() => autopilotRunner.pause()}
                className="inline-flex items-center gap-1 rounded bg-stone-200 px-2 py-0.5 text-stone-700 dark:bg-stone-800 dark:text-stone-200"
              >
                <Pause className="h-3 w-3" />
                暂停
              </button>
            ) : autoProgress.phase === 'paused' ? (
              <button
                type="button"
                onClick={startAutopilot}
                className="inline-flex items-center gap-1 rounded bg-amber-600 px-2 py-0.5 text-white"
              >
                <Play className="h-3 w-3" />
                继续
              </button>
            ) : null}
            {isRunningAuto && (
              <button
                type="button"
                onClick={() => autopilotRunner.cancel()}
                className="inline-flex items-center gap-1 rounded bg-red-500/15 px-2 py-0.5 text-red-600"
              >
                <Square className="h-3 w-3" />
                取消
              </button>
            )}
            {!isRunningAuto && (
              <button
                type="button"
                onClick={() => setAutoProgress(null)}
                className="px-1.5 text-stone-400 hover:text-stone-700"
              >
                关闭
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <StoryboardStage
          preview={preview}
          externalConfirmTargets={suggestTargets}
          onClearExternalConfirm={() => setSuggestTargets([])}
          onOpenViralClone={() => {
            setShowAgent(true);
            setAgentTab('clone');
          }}
        />
        {showAgent && (
          <AgentPanel
            pendingPlan={pendingPlan}
            enabledIds={enabledIds}
            preview={preview}
            onPlanReady={handlePlanReady}
            onToggleChange={handleToggleChange}
            onApplyPlan={handleApplyPlan}
            onDiscardPlan={handleDiscardPlan}
            onSuggestRun={handleSuggestRun}
            activeTab={agentTab}
            onTabChange={setAgentTab}
          />
        )}
      </div>

      {/* 全自动唯一确认卡 */}
      {autoConfirmOpen && (
        <div
          onClick={() => setAutoConfirmOpen(false)}
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-[400px] flex-col gap-3 rounded-[14px] border border-stone-300/70 bg-[#fbfaf7] p-4 text-[12px] dark:border-stone-700 dark:bg-[#1c1a17]"
          >
            <b className="text-[13.5px]">确认一键出片（全自动）</b>
            <div className="rounded-lg bg-[#efece4] p-2.5 text-[11px] leading-relaxed dark:bg-[#2c2823]">
              将按顺序推进共 <b>{desk.rows.length} 镜</b>（首帧 → 视频 → 本地配音）。遇审核失败自动改写重试 1 次，单镜失败不阻断全局，可随时暂停或取消。
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-[11px]">
              <input
                type="checkbox"
                checked={autoQc}
                onChange={(e) => setAutoQc(e.target.checked)}
                className="accent-amber-600"
              />
              <span>开启自动质检（每镜最多重试 3 次，自动保留最佳结果）</span>
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAutoConfirmOpen(false)}
                className="rounded-lg border border-stone-300 px-3 py-1.5 text-[11.5px] dark:border-stone-700"
              >
                取消
              </button>
              <button
                type="button"
                onClick={startAutopilot}
                className="rounded-lg bg-amber-600 px-3.5 py-1.5 text-[11.5px] font-medium text-white hover:bg-amber-700"
              >
                开始全自动出片
              </button>
            </div>
          </div>
        </div>
      )}

      <PreviewStitchModal open={stitchOpen} onClose={() => setStitchOpen(false)} />
      <CommandPalette items={commands} />
    </div>
  );
}
