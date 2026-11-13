export interface Provider<I, O> {
    id: string;
    kind: string;
    health(): Promise<"up" | "down">;
    run(input: I, signal?: AbortSignal): Promise<O>;
}

export type SidecarHealth = {
    status: "up" | "down";
    ffmpeg: boolean;
    ffprobe: boolean;
    reason?: string;
};

export async function probeSidecarHealth(signal?: AbortSignal): Promise<SidecarHealth> {
    try {
        const res = await fetch("/health", { method: "GET", signal });
        if (!res.ok) {
            return { status: "down", ffmpeg: false, ffprobe: false, reason: `本地服务未响应 (${res.status})` };
        }
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
            return { status: "down", ffmpeg: false, ffprobe: false, reason: "当前为 Web 版或未启动桌面合成服务" };
        }
        const data = (await res.json()) as { ok?: boolean; ffmpeg?: boolean; ffprobe?: boolean };
        if (!data.ok || !data.ffmpeg) {
            return {
                status: "down",
                ffmpeg: Boolean(data.ffmpeg),
                ffprobe: Boolean(data.ffprobe),
                reason: data.ffmpeg ? "本地服务异常" : "未检测到本机 ffmpeg",
            };
        }
        return { status: "up", ffmpeg: Boolean(data.ffmpeg), ffprobe: Boolean(data.ffprobe) };
    } catch {
        return { status: "down", ffmpeg: false, ffprobe: false, reason: "未检测到本地合成服务" };
    }
}

export type ComposeClipInput = {
    videoUrl: string;
    audioUrl?: string;
};

export const sidecarComposeProvider: Provider<ComposeClipInput[], Blob> = {
    id: "desktop-sidecar-compose",
    kind: "compose",
    async health() {
        const h = await probeSidecarHealth();
        return h.status;
    },
    async run(clips, signal) {
        if (!clips.length) throw new Error("没有可合成的视频片段");
        const form = new FormData();
        const manifest = clips.map((_, index) => ({ index }));
        form.append("manifest", JSON.stringify(manifest));

        for (let i = 0; i < clips.length; i++) {
            const vRes = await fetch(clips[i].videoUrl, { signal });
            if (!vRes.ok) throw new Error(`读取第 ${i + 1} 段视频失败`);
            const vBlob = await vRes.blob();
            form.append(`video_${i}`, vBlob, `v_${i}.mp4`);

            if (clips[i].audioUrl) {
                const aRes = await fetch(clips[i].audioUrl!, { signal });
                if (aRes.ok) {
                    form.append(`audio_${i}`, await aRes.blob(), `a_${i}.wav`);
                }
            }
        }

        const res = await fetch("/compose", { method: "POST", body: form, signal });
        if (!res.ok) {
            const errText = await res.text().catch(() => "");
            throw new Error(errText || `合成失败 (${res.status})`);
        }
        const outBlob = await res.blob();
        if (outBlob.size === 0) throw new Error("合成返回空文件");
        return outBlob;
    },
};
