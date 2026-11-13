import {
  ViralBlueprint,
  ViralCut,
  applyVariantToBlueprint,
  buildLocalHeuristicBlueprint,
  exportViralBlueprintZip,
  extractLocalVideoCuts,
  resolveTemplateVariables,
} from '@/lib/canvas/viral-clone';
import { transcribeLocalAudio } from './local-services';
import { Plan } from './plan-schema';

/**
 * 优先走 sidecar /cut + /frames，无 sidecar 时走浏览器抽帧
 */
export async function extractCutsPreferSidecar(
  file: File,
  sidecarUrl: string,
  sidecarUp: boolean
): Promise<ViralCut[]> {
  if (sidecarUp) {
    try {
      const base = sidecarUrl.replace(/\/+$/, '');
      const form1 = new FormData();
      form1.append('file', file);
      const cutRes = await fetch(`${base}/cut`, { method: 'POST', body: form1 });
      if (cutRes.ok) {
        const { cuts } = (await cutRes.json()) as { cuts: number[] };
        const form2 = new FormData();
        form2.append('file', file);
        form2.append('times', JSON.stringify(cuts.slice(0, 16)));
        const frRes = await fetch(`${base}/frames`, { method: 'POST', body: form2 });
        if (frRes.ok) {
          const { frames } = (await frRes.json()) as {
            frames: Array<{ time: number; dataUrl: string }>;
          };
          return frames.map((f, idx) => {
            const nextT = cuts[idx + 1] ?? f.time + 3;
            return {
              index: idx + 1,
              startSec: f.time,
              endSec: nextT,
              durationSec: Math.max(1, Number((nextT - f.time).toFixed(1))),
              frameDataUrl: f.dataUrl,
            };
          });
        }
      }
    } catch {
      // 回退浏览器端抽帧
    }
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    return await extractLocalVideoCuts(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * 将关键帧拼成 4x3 带时间码的网格图（供多模态模型分析）
 */
export async function buildKeyframeGridDataUrl(
  cuts: ViralCut[]
): Promise<string> {
  const sample = cuts.slice(0, 12);
  const cols = 4;
  const rows = Math.max(1, Math.ceil(sample.length / cols));
  const cw = 240;
  const ch = 135;

  const canvas = document.createElement('canvas');
  canvas.width = cols * cw;
  canvas.height = rows * ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await Promise.all(
    sample.map(
      (cut, idx) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            const col = idx % cols;
            const row = Math.floor(idx / cols);
            const x = col * cw;
            const y = row * ch;
            ctx.drawImage(img, x, y, cw, ch);
            ctx.fillStyle = 'rgba(0,0,0,0.65)';
            ctx.fillRect(x + 6, y + 6, 76, 20);
            ctx.fillStyle = '#fff';
            ctx.font = '12px sans-serif';
            ctx.fillText(
              `#${cut.index} ${cut.startSec.toFixed(1)}s`,
              x + 10,
              y + 20
            );
            resolve();
          };
          img.onerror = () => resolve();
          img.src = cut.frameDataUrl;
        })
    )
  );

  return canvas.toDataURL('image/jpeg', 0.8);
}

/**
 * 复用本地启发式或 Whisper 转写生成蓝图
 */
export async function analyzeViralVideo(
  file: File,
  cuts: ViralCut[],
  asrUrl: string,
  asrUp: boolean,
  manualTranscript?: string
): Promise<ViralBlueprint> {
  let transcript = manualTranscript?.trim() ?? '';
  if (!transcript && asrUp) {
    try {
      transcript = await transcribeLocalAudio(file, asrUrl);
    } catch {
      // 未通或失败时允许继续
    }
  }
  const title = file.name.replace(/\.[^.]+$/, '') || '复刻分镜';
  return buildLocalHeuristicBlueprint(title, cuts, transcript);
}

/**
 * 将爆款复刻蓝图转为分镜表标准 Plan，直接通过 applyPlan 写入画布
 */
export function blueprintToStoryboardPlan(
  blueprint: ViralBlueprint,
  variantIndex = 0
): Plan {
  const variants = blueprint.variants ?? [];
  const effectiveBp =
    variants[variantIndex]
      ? applyVariantToBlueprint(blueprint, variants[variantIndex])
      : blueprint;

  const anchorChanges: Plan['changes'] = effectiveBp.anchors.map((a, i) => ({
    id: `vca_${i + 1}`,
    kind: 'anchor.add' as const,
    anchor: {
      kind: a.role,
      name: a.name,
      text: resolveTemplateVariables(a.prompt, effectiveBp.variables),
    },
  }));

  const rowChanges: Plan['changes'] = effectiveBp.beats.map((beat, i) => {
    const dur = Math.max(1, Math.round(beat.endSec - beat.startSec || 4));
    const desc = resolveTemplateVariables(
      beat.imagePrompt || beat.videoPrompt,
      effectiveBp.variables
    );
    const line = resolveTemplateVariables(
      beat.newLine || beat.originalLine,
      effectiveBp.variables
    );
    return {
      id: `vc_${i + 1}`,
      kind: 'row.add' as const,
      row: {
        desc,
        line,
        dur,
        size: '中景',
        voice: line ? 'dub' : 'none',
        mode: 'frame',
        cont: false,
      },
    };
  });

  return {
    summary: `爆款复刻导入：${effectiveBp.title}（${effectiveBp.beats.length} 镜）`,
    changes: [...anchorChanges, ...rowChanges],
  };
}

export { exportViralBlueprintZip };
