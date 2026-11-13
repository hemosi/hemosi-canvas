import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { AnchorLayoutItem } from '@/lib/storyboard/layout';
import { getMediaUrl, saveMediaBlob } from '@/lib/storyboard/media-store';
import { Anchor } from '@/lib/storyboard/types';
import { useStoryboardStore } from '@/stores/storyboard/use-storyboard-store';
import { MediaPreviewModal } from './MediaPreviewModal';

interface AnchorNodeProps {
  anchor: Anchor;
  layout: AnchorLayoutItem;
  usedCount: number;
  dimmed: boolean;
}

const KIND_LABEL: Record<Anchor['kind'], string> = {
  character: '角色',
  scene: '场景',
  style: '风格',
};

export const AnchorNode: React.FC<AnchorNodeProps> = ({
  anchor,
  layout,
  usedCount,
  dimmed,
}) => {
  const updateAnchor = useStoryboardStore((s) => s.updateAnchor);
  const removeAnchor = useStoryboardStore((s) => s.removeAnchor);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const firstKey = anchor.imageKeys[0];

  useEffect(() => {
    let active = true;
    if (!firstKey) {
      setImgUrl(null);
      return;
    }
    getMediaUrl(firstKey).then((url) => {
      if (active) setImgUrl(url);
    });
    return () => {
      active = false;
    };
  }, [firstKey]);

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const key = await saveMediaBlob(file);
    updateAnchor(anchor.id, { imageKeys: [key, ...anchor.imageKeys] });
  };

  return (
    <>
      <div
        data-node-interactive="true"
        data-a={anchor.id}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{
          left: layout.x,
          top: layout.y,
          width: layout.w,
          height: layout.h,
        }}
        className={`absolute flex flex-col rounded-[11px] border bg-[#fbfaf7] transition-opacity duration-150 dark:bg-[#1c1a17] ${
          dragOver
            ? 'border-amber-500 ring-2 ring-amber-500/30'
            : 'border-stone-300/70 dark:border-stone-700/70'
        } ${dimmed ? 'opacity-30' : 'opacity-100'}`}
      >
        <div className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 text-[11px]">
          <input
            type="text"
            value={anchor.name}
            onChange={(e) => updateAnchor(anchor.id, { name: e.target.value })}
            className="min-w-0 flex-1 bg-transparent font-semibold outline-none focus:underline"
          />
          <span className="rounded bg-stone-200/70 px-1.5 py-0.5 text-[10px] text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            {KIND_LABEL[anchor.kind]}
          </span>
          <button
            type="button"
            title="删除锚点"
            onClick={() => removeAnchor(anchor.id)}
            className="rounded p-0.5 text-stone-400 hover:bg-red-500/10 hover:text-red-500"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>

        <div
          onClick={() => imgUrl && setPreviewOpen(true)}
          className={`mx-2 flex flex-1 items-center justify-center overflow-hidden rounded-[5px] bg-[#efece4] px-2 text-center text-[10.5px] text-stone-500 dark:bg-[#2c2823] dark:text-stone-400 ${
            imgUrl ? 'cursor-zoom-in px-0' : ''
          }`}
        >
          {imgUrl ? (
            <img src={imgUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <textarea
              rows={3}
              value={anchor.text}
              onChange={(e) => updateAnchor(anchor.id, { text: e.target.value })}
              placeholder="拖入设定图或填写描述"
              className="h-full w-full resize-none bg-transparent p-1 text-center text-[10.5px] outline-none"
            />
          )}
        </div>

        <div className="flex items-center justify-between px-2.5 py-1.5 text-[10.5px] text-stone-500">
          <span>{anchor.imageKeys.length > 0 ? '已绑定参考图' : '纯文本锚点'}</span>
          <span>{usedCount} 镜使用</span>
        </div>
      </div>

      <MediaPreviewModal
        url={previewOpen ? imgUrl : null}
        role="frame"
        onClose={() => setPreviewOpen(false)}
      />
    </>
  );
};
