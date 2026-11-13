import React, { useState } from 'react';
import { FileArchive, Flame, Loader2, Sparkles, Upload } from 'lucide-react';
import { ViralBlueprint, ViralCut } from '@/lib/canvas/viral-clone';
import {
  analyzeViralVideo,
  blueprintToStoryboardPlan,
  buildKeyframeGridDataUrl,
  extractCutsPreferSidecar,
  exportViralBlueprintZip,
} from '@/lib/storyboard/viral-bridge';
import { useStoryboardSettingsStore } from '@/stores/storyboard/use-storyboard-settings-store';
import { useStoryboardStore } from '@/stores/storyboard/use-storyboard-store';

interface ViralCloneTabProps {
  onDone?: () => void;
}

export const ViralCloneTab: React.FC<ViralCloneTabProps> = ({ onDone }) => {
  const localEndpoints = useStoryboardSettingsStore((s) => s.localEndpoints);
  const localHealth = useStoryboardSettingsStore((s) => s.localHealth);
  const applyPlan = useStoryboardStore((s) => s.applyPlan);

  const [file, setFile] = useState<File | null>(null);
  const [cuts, setCuts] = useState<ViralCut[]>([]);
  const [gridUrl, setGridUrl] = useState<string>('');
  const [transcript, setTranscript] = useState('');
  const [blueprint, setBlueprint] = useState<ViralBlueprint | null>(null);
  const [variantIdx, setVariantIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleFile = async (f: File) => {
    setFile(f);
    setLoading(true);
    setErr(null);
    setBlueprint(null);
    try {
      const nextCuts = await extractCutsPreferSidecar(
        f,
        localEndpoints.sidecarUrl,
        localHealth.sidecar
      );
      setCuts(nextCuts);
      const grid = await buildKeyframeGridDataUrl(nextCuts);
      setGridUrl(grid);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '抽帧失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!file || cuts.length === 0) return;
    setLoading(true);
    setErr(null);
    try {
      const bp = await analyzeViralVideo(
        file,
        cuts,
        localEndpoints.asrUrl,
        localHealth.asr,
        transcript
      );
      setBlueprint(bp);
      setVariantIdx(0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '拆解失败');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyToDesk = () => {
    if (!blueprint) return;
    const plan = blueprintToStoryboardPlan(blueprint, variantIdx);
    applyPlan(
      plan,
      plan.changes.map((c) => c.id)
    );
    onDone?.();
  };

  const handleExportZip = async () => {
    if (!blueprint) return;
    await exportViralBlueprintZip(blueprint);
  };

  const variants = blueprint?.variants ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3 text-[11.5px]">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-stone-300 bg-white/60 p-3 text-center hover:border-amber-500 dark:border-stone-700 dark:bg-stone-900/60">
        <Upload className="h-4 w-4 text-amber-600" />
        <span className="font-medium">
          {file ? file.name : '选择参考视频 MP4（本地抽帧拆解）'}
        </span>
        <span className="text-[10px] text-stone-400">
          {localHealth.sidecar ? '将使用本地 ffmpeg 抽帧' : '将使用浏览器端抽帧'}
        </span>
        <input
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </label>

      {loading && (
        <div className="flex items-center gap-2 rounded-md bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>正在本地处理视频切点与关键帧...</span>
        </div>
      )}

      {err && (
        <div className="rounded-md bg-red-500/10 p-2 text-[11px] text-red-500">
          {err}
        </div>
      )}

      {gridUrl && (
        <div className="flex flex-col gap-1">
          <span className="text-[10.5px] text-stone-500">
            关键帧网格图（共 {cuts.length} 镜）
          </span>
          <img
            src={gridUrl}
            alt="keyframes"
            className="w-full rounded-md border border-stone-300/60 dark:border-stone-700"
          />
        </div>
      )}

      {cuts.length > 0 && (
        <>
          <textarea
            rows={2}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder={
              localHealth.asr
                ? '可选：留空将自动调本机 Whisper 转写'
                : '可选：手动粘贴台词（未检测到本机 Whisper）'
            }
            className="w-full resize-none rounded-md border border-stone-300/70 bg-white p-2 text-[11px] outline-none focus:border-amber-500 dark:border-stone-700 dark:bg-stone-900"
          />
          <button
            type="button"
            disabled={loading}
            onClick={handleAnalyze}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-stone-800 px-3 py-1.5 text-[11.5px] font-medium text-white hover:bg-stone-900 dark:bg-stone-200 dark:text-stone-900"
          >
            <Sparkles className="h-3.5 w-3.5" />
            拆解成可替换分镜蓝图
          </button>
        </>
      )}

      {blueprint && (
        <div className="flex flex-col gap-2 rounded-lg border border-stone-300/70 bg-white p-2.5 dark:border-stone-700 dark:bg-stone-900">
          <div className="flex items-center justify-between">
            <b className="inline-flex items-center gap-1 text-[12px]">
              <Flame className="h-3.5 w-3.5 text-amber-500" />
              {blueprint.beats.length} 镜蓝图已就绪
            </b>
            {variants.length > 0 && (
              <select
                value={variantIdx}
                onChange={(e) => setVariantIdx(Number(e.target.value))}
                className="rounded border border-stone-300 bg-transparent px-1.5 py-0.5 text-[10.5px] dark:border-stone-700"
              >
                {variants.map((v, i) => (
                  <option key={v.id} value={i} className="bg-stone-900">
                    {v.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex max-h-36 flex-col gap-1 overflow-y-auto text-[10.5px] text-stone-500">
            {blueprint.beats.map((b, i) => (
              <div key={b.id} className="truncate">
                {i + 1}. [{Math.max(1, Math.round(b.endSec - b.startSec))}s]{' '}
                {b.imagePrompt || b.videoPrompt}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-1.5 pt-1">
            <button
              type="button"
              onClick={handleApplyToDesk}
              className="flex-1 rounded-md bg-amber-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-amber-700"
            >
              生成到分镜表
            </button>
            <button
              type="button"
              onClick={handleExportZip}
              title="导出切片 + SRT + 蓝图 ZIP"
              className="inline-flex items-center gap-1 rounded-md border border-stone-300 px-2 py-1.5 text-[11px] hover:bg-black/5 dark:border-stone-700 dark:hover:bg-white/10"
            >
              <FileArchive className="h-3.5 w-3.5" />
              素材包
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
