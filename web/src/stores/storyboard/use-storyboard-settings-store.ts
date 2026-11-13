import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DEFAULT_LOCAL_ENDPOINTS,
  LocalEndpoints,
  LocalHealthStatus,
} from '@/lib/storyboard/local-services';

export type TextProviderKind = 'openai' | 'ollama';

export interface StoryboardTextConfig {
  kind: TextProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface StoryboardMediaConfig {
  label: string;
  isLocal: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface StoryboardSettingsState {
  textConfig: StoryboardTextConfig;
  imageConfig: StoryboardMediaConfig;
  videoConfig: StoryboardMediaConfig;
  localEndpoints: LocalEndpoints;
  localHealth: LocalHealthStatus;
  setTextConfig: (patch: Partial<StoryboardTextConfig>) => void;
  setImageConfig: (patch: Partial<StoryboardMediaConfig>) => void;
  setVideoConfig: (patch: Partial<StoryboardMediaConfig>) => void;
  setLocalEndpoints: (patch: Partial<LocalEndpoints>) => void;
  setLocalHealth: (health: LocalHealthStatus) => void;
}

export const useStoryboardSettingsStore = create<StoryboardSettingsState>()(
  persist(
    (set) => ({
      textConfig: {
        kind: 'openai',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: '',
        model: 'deepseek-chat',
      },
      imageConfig: {
        label: '默认图片渠道',
        isLocal: false,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-image-1',
      },
      videoConfig: {
        label: '默认视频渠道',
        isLocal: false,
        baseUrl: '',
        apiKey: '',
        model: 'video-gen-1',
      },
      localEndpoints: DEFAULT_LOCAL_ENDPOINTS,
      localHealth: { sidecar: false, tts: false, asr: false },
      setTextConfig: (patch) =>
        set((s) => ({
          textConfig: { ...s.textConfig, ...patch },
        })),
      setImageConfig: (patch) =>
        set((s) => ({
          imageConfig: { ...s.imageConfig, ...patch },
        })),
      setVideoConfig: (patch) =>
        set((s) => ({
          videoConfig: { ...s.videoConfig, ...patch },
        })),
      setLocalEndpoints: (patch) =>
        set((s) => ({
          localEndpoints: { ...s.localEndpoints, ...patch },
        })),
      setLocalHealth: (localHealth) => set({ localHealth }),
    }),
    {
      name: 'hemosi-storyboard-settings',
      partialize: (s) => ({
        textConfig: s.textConfig,
        imageConfig: s.imageConfig,
        videoConfig: s.videoConfig,
        localEndpoints: s.localEndpoints,
      }),
    }
  )
);
