import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';

/**
 * File plumbing shared by Download / Screenshot / clip download. The web does
 * all of this with <a download>; on iOS a file must first land in the cache
 * directory, then go to the share sheet or the photo library.
 *
 * Cookie note (UNVERIFIED, tracked in CLAUDE.md): FileSystem.downloadAsync uses
 * NSURLSession, which shares NSHTTPCookieStorage with fetch, so the Flask session
 * cookie should ride along on org-host URLs.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until the URL answers 2xx (S3 objects produced by a Celery task appear late). */
export async function waitForUrl(url: string, attempts = 12, delayMs = 1000): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) return true;
    } catch {
      /* not yet */
    }
    await sleep(delayMs);
  }
  return false;
}

export interface DownloadResult {
  uri: string;
  status: number;
  headers: Record<string, string>;
}

/**
 * Server-supplied names (e.g. the screenshot response's `filename`) become a path
 * inside the cache directory, so strip directories and anything but [\w.-]
 * (SEC-007). Never empty, never `.`/`..`, capped at 100 chars.
 */
export function safeFilename(filename: string | null | undefined, fallback = 'download.bin'): string {
  const base = (filename ?? '').split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(0, 100);
  return clean || fallback;
}

export async function downloadToCache(url: string, filename: string): Promise<DownloadResult> {
  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
  const target = `${dir}${safeFilename(filename)}`;
  const res = await FileSystem.downloadAsync(url, target);
  return { uri: res.uri, status: res.status, headers: res.headers ?? {} };
}

export async function removeFile(uri: string) {
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}

export async function shareFile(uri: string, mimeType?: string, UTI?: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(uri, { mimeType, UTI });
}

/** Save an image/video file to Photos; asks for add-only permission first. */
export async function saveToPhotos(uri: string): Promise<void> {
  const perm = await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) throw new Error('Photo library permission was not granted.');
  await MediaLibrary.saveToLibraryAsync(uri);
}

export function mimeForExtension(ext: string): { mimeType: string; UTI: string } {
  switch (ext.toLowerCase()) {
    case 'mp4':
      return { mimeType: 'video/mp4', UTI: 'public.mpeg-4' };
    case 'ts':
      return { mimeType: 'video/mp2t', UTI: 'public.mpeg-2-transport-stream' };
    case 'png':
      return { mimeType: 'image/png', UTI: 'public.png' };
    case 'jpg':
    case 'jpeg':
      return { mimeType: 'image/jpeg', UTI: 'public.jpeg' };
    default:
      return { mimeType: 'application/octet-stream', UTI: 'public.data' };
  }
}

export function extensionOf(urlOrName: string, fallback = 'bin'): string {
  const clean = urlOrName.split('?')[0];
  const m = /\.([a-zA-Z0-9]{2,5})$/.exec(clean);
  return m ? m[1] : fallback;
}
