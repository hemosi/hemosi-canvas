import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Play, X } from 'lucide-react';
import { composeViaSidecar } from '@/lib/storyboard/local-services';
import { getMediaBlob, getMediaUrl } from '@/lib/storyboard/media-store';
import { getPickedTake, rowNodeKey } from '@/lib/storyboard/types';
import { useStoryboardSettingsStore } from '@/stores/storyboard/use-storyboard-settings-store';
import { useStoryboardStore } from '@/stores/storyboard/use-storyboard-store';

interface PreviewStitchModalProps {
  open: boolean;
  onClose: () => void;
}

interface ClipItem {
  rowId: string;
  index: number;
  videoUrl: string;
  audioUrl?: string;
  line: string;
  dur: number;
}

export const PreviewStitchModal: React.FC<PreviewStitchModalProps> = ({
  open,
  onClose,
}) => {
  const desk = useStoryboardStore((s) => s.desk);
  const nodes = useStoryboardStore((s) => s.nodes);
  const localEndpoints = useStoryboardSettingsStore((s) => s.localEndpoints);
  const sidecarUp = useStoryboardSettingsStore((s) => s.localHealth.sidecar);

  const [clips, setClips] = useState<ClipItem[]>([]);
  const [curIdx, setCurIdx] = useState(0);
  const [composing, setComposing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    (async () => {
      const list: ClipItem[] = [];
      for (let i = 0; i < desk.rows.length; i++) {
        const r = desk.rows[i];
        const vNode = nodes[rowNodeKey(r.id, 'video')];
        const take = getPickedTake(vNode);
        if (!take?.storageKey) continue;
        const videoUrl = await getMediaUrl(take.storageKey);
        if (!videoUrl) continue;
        const audioUrl = r.dubStorageKey
          ? (await getMediaUrl(r.dubStorageKey)) ?? undefined
          : undefined;
        list.push({
          rowId: r.id,
          index: i,
          videoUrl,
          audioUrl,
          line: r.line,
          dur: r.dur,
        });
      }
      if (active) {
        setClips(list);
        setCurIdx(0);
        setErr(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [open, desk.rows, nodes]);

  useEffect(() => {
    const clip = clips[curIdx];
    if (!clip || !open) return;
    if (audioRef.current && clip.audioUrl) {
      audioRef.current.src = clip.audioUrl;
      audioRef.current.play().catch(() => {});
    }
  }, [curIdx, clips, open]);

  if (!open) return null;

  const currentClip = clips[curIdx];

  const handleComposeExport = async () => {
    if (!sidecarUp || composing) return;
    setComposing(true);
    setErr(null);
    try {
      const payload: Array<{
        videoBlob: Blob;
        audioBlob?: Blob;
        line?: string;
        dur: number;
      }> = [];
      for (const r of desk.rows) {
        const take = getPickedTake(nodes[rowNodeKey(r.id, 'video')]);
        if (!take?.storageKey) continue;
        const videoBlob = await getMediaBlob(take.storageKey);
        if (!videoBlob) continue;
        const audioBlob = r.dubStorageKey
          ? (await getMediaBlob(r.dubStorageKey)) ?? undefined
          : undefined;
        payload.push({ videoBlob, audioBlob, line: r.line, dur: r.dur });
      }
      const outBlob = await composeViaSidecar(
        localEndpoints.sidecarUrl,
        payload,
        desk.title
      );
      const url = URL.createObjectURL(outBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${desk.title || '成片'}.mp4`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '合成失败');
    } finally {
      setComposing(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-[760px] flex-col gap-3 rounded-2xl border border-stone-700 bg-[#1c1a17] p-4 text-stone-100 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <b className="text-sm">预览拼接 · {desk.title}</b>
            <span className="text-xs text-stone-400">
              {clips.length} / {desk.rows.length} 镜已出片
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!sidecarUp || clips.length === 0 || composing}
              onClick={handleComposeExport}
              title={sidecarUp ? '调用本地 ffmpeg 合成 MP4' : '未检测到本地 sidecar，Web 版仅支持预览拼接'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-40"
            >
              {composing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {sidecarUp ? '合成导出 MP4' : 'Sidecar 未启动'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-stone-400 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {err && (
          <div className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-400">
            {err}
          </div>
        )}

        <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-black">
          {currentClip ? (
            <>
              <video
                ref={videoRef}
                key={currentClip.videoUrl}
                src={currentClip.videoUrl}
                controls
                autoPlay
                onEnded={() => {
                  if (curIdx + 1 < clips.length) setCurIdx((i) => i + 1);
                }}
                className="h-full w-full object-contain"
              />
              {currentClip.line && (
                <div className="pointer-events-none absolute bottom-10 rounded bg-black/70 px-3 py-1 text-sm text-white">
                  {currentClip.line}
                </div>
              )}
              <audio ref={audioRef} className="hidden" />
            </>
          ) : (
            <span className="text-xs text-stone-500">
              当前没有已出片的视频镜头，请先生成或拖入 MP4 片段
            </span>
          )}
        </div>

        {clips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {clips.map((c, idx) => (
              <button
                key={c.rowId}
                type="button"
                onClick={() => setCurIdx(idx)}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs ${
                  idx === curIdx
                    ? 'bg-amber-600 text-white'
                    : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
                }`}
              >
                <Play className="h-3 w-3" />
                镜 {String(c.index + 1).padStart(2, '0')}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
