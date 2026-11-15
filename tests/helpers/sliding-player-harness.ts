import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as paging from '../../src/mobile/window-paging.ts';
import { createPageSync } from '../../src/mobile/page-sync.ts';

const compiled = ts.transpileModule(readFileSync(new URL('../../src/mobile/SlidingWorkPager.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Runs the actual component, page transforms and callbacks with separate UI/RN
// queues and a controllable animation clock. It does not measure device FPS.
export function slidingPlayerHarness(initial = 0, count = 20) {
  let cursor = 0; let clock = 0; const hooks: any[] = []; const effects: (() => void)[] = [];
  const rn: (() => void)[] = []; const ui: (() => void)[] = []; const cells: any[] = []; const animations: any[] = [];
  const motions: boolean[] = []; const commits: number[] = []; const targets: { index: number | null; at?: number }[] = []; const arrivals: number[] = [];
  let pan: any; let touch: any; let tree: any; let roles: any[] = [];
  const ref: any = { current: null };
  const props: any = { ids: Array.from({ length: count }, (_, i) => `work-${i}`), index: initial, width: 390, height: 800, enabled: true,
    onCommit: (index: number, at: number) => { commits.push(index); arrivals.push(at); props.index = index; }, onMotion: (value: boolean) => motions.push(value),
    onPlaybackTarget: (index: number | null, at?: number) => targets.push({ index, at }),
    renderPage: (id: string, position: number, current: boolean, warm: boolean, retain: boolean, context: any) => {
      touch = context; roles.push({ id, position, current, warm, retain }); return id;
    },
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
  const cancel = (cell: any) => { const old = cell.animation; cell.animation = null; old?.callback?.(false); };
  const shared = (initial: any) => slot(() => {
    const cell: any = { raw: initial, animation: null };
    Object.defineProperty(cell, 'value', { get: () => cell.raw, set: value => {
      cancel(cell);
      if (value?.timing) { cell.animation = { ...value, from: cell.raw, start: clock }; animations.push(cell.animation); }
      else cell.raw = value;
    } });
    cells.push(cell); return cell;
  });
  const imports: Record<string, any> = {
    react: { forwardRef: (fn: any) => fn, useCallback: (fn: any, deps: any[]) => memo(() => fn, deps), useMemo: memo,
      useRef: (value: any) => slot(() => ({ current: value })), useEffect: effect, useLayoutEffect: effect,
      useImperativeHandle: (_ref: any, fn: any) => { _ref.current = fn(); },
      useState: (initial: any) => { const entry = slot(() => ({ value: initial })); return [entry.value, (value: any) => { entry.value = value; }]; },
    },
    'react/jsx-runtime': { jsx: (type: any, props: any, key: any) => ({ type, props, key }), jsxs: (type: any, props: any, key: any) => ({ type, props, key }) },
    'react-native': { StyleSheet: { absoluteFill: {} }, View: 'View' },
    'react-native-gesture-handler': { GestureDetector: 'GestureDetector', usePanGesture: (config: any) => { pan = memo(() => ({ config }), []); pan.config = config; return pan; } },
    'react-native-reanimated': {
      __esModule: true, default: { View: 'AnimatedView' }, cancelAnimation: cancel, useSharedValue: shared,
      Easing: { quad: (t: number) => t * t, out: (fn: any) => (t: number) => 1 - fn(1 - t) },
      useDerivedValue: (fn: any) => { const entry = slot(() => ({ fn })); entry.fn = fn; return memo(() => ({ get value() { return entry.fn(); } }), []); },
      useAnimatedStyle: (fn: any) => ({ get transform() { return fn().transform; } }),
      withTiming: (target: number, config: any, callback: any) => ({ timing: true, target, config, callback }),
    },
    'react-native-worklets': { scheduleOnRN: (fn: any, ...args: any[]) => rn.push(() => fn(...args)), scheduleOnUI: (fn: any, ...args: any[]) => ui.push(() => fn(...args)) },
    './page-sync': { createPageSync }, './window-paging': paging,
  };
  const exports: any = {};
  runInNewContext(compiled, { exports, Date: { now: () => clock }, require: (name: string) => {
    if (!(name in imports)) throw new Error(`Unmocked import: ${name}`); return imports[name];
  } });
  function render(patch: any = {}) {
    Object.assign(props, patch); cursor = 0; roles = []; tree = exports.SlidingWorkPager(props, ref);
    for (const fn of effects.splice(0)) fn();
  }
  function advance(ms: number) {
    clock += ms;
    for (const cell of cells) {
      const animation = cell.animation; if (!animation) continue;
      const part = animation.config.duration ? Math.min(1, (clock - animation.start) / animation.config.duration) : 1;
      cell.raw = animation.from + (animation.target - animation.from) * animation.config.easing(part);
      if (part === 1) { cell.animation = null; animation.callback?.(true); }
    }
  }
  function flushUI() { for (let fn = ui.shift(); fn; fn = ui.shift()) fn(); }
  function flushRN(acknowledge = true) { for (let fn = rn.shift(); fn; fn = rn.shift()) fn(); if (acknowledge) render(); }
  function sync() {
    for (let round = 0; rn.length || ui.length; round++) {
      if (round > 30) throw new Error('Queues failed to settle');
      if (rn.length) flushRN(); if (ui.length) flushUI();
    }
  }
  render(); sync();
  return { props, ref, motions, commits, targets, arrivals, animations, render, advance, flushUI, flushRN, sync,
    get touch() { return touch; }, get pan() { return pan.config; }, get roles() { return roles; },
    get layers() { return tree.props.children.props.children; },
    get keys() { return tree.props.children.props.children.map((page: any) => page.key); },
    translation(id: string) { const page = tree.props.children.props.children.find((node: any) => node.key === id); return page.type(page.props).props.style[2].transform[0].translateY; },
    activate(distance = 20, velocity = 0) { pan.config.onActivate({ translationY: distance, velocityY: velocity }); },
    move(distance: number, velocity = 0) { pan.config.onUpdate({ translationY: distance, velocityY: velocity }); },
    up(distance: number, velocity: number, canceled = false) { pan.config.onDeactivate({ translationY: distance, velocityY: velocity, canceled }); pan.config.onFinalize(); },
    unmount() { for (const hook of hooks) hook.cleanup?.(); },
  };
}
