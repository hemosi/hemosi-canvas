import React from 'react';
import { RowNodeRole } from '@/lib/storyboard/types';
import { useStoryboardSettingsStore } from '@/stores/storyboard/use-storyboard-settings-store';

export interface ConfirmGenTarget {
  rowId: string;
  rowIndex: number;
  role: RowNodeRole;
  prompt: string;
  size: string;
  dur: number;
}

interface GenerateConfirmModalProps {
  targets: ConfirmGenTarget[];
  onConfirm: () => void;
  onCancel: () => void;
}

export const GenerateConfirmModal: React.FC<GenerateConfirmModalProps> = ({
  targets,
  onConfirm,
  onCancel,
}) => {
  const imageConfig = useStoryboardSettingsStore((s) => s.imageConfig);
  const videoConfig = useStoryboardSettingsStore((s) => s.videoConfig);

  if (targets.length === 0) return null;

  const first = targets[0];
  const hasFrame = targets.some((t) => t.role === 'frame');
  const hasVideo = targets.some((t) => t.role === 'video');

  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-[440px] flex-col gap-3 rounded-[14px] border border-stone-300/70 bg-[#fbfaf7] p-4 text-[12px] text-stone-900 shadow-xl dark:border-stone-700 dark:bg-[#1c1a17] dark:text-stone-100"
      >
        <div className="flex items-center justify-between">
          <b className="text-[13.5px]">
            确认生成（{targets.length} 个任务）
          </b>
          <span className="text-[11px] text-stone-500">
            生成始终由你确认后提交
          </span>
        </div>

        <div className="flex flex-col gap-1.5 rounded-lg bg-[#efece4] p-2.5 text-[11px] dark:bg-[#2c2823]">
          {hasFrame && (
            <div className="flex justify-between gap-2">
              <span className="text-stone-500">图片渠道 / 模型</span>
              <span className="truncate font-medium">
                {imageConfig.label} · {imageConfig.model}（
                {imageConfig.isLocal ? '本机串行 1' : '远程并发 3'}）
              </span>
            </div>
          )}
          {hasVideo && (
            <div className="flex justify-between gap-2">
              <span className="text-stone-500">视频渠道 / 模型</span>
              <span className="truncate font-medium">
                {videoConfig.label} · {videoConfig.model}（
                {videoConfig.isLocal ? '本机串行 1' : '远程并发 3'}）
              </span>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <span className="text-stone-500">涉及镜头</span>
            <span>
              {targets
                .map(
                  (t) =>
                    `镜${String(t.rowIndex + 1).padStart(2, '0')}${t.role === 'frame' ? '首帧' : '视频'}`
                )
                .join('、')}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10.5px] text-stone-500">
            {targets.length === 1 ? '完整生效提示词' : '首项生效提示词预览'}
          </span>
          <div className="max-h-32 overflow-y-auto rounded-lg border border-stone-300/60 bg-white p-2 text-[11px] leading-relaxed dark:border-stone-700 dark:bg-stone-900">
            {first.prompt || '（空提示词）'}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-[11.5px] hover:bg-black/5 dark:border-stone-700 dark:hover:bg-white/10"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-amber-600 px-3.5 py-1.5 text-[11.5px] font-medium text-white hover:bg-amber-700"
          >
            确认入队生成
          </button>
        </div>
      </div>
    </div>
  );
};
