import { withLocalProxy, type AiConfig } from "@/stores/use-config-store";
import type { AiTextMessage } from "./image";

/**
 * Anthropic Messages API (official, https://api.anthropic.com/v1/messages) for text, streamed.
 * Browser calls need the anthropic-dangerous-direct-browser-access header (the Key stays in this browser).
 */
export async function requestAnthropicText(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: { signal?: AbortSignal }) {
    const base = config.baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
    const system = messages.filter((message) => message.role === "system").map((message) => (typeof message.content === "string" ? message.content : message.content.map((part) => (part.type === "text" ? part.text : "")).join("\n"))).join("\n\n");
    const body = {
        model: config.model,
        max_tokens: 16000,
        stream: true,
        ...(system ? { system } : {}),
        messages: messages.filter((message) => message.role !== "system").map((message) => ({ role: message.role, content: typeof message.content === "string" ? message.content : message.content.map((part) => { if (part.type === "text") return { type: "text", text: part.text }; if (part.type === "image_url") return imageBlock(part.image_url.url); throw new Error("该渠道格式不支持视频输入"); }) })),
    };
    const response = await fetch(withLocalProxy(`${base}/v1/messages`), {
        method: "POST",
        headers: { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true", "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: options?.signal,
    });
    if (!response.ok || !response.body) {
        const text = await response.text().catch(() => "");
        let message = text.slice(0, 300);
        try {
            message = JSON.parse(text)?.error?.message || message;
        } catch {
            /* keep raw text */
        }
        throw new Error(`Anthropic：${message || response.statusText}（HTTP ${response.status}）`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let output = "";
    for (;;) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = done ? "" : lines.pop() || "";
        for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const event = parseJson(line.slice(5).trim());
            if (event?.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
                output += event.delta.text;
                onDelta(event.delta.text);
            }
            if (event?.type === "error") throw new Error(`Anthropic：${event.error?.message || "stream error"}`);
        }
        if (done) break;
    }
    return output;
}

function imageBlock(url: string) {
    const match = url.match(/^data:([^;]+);base64,(.*)$/);
    return match ? { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } } : { type: "image", source: { type: "url", url } };
}

function parseJson(value: string) {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}
