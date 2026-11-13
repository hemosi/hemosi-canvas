import React, { useMemo, useRef, useState } from 'react';
import { Loader2, Settings, Square, Send, Plus, Trash2 } from 'lucide-react';
import {
  checkTextProviderHealth,
  runAgentPlan,
} from '@/lib/storyboard/agent-provider';
import { probeLocalServices } from '@/lib/storyboard/local-services';
import { PreviewPlanResult } from '@/lib/storyboard/plan';
import { Plan } from '@/lib/storyboard/plan-schema';
import { getEffectivePrompt } from '@/lib/storyboard/types';
import { useStoryboardSettingsStore } from '@/stores/storyboard/use-storyboard-settings-store';
import { useStoryboardStore } from '@/stores/storyboard/use-storyboard-store';
import { PlanCard } from './PlanCard';
import { ViralCloneTab } from './ViralCloneTab';

interface AgentPanelProps {
  pendingPlan: Plan | null;
  enabledIds: Set<string>;
  preview: PreviewPlanResult | null;
  onPlanReady: (plan: Plan) => void;
  onToggleChange: (id: string) => void;
  onApplyPlan: () => void;
  onDiscardPlan: () => void;
  onSuggestRun?: (rowIds: string[], kind: 'image' | 'video') => void;
  activeTab?: 'chat' | 'props' | 'clone';
  onTabChange?: (tab: 'chat' | 'props' | 'clone') => void;
}

export const AgentPanel: React.FC<AgentPanelProps> = ({
  pendingPlan,
  enabledIds,
  preview,
  onPlanReady,
  onToggleChange,
  onApplyPlan,
  onDiscardPlan,
  onSuggestRun,
  activeTab,
  onTabChange,
}) => {
  const [innerTab, setInnerTab] = useState<'chat' | 'props' | 'clone'>('chat');
  const tab = activeTab ?? innerTab;
  const setTab = (t: 'chat' | 'props' | 'clone') => {
    setInnerTab(t);
    onTabChange?.(t);
  };
  const [showSettings, setShowSettings] = useState(false);
  const [input, setInput] = useState('');
  const [lastUserMsg, setLastUserMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<'idle' | 'up' | 'down'>('idle');

  const abortRef = useRef<AbortController | null>(null);

  const desk = useStoryboardStore((s) => s.desk);
  const anchors = useStoryboardStore((s) => s.anchors);
  const nodes = useStoryboardStore((s) => s.nodes);
  const templates = useStoryboardStore((s) => s.templates);
  const activeTemplateId = useStoryboardStore((s) => s.activeTemplateId);
  const selectedRowId = useStoryboardStore((s) => s.selectedRowId);
  const upsertTemplate = useStoryboardStore((s) => s.upsertTemplate);
  const removeTemplate = useStoryboardStore((s) => s.removeTemplate);
  const setActiveTemplateId = useStoryboardStore((s) => s.setActiveTemplateId);
  const commitDoc = useStoryboardStore((s) => s.commitDoc);

  const textConfig = useStoryboardSettingsStore((s) => s.textConfig);
  const imageConfig = useStoryboardSettingsStore((s) => s.imageConfig);
  const videoConfig = useStoryboardSettingsStore((s) => s.videoConfig);
  const localEndpoints = useStoryboardSettingsStore((s) => s.localEndpoints);
  const localHealth = useStoryboardSettingsStore((s) => s.localHealth);
  const setTextConfig = useStoryboardSettingsStore((s) => s.setTextConfig);
  const setImageConfig = useStoryboardSettingsStore((s) => s.setImageConfig);
  const setVideoConfig = useStoryboardSettingsStore((s) => s.setVideoConfig);
  const setLocalEndpoints = useStoryboardSettingsStore((s) => s.setLocalEndpoints);
  const setLocalHealth = useStoryboardSettingsStore((s) => s.setLocalHealth);

  const selectedIndex = desk.rows.findIndex((r) => r.id === selectedRowId);
  const selectedRow = selectedIndex >= 0 ? desk.rows[selectedIndex] : null;
  const activeTemplate = useMemo(
    () => templates.find((t) => t.id === activeTemplateId) ?? null,
    [templates, activeTemplateId]
  );

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    if (textConfig.kind === 'openai' && !textConfig.apiKey.trim()) {
      setError('请先点击右上角 ⚙ 填写 API Key 或切换为本机 Ollama');
      setShowSettings(true);
      return;
    }

    setLastUserMsg(trimmed);
    setInput('');
    setError(null);
    setLoading(true);
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const plan = await runAgentPlan(
        { instruction: trimmed, desk, anchors, selectedRowId },
        textConfig,
        ac.signal
      );
      onPlanReady(plan);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError(e instanceof Error ? e.message : '请求失败');
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const handleCheckHealth = async () => {
    const [status, lHealth] = await Promise.all([
      checkTextProviderHealth(textConfig),
      probeLocalServices(localEndpoints),
    ]);
    setHealthStatus(status);
    setLocalHealth(lHealth);
  };

  const videoKey = selectedRow ? `${selectedRow.id}:video` : '';
  const selectedVideoNode = videoKey ? nodes[videoKey] : undefined;

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-l border-stone-300/70 bg-[#fbfaf7] text-stone-900 dark:border-stone-800 dark:bg-[#1c1a17] dark:text-stone-100">
      {/* 顶部栏 */}
      <div className="flex h-[42px] shrink-0 items-center gap-2 border-b border-stone-300/60 px-3 dark:border-stone-800">
        <b className="flex-1 text-[12.5px]">导演 Agent</b>
        <span className="max-w-[120px] truncate rounded bg-stone-200/70 px-1.5 py-0.5 text-[10.5px] text-stone-600 dark:bg-stone-800 dark:text-stone-300">
          {textConfig.model || '未配置'}
        </span>
        <button
          type="button"
          onClick={() => setShowSettings((v) => !v)}
          title="模型与本机服务设置"
          className={`rounded p-1 hover:bg-black/5 dark:hover:bg-white/10 ${
            showSettings ? 'bg-black/5 dark:bg-white/10' : ''
          }`}
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 模型设置折叠面板 */}
      {showSettings && (
        <div className="flex flex-col gap-2 border-b border-stone-300/60 bg-[#efece4]/70 p-3 text-[11px] dark:border-stone-800 dark:bg-[#24211d]">
          <div className="flex items-center justify-between">
            <span className="font-medium">文本模型设置</span>
            <button
              type="button"
              onClick={handleCheckHealth}
              className="rounded border border-stone-300 px-2 py-0.5 text-[10.5px] hover:bg-black/5 dark:border-stone-700"
            >
              测试连通
              {healthStatus === 'up' ? ' (可用)' : healthStatus === 'down' ? ' (未通)' : ''}
            </button>
          </div>

          <div className="inline-flex rounded-md bg-stone-200/70 p-0.5 dark:bg-stone-800">
            {(['openai', 'ollama'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() =>
                  setTextConfig({
                    kind: k,
                    baseUrl:
                      k === 'ollama'
                        ? 'http://127.0.0.1:11434/v1'
                        : 'https://api.deepseek.com/v1',
                    model: k === 'ollama' ? 'qwen2.5:7b' : 'deepseek-chat',
                  })
                }
                className={`flex-1 rounded py-0.5 text-[10.5px] ${
                  textConfig.kind === k
                    ? 'bg-white font-medium shadow-xs dark:bg-stone-700'
                    : 'text-stone-500'
                }`}
              >
                {k === 'openai' ? 'OpenAI 兼容' : '本机 Ollama'}
              </button>
            ))}
          </div>

          <input
            type="text"
            value={textConfig.baseUrl}
            onChange={(e) => setTextConfig({ baseUrl: e.target.value })}
            placeholder="Base URL"
            className="rounded border border-stone-300/70 bg-white px-2 py-1 outline-none focus:border-amber-500 dark:border-stone-700 dark:bg-stone-900"
          />
          <input
            type="text"
            value={textConfig.model}
            onChange={(e) => setTextConfig({ model: e.target.value })}
            placeholder="模型名称"
            className="rounded border border-stone-300/70 bg-white px-2 py-1 outline-none focus:border-amber-500 dark:border-stone-700 dark:bg-stone-900"
          />
          {textConfig.kind === 'openai' && (
            <input
              type="password"
              value={textConfig.apiKey}
              onChange={(e) => setTextConfig({ apiKey: e.target.value })}
              placeholder="API Key（仅保存在本地浏览器）"
              className="rounded border border-stone-300/70 bg-white px-2 py-1 outline-none focus:border-amber-500 dark:border-stone-700 dark:bg-stone-900"
            />
          )}

          <div className="mt-1 flex items-center justify-between border-t border-stone-300/50 pt-2 dark:border-stone-700">
            <span className="font-medium">图片 / 视频渠道</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <input
              type="text"
              value={imageConfig.baseUrl}
              onChange={(e) => setImageConfig({ baseUrl: e.target.value })}
              placeholder="图片 Base URL"
              className="rounded border border-stone-300/70 bg-white px-2 py-1 outline-none dark:border-stone-700 dark:bg-stone-900"
            />
            <input
              type="text"
              value={imageConfig.model}
              onChange={(e) => setImageConfig({ model: e.target.value })}
              placeholder="图片模型"
              className="rounded border border-stone-300/70 bg-white px-2 py-1 outline-none dark:border-stone-700 dark:bg-stone-900"
            />
            <input
              type="text"
              value={videoConfig.baseUrl}
              onChange={(e) => setVideoConfig({ baseUrl: e.target.value })}
              placeholder="视频 Base URL"
              className="rounded border border-stone-300/70 bg-white px-2 py-1 outline-none dark:border-stone-700 dark:bg-stone-900"
            />
            <input
              type="text"
              value={videoConfig.model}
              onChange={(e) => setVideoConfig({ model: e.target.value })}
              placeholder="视频模型"
              className="rounded border border-stone-300/70 bg-white px-2 py-1 outline-none dark:border-stone-700 dark:bg-stone-900"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-[10.5px] text-stone-500">
            <input
              type="checkbox"
              checked={imageConfig.isLocal || videoConfig.isLocal}
              onChange={(e) => {
                setImageConfig({ isLocal: e.target.checked });
                setVideoConfig({ isLocal: e.target.checked });
              }}
              className="accent-amber-600"
            />
            <span>本机 8G 显存模式（图片/视频队列串行 1）</span>
          </label>

          <div className="mt-1 flex items-center justify-between border-t border-stone-300/50 pt-2 dark:border-stone-700">
            <span className="font-medium">本机服务（TTS / Whisper / Sidecar）</span>
          </div>
          <div className="flex flex-col gap-1 text-[10.5px]">
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${localHealth.sidecar ? 'bg-emerald-500' : 'bg-stone-400'}`} />
              <input
                type="text"
                value={localEndpoints.sidecarUrl}
                onChange={(e) => setLocalEndpoints({ sidecarUrl: e.target.value })}
                placeholder="Sidecar URL"
                className="flex-1 rounded border border-stone-300/70 bg-white px-2 py-0.5 outline-none dark:border-stone-700 dark:bg-stone-900"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${localHealth.tts ? 'bg-emerald-500' : 'bg-stone-400'}`} />
              <input
                type="text"
                value={localEndpoints.ttsUrl}
                onChange={(e) => setLocalEndpoints({ ttsUrl: e.target.value })}
                placeholder="TTS URL"
                className="flex-1 rounded border border-stone-300/70 bg-white px-2 py-0.5 outline-none dark:border-stone-700 dark:bg-stone-900"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${localHealth.asr ? 'bg-emerald-500' : 'bg-stone-400'}`} />
              <input
                type="text"
                value={localEndpoints.asrUrl}
                onChange={(e) => setLocalEndpoints({ asrUrl: e.target.value })}
                placeholder="Whisper URL"
                className="flex-1 rounded border border-stone-300/70 bg-white px-2 py-0.5 outline-none dark:border-stone-700 dark:bg-stone-900"
              />
            </div>
          </div>
        </div>
      )}

      {/* 页签切换 */}
      <div className="flex gap-1.5 border-b border-stone-300/60 px-3 py-1.5 text-[11.5px] dark:border-stone-800">
        {(['chat', 'props', 'clone'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md py-1 transition ${
              tab === t
                ? 'bg-black/5 font-medium text-stone-900 dark:bg-white/10 dark:text-stone-100'
                : 'text-stone-500 hover:text-stone-800 dark:text-stone-400'
            }`}
          >
            {t === 'chat' ? '导演' : t === 'props' ? '属性' : '爆款复刻'}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      {tab === 'clone' ? (
        <ViralCloneTab onDone={() => setTab('chat')} />
      ) : tab === 'chat' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3 text-[12px]">
          {!lastUserMsg && !pendingPlan && !error && (
            <div className="rounded-lg border border-dashed border-stone-300 p-3 text-[11px] leading-relaxed text-stone-500 dark:border-stone-700 dark:text-stone-400">
              在下方输入分镜需求（如：写 5 镜短片、改选中镜头台词、在最后加一镜）。Agent 只产出方案并在画布上给出幽灵预览，确认后才写入。
            </div>
          )}

          {lastUserMsg && (
            <div className="max-w-[90%] self-end rounded-[9px] bg-amber-500/15 px-2.5 py-2 text-[11.5px] leading-relaxed">
              {lastUserMsg}
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 rounded-[9px] border border-stone-300/70 bg-white p-2.5 text-[11.5px] text-stone-500 dark:border-stone-700 dark:bg-stone-900">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600" />
              <span>正在生成分镜方案并校验...</span>
            </div>
          )}

          {error && (
            <div className="rounded-[9px] border border-red-500/40 bg-red-500/10 p-2.5 text-[11px] text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {pendingPlan && preview && (
            <PlanCard
              plan={pendingPlan}
              rows={desk.rows}
              enabledIds={enabledIds}
              warnings={preview.warnings}
              onToggleChange={onToggleChange}
              onApply={onApplyPlan}
              onDiscard={onDiscardPlan}
              onSuggestRun={onSuggestRun}
            />
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-[11.5px]">
          {selectedRow ? (
            <>
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[10.5px] text-stone-500">
                  <span>当前选中：镜 {String(selectedIndex + 1).padStart(2, '0')}</span>
                  <label className="flex cursor-pointer items-center gap-1">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedVideoNode?.detached)}
                      onChange={(e) =>
                        commitDoc('切换脱离状态', (d) => {
                          if (!d.nodes[videoKey]) {
                            d.nodes[videoKey] = {
                              rowId: selectedRow.id,
                              role: 'video',
                              takes: [],
                            };
                          }
                          d.nodes[videoKey].detached = e.target.checked;
                        })
                      }
                      className="accent-amber-600"
                    />
                    <span>已脱离（不随方案覆盖）</span>
                  </label>
                </div>

                <div className="rounded-md border border-stone-300/60 bg-white p-2 text-[11px] leading-relaxed text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
                  {getEffectivePrompt(
                    selectedRow,
                    selectedVideoNode,
                    anchors,
                    activeTemplate
                  ) || '（暂无画面描述）'}
                </div>
              </div>

              <div className="flex flex-col gap-1.5 border-t border-stone-300/50 pt-2.5 dark:border-stone-800">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium">本地提示词底板库</span>
                  <button
                    type="button"
                    onClick={() =>
                      upsertTemplate({
                        id: `tpl_${Date.now()}`,
                        name: `底板 ${templates.length + 1}`,
                        body: '[{{size}}] {{desc}} | {{roles}}',
                      })
                    }
                    className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10.5px] hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <Plus className="h-3 w-3" />
                    新建
                  </button>
                </div>

                {templates.length === 0 ? (
                  <span className="text-[10.5px] text-stone-400">
                    暂无自定义底板，默认按字段拼接。可新建 {'{{desc}}'} {'{{roles}}'} 等占位符底板。
                  </span>
                ) : (
                  templates.map((tpl) => {
                    const isAct = tpl.id === activeTemplateId;
                    return (
                      <div
                        key={tpl.id}
                        className={`flex flex-col gap-1 rounded-md border p-2 ${
                          isAct
                            ? 'border-amber-500 bg-amber-500/5'
                            : 'border-stone-300/60 dark:border-stone-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <input
                            type="text"
                            value={tpl.name}
                            onChange={(e) =>
                              upsertTemplate({ ...tpl, name: e.target.value })
                            }
                            className="min-w-0 flex-1 bg-transparent text-[11px] font-medium outline-none"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setActiveTemplateId(isAct ? null : tpl.id)
                            }
                            className="rounded px-1.5 py-0.5 text-[10px] hover:bg-black/5 dark:hover:bg-white/10"
                          >
                            {isAct ? '停用' : '选用'}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeTemplate(tpl.id)}
                            className="p-0.5 text-stone-400 hover:text-red-500"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                        <textarea
                          rows={2}
                          value={tpl.body}
                          onChange={(e) =>
                            upsertTemplate({ ...tpl, body: e.target.value })
                          }
                          className="w-full resize-none rounded border border-stone-300/60 bg-transparent p-1 text-[10.5px] outline-none dark:border-stone-700"
                        />
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <div className="text-[11px] text-stone-400">先在画布选中一镜</div>
          )}
        </div>
      )}

      {/* 底部输入框 */}
      <div className="flex flex-col gap-1.5 border-t border-stone-300/60 p-2.5 dark:border-stone-800">
        {selectedIndex >= 0 && (
          <div className="flex flex-wrap gap-1">
            <span className="rounded border border-stone-300/70 bg-white px-1.5 py-0.5 text-[10.5px] dark:border-stone-700 dark:bg-stone-900">
              @镜 {String(selectedIndex + 1).padStart(2, '0')}
            </span>
          </div>
        )}
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="写分镜、改某一镜…选中镜头会自动作为引用"
          className="w-full resize-none rounded-lg border border-stone-300/70 bg-white px-2.5 py-1.5 text-[11.5px] outline-none focus:border-amber-500 dark:border-stone-700 dark:bg-stone-900"
        />
        <div className="flex items-center justify-between text-[10.5px] text-stone-400">
          <span>只出方案，确认后才写入</span>
          {loading ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="inline-flex items-center gap-1 rounded-md bg-stone-200 px-2.5 py-1 text-[11px] text-stone-700 dark:bg-stone-800 dark:text-stone-200"
            >
              <Square className="h-3 w-3" />
              停止
            </button>
          ) : (
            <button
              type="button"
              disabled={!input.trim()}
              onClick={handleSend}
              className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-700 disabled:opacity-40"
            >
              <Send className="h-3 w-3" />
              发送
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
