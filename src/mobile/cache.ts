import { Directory, File, Paths } from 'expo-file-system';
import { clearMediaCache, mediaCacheCount } from './media-cache';
import { clearAuthorCache } from '../guest-author';
import { clearGuestCommentCache } from '../guest-comments';
function ownFiles() {
  const parent = Paths.cache.uri.replace(/\/?$/, '/');
  return new Directory(Paths.cache).list().filter((entry): entry is File => entry instanceof File && entry.uri.startsWith(parent) && /^mylike-live-test-\d+-\d+\.mp4$/.test(entry.name));
}
export function cacheUsage() { let bytes = 0; let clips = 0; for (const file of ownFiles()) { try { if (file.exists) { bytes += file.size; clips++; } } catch { /* A clip can be reclaimed while its route closes. */ } } return { bytes, clips, details: mediaCacheCount() }; }
export function clearPlaybackCache() {
  // Only MyLike-owned temporary files; never recurse into the system/picker cache.
  let removed = 0; let failed = 0;
  for (const file of ownFiles()) { try { if (file.exists) { file.delete(); removed++; } } catch { failed++; } }
  clearMediaCache();
  clearAuthorCache();
  clearGuestCommentCache();
  return { removed, failed };
}
export function bytesLabel(bytes: number) { return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
