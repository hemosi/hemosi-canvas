import React from 'react';
import { LAYOUT_CONSTANTS, LaneLayoutResult } from '@/lib/storyboard/layout';
import { PreviewPlanResult } from '@/lib/storyboard/plan';

interface GhostLayerProps {
  preview: PreviewPlanResult | null;
  layout: LaneLayoutResult;
}

export const GhostLayer: React.FC<GhostLayerProps> = ({ preview, layout }) => {
  if (!preview) return null;

  const { diff } = preview;
  const C = LAYOUT_CONSTANTS;
  const deskBottomY = layout.desk.y + layout.desk.h;

  return (
    <div className="pointer-events-none absolute inset-0 z-[4]">
      {/* 被修改/删除的已有行高亮标注 */}
      {layout.rows.map((r) => {
        const isRemoved = diff.removedRowIds.includes(r.rowId);
        const isUpdated = Boolean(diff.updatedRows[r.rowId]);
        if (!isRemoved && !isUpdated) return null;

        return (
          <div
            key={r.rowId}
            style={{
              left: layout.desk.x,
              top: r.absY,
              width: layout.desk.w,
              height: r.h,
            }}
            className={`absolute rounded border-[1.5px] border-dashed ${
              isRemoved
                ? 'border-red-500/80 bg-red-500/10'
                : 'border-amber-500/80 bg-amber-500/10'
            }`}
          >
            <span
              className={`absolute top-1.5 right-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                isRemoved
                  ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                  : 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
              }`}
            >
              {isRemoved ? '拟删除' : '拟修改'}
            </span>
          </div>
        );
      })}

      {/* 新增的幽灵镜头行 + 对应的虚线 RowNode */}
      {diff.addedRows.map((item, idx) => {
        const gy = deskBottomY + idx * C.ROW_COLLAPSED_H;
        const nodeY = gy + 5;
        const nodeH = C.ROW_COLLAPSED_H - 10;

        return (
          <React.Fragment key={item.changeId}>
            <div
              style={{
                left: C.DESK_X,
                top: gy,
                width: C.DESK_W,
                height: C.ROW_COLLAPSED_H,
              }}
              className="absolute flex items-center gap-2.5 rounded-lg border-[1.5px] border-dashed border-amber-500 bg-amber-500/10 px-3 text-[12px] text-amber-800 dark:text-amber-300"
            >
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium">
                新增
              </span>
              <span className="min-w-0 flex-1 truncate">
                {item.row.desc || '未填写画面描述'}
              </span>
              <span className="text-[11px] opacity-80">
                {item.row.dur}s · {item.row.size}
              </span>
            </div>

            {item.row.mode === 'frame' && (
              <div
                style={{
                  left: C.FRAME_X,
                  top: nodeY,
                  width: C.NODE_W,
                  height: nodeH,
                }}
                className="absolute flex items-center gap-2 rounded-[11px] border-[1.5px] border-dashed border-amber-500/80 bg-[#fbfaf7]/80 px-2.5 text-[11px] text-amber-700 opacity-75 dark:bg-[#1c1a17]/80 dark:text-amber-300"
              >
                <span>首帧（幽灵）</span>
              </div>
            )}

            <div
              style={{
                left: C.VIDEO_X,
                top: nodeY,
                width: C.NODE_W,
                height: nodeH,
              }}
              className="absolute flex items-center gap-2 rounded-[11px] border-[1.5px] border-dashed border-amber-500/80 bg-[#fbfaf7]/80 px-2.5 text-[11px] text-amber-700 opacity-75 dark:bg-[#1c1a17]/80 dark:text-amber-300"
            >
              <span>视频（幽灵）</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};
