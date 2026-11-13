import { nanoid } from "nanoid";

import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { buildShotRow, nextShotNo } from "@/lib/canvas/canvas-shot-actions";
import { CanvasNodeType, HemosiNodeType, type CanvasAnchorKind, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

/** 一次回复里最多连续自动执行的只读步数（待 hemosi 确认，见 docs/plans/agent-v2.md）。 */
export const AGENT_MAX_AUTO_STEPS = 6;
/** read_node 返回文字的截断长度（待 hemosi 确认）。 */
export const AGENT_READ_NODE_MAX = 4000;

export type AgentCall = { tool: string; args?: Record<string, unknown> };
export type AgentReply = { say: string; calls: AgentCall[] };

/** 改动卡：攒起来等用户点「应用」的写操作。 */
export type AgentChange = {
    ops: CanvasAgentOp[];
    steps: Array<{ text: string; danger?: boolean }>;
    /** 分镜批量生成（走一张生成确认卡）。 */
    shots: Array<{ ids: string[]; kind: "image" | "video" }>;
    /** 应用后要打开爆款复刻的视频节点。 */
    cloneNodeId?: string;
    /** 模型给新节点起的 key → 实际节点 id，应用后告诉模型。 */
    keys: Record<string, string>;
    errors: string[];
};

const READ_TOOLS = new Set(["read_canvas", "read_node"]);
export const isReadCall = (call: AgentCall) => READ_TOOLS.has(call.tool);

export function agentSystemPrompt() {
    return `你是 HemosiTV 无限画布里的创作 Agent，帮用户做 AI 短片：写脚本、拆分镜、建锚点、改提示词、发起生成。
你每次只输出一个 JSON 对象，不要代码块，不要别的文字：
{"say": "对用户说的话（中文，简短，说你做了什么、接下来做什么，或问一个问题）", "calls": [{"tool": "工具名", "args": {...}}]}
不需要工具时 calls 写 []，这代表这一轮结束，等用户说话。

工具：
- read_canvas {"onlySelected": false}：读画布摘要（节点 id、类型、标题、提示词开头、连线）。不知道画布上有什么时先读。
- read_node {"id": "节点id"}：读一个节点的完整内容。
- add_text {"key": "自取名", "title": "标题", "content": "全文"}：新建文本节点（剧本、台词稿）。
- add_shots {"key": "自取名", "title": "这组分镜的名字", "shots": [{"image": "首帧画面的图片提示词", "video": "人物动作与运镜的视频提示词", "seconds": 5}]}：新建一组分镜，第 n 个分镜可用 "自取名.n"（从 1 开始）引用。
- add_anchor {"key": "自取名", "kind": "character|scene|style", "title": "名字", "text": "固定设定（外形、服装、环境、色调）", "linkTo": ["节点id或自取名"]}：新建锚点并连到分镜，保证全片一致。
- update_node {"id": "节点id", "title": "...", "image": "分镜图片提示词", "video": "分镜视频提示词", "prompt": "普通节点提示词", "content": "文本节点全文", "seconds": "5", "size": "16:9"}：只写要改的字段。
- connect {"from": "节点id或自取名", "to": "节点id或自取名"}
- delete_nodes {"ids": ["节点id"]}
- generate {"ids": ["节点id或自取名"], "kind": "image|video"}：生成。花钱，用户会先看到确认卡。
- open_clone {"id": "视频节点id"}：对这个视频打开「爆款复刻」拆解。

规则：
1. read_canvas / read_node 会立即执行，结果下一条消息给你。读和改不要放在同一次 calls 里：先读，看完结果再改。
2. 其余工具会攒成一张改动卡，用户点「应用」才执行；结果（含自取名对应的真实 id）下一条消息给你。用户拒绝时会告诉你。
3. 只用画布里真实存在的 id 或本次自取名，不要编 id。
4. 用户没说要生成就不要 generate。一次性做太多前先用 say 问一句。
5. 提示词要具体：谁、在哪、做什么、景别、运镜、光线、风格。`;
}

/** 从模型回复里取出 JSON；取不到就把整段当成 say，本轮结束。 */
export function parseAgentReply(text: string): AgentReply {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    const source = fenced || text;
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start >= 0 && end > start) {
        try {
            const json = JSON.parse(source.slice(start, end + 1)) as { say?: unknown; calls?: unknown };
            const calls = Array.isArray(json.calls) ? json.calls.filter((item): item is AgentCall => Boolean(item && typeof item === "object" && typeof (item as AgentCall).tool === "string")) : [];
            return { say: typeof json.say === "string" ? json.say : "", calls };
        } catch {
            // 落到下面，当普通文字
        }
    }
    return { say: text.trim(), calls: [] };
}

const clip = (value: unknown, max: number) => {
    const text = typeof value === "string" ? value : value == null ? "" : String(value);
    return text.length > max ? `${text.slice(0, max)}…（已截断）` : text;
};

function compact<T extends Record<string, unknown>>(value: T) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "" && item !== null && !(Array.isArray(item) && !item.length))) as T;
}

function nodeBrief(node: CanvasNodeData) {
    const meta = node.metadata || {};
    const hasResult = node.type === HemosiNodeType.Shot ? { hasImage: Boolean(meta.shotImage?.content) || undefined, hasVideo: Boolean(meta.shotVideo?.content) || undefined } : { hasResult: Boolean(meta.content && node.type !== CanvasNodeType.Text) || undefined };
    return compact({
        id: node.id,
        type: node.type,
        title: node.title,
        group: meta.groupId,
        shotNo: meta.shotNo,
        image: node.type === HemosiNodeType.Shot ? clip(meta.shotDescription, 120) : undefined,
        video: node.type === HemosiNodeType.Shot ? clip(meta.prompt, 120) : undefined,
        prompt: node.type !== HemosiNodeType.Shot ? clip(meta.prompt, 120) : undefined,
        text: node.type === CanvasNodeType.Text ? clip(meta.content, 160) : undefined,
        anchor: meta.anchorKind ? `${meta.anchorKind}：${clip(meta.anchorText, 120)}` : undefined,
        seconds: meta.seconds,
        size: meta.size,
        status: meta.status,
        ...hasResult,
    });
}

/** 执行只读工具，返回给模型看的文字。 */
export function runReadCall(call: AgentCall, snapshot: CanvasAgentSnapshot) {
    if (call.tool === "read_canvas") {
        const selected = new Set(snapshot.selectedNodeIds);
        const onlySelected = Boolean(call.args?.onlySelected) && selected.size > 0;
        const nodes = snapshot.nodes.filter((node) => !onlySelected || selected.has(node.id) || (node.metadata?.groupId && selected.has(node.metadata.groupId)));
        const ids = new Set(nodes.map((node) => node.id));
        return JSON.stringify({
            title: snapshot.title,
            selected: snapshot.selectedNodeIds,
            nodes: nodes.map(nodeBrief),
            links: snapshot.connections.filter((item) => ids.has(item.fromNodeId) && ids.has(item.toNodeId)).map((item) => `${item.fromNodeId} -> ${item.toNodeId}`),
        });
    }
    const id = String(call.args?.id || "");
    const node = snapshot.nodes.find((item) => item.id === id);
    if (!node) return `read_node：画布里没有节点 ${id}`;
    const meta = node.metadata || {};
    return JSON.stringify(
        compact({
            ...nodeBrief(node),
            image: node.type === HemosiNodeType.Shot ? clip(meta.shotDescription, AGENT_READ_NODE_MAX) : undefined,
            video: node.type === HemosiNodeType.Shot ? clip(meta.prompt, AGENT_READ_NODE_MAX) : undefined,
            prompt: node.type !== HemosiNodeType.Shot ? clip(meta.prompt, AGENT_READ_NODE_MAX) : undefined,
            text: node.type === CanvasNodeType.Text ? clip(meta.content, AGENT_READ_NODE_MAX) : undefined,
            anchorText: clip(meta.anchorText, AGENT_READ_NODE_MAX),
            upstream: snapshot.connections.filter((item) => item.toNodeId === id).map((item) => item.fromNodeId),
            downstream: snapshot.connections.filter((item) => item.fromNodeId === id).map((item) => item.toNodeId),
        }),
    );
}

const str = (value: unknown) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
const list = (value: unknown) => (Array.isArray(value) ? value.map(str).filter(Boolean) : str(value) ? [str(value)] : []);
const ANCHOR_LABEL: Record<CanvasAnchorKind, string> = { character: "角色", scene: "场景", style: "风格" };

/** 把写工具攒成改动卡；新节点放在画布现有内容右边。 */
export function buildAgentChange(calls: AgentCall[], snapshot: CanvasAgentSnapshot): AgentChange {
    const change: AgentChange = { ops: [], steps: [], shots: [], keys: {}, errors: [] };
    const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const created = new Map<string, CanvasNodeData["type"]>();
    const resolve = (ref: string) => change.keys[ref] || ref;
    const exists = (id: string) => nodes.has(id) || created.has(id);
    const nameOf = (id: string) => nodes.get(id)?.title || Object.entries(change.keys).find(([, value]) => value === id)?.[0] || id;
    const right = snapshot.nodes.reduce((max, node) => Math.max(max, node.position.x + node.width), 0);
    const top = snapshot.nodes.length ? Math.min(...snapshot.nodes.map((node) => node.position.y)) : 0;
    let cursor = { x: snapshot.nodes.length ? right + 160 : 0, y: top };
    let shotNo = nextShotNo(snapshot.nodes);

    for (const call of calls) {
        const args = call.args || {};
        if (call.tool === "add_text") {
            const content = str(args.content);
            if (!content) {
                change.errors.push("add_text 缺 content，已跳过");
                continue;
            }
            const id = `agent-text-${nanoid(6)}`;
            change.ops.push({ type: "add_node", id, nodeType: CanvasNodeType.Text, title: str(args.title) || "文本", position: cursor, width: 420, height: 480, metadata: { content, prompt: content, status: "success" } });
            created.set(id, CanvasNodeType.Text);
            if (str(args.key)) change.keys[str(args.key)] = id;
            change.steps.push({ text: `新建文本「${str(args.title) || "文本"}」（${content.length} 字）` });
            cursor = { x: cursor.x + 500, y: cursor.y };
            continue;
        }
        if (call.tool === "add_shots") {
            const shots = (Array.isArray(args.shots) ? args.shots : []).map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : {})).filter((item) => str(item.image) || str(item.video));
            if (!shots.length) {
                change.errors.push("add_shots 没有有效分镜，已跳过");
                continue;
            }
            const title = str(args.title) || "分镜";
            const [group, ...row] = buildShotRow(shots.map((item) => str(item.image) || str(item.video)), cursor, shotNo, title);
            change.ops.push({ type: "add_node", id: group.id, nodeType: group.type, title: group.title, position: group.position, width: group.width, height: group.height, metadata: group.metadata });
            created.set(group.id, group.type);
            row.forEach((node, index) => {
                const shot = shots[index];
                const metadata: CanvasNodeMetadata = compact({ ...node.metadata, prompt: str(shot.video), seconds: str(shot.seconds) });
                change.ops.push({ type: "add_node", id: node.id, nodeType: node.type, title: node.title, position: node.position, width: node.width, height: node.height, metadata });
                created.set(node.id, node.type);
                if (str(args.key)) change.keys[`${str(args.key)}.${index + 1}`] = node.id;
            });
            if (str(args.key)) change.keys[str(args.key)] = group.id;
            change.steps.push({ text: `新建分镜组「${title}」：镜头 ${shotNo}–${shotNo + row.length - 1}，共 ${row.length} 个` });
            shotNo += row.length;
            cursor = { x: cursor.x, y: group.position.y + group.height + 80 };
            continue;
        }
        if (call.tool === "add_anchor") {
            const kind = (["character", "scene", "style"].includes(str(args.kind)) ? str(args.kind) : "character") as CanvasAnchorKind;
            const title = str(args.title) || ANCHOR_LABEL[kind];
            const text = str(args.text);
            const id = `agent-anchor-${nanoid(6)}`;
            change.ops.push({ type: "add_node", id, nodeType: HemosiNodeType.Anchor, title, position: cursor, metadata: { anchorKind: kind, anchorText: text, anchorImages: [], status: "idle" } });
            created.set(id, HemosiNodeType.Anchor);
            if (str(args.key)) change.keys[str(args.key)] = id;
            const links = list(args.linkTo).map(resolve).filter(exists);
            links.forEach((to) => change.ops.push({ type: "connect_nodes", fromNodeId: id, toNodeId: to }));
            change.steps.push({ text: `新建${ANCHOR_LABEL[kind]}锚点「${title}」${links.length ? `，连到 ${links.length} 个节点` : ""}` });
            cursor = { x: cursor.x + 360, y: cursor.y };
            continue;
        }
        if (call.tool === "update_node") {
            const id = resolve(str(args.id));
            const node = nodes.get(id);
            if (!node) {
                change.errors.push(`update_node：没有节点 ${id}`);
                continue;
            }
            const isShot = node.type === HemosiNodeType.Shot;
            const metadata: CanvasNodeMetadata = compact({
                shotDescription: isShot ? str(args.image) : undefined,
                prompt: isShot ? str(args.video) : str(args.prompt),
                content: node.type === CanvasNodeType.Text ? str(args.content) : undefined,
                seconds: str(args.seconds),
                size: str(args.size),
                videoSize: isShot ? str(args.size) : undefined,
            });
            const title = str(args.title);
            const fields = [title && "标题", ...Object.keys(metadata).map((key) => ({ shotDescription: "图片提示词", prompt: "提示词", content: "正文", seconds: "时长", size: "比例", videoSize: "" })[key])].filter(Boolean);
            if (!fields.length) {
                change.errors.push(`update_node ${id}：没有要改的字段`);
                continue;
            }
            change.ops.push({ type: "update_node", id, ...(title ? { patch: { title } } : {}), metadata });
            change.steps.push({ text: `修改「${node.title}」：${[...new Set(fields)].join("、")}` });
            continue;
        }
        if (call.tool === "connect") {
            const from = resolve(str(args.from));
            const to = resolve(str(args.to));
            if (!exists(from) || !exists(to)) {
                change.errors.push(`connect：${exists(from) ? to : from} 不存在`);
                continue;
            }
            change.ops.push({ type: "connect_nodes", fromNodeId: from, toNodeId: to });
            change.steps.push({ text: `连线：「${nameOf(from)}」→「${nameOf(to)}」` });
            continue;
        }
        if (call.tool === "delete_nodes") {
            const ids = list(args.ids).filter((id) => nodes.has(id));
            if (!ids.length) {
                change.errors.push("delete_nodes：没有可删的节点");
                continue;
            }
            change.ops.push({ type: "delete_node", ids });
            change.steps.push({ text: `删除 ${ids.length} 个节点：${ids.map(nameOf).join("、")}`, danger: true });
            continue;
        }
        if (call.tool === "generate") {
            const kind = str(args.kind) === "video" ? "video" : "image";
            const ids = list(args.ids).map(resolve).filter(exists);
            const shotIds = ids.filter((id) => (nodes.get(id)?.type || created.get(id)) === HemosiNodeType.Shot);
            const others = ids.filter((id) => !shotIds.includes(id));
            if (shotIds.length) change.shots.push({ ids: shotIds, kind });
            others.forEach((id) => change.ops.push({ type: "run_generation", nodeId: id, mode: kind }));
            if (!ids.length) change.errors.push("generate：没有可生成的节点");
            else change.steps.push({ text: `生成${kind === "video" ? "视频" : "图片"}：${ids.length} 个节点（会先弹生成确认卡）` });
            continue;
        }
        if (call.tool === "open_clone") {
            const id = resolve(str(args.id));
            if (nodes.get(id)?.type !== CanvasNodeType.Video) {
                change.errors.push(`open_clone：${id} 不是视频节点`);
                continue;
            }
            change.cloneNodeId = id;
            change.steps.push({ text: `对「${nameOf(id)}」打开爆款复刻` });
            continue;
        }
        change.errors.push(`没有工具「${call.tool}」，已跳过`);
    }
    return change;
}
