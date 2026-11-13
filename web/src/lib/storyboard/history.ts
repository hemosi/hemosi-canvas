import {
  Patch,
  applyPatches,
  enablePatches,
  produceWithPatches,
} from 'immer';

enablePatches();

export interface HistoryEntry {
  id: string;
  label: string;
  patches: Patch[];
  inverse: Patch[];
  mergeKey?: string;
  timestamp: number;
}

export interface HistoryStack {
  past: HistoryEntry[];
  future: HistoryEntry[];
  limit: number;
}

export function createHistoryStack(limit = 80): HistoryStack {
  return { past: [], future: [], limit };
}

export interface CommitOptions {
  label: string;
  mergeKey?: string;
  now?: number;
  mergeWindowMs?: number;
}

export function commitState<T>(
  state: T,
  stack: HistoryStack,
  recipe: (draft: T) => void,
  opts: CommitOptions
): { state: T; stack: HistoryStack; changed: boolean } {
  const [nextState, patches, inverse] = produceWithPatches(state, recipe);
  if (patches.length === 0) {
    return { state, stack, changed: false };
  }

  const now = opts.now ?? Date.now();
  const windowMs = opts.mergeWindowMs ?? 500;
  const last = stack.past[stack.past.length - 1];

  if (
    opts.mergeKey &&
    last &&
    last.mergeKey === opts.mergeKey &&
    now - last.timestamp <= windowMs
  ) {
    const merged: HistoryEntry = {
      ...last,
      label: opts.label,
      patches: [...last.patches, ...patches],
      // inverse 需要先撤回后发生的，再撤回先发生的
      inverse: [...inverse, ...last.inverse],
      timestamp: now,
    };
    const nextPast = [...stack.past.slice(0, -1), merged];
    return {
      state: nextState,
      stack: { ...stack, past: nextPast, future: [] },
      changed: true,
    };
  }

  const entry: HistoryEntry = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    label: opts.label,
    patches,
    inverse,
    mergeKey: opts.mergeKey,
    timestamp: now,
  };

  const nextPast = [...stack.past, entry];
  if (nextPast.length > stack.limit) {
    nextPast.splice(0, nextPast.length - stack.limit);
  }

  return {
    state: nextState,
    stack: { ...stack, past: nextPast, future: [] },
    changed: true,
  };
}

export function undoState<T extends object>(
  state: T,
  stack: HistoryStack
): { state: T; stack: HistoryStack; undone?: HistoryEntry } {
  if (stack.past.length === 0) {
    return { state, stack };
  }
  const entry = stack.past[stack.past.length - 1];
  const prevState = applyPatches(state, entry.inverse) as T;
  return {
    state: prevState,
    stack: {
      ...stack,
      past: stack.past.slice(0, -1),
      future: [entry, ...stack.future],
    },
    undone: entry,
  };
}

export function redoState<T extends object>(
  state: T,
  stack: HistoryStack
): { state: T; stack: HistoryStack; redone?: HistoryEntry } {
  if (stack.future.length === 0) {
    return { state, stack };
  }
  const [entry, ...restFuture] = stack.future;
  const nextState = applyPatches(state, entry.patches) as T;
  return {
    state: nextState,
    stack: {
      ...stack,
      past: [...stack.past, entry],
      future: restFuture,
    },
    redone: entry,
  };
}
