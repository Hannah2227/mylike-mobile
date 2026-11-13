import { resolveMedia } from '../douyin';
import { createRequestCache } from './request-cache';
const cache = createRequestCache(resolveMedia);
export const peekMedia = cache.peek;
export const forgetMedia = cache.forget;
export const clearMediaCache = cache.clear;
export const mediaCacheCount = cache.count;
export const loadMedia = cache.get;
