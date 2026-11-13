import React from 'react';
import { WireItem } from '@/lib/storyboard/layout';

interface WiresProps {
  wires: WireItem[];
  hoveredRowId: string | null;
}

export const Wires: React.FC<WiresProps> = React.memo(({ wires, hoveredRowId }) => {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      aria-hidden="true"
    >
      {wires.map((w) => {
        const isHl = hoveredRowId !== null && w.rowId === hoveredRowId;
        const isDim = hoveredRowId !== null && w.rowId !== hoveredRowId;
        const strokeColor =
          w.kind === 'continue' || isHl
            ? 'var(--sb-ac, #d97706)'
            : 'var(--sb-wire, rgba(120,113,108,0.38))';

        return (
          <path
            key={w.id}
            data-row={w.rowId}
            d={w.d}
            fill="none"
            stroke={strokeColor}
            strokeWidth={isHl ? 2.4 : 1.5}
            strokeDasharray={w.kind === 'continue' ? '5 4' : undefined}
            opacity={isDim ? 0.14 : 1}
            className="transition-opacity duration-150"
          />
        );
      })}
    </svg>
  );
});

Wires.displayName = 'Wires';
