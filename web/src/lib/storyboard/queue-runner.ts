import { ConfirmGenTarget } from '@/components/storyboard/GenerateConfirmModal';
import { useStoryboardSettingsStore } from '@/stores/storyboard/use-storyboard-settings-store';
import { useStoryboardStore } from '@/stores/storyboard/use-storyboard-store';
import { runMediaProvider } from './media-provider';
import { StoryboardQueue, buildDependencyKey } from './queue';
import { rowNodeKey } from './types';

export const storyboardQueue = new StoryboardQueue(3, 1);

export function enqueueGenerationTargets(targets: ConfirmGenTarget[]) {
  const store = useStoryboardStore.getState();
  const settings = useStoryboardSettingsStore.getState();
  const rows = store.desk.rows;

  for (const target of targets) {
    const config =
      target.role === 'frame' ? settings.imageConfig : settings.videoConfig;
    const key = rowNodeKey(target.rowId, target.role);
    const dependsOnKey = buildDependencyKey(rows, target.rowIndex, target.role);

    store.setNodeRun(target.rowId, target.role, { state: 'queued' });

    storyboardQueue.enqueue({
      key,
      rowId: target.rowId,
      role: target.role,
      isLocal: config.isLocal,
      dependsOnKey,
      execute: async (signal) => {
        const st = useStoryboardStore.getState();
        st.setNodeRun(target.rowId, target.role, { state: 'running' });
        try {
          const storageKey = await runMediaProvider(
            {
              role: target.role,
              prompt: target.prompt,
              size: target.size,
              dur: target.dur,
            },
            config,
            signal
          );
          useStoryboardStore
            .getState()
            .addTake(target.rowId, target.role, storageKey, config.model);
        } catch (err) {
          if ((err as Error).name === 'AbortError') {
            useStoryboardStore.getState().setNodeRun(target.rowId, target.role, undefined);
            return;
          }
          useStoryboardStore.getState().setNodeRun(target.rowId, target.role, {
            state: 'error',
            error: err instanceof Error ? err.message : '生成失败',
          });
          throw err;
        }
      },
    });
  }
}

export function cancelNodeGeneration(rowId: string, role: 'frame' | 'video') {
  const key = rowNodeKey(rowId, role);
  storyboardQueue.cancel(key);
  useStoryboardStore.getState().setNodeRun(rowId, role, undefined);
}
