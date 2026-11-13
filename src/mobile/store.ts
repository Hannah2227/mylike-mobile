import { duplicateCount, mergeLibrary, openLibrary } from '../library-store';
import { createStore, type MobileStore } from './store-core';
export type { MobileStore, HistoryWork } from './store-core';
const stores = new Map<string, MobileStore>();
export function createMobileStore(name = 'mylike-mobile.db'): MobileStore {
  const cached = stores.get(name); if (cached) return cached;
  const store = createStore({ open: () => openLibrary(name), mergeLibrary, countDuplicates: duplicateCount });
  stores.set(name, store); return store;
}