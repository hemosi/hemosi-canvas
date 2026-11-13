import {
  Anchor,
  Desk,
  RowNode,
  RowNodeRole,
  rowNodeKey,
} from './types';

export const LAYOUT_CONSTANTS = {
  TOP: 40,
  ANCHOR_X: 0,
  ANCHOR_W: 200,
  ANCHOR_H: 150,
  ANCHOR_GAP: 22,
  DESK_X: 250,
  DESK_W: 600,
  DESK_HEADER_H: 44,
  ROW_COLLAPSED_H: 60,
  ROW_EXPANDED_H: 262,
  FRAME_X: 900,
  VIDEO_X: 1120,
  NODE_W: 200,
  BOARD_PADDING_BOTTOM: 120,
} as const;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RowLayoutItem {
  rowId: string;
  index: number;
  localY: number;
  absY: number;
  h: number;
  expanded: boolean;
  midY: number;
}

export interface NodeLayoutItem extends Rect {
  key: string;
  rowId: string;
  role: RowNodeRole;
  isManual: boolean;
}

export interface AnchorLayoutItem extends Rect {
  anchorId: string;
}

export interface WireItem {
  id: string;
  rowId: string;
  anchorId?: string;
  kind: 'anchor' | 'flow' | 'continue';
  d: string;
}

export interface LaneLayoutResult {
  anchors: AnchorLayoutItem[];
  desk: Rect;
  rows: RowLayoutItem[];
  nodes: Record<string, NodeLayoutItem>;
  wires: WireItem[];
  boardHeight: number;
}

function cubicPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = (x2 - x1) / 2;
  return `M${x1} ${y1}C${x1 + dx} ${y1},${x2 - dx} ${y2},${x2} ${y2}`;
}

export function laneLayout(
  desk: Desk,
  anchors: Anchor[],
  nodes: Record<string, RowNode>,
  selectedRowId?: string | null
): LaneLayoutResult {
  const C = LAYOUT_CONSTANTS;

  const anchorItems: AnchorLayoutItem[] = anchors.map((a, i) => ({
    anchorId: a.id,
    x: C.ANCHOR_X,
    y: C.TOP + i * (C.ANCHOR_H + C.ANCHOR_GAP),
    w: C.ANCHOR_W,
    h: C.ANCHOR_H,
  }));

  const anchorMap = new Map(anchorItems.map((a) => [a.anchorId, a]));

  let localY = C.DESK_HEADER_H;
  const rowItems: RowLayoutItem[] = [];
  const nodeItems: Record<string, NodeLayoutItem> = {};

  desk.rows.forEach((row, index) => {
    const expanded = row.id === selectedRowId;
    const h = expanded ? C.ROW_EXPANDED_H : C.ROW_COLLAPSED_H;
    const absY = C.TOP + localY;
    const midY = absY + C.ROW_COLLAPSED_H / 2;

    rowItems.push({
      rowId: row.id,
      index,
      localY,
      absY,
      h,
      expanded,
      midY,
    });

    const nodeH = expanded ? C.ROW_EXPANDED_H - 14 : C.ROW_COLLAPSED_H - 10;
    const nodeY = absY + (expanded ? 7 : 5);

    if (row.mode === 'frame') {
      const fKey = rowNodeKey(row.id, 'frame');
      const fManual = nodes[fKey]?.manual;
      nodeItems[fKey] = {
        key: fKey,
        rowId: row.id,
        role: 'frame',
        x: fManual ? fManual.x : C.FRAME_X,
        y: fManual ? fManual.y : nodeY,
        w: C.NODE_W,
        h: nodeH,
        isManual: Boolean(fManual),
      };
    }

    const vKey = rowNodeKey(row.id, 'video');
    const vManual = nodes[vKey]?.manual;
    nodeItems[vKey] = {
      key: vKey,
      rowId: row.id,
      role: 'video',
      x: vManual ? vManual.x : C.VIDEO_X,
      y: vManual ? vManual.y : nodeY,
      w: C.NODE_W,
      h: nodeH,
      isManual: Boolean(vManual),
    };

    localY += h;
  });

  const deskRect: Rect = {
    x: C.DESK_X,
    y: C.TOP,
    w: C.DESK_W,
    h: Math.max(C.DESK_HEADER_H + C.ROW_COLLAPSED_H, localY),
  };

  const wires: WireItem[] = [];

  desk.rows.forEach((row, index) => {
    const rLayout = rowItems[index];
    const fNode = nodeItems[rowNodeKey(row.id, 'frame')];
    const vNode = nodeItems[rowNodeKey(row.id, 'video')];

    row.roles.forEach((anchorId) => {
      const aLayout = anchorMap.get(anchorId);
      if (!aLayout) return;
      wires.push({
        id: `a:${anchorId}->${row.id}`,
        rowId: row.id,
        anchorId,
        kind: 'anchor',
        d: cubicPath(
          aLayout.x + aLayout.w,
          aLayout.y + aLayout.h / 2,
          C.DESK_X,
          rLayout.midY
        ),
      });
    });

    if (row.mode === 'frame' && fNode && vNode) {
      const fy = fNode.y + fNode.h / 2;
      const vy = vNode.y + vNode.h / 2;
      wires.push({
        id: `f:${row.id}:d->f`,
        rowId: row.id,
        kind: 'flow',
        d: cubicPath(C.DESK_X + C.DESK_W, rLayout.midY, fNode.x, fy),
      });
      wires.push({
        id: `f:${row.id}:f->v`,
        rowId: row.id,
        kind: 'flow',
        d: cubicPath(fNode.x + fNode.w, fy, vNode.x, vy),
      });
    } else if (vNode) {
      const vy = vNode.y + vNode.h / 2;
      wires.push({
        id: `f:${row.id}:d->v`,
        rowId: row.id,
        kind: 'flow',
        d: cubicPath(C.DESK_X + C.DESK_W, rLayout.midY, vNode.x, vy),
      });
    }

    if (row.cont && index > 0 && row.mode === 'frame' && fNode) {
      const prevRow = desk.rows[index - 1];
      const prevVideo = nodeItems[rowNodeKey(prevRow.id, 'video')];
      if (prevVideo) {
        const x1 = prevVideo.x + prevVideo.w / 2;
        const y1 = prevVideo.y + prevVideo.h;
        const x2 = fNode.x + fNode.w / 2;
        const y2 = fNode.y;
        wires.push({
          id: `c:${prevRow.id}->${row.id}`,
          rowId: row.id,
          kind: 'continue',
          d: `M${x1} ${y1}C${x1} ${y1 + 50},${x2} ${y2 - 50},${x2} ${y2}`,
        });
      }
    }
  });

  const maxBottom = Math.max(
    deskRect.y + deskRect.h,
    ...anchorItems.map((a) => a.y + a.h),
    ...Object.values(nodeItems).map((n) => n.y + n.h)
  );

  return {
    anchors: anchorItems,
    desk: deskRect,
    rows: rowItems,
    nodes: nodeItems,
    wires,
    boardHeight: maxBottom + C.BOARD_PADDING_BOTTOM,
  };
}
