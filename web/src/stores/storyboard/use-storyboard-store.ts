import localforage from 'localforage';
import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  HistoryStack,
  commitState,
  createHistoryStack,
  redoState,
  undoState,
} from '@/lib/storyboard/history';
import {
  Anchor,
  Desk,
  DeskRow,
  PromptTemplate,
  RowNode,
  RowNodeRole,
  computeInputsHash,
  getEffectivePrompt,
  rowNodeKey,
} from '@/lib/storyboard/types';
import { Plan } from '@/lib/storyboard/plan-schema';
import { previewPlan } from '@/lib/storyboard/plan';

export const STORYBOARD_SCHEMA_VERSION = 1;

export interface StoryboardDocState {
  desk: Desk;
  anchors: Anchor[];
  nodes: Record<string, RowNode>;
  templates: PromptTemplate[];
  activeTemplateId: string | null;
}

export interface StoryboardStoreState extends StoryboardDocState {
  schemaVersion: number;
  selectedRowId: string | null;
  hoveredRowId: string | null;
  history: HistoryStack;

  // 文档编辑（入历史栈）
  commitDoc: (
    label: string,
    recipe: (draft: StoryboardDocState) => void,
    mergeKey?: string
  ) => void;
  undo: () => void;
  redo: () => void;

  // 行操作
  selectRow: (rowId: string | null) => void;
  hoverRow: (rowId: string | null) => void;
  addRow: (at?: number, partial?: Partial<DeskRow>) => string;
  updateRow: (rowId: string, patch: Partial<DeskRow>, mergeKey?: string) => void;
  removeRow: (rowId: string) => void;
  moveRow: (fromIndex: number, toIndex: number) => void;
  toggleRowRole: (rowId: string, anchorId: string) => void;

  // 锚点操作
  addAnchor: (anchor: Omit<Anchor, 'id'>) => string;
  updateAnchor: (id: string, patch: Partial<Anchor>) => void;
  removeAnchor: (id: string) => void;

  // 节点与 Take 操作
  setManualNodePos: (key: string, pos: { x: number; y: number }) => void;
  tidyLayout: () => void;
  setNodeRun: (
    rowId: string,
    role: RowNodeRole,
    run?: { state: 'queued' | 'running' | 'error'; error?: string }
  ) => void;
  addTake: (
    rowId: string,
    role: RowNodeRole,
    storageKey: string,
    modelLabel: string
  ) => void;
  pickTake: (rowId: string, role: RowNodeRole, takeId: string) => void;

  // 提示词底板库（完全由用户自定义，无硬编码文案）
  upsertTemplate: (tpl: PromptTemplate) => void;
  removeTemplate: (id: string) => void;
  setActiveTemplateId: (id: string | null) => void;

  // 元信息
  setDeskMeta: (patch: Partial<Pick<Desk, 'title' | 'budgetSec'>>) => void;
  resetEmptyDesk: (title?: string) => void;
  applyPlan: (plan: Plan, enabledIds: string[]) => void;
}

function createEmptyDoc(title = '未命名分镜表'): StoryboardDocState {
  return {
    desk: {
      id: nanoid(8),
      title,
      budgetSec: 30,
      rows: [
        {
          id: nanoid(8),
          desc: '',
          line: '',
          dur: 5,
          size: '中景',
          roles: [],
          voice: 'none',
          mode: 'frame',
          cont: false,
        },
      ],
    },
    anchors: [],
    nodes: {},
    templates: [],
    activeTemplateId: null,
  };
}

const lfStorage = createJSONStorage(() => ({
  getItem: (name) => localforage.getItem<string>(name),
  setItem: async (name, value) => {
    await localforage.setItem(name, value);
  },
  removeItem: (name) => localforage.removeItem(name),
}));

export const useStoryboardStore = create<StoryboardStoreState>()(
  persist(
    (set, get) => {
      const initialDoc = createEmptyDoc();

      const extractDoc = (s: StoryboardStoreState): StoryboardDocState => ({
        desk: s.desk,
        anchors: s.anchors,
        nodes: s.nodes,
        templates: s.templates,
        activeTemplateId: s.activeTemplateId,
      });

      return {
        ...initialDoc,
        schemaVersion: STORYBOARD_SCHEMA_VERSION,
        selectedRowId: initialDoc.desk.rows[0]?.id ?? null,
        hoveredRowId: null,
        history: createHistoryStack(),

        commitDoc: (label, recipe, mergeKey) => {
          const s = get();
          const doc = extractDoc(s);
          const res = commitState(doc, s.history, recipe, { label, mergeKey });
          if (!res.changed) return;
          set({ ...res.state, history: res.stack });
        },

        undo: () => {
          const s = get();
          const res = undoState(extractDoc(s), s.history);
          if (!res.undone) return;
          set({ ...res.state, history: res.stack });
        },

        redo: () => {
          const s = get();
          const res = redoState(extractDoc(s), s.history);
          if (!res.redone) return;
          set({ ...res.state, history: res.stack });
        },

        selectRow: (rowId) => set({ selectedRowId: rowId }),
        hoverRow: (rowId) => set({ hoveredRowId: rowId }),

        addRow: (at, partial) => {
          const id = nanoid(8);
          get().commitDoc('添加镜头', (d) => {
            const newRow: DeskRow = {
              id,
              desc: partial?.desc ?? '',
              line: partial?.line ?? '',
              dur: partial?.dur ?? 5,
              size: partial?.size ?? '中景',
              roles: partial?.roles ?? [],
              voice: partial?.voice ?? 'none',
              mode: partial?.mode ?? 'frame',
              cont: partial?.cont ?? false,
            };
            if (typeof at === 'number' && at >= 0 && at <= d.desk.rows.length) {
              d.desk.rows.splice(at, 0, newRow);
            } else {
              d.desk.rows.push(newRow);
            }
          });
          set({ selectedRowId: id });
          return id;
        },

        updateRow: (rowId, patch, mergeKey) => {
          get().commitDoc(
            '编辑镜头',
            (d) => {
              const row = d.desk.rows.find((r) => r.id === rowId);
              if (!row) return;
              Object.assign(row, patch);
              if (patch.mode === 'direct') {
                row.cont = false;
              }
            },
            mergeKey
          );
        },

        removeRow: (rowId) => {
          const s = get();
          get().commitDoc('删除镜头', (d) => {
            d.desk.rows = d.desk.rows.filter((r) => r.id !== rowId);
            delete d.nodes[rowNodeKey(rowId, 'frame')];
            delete d.nodes[rowNodeKey(rowId, 'video')];
          });
          if (s.selectedRowId === rowId) {
            const remaining = get().desk.rows;
            set({ selectedRowId: remaining[0]?.id ?? null });
          }
        },

        moveRow: (fromIndex, toIndex) => {
          if (fromIndex === toIndex) return;
          get().commitDoc('调整镜序', (d) => {
            const rows = d.desk.rows;
            if (
              fromIndex < 0 ||
              fromIndex >= rows.length ||
              toIndex < 0 ||
              toIndex >= rows.length
            ) {
              return;
            }
            const [moved] = rows.splice(fromIndex, 1);
            rows.splice(toIndex, 0, moved);
          });
        },

        toggleRowRole: (rowId, anchorId) => {
          get().commitDoc('切换出镜锚点', (d) => {
            const row = d.desk.rows.find((r) => r.id === rowId);
            if (!row) return;
            if (row.roles.includes(anchorId)) {
              row.roles = row.roles.filter((id) => id !== anchorId);
            } else {
              row.roles.push(anchorId);
            }
          });
        },

        addAnchor: (anchor) => {
          const id = nanoid(8);
          get().commitDoc('添加设定锚点', (d) => {
            d.anchors.push({ ...anchor, id });
          });
          return id;
        },

        updateAnchor: (id, patch) => {
          get().commitDoc('编辑设定锚点', (d) => {
            const a = d.anchors.find((x) => x.id === id);
            if (a) Object.assign(a, patch);
          });
        },

        removeAnchor: (id) => {
          get().commitDoc('删除设定锚点', (d) => {
            d.anchors = d.anchors.filter((a) => a.id !== id);
            d.desk.rows.forEach((r) => {
              r.roles = r.roles.filter((rid) => rid !== id);
            });
          });
        },

        setManualNodePos: (key, pos) => {
          get().commitDoc(
            '移动节点',
            (d) => {
              const [rowId, role] = key.split(':') as [string, RowNodeRole];
              if (!d.nodes[key]) {
                d.nodes[key] = { rowId, role, takes: [] };
              }
              d.nodes[key].manual = pos;
            },
            `drag:${key}`
          );
        },

        tidyLayout: () => {
          get().commitDoc('整理画布', (d) => {
            Object.values(d.nodes).forEach((n) => {
              delete n.manual;
            });
          });
        },

        setNodeRun: (rowId, role, run) => {
          set((s) => {
            const key = rowNodeKey(rowId, role);
            const existing = s.nodes[key] ?? { rowId, role, takes: [] };
            const nextNode: RowNode = { ...existing };
            if (run) nextNode.run = run;
            else delete nextNode.run;
            return { nodes: { ...s.nodes, [key]: nextNode } };
          });
        },

        addTake: (rowId, role, storageKey, modelLabel) => {
          const s = get();
          const row = s.desk.rows.find((r) => r.id === rowId);
          if (!row) return;
          const key = rowNodeKey(rowId, role);
          const tpl = s.templates.find((t) => t.id === s.activeTemplateId) ?? null;
          const prompt = getEffectivePrompt(row, s.nodes[key], s.anchors, tpl);
          const refKeys = s.anchors
            .filter((a) => row.roles.includes(a.id))
            .flatMap((a) => a.imageKeys);
          const hash = computeInputsHash({
            effectivePrompt: prompt,
            refImageKeys: refKeys,
            model: modelLabel,
            size: row.size,
          });
          const takeId = nanoid(8);
          get().commitDoc('写入素材版本', (d) => {
            if (!d.nodes[key]) {
              d.nodes[key] = { rowId, role, takes: [] };
            }
            d.nodes[key].takes.push({
              id: takeId,
              storageKey,
              inputsHash: hash,
              prompt,
              model: modelLabel,
              createdAt: Date.now(),
            });
            d.nodes[key].pickedTakeId = takeId;
            delete d.nodes[key].run;
          });
        },

        pickTake: (rowId, role, takeId) => {
          get().commitDoc('切换素材版本', (d) => {
            const n = d.nodes[rowNodeKey(rowId, role)];
            if (n) n.pickedTakeId = takeId;
          });
        },

        upsertTemplate: (tpl) => {
          get().commitDoc('保存提示词底板', (d) => {
            const idx = d.templates.findIndex((t) => t.id === tpl.id);
            if (idx >= 0) d.templates[idx] = tpl;
            else d.templates.push(tpl);
          });
        },

        removeTemplate: (id) => {
          get().commitDoc('删除提示词底板', (d) => {
            d.templates = d.templates.filter((t) => t.id !== id);
            if (d.activeTemplateId === id) d.activeTemplateId = null;
          });
        },

        setActiveTemplateId: (id) => set({ activeTemplateId: id }),

        setDeskMeta: (patch) => {
          get().commitDoc(
            '更新分镜表信息',
            (d) => {
              Object.assign(d.desk, patch);
            },
            'desk-meta'
          );
        },

        resetEmptyDesk: (title) => {
          const fresh = createEmptyDoc(title);
          set({
            ...fresh,
            selectedRowId: fresh.desk.rows[0]?.id ?? null,
            hoveredRowId: null,
            history: createHistoryStack(),
          });
        },

        applyPlan: (plan, enabledIds) => {
          get().commitDoc(`应用方案: ${plan.summary.slice(0, 20)}`, (d) => {
            const res = previewPlan(
              d.desk,
              d.anchors,
              d.nodes,
              plan,
              enabledIds
            );
            d.desk = res.nextDesk;
            d.anchors = res.nextAnchors;
            for (const removedId of res.diff.removedRowIds) {
              delete d.nodes[rowNodeKey(removedId, 'frame')];
              delete d.nodes[rowNodeKey(removedId, 'video')];
            }
          });
        },
      };
    },
    {
      name: 'hemosi-storyboard-v1',
      version: STORYBOARD_SCHEMA_VERSION,
      storage: lfStorage,
      partialize: (state) => ({
        schemaVersion: state.schemaVersion,
        desk: state.desk,
        anchors: state.anchors,
        nodes: state.nodes,
        templates: state.templates,
        activeTemplateId: state.activeTemplateId,
        selectedRowId: state.selectedRowId,
      }),
    }
  )
);
