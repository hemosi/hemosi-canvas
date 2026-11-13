import { StoryboardMediaConfig } from '@/stores/storyboard/use-storyboard-settings-store';
import { saveMediaBlob } from './media-store';
import { RowNodeRole } from './types';

export interface MediaGenInput {
  role: RowNodeRole;
  prompt: string;
  size: string;
  dur: number;
  refImageBlobs?: Blob[];
  upstreamFrameBlob?: Blob;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

async function fetchAsBlob(url: string, signal: AbortSignal): Promise<Blob> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`下载生成结果失败 (${res.status})`);
  return res.blob();
}

function base64ToBlob(b64: string, mime = 'image/png'): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * 统一 submit → poll → fetch 媒体生成入口
 */
export async function runMediaProvider(
  input: MediaGenInput,
  config: StoryboardMediaConfig,
  signal: AbortSignal
): Promise<string> {
  const base = config.baseUrl.replace(/\/+$/, '');
  if (!base) {
    throw new Error(
      `未配置${input.role === 'frame' ? '图片' : '视频'}渠道 Base URL`
    );
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  };

  if (input.role === 'frame') {
    const res = await fetch(`${base}/images/generations`, {
      method: 'POST',
      signal,
      headers,
      body: JSON.stringify({
        model: config.model,
        prompt: input.prompt,
        size: '1024x1792',
        n: 1,
      }),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => res.statusText);
      throw new Error(`图片生成失败 (${res.status}): ${msg}`);
    }
    const data = await res.json();
    const item = data?.data?.[0];
    let blob: Blob;
    if (item?.b64_json) {
      blob = base64ToBlob(item.b64_json, 'image/png');
    } else if (item?.url) {
      blob = await fetchAsBlob(item.url, signal);
    } else {
      throw new Error('图片接口未返回 url 或 b64_json');
    }
    return saveMediaBlob(blob);
  }

  // 视频生成：submit -> poll -> fetch
  const submitRes = await fetch(`${base}/videos/generations`, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify({
      model: config.model,
      prompt: input.prompt,
      duration: input.dur,
    }),
  });
  if (!submitRes.ok) {
    const msg = await submitRes.text().catch(() => submitRes.statusText);
    throw new Error(`视频提交失败 (${submitRes.status}): ${msg}`);
  }
  const submitData = await submitRes.json();

  if (submitData?.url) {
    const blob = await fetchAsBlob(submitData.url, signal);
    return saveMediaBlob(blob);
  }

  const taskId = submitData?.id || submitData?.task_id;
  if (!taskId) {
    throw new Error('视频接口未返回任务 id 或直出 url');
  }

  // 轮询直到完成或取消
  for (let i = 0; i < 120; i++) {
    await sleep(2500, signal);
    const pollRes = await fetch(`${base}/videos/generations/${taskId}`, {
      signal,
      headers,
    });
    if (!pollRes.ok) continue;
    const pollData = await pollRes.json();
    const status = String(pollData?.status ?? '').toLowerCase();
    if (status === 'failed' || status === 'error') {
      throw new Error(pollData?.error || '视频生成任务失败');
    }
    const videoUrl =
      pollData?.url || pollData?.video_url || pollData?.output?.video_url;
    if (
      videoUrl &&
      (status === 'succeeded' || status === 'completed' || status === 'done' || !status)
    ) {
      const blob = await fetchAsBlob(videoUrl, signal);
      return saveMediaBlob(blob);
    }
  }

  throw new Error('视频生成轮询超时');
}
