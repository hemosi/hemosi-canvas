import { saveMediaBlob } from './media-store';

export interface LocalEndpoints {
  sidecarUrl: string;
  ttsUrl: string;
  asrUrl: string;
}

export const DEFAULT_LOCAL_ENDPOINTS: LocalEndpoints = {
  sidecarUrl: 'http://127.0.0.1:17890',
  ttsUrl: 'http://127.0.0.1:8880/v1',
  asrUrl: 'http://127.0.0.1:8000/v1',
};

export interface LocalHealthStatus {
  sidecar: boolean;
  tts: boolean;
  asr: boolean;
}

async function pingUrl(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export async function probeLocalServices(
  endpoints: LocalEndpoints
): Promise<LocalHealthStatus> {
  const sBase = endpoints.sidecarUrl.replace(/\/+$/, '');
  const tBase = endpoints.ttsUrl.replace(/\/+$/, '');
  const aBase = endpoints.asrUrl.replace(/\/+$/, '');
  const [sidecar, tts, asr] = await Promise.all([
    pingUrl(`${sBase}/health`),
    pingUrl(`${tBase}/models`),
    pingUrl(`${aBase}/models`),
  ]);
  return { sidecar, tts, asr };
}

/**
 * 测量音频 Blob 真实时长（秒）
 */
export function measureAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.addEventListener('loadedmetadata', () => {
      const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
      URL.revokeObjectURL(url);
      resolve(Number(dur.toFixed(1)));
    });
    audio.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      resolve(0);
    });
  });
}

/**
 * 本地 TTS 配音（严格本地，失败不降级付费接口）
 */
export async function synthesizeLocalTts(
  text: string,
  ttsBaseUrl: string,
  voice = 'alloy',
  signal?: AbortSignal
): Promise<{ storageKey: string; durationSec: number }> {
  const base = ttsBaseUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/audio/speech`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice,
      response_format: 'wav',
    }),
  });
  if (!res.ok) {
    throw new Error(`本机 TTS 服务不可用或报错 (${res.status})，请先启动本地配音服务`);
  }
  const blob = await res.blob();
  const durationSec = await measureAudioDuration(blob);
  const storageKey = await saveMediaBlob(blob);
  return { storageKey, durationSec };
}

/**
 * 本地 Whisper 转写（严格本地，失败不降级付费接口）
 */
export async function transcribeLocalAudio(
  file: Blob,
  asrBaseUrl: string,
  signal?: AbortSignal
): Promise<string> {
  const base = asrBaseUrl.replace(/\/+$/, '');
  const form = new FormData();
  form.append('file', file, 'audio.wav');
  form.append('model', 'whisper-1');
  const res = await fetch(`${base}/audio/transcriptions`, {
    method: 'POST',
    signal,
    body: form,
  });
  if (!res.ok) {
    throw new Error(`本机转写服务报错 (${res.status})，请检查 Whisper 服务`);
  }
  const data = await res.json();
  return String(data?.text ?? '');
}

/**
 * 调 sidecar 本地 ffmpeg 合成最终成片
 */
export async function composeViaSidecar(
  sidecarUrl: string,
  clips: Array<{ videoBlob: Blob; audioBlob?: Blob; line?: string; dur: number }>,
  title: string
): Promise<Blob> {
  const base = sidecarUrl.replace(/\/+$/, '');
  const form = new FormData();
  form.append('title', title);
  form.append(
    'manifest',
    JSON.stringify(
      clips.map((c, i) => ({
        index: i,
        hasAudio: Boolean(c.audioBlob),
        line: c.line ?? '',
        dur: c.dur,
      }))
    )
  );
  clips.forEach((c, i) => {
    form.append(`video_${i}`, c.videoBlob, `clip_${i}.mp4`);
    if (c.audioBlob) {
      form.append(`audio_${i}`, c.audioBlob, `dub_${i}.wav`);
    }
  });

  const res = await fetch(`${base}/compose`, { method: 'POST', body: form });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`Sidecar 合成失败 (${res.status}): ${txt}`);
  }
  return res.blob();
}
