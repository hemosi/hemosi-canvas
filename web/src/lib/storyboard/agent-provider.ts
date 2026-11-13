import { PLAN_JSON_SCHEMA, Plan, PlanSchema } from './plan-schema';
import { Anchor, Desk } from './types';
import { StoryboardTextConfig } from '@/stores/storyboard/use-storyboard-settings-store';

export interface Provider<I, O> {
  id: string;
  kind: string;
  health(): Promise<'up' | 'down'>;
  run(input: I, signal: AbortSignal): Promise<O>;
}

export interface AgentPlanInput {
  instruction: string;
  desk: Desk;
  anchors: Anchor[];
  selectedRowId: string | null;
}

export function buildTextSnapshot(
  desk: Desk,
  anchors: Anchor[],
  selectedRowId: string | null
): string {
  const rowsText = desk.rows
    .map((r, i) => {
      const mark = r.id === selectedRowId ? ' [当前选中]' : '';
      return `镜${String(i + 1).padStart(2, '0')}(id=${r.id})${mark}: 画面="${r.desc}" | 台词="${r.line}" | 时长=${r.dur}s | 景别=${r.size} | 模式=${r.mode}`;
    })
    .join('\n');

  const anchorsText =
    anchors.length > 0
      ? anchors
          .map((a) => `- ${a.name}(${a.kind}): ${a.text || '无描述'}`)
          .join('\n')
      : '无';

  return `分镜表标题: ${desk.title}\n预算总时长: ${desk.budgetSec}s\n\n锚点:\n${anchorsText}\n\n分镜行:\n${rowsText || '（空）'}`;
}

const SYSTEM_PROMPT = `你是分镜表导演助手。你只产出修改方案（JSON），不直接修改画布，也不触发生成。
必须严格输出合法 JSON 对象，字段如下：
{
  "summary": "一句话总结方案",
  "changes": [
    { "id": "c1", "kind": "row.add", "at": 可选下标, "row": { "desc": "", "line": "", "dur": 5, "size": "中景", "voice": "none|dub|native", "mode": "frame|direct", "cont": false } },
    { "id": "c2", "kind": "row.update", "rowId": "已有行id", "patch": { ... } },
    { "id": "c3", "kind": "row.remove", "rowId": "已有行id" },
    { "id": "c4", "kind": "row.move", "rowId": "已有行id", "to": 目标下标 },
    { "id": "c5", "kind": "anchor.add", "anchor": { "kind": "character|scene|style", "name": "名字", "text": "描述" } },
    { "id": "c6", "kind": "row.roles", "rowId": "已有行id", "anchorNames": ["名字"] }
  ],
  "suggestRun": { "rowIds": ["可选"], "kind": "image|video" }
}
注意：每条 change 的 id 必须唯一；rowId 必须使用快照里的真实 id。`;

function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export async function checkTextProviderHealth(
  config: StoryboardTextConfig
): Promise<'up' | 'down'> {
  try {
    const base = config.baseUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/models`, {
      headers: config.apiKey
        ? { Authorization: `Bearer ${config.apiKey}` }
        : undefined,
    });
    return res.ok ? 'up' : 'down';
  } catch {
    return 'down';
  }
}

export async function runAgentPlan(
  input: AgentPlanInput,
  config: StoryboardTextConfig,
  signal: AbortSignal
): Promise<Plan> {
  const base = config.baseUrl.replace(/\/+$/, '');
  const snapshot = buildTextSnapshot(
    input.desk,
    input.anchors,
    input.selectedRowId
  );

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `当前分镜表快照：\n${snapshot}\n\n导演指令：\n${input.instruction}`,
    },
  ];

  let lastError = '未知错误';
  const maxAttempts = 3; // 初次 + 最多重试 2 次

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      temperature: 0.3,
    };

    if (config.kind === 'ollama') {
      body.format = PLAN_JSON_SCHEMA;
    } else {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`模型接口报错 (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const rawContent: string = data?.choices?.[0]?.message?.content ?? '';

    try {
      const parsedJson = JSON.parse(extractJsonText(rawContent));
      const checked = PlanSchema.safeParse(parsedJson);
      if (checked.success) {
        return checked.data;
      }
      lastError = checked.error.issues
        .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
        .join('; ');
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'JSON 解析失败';
    }

    if (attempt < maxAttempts) {
      messages.push({ role: 'assistant', content: rawContent });
      messages.push({
        role: 'user',
        content: `输出校验失败（${lastError}），请严格按 JSON Schema 修正后仅输出合法 JSON。`,
      });
    }
  }

  throw new Error(`Agent 方案校验失败（已重试 2 次）：${lastError}`);
}
