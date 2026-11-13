import localforage from 'localforage';
import { nanoid } from 'nanoid';

const mediaBlobStore = localforage.createInstance({
  name: 'hemosi-storyboard-media',
  storeName: 'blobs',
});

const urlCache = new Map<string, string>();

export async function saveMediaBlob(blob: Blob): Promise<string> {
  const key = `media_${nanoid(10)}`;
  await mediaBlobStore.setItem(key, blob);
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return key;
}

export async function getMediaUrl(storageKey: string): Promise<string | null> {
  if (!storageKey) return null;
  const cached = urlCache.get(storageKey);
  if (cached) return cached;

  const blob = await mediaBlobStore.getItem<Blob>(storageKey);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(storageKey, url);
  return url;
}

export async function getMediaBlob(storageKey: string): Promise<Blob | null> {
  if (!storageKey) return null;
  return mediaBlobStore.getItem<Blob>(storageKey);
}

export async function deleteMediaBlob(storageKey: string): Promise<void> {
  const cached = urlCache.get(storageKey);
  if (cached) {
    URL.revokeObjectURL(cached);
    urlCache.delete(storageKey);
  }
  await mediaBlobStore.removeItem(storageKey);
}
