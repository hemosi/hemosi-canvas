export type VoiceMode = 'native' | 'dub' | 'none';
export type GenerationMode = 'frame' | 'direct';
export type AnchorKind = 'character' | 'scene' | 'style';
export type RowNodeRole = 'frame' | 'video';
export type RowNodeHealth = 'error' | 'running' | 'idle' | 'stale' | 'ok';

export interface DeskRow {
  id: string;
  desc: string;
  line: string;
  dur: number;
  size: string;
  roles: string[];
  voice: VoiceMode;
  mode: GenerationMode;
  cont: boolean;
  dubStorageKey?: string;
  dubDurationSec?: number;
}

export interface Desk {
  id: string;
  title: string;
  budgetSec: number;
  rows: DeskRow[];
}

export interface Anchor {
  id: string;
  kind: AnchorKind;
  name: string;
  text: string;
  imageKeys: string[];
}

export interface Take {
  id: string;
  storageKey: string;
  inputsHash: string;
  prompt: string;
  model: string;
  createdAt: number;
}

export interface RowNode {
  rowId: string;
  role: RowNodeRole;
  takes: Take[];
  pickedTakeId?: string;
  run?: {
    state: 'queued' | 'running' | 'error';
    error?: string;
  };
  detached?: boolean;
  promptOverride?: string;
  manual?: { x: number; y: number };
}

export interface PromptTemplate {
  id: string;
  name: string;
  body: string;
}

export function rowNodeKey(rowId: string, role: RowNodeRole): string {
  return `${rowId}:${role}`;
}

export function getPickedTake(node?: RowNode): Take | undefined {
  if (!node || node.takes.length === 0) return undefined;
  if (node.pickedTakeId) {
    const found = node.takes.find((t) => t.id === node.pickedTakeId);
    if (found) return found;
  }
  return node.takes[node.takes.length - 1];
}

export function composePrompt(
  row: DeskRow,
  anchors: Anchor[],
  template?: PromptTemplate | null
): string {
  const usedAnchors = anchors.filter((a) => row.roles.includes(a.id));
  const rolesText = usedAnchors
    .map((a) => (a.text ? `${a.name}：${a.text}` : a.name))
    .join('；');

  if (template?.body) {
    return template.body
      .replace(/\{\{\s*desc\s*\}\}/g, row.desc)
      .replace(/\{\{\s*line\s*\}\}/g, row.line)
      .replace(/\{\{\s*size\s*\}\}/g, row.size)
      .replace(/\{\{\s*dur\s*\}\}/g, String(row.dur))
      .replace(/\{\{\s*roles\s*\}\}/g, rolesText)
      .trim();
  }

  return [row.size, row.desc, rolesText, row.line ? `台词：${row.line}` : '']
    .filter(Boolean)
    .join(' | ');
}

export function getEffectivePrompt(
  row: DeskRow,
  node: RowNode | undefined,
  anchors: Anchor[],
  template?: PromptTemplate | null
): string {
  if (node?.promptOverride !== undefined && node.promptOverride !== '') {
    return node.promptOverride;
  }
  return composePrompt(row, anchors, template);
}

/**
 * 确定性 32 位 FNV-1a 哈希，用于 inputsHash，纯函数无浏览器/Node 依赖
 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export interface InputsHashParams {
  effectivePrompt: string;
  refImageKeys: string[];
  model: string;
  size: string;
  upstreamTakeId?: string;
}

export function computeInputsHash(params: InputsHashParams): string {
  const sortedRefs = [...params.refImageKeys].sort();
  const payload = JSON.stringify({
    p: params.effectivePrompt,
    r: sortedRefs,
    m: params.model,
    s: params.size,
    u: params.upstreamTakeId ?? '',
  });
  return fnv1a(payload);
}

/**
 * 状态是派生的，不存储：
 * error/running > 无 take 为 idle > inputsHash 不一致为 stale > ok
 */
export function deriveNodeHealth(
  node: RowNode | undefined,
  currentInputsHash: string
): RowNodeHealth {
  if (!node) return 'idle';
  if (node.run?.state === 'error') return 'error';
  if (node.run?.state === 'running' || node.run?.state === 'queued') {
    return 'running';
  }
  const picked = getPickedTake(node);
  if (!picked) return 'idle';
  if (picked.inputsHash !== currentInputsHash) return 'stale';
  return 'ok';
}

export function estimateDubSeconds(line: string, charsPerSec = 4.2): number {
  const clean = line.replace(/[“”"'…，。！？、；：\s]/g, '');
  if (!clean) return 0;
  return Number((clean.length / charsPerSec).toFixed(1));
}
