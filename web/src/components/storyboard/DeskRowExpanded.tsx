import React, { useState } from 'react';
import { Trash2, Volume2, Loader2 } from 'lucide-react';
import { synthesizeLocalTts } from '@/lib/storyboard/local-services';
import {
  DeskRow,
  GenerationMode,
  VoiceMode,
  estimateDubSeconds,
} from '@/lib/storyboard/types';
import { useStoryboardSettingsStore } from '@/stores/storyboard/use-storyboard-settings-store';
import { useStoryboardStore } from '@/stores/storyboard/use-storyboard-store';

interface DeskRowExpandedProps {
  row: DeskRow;
  index: number;
}

const SIZE_OPTIONS = ['大远景', '全景', '中景', '近景', '特写'];

export const DeskRowExpanded: React.FC<DeskRowExpandedProps> = ({ row, index }) => {
  const anchors = useStoryboardStore((s) => s.anchors);
  const updateRow = useStoryboardStore((s) => s.updateRow);
  const removeRow = useStoryboardStore((s) => s.removeRow);
  const toggleRowRole = useStoryboardStore((s) => s.toggleRowRole);
  const ttsUrl = useStoryboardSettingsStore((s) => s.localEndpoints.ttsUrl);

  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);

  const measuredOrEst = row.dubDurationSec ?? estimateDubSeconds(row.line);
  const isOver =
    row.voice === 'dub' && row.line.trim().length > 0 && measuredOrEst > row.dur;

  const estLabel =
    row.voice === 'dub' && row.line.trim()
      ? `${row.dubDurationSec !== undefined ? '实测' : '估算'} ${measuredOrEst}s / 镜头 ${row.dur}s`
      : row.voice === 'native'
        ? '视频自带声音'
        : '';

  const handleSynthDub = async () => {
    if (!row.line.trim() || ttsLoading) return;
    setTtsLoading(true);
    setTtsError(null);
    try {
      const res = await synthesizeLocalTts(row.line, ttsUrl);
      updateRow(row.id, {
        dubStorageKey: res.storageKey,
        dubDurationSec: res.durationSec,
      });
    } catch (e) {
      setTtsError(e instanceof Error ? e.message : '配音失败');
    } finally {
      setTtsLoading(false);
    }
  };

  return (
    <div
      className="grid grid-cols-[1fr_196px] gap-3.5 px-3.5 pb-3 text-[11px]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center justify-between text-[10.5px] opacity-60">
          <span>画面描述</span>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1">
              <span>时长</span>
              <input
                type="number"
                min={1}
                max={30}
                value={row.dur}
                onChange={(e) =>
                  updateRow(
                    row.id,
                    { dur: Math.max(1, Number(e.target.value) || 1) },
                    `dur:${row.id}`
                  )
                }
                className="w-11 rounded border border-stone-300/60 bg-transparent px-1 py-0.5 text-center text-[11px] outline-none focus:border-amber-500 dark:border-stone-700"
              />
              <span>s</span>
            </label>
            <select
              value={row.size}
              onChange={(e) => updateRow(row.id, { size: e.target.value })}
              className="rounded border border-stone-300/60 bg-transparent px-1.5 py-0.5 text-[11px] outline-none focus:border-amber-500 dark:border-stone-700"
            >
              {SIZE_OPTIONS.map((sz) => (
                <option key={sz} value={sz} className="bg-stone-50 dark:bg-stone-900">
                  {sz}
                </option>
              ))}
            </select>
          </div>
        </div>

        <textarea
          rows={3}
          value={row.desc}
          placeholder="填写该镜头的画面内容与运动..."
          onChange={(e) =>
            updateRow(row.id, { desc: e.target.value }, `desc:${row.id}`)
          }
          className="w-full resize-none rounded-md border border-stone-300/60 bg-transparent px-2 py-1 text-[12px] outline-none focus:border-amber-500 dark:border-stone-700"
        />

        <div className="flex items-center justify-between text-[10.5px]">
          <div className="flex items-center gap-2">
            <span className="opacity-60">台词</span>
            {row.voice === 'dub' && row.line.trim() && (
              <button
                type="button"
                disabled={ttsLoading}
                onClick={handleSynthDub}
                className="inline-flex items-center gap-1 rounded bg-stone-200/70 px-1.5 py-0.5 text-[10px] hover:bg-stone-300/80 disabled:opacity-50 dark:bg-stone-800 dark:hover:bg-stone-700"
              >
                {ttsLoading ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <Volume2 className="h-2.5 w-2.5" />
                )}
                {row.dubStorageKey ? '重配音' : '本地配音'}
              </button>
            )}
          </div>
          {estLabel && (
            <span className={isOver ? 'font-medium text-red-500' : 'opacity-60'}>
              {estLabel}
            </span>
          )}
        </div>
        {ttsError && <div className="text-[10px] text-red-500">{ttsError}</div>}

        <textarea
          rows={2}
          value={row.line}
          placeholder="无台词"
          onChange={(e) =>
            updateRow(row.id, { line: e.target.value }, `line:${row.id}`)
          }
          className="w-full resize-none rounded-md border border-stone-300/60 bg-transparent px-2 py-1 text-[12px] outline-none focus:border-amber-500 dark:border-stone-700"
        />
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[10.5px] opacity-60">对白</span>
        <select
          value={row.voice}
          onChange={(e) =>
            updateRow(row.id, { voice: e.target.value as VoiceMode })
          }
          className="rounded-md border border-stone-300/60 bg-transparent px-2 py-1 text-[11px] outline-none focus:border-amber-500 dark:border-stone-700"
        >
          <option value="native" className="bg-stone-50 dark:bg-stone-900">
            视频原生
          </option>
          <option value="dub" className="bg-stone-50 dark:bg-stone-900">
            后期配音
          </option>
          <option value="none" className="bg-stone-50 dark:bg-stone-900">
            无
          </option>
        </select>

        <span className="text-[10.5px] opacity-60">生成方式</span>
        <div className="inline-flex rounded-md bg-stone-200/70 p-0.5 dark:bg-stone-800">
          {(['frame', 'direct'] as GenerationMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => updateRow(row.id, { mode: m })}
              className={`flex-1 rounded px-2 py-0.5 text-[10.5px] transition ${
                row.mode === m
                  ? 'bg-white font-medium text-stone-900 shadow-xs dark:bg-stone-700 dark:text-stone-100'
                  : 'text-stone-500 hover:text-stone-800 dark:text-stone-400'
              }`}
            >
              {m === 'frame' ? '首帧→视频' : '直出'}
            </button>
          ))}
        </div>

        {index > 0 && row.mode === 'frame' && (
          <label className="mt-0.5 flex cursor-pointer items-center gap-2 text-[11px]">
            <input
              type="checkbox"
              checked={row.cont}
              onChange={(e) => updateRow(row.id, { cont: e.target.checked })}
              className="accent-amber-600"
            />
            <span>接续镜 {String(index).padStart(2, '0')} 末帧</span>
          </label>
        )}

        <span className="mt-0.5 text-[10.5px] opacity-60">出镜（悬停可见连线）</span>
        <div className="flex flex-wrap gap-1">
          {anchors.length === 0 ? (
            <span className="text-[10.5px] opacity-40">暂无设定锚点</span>
          ) : (
            anchors.map((a) => {
              const active = row.roles.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  title={a.name}
                  onClick={() => toggleRowRole(row.id, a.id)}
                  className={`h-6 w-6 rounded-full border text-[10.5px] transition ${
                    active
                      ? 'border-amber-600 bg-amber-600 font-medium text-white'
                      : 'border-stone-300 text-stone-500 hover:border-amber-500 dark:border-stone-700'
                  }`}
                >
                  {a.name.slice(0, 1) || '?'}
                </button>
              );
            })
          )}
        </div>

        <div className="mt-auto flex justify-end pt-1">
          <button
            type="button"
            onClick={() => removeRow(row.id)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-stone-400 hover:bg-red-500/10 hover:text-red-500"
          >
            <Trash2 className="h-3 w-3" />
            删除此镜
          </button>
        </div>
      </div>
    </div>
  );
};
