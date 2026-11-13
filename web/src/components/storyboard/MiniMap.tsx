import React from 'react';
import { LaneLayoutResult } from '@/lib/storyboard/layout';
import { CameraState } from './use-camera';

interface MiniMapProps {
  layout: LaneLayoutResult;
  cam: CameraState;
}

export const MiniMap: React.FC<MiniMapProps> = ({ layout, cam }) => {
  const mapW = 148;
  const mapH = 88;
  const boardW = 1400;
  const boardH = Math.max(800, layout.boardHeight);
  const scale = Math.min(mapW / boardW, mapH / boardH);

  return (
    <div
      data-node-interactive="true"
      className="pointer-events-none absolute right-3 bottom-24 z-10 overflow-hidden rounded-lg border border-stone-300/70 bg-[#fbfaf7]/85 p-1 backdrop-blur-xs dark:border-stone-700/70 dark:bg-[#1c1a17]/85"
      style={{ width: mapW, height: mapH }}
    >
      <div className="relative h-full w-full">
        {layout.anchors.map((a) => (
          <div
            key={a.anchorId}
            style={{
              left: a.x * scale,
              top: a.y * scale,
              width: Math.max(3, a.w * scale),
              height: Math.max(3, a.h * scale),
            }}
            className="absolute rounded-[1px] bg-stone-400/60"
          />
        ))}
        <div
          style={{
            left: layout.desk.x * scale,
            top: layout.desk.y * scale,
            width: Math.max(6, layout.desk.w * scale),
            height: Math.max(6, layout.desk.h * scale),
          }}
          className="absolute rounded-[2px] border border-amber-600/70 bg-amber-500/20"
        />
        {Object.values(layout.nodes).map((n) => (
          <div
            key={n.key}
            style={{
              left: n.x * scale,
              top: n.y * scale,
              width: Math.max(3, n.w * scale),
              height: Math.max(2, n.h * scale),
            }}
            className="absolute rounded-[1px] bg-stone-500/50"
          />
        ))}
        {/* 视口指示框 */}
        <div
          style={{
            left: Math.max(0, (-cam.x / cam.k) * scale),
            top: Math.max(0, (-cam.y / cam.k) * scale),
            width: Math.min(mapW, (900 / cam.k) * scale),
            height: Math.min(mapH, (560 / cam.k) * scale),
          }}
          className="absolute rounded-[2px] border border-amber-500/90"
        />
      </div>
    </div>
  );
};
