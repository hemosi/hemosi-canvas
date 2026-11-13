import { useCallback, useRef, useState } from 'react';

export interface CameraState {
  x: number;
  y: number;
  k: number;
}

export type LodLevel = 'hi' | 'mid' | 'low';

export function getLodLevel(k: number): LodLevel {
  if (k < 0.45) return 'low';
  if (k < 0.8) return 'mid';
  return 'hi';
}

export function useCamera(initial: CameraState = { x: 30, y: 10, k: 1 }) {
  const [cam, setCam] = useState<CameraState>(initial);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    camX: number;
    camY: number;
  } | null>(null);

  const clampZoom = (k: number) => Math.min(2.2, Math.max(0.22, k));

  const zoomAt = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      setCam((prev) => {
        const nextK = clampZoom(prev.k * factor);
        const el = stageRef.current;
        if (!el || clientX === undefined || clientY === undefined) {
          return { ...prev, k: nextK };
        }
        const rect = el.getBoundingClientRect();
        const px = clientX - rect.left;
        const py = clientY - rect.top;
        const ratio = nextK / prev.k;
        return {
          k: nextK,
          x: px - (px - prev.x) * ratio,
          y: py - (py - prev.y) * ratio,
        };
      });
    },
    []
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const el = stageRef.current;
      if (!el) {
        zoomAt(factor);
        return;
      }
      const rect = el.getBoundingClientRect();
      zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
    },
    [zoomAt]
  );

  const fit = useCallback((boardWidth = 1360, boardHeight = 760) => {
    const el = stageRef.current;
    if (!el) {
      setCam({ x: 30, y: 10, k: 1 });
      return;
    }
    const rect = el.getBoundingClientRect();
    const pad = 40;
    const kx = (rect.width - pad * 2) / boardWidth;
    const ky = (rect.height - pad * 2) / boardHeight;
    const k = clampZoom(Math.min(1, kx, ky));
    const x = Math.max(20, (rect.width - boardWidth * k) / 2);
    const y = 16;
    setCam({ x, y, k });
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        zoomAt(factor, e.clientX, e.clientY);
      } else {
        setCam((prev) => ({
          ...prev,
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }));
      }
    },
    [zoomAt]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('[data-node-interactive="true"]')) return;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        camX: cam.x,
        camY: cam.y,
      };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [cam.x, cam.y]
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setCam((prev) => ({
      ...prev,
      x: dragRef.current!.camX + dx,
      y: dragRef.current!.camY + dy,
    }));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }, []);

  return {
    cam,
    lod: getLodLevel(cam.k),
    stageRef,
    zoomBy,
    fit,
    handlers: {
      onWheel,
      onPointerDown,
      onPointerMove,
      onPointerUp,
    },
  };
}
