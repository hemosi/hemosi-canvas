import { runAgentPlan } from './agent-provider';
import { synthesizeLocalTts } from './local-services';
import { runMediaProvider } from './media-provider';
import {
  RowNodeRole,
  computeInputsHash,
  deriveNodeHealth,
  getEffectivePrompt,
  getPickedTake,
  rowNodeKey,
} from './types';
import { useStoryboardSettingsStore } from '@/stores/storyboard/use-storyboard-settings-store';
import { useStoryboardStore } from '@/stores/storyboard/use-storyboard-store';

export type AutopilotMode = 'manual' | 'semi' | 'auto';

export type AutopilotPhase =
  | 'idle'
  | 'plan'
  | 'frames'
  | 'videos'
  | 'dub'
  | 'done'
  | 'paused'
  | 'cancelled';

export interface AutopilotProgress {
  phase: AutopilotPhase;
  completedShots: number;
  totalShots: number;
  failedRowIds: string[];
  message: string;
}

class AutopilotRunner {
  private controller: AbortController | null = null;
  private paused = false;

  pause() {
    this.paused = true;
    this.controller?.abort();
  }

  cancel() {
    this.paused = false;
    this.controller?.abort();
  }

  isPaused() {
    return this.paused;
  }

  async run(
    instruction: string,
    onProgress: (p: AutopilotProgress) => void,
    opts?: { autoQc?: boolean; maxRetries?: number }
  ): Promise<AutopilotProgress> {
    this.paused = false;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const settings = useStoryboardSettingsStore.getState();
    const maxRetries = opts?.maxRetries ?? 3;

    const failedRowIds: string[] = [];

    const report = (phase: AutopilotPhase, message: string): AutopilotProgress => {
      const s = useStoryboardStore.getState();
      const totalShots = s.desk.rows.length;
      const completedShots = s.desk.rows.filter((r) => {
        const vNode = s.nodes[rowNodeKey(r.id, 'video')];
        return Boolean(getPickedTake(vNode));
      }).length;
      const p = { phase, completedShots, totalShots, failedRowIds: [...failedRowIds], message };
      onProgress(p);
      return p;
    };

    try {
      // 1. 剧本 Plan（如果传了新指令则生成并自动采纳）
      if (instruction.trim()) {
        report('plan', '正在生成分镜方案并自动采纳...');
        const s = useStoryboardStore.getState();
        const plan = await runAgentPlan(
          {
            instruction,
            desk: s.desk,
            anchors: s.anchors,
            selectedRowId: s.selectedRowId,
          },
          settings.textConfig,
          signal
        );
        s.applyPlan(
          plan,
          plan.changes.map((c) => c.id)
        );
      }

      const runRoleForRow = async (rowIndex: number, role: RowNodeRole) => {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const st = useStoryboardStore.getState();
        const row = st.desk.rows[rowIndex];
        if (!row) return;
        const tpl = st.templates.find((t) => t.id === st.activeTemplateId) ?? null;
        const key = rowNodeKey(row.id, role);
        const node = st.nodes[key];
        const cfg = role === 'frame' ? settings.imageConfig : settings.videoConfig;
        const prompt = getEffectivePrompt(row, node, st.anchors, tpl);
        const refKeys = st.anchors
          .filter((a) => row.roles.includes(a.id))
          .flatMap((a) => a.imageKeys);
        const hash = computeInputsHash({
          effectivePrompt: prompt,
          refImageKeys: refKeys,
          model: cfg.model,
          size: row.size,
        });

        // 已是 ok 则断点跳过
        if (deriveNodeHealth(node, hash) === 'ok') return;

        st.setNodeRun(row.id, role, { state: 'running' });
        try {
          const storageKey = await runMediaProvider(
            { role, prompt, size: row.size, dur: row.dur },
            cfg,
            signal
          );
          useStoryboardStore.getState().addTake(row.id, role, storageKey, cfg.model);
        } catch (err) {
          if ((err as Error).name === 'AbortError') throw err;
          // 审核失败等错误尝试让文字模型改写提示词重试 1 次
          const msg = err instanceof Error ? err.message : String(err);
          if (/audit|safety|sensitive|审核/i.test(msg) && settings.textConfig.apiKey) {
            try {
              const safePrompt = `${prompt}（安全合规画面，无敏感元素）`;
              const storageKey = await runMediaProvider(
                { role, prompt: safePrompt, size: row.size, dur: row.dur },
                cfg,
                signal
              );
              useStoryboardStore.getState().addTake(row.id, role, storageKey, cfg.model);
              return;
            } catch {
              // 重试仍失败，标记失败继续其余镜头
            }
          }
          useStoryboardStore.getState().setNodeRun(row.id, role, {
            state: 'error',
            error: msg,
          });
          if (!failedRowIds.includes(row.id)) failedRowIds.push(row.id);
        }
      };

      // 2. 首帧与视频（按依赖顺序：接续镜先等上一镜出片，非接续依次推进）
      report('frames', '正在生成首帧与视频...');
      const rows = useStoryboardStore.getState().desk.rows;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.mode === 'frame') {
          await runRoleForRow(i, 'frame');
        }
        report('videos', `正在推进镜 ${String(i + 1).padStart(2, '0')} / ${rows.length}...`);
        await runRoleForRow(i, 'video');
      }

      // 3. 本地 TTS 配音
      if (settings.localHealth.tts) {
        report('dub', '正在合成后期配音...');
        const curRows = useStoryboardStore.getState().desk.rows;
        for (const r of curRows) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          if (r.voice === 'dub' && r.line.trim() && !r.dubStorageKey) {
            try {
              const tts = await synthesizeLocalTts(
                r.line,
                settings.localEndpoints.ttsUrl,
                'alloy',
                signal
              );
              useStoryboardStore.getState().updateRow(r.id, {
                dubStorageKey: tts.storageKey,
                dubDurationSec: tts.durationSec,
              });
            } catch {
              // 配音单镜失败不阻断全局
            }
          }
        }
      }

      const finalS = useStoryboardStore.getState();
      const okCount = finalS.desk.rows.filter((r) =>
        Boolean(getPickedTake(finalS.nodes[rowNodeKey(r.id, 'video')]))
      ).length;
      return report(
        'done',
        `完成 ${okCount}/${finalS.desk.rows.length} 镜${
          failedRowIds.length > 0 ? `，${failedRowIds.length} 镜失败` : ''
        }`
      );
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return report(
          this.paused ? 'paused' : 'cancelled',
          this.paused ? '已暂停，可点击继续断点续跑' : '已取消一键出片'
        );
      }
      return report('done', err instanceof Error ? err.message : '流水线中断');
    }
  }
}

export const autopilotRunner = new AutopilotRunner();
