import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as playback from '../../src/mobile/playback.ts';
import * as metrics from '../../src/mobile/frame-metrics.ts';
import { neighborPages, pageTranslation, videoFit } from '../../src/mobile/layout.ts';

// Expose the existing private component solely to execute its real effects.
const compiled = ts.transpileModule(readFileSync(new URL('../../src/mobile/Media.tsx', import.meta.url), 'utf8') + '\nexport { Video };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
export function videoStartHarness() {
  let cursor = 0; let time = 0; let dirty = false; let tree: any; let nativeTime = 0; let timerId = 0;
  const hooks: any[] = []; const effects: (() => void)[] = []; const listeners = new Map<string, any>();
  const timers = new Map<number, { at: number; callback: () => void }>(); const logs: any[] = []; const progress: number[] = [];
  const handoff = playback.createPlaybackHandoff(); const position = { current: 0 }; const appState = { currentState: 'active' };
  const player = { muted: true, playbackRate: 1, playing: false, loop: false, duration: 60, status: 'readyToPlay', timeUpdateEventInterval: 0.5,
    staysActiveInBackground: false, bufferOptions: {}, plays: 0, pauses: 0, seeks: [] as number[],
    get currentTime() { return nativeTime; }, set currentTime(value: number) { nativeTime = value; this.seeks.push(value); },
    play() { this.plays++; this.playing = true; }, pause() { this.pauses++; this.playing = false; },
  };
  const props: any = { id: 'next', uri: 'https://example.invalid/video.mp4', current: false, active: false, prime: true, prepare: true,
    paused: false, boosted: false, seeking: false, rate: 1, auto: false, width: 390, height: 800, sourceSize: { width: 1080, height: 1920 }, allowZoom: true,
    position, control: { current: { id: 'next', retry() {}, seek: null } }, handoff, onFrame() {}, onReady() {}, onTime: (_id: string, value: number) => progress.push(value), onEnd: () => false, onPause() {}, onFailure() {},
  };
  const slot = (create: () => any) => { const i = cursor++; return hooks[i] ?? (hooks[i] = create()); };
  const memo = (create: () => any, deps?: any[]) => {
    const entry = slot(() => ({ deps: undefined, value: undefined }));
    if (!deps || !entry.deps || deps.some((value, i) => value !== entry.deps[i])) { entry.value = create(); entry.deps = deps; }
    return entry.value;
  };
  const effect = (fn: () => any, deps?: any[]) => {
    const entry = slot(() => ({ deps: undefined, cleanup: undefined }));
    if (!deps || !entry.deps || deps.some((value, i) => value !== entry.deps[i])) {
      entry.deps = deps; effects.push(() => { entry.cleanup?.(); entry.cleanup = fn(); });
    }
  };
  const imports: Record<string, any> = {
    react: { memo: (fn: any) => fn, useMemo: memo, useCallback: (fn: any, deps: any[]) => memo(() => fn, deps),
      useRef: (value: any) => slot(() => ({ current: value })), useEffect: effect, useLayoutEffect: effect,
      useState: (initial: any) => { const entry = slot(() => ({ value: typeof initial === 'function' ? initial() : initial })); return [entry.value, (value: any) => {
        const next = typeof value === 'function' ? value(entry.value) : value; if (next !== entry.value) { entry.value = next; dirty = true; }
      }]; },
    },
    'react/jsx-runtime': { jsx: (type: any, props: any, key: any) => ({ type, props, key }), jsxs: (type: any, props: any, key: any) => ({ type, props, key }), Fragment: 'Fragment' },
    'react-native': { ActivityIndicator: 'Spinner', AppState: appState, Image: 'Image', Text: 'Text', View: 'View', StyleSheet: { absoluteFill: {}, create: (value: any) => value } },
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' }, useAnimatedStyle: (fn: any) => fn() },
    'expo-video': { VideoView: 'VideoView', useVideoPlayer: (_source: any, init: any) => memo(() => { init(player); return player; }, []) },
    expo: { useEvent: (_player: any, name: string) => name === 'statusChange' ? { status: player.status } : name === 'videoTrackChange' ? { videoTrack: null } : undefined,
      useEventListener: (_player: any, name: string, callback: any) => { const entry = slot(() => ({})); entry.callback = callback; listeners.set(name, entry); },
    },
    '../GalleryMusic': {}, '../LiveClip': {}, '../douyin': { mediaHeaders: {} }, './media-cache': {}, './context': {},
    './layout': { neighborPages, pageTranslation, videoFit }, './playback': playback, './frame-metrics': metrics,
  };
  const exports: any = {};
  runInNewContext(compiled, { exports, __DEV__: true, Date: { now: () => time }, performance: { now: () => time }, console: { info: (...value: any[]) => logs.push(value) },
    setTimeout: (callback: () => void, delay: number) => { const id = ++timerId; timers.set(id, { at: time + delay, callback }); return id; },
    clearTimeout: (id: number) => timers.delete(id), require: (name: string) => {
      if (!(name in imports)) throw new Error(`Unmocked import: ${name}`); return imports[name];
    },
  });
  function render(patch: any = {}) {
    Object.assign(props, patch);
    for (let round = 0; ; round++) {
      if (round > 20) throw new Error('Video render failed to settle');
      cursor = 0; dirty = false; tree = exports.Video(props); for (const fn of effects.splice(0)) fn(); if (!dirty) break;
    }
  }
  function emit(name: string, value: any) { listeners.get(name)?.callback(value); if (dirty) render(); }
  function frame() { const view = tree.props.children.find((node: any) => node && node.type === 'VideoView'); view.props.onFirstFrameRender(); if (dirty) render(); }
  render();
  return { player, position, handoff, appState, logs, progress, props, render, emit, frame,
    tick(ms: number) { time += ms; },
    nativeTime(value: number) { nativeTime = value; },
    timeUpdate(value: number) { nativeTime = value; emit('timeUpdate', { currentTime: value }); },
    deadlines(ms: number) { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time && timers.delete(id)) timer.callback(); if (dirty) render(); },
    unmount() { for (const hook of hooks) hook.cleanup?.(); listeners.clear(); },
  };
}
