import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { createPageSync } from './page-sync';
import { windowDrag, windowDuration, windowPages, windowStep } from './window-paging';
import type { PageTouch, PagerHandle } from './player-types';

type Touch = { active: boolean; pending: boolean; ended: boolean; cancelled: boolean; translation: number; velocity: number; releasedAt: number };
const emptyTouch: Touch = { active: false, pending: false, ended: false, cancelled: false, translation: 0, velocity: 0, releasedAt: 0 };
function Page({ position, active, height, offset, children }: { position: number; active: boolean; height: number; offset: SharedValue<number>; children: ReactNode }) {
  // Absolute coordinates avoid a recenter/reset step when the window advances.
  // Subtraction happens before the small transform reaches the native view.
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: position * height - offset.value }] }));
  return <Animated.View accessibilityElementsHidden={!active} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'} style={[StyleSheet.absoluteFill, { overflow: 'hidden' }, style]}>{children}</Animated.View>;
}

export const SlidingWorkPager = forwardRef<PagerHandle, {
  ids: string[]; index: number; width: number; height: number; enabled: boolean;
  onCommit: (index: number, arrivedAt?: number) => void; onMotion: (moving: boolean) => void;
  onPlaybackTarget?: (index: number | null, requestedAt?: number) => void;
  renderPage: (id: string, position: number, current: boolean, warm: boolean, retain: boolean, touch: PageTouch) => ReactNode;
}>(function SlidingWorkPager({ ids, index, width, height, enabled, onCommit, onMotion, onPlaybackTarget, renderPage }, ref) {
  const count = ids.length;
  const offset = useSharedValue(index * height); const center = useSharedValue(index); const target = useSharedValue(index);
  // 0 idle, 1 dragging, 2 settling, 3 waiting for React to install the new window.
  const phase = useSharedValue(0); const owner = useSharedValue(-1); const generation = useSharedValue(0); const epoch = useSharedValue(0);
  const finger = useSharedValue<Touch>(emptyTouch); const allowed = useDerivedValue(() => enabled && owner.value < 0);
  const [completion, setCompletion] = useState(-1);
  const mounted = useRef(true); const revision = useRef(0); const extent = useRef({ width, height });
  const pageSync = useRef(createPageSync(index)).current;
  const latest = useRef({ enabled, onCommit, onMotion, onPlaybackTarget }); latest.current = { enabled, onCommit, onMotion, onPlaybackTarget };
  const begin = useCallback((token: number, source: number, next?: number | null, requestedAt?: number) => {
    if (!mounted.current || !latest.current.enabled || source !== revision.current || token !== generation.value) return;
    latest.current.onMotion(true);
    if (next !== undefined) latest.current.onPlaybackTarget?.(next, requestedAt);
  }, [generation]);
  const idle = useCallback((token: number, source: number) => {
    if (mounted.current && source === revision.current && token === generation.value && phase.value === 0) latest.current.onMotion(owner.value >= 0);
  }, [generation, phase, owner]);
  const finish = useCallback((next: number, token: number, source: number, arrivedAt: number) => {
    if (!mounted.current || !latest.current.enabled || source !== revision.current || token !== generation.value || target.value !== next) return;
    // No queue/window/role update until the last animation frame has completed.
    pageSync.request(next); latest.current.onCommit(next, arrivedAt); setCompletion(token);
  }, [generation, target, pageSync]);
  const startDrag = useCallback((translation: number) => {
    'worklet'; const token = ++generation.value; phase.value = 1;
    offset.value = windowDrag(center.value, translation, height, count); scheduleOnRN(begin, token, epoch.value);
  }, [generation, phase, offset, center, height, count, begin, epoch]);
  const settle = useCallback((step: -1 | 0 | 1, requestedAt = Date.now()) => {
    'worklet'; const next = Math.max(0, Math.min(count - 1, center.value + step)); const token = ++generation.value; const source = epoch.value;
    target.value = next; phase.value = 2; scheduleOnRN(begin, token, source, next !== center.value ? next : null, requestedAt);
    offset.value = withTiming(next * height, { duration: windowDuration(next * height - offset.value, height), easing: Easing.out(Easing.quad) }, done => {
      if (!done || token !== generation.value || source !== epoch.value) return;
      phase.value = 3; scheduleOnRN(finish, next, token, source, Date.now());
    });
  }, [count, center, generation, epoch, target, phase, begin, offset, height, finish]);
  const acknowledge = useCallback((at: number, token: number) => {
    'worklet'; if (token !== generation.value || phase.value !== 3 || target.value !== at) return;
    center.value = at; phase.value = 0;
    const touch = finger.value;
    if (touch.pending) {
      finger.value = { ...touch, pending: false };
      const step = windowStep(touch.translation, touch.velocity, height, touch.cancelled);
      if (touch.active) { startDrag(touch.translation); return; }
      // A gesture already released during the previous settle starts a fresh
      // transition from the centered page, without a late displacement jump.
      if (touch.ended && step) { settle(step, touch.releasedAt); return; }
    }
    finger.value = emptyTouch; scheduleOnRN(idle, token, epoch.value);
  }, [generation, phase, target, center, finger, height, startDrag, settle, idle, epoch]);
  const reset = useCallback((at: number, size: number, source: number) => {
    'worklet'; generation.value++; cancelAnimation(offset); epoch.value = source;
    center.value = at; target.value = at; offset.value = at * size; phase.value = 0; finger.value = emptyTouch;
    scheduleOnRN(idle, generation.value, source);
  }, [generation, offset, epoch, center, target, phase, finger, idle]);
  useLayoutEffect(() => {
    const external = pageSync.reconcile(index); const resized = extent.current.width !== width || extent.current.height !== height;
    extent.current = { width, height };
    if (external || resized) {
      pageSync.reset(index); setCompletion(-1); const source = ++revision.current;
      latest.current.onPlaybackTarget?.(null); scheduleOnUI(reset, index, height, source);
    } else if (completion >= 0) scheduleOnUI(acknowledge, index, completion);
  });
  useLayoutEffect(() => {
    if (!enabled) { const source = ++revision.current; latest.current.onPlaybackTarget?.(null); scheduleOnUI(reset, index, height, source); }
  }, [enabled, reset, index, height]);
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; revision.current++;
    latest.current.onPlaybackTarget?.(null);
    scheduleOnUI(() => { 'worklet'; generation.value++; cancelAnimation(offset); phase.value = 0; finger.value = emptyTouch; });
    latest.current.onMotion(false);
  }; }, [generation, offset, phase, finger]);
  useImperativeHandle(ref, () => ({
    go(next) {
      if (!mounted.current || !enabled || !ids[next] || Math.abs(next - center.value) !== 1 || phase.value !== 0 || owner.value >= 0) return false;
      scheduleOnUI(() => { 'worklet'; if (phase.value === 0 && owner.value < 0 && Math.abs(next - center.value) === 1) settle(next > center.value ? 1 : -1); });
      return true;
    },
    isMoving() { return phase.value !== 0 || owner.value >= 0; },
  }), [enabled, ids, center, phase, owner, settle]);
  const vertical = usePanGesture({ enabled: allowed, activeOffsetY: [-12, 12], failOffsetX: [-14, 14], maxPointers: 1,
    onActivate: event => {
      'worklet'; if (owner.value >= 0) return;
      const pending = phase.value === 2 || phase.value === 3;
      finger.value = { active: true, pending, ended: false, cancelled: false, translation: event.translationY, velocity: event.velocityY, releasedAt: 0 };
      if (!pending) startDrag(event.translationY);
    },
    onUpdate: event => {
      'worklet'; const touch = finger.value; if (!touch.active || owner.value >= 0) return;
      finger.value = { ...touch, translation: event.translationY, velocity: event.velocityY };
      if (!touch.pending && phase.value === 1) offset.value = windowDrag(center.value, event.translationY, height, count);
    },
    onDeactivate: event => {
      'worklet'; const touch = finger.value; if (!touch.active) return;
      finger.value = { ...touch, active: false, ended: true, cancelled: event.canceled, translation: event.translationY, velocity: event.velocityY, releasedAt: Date.now() };
      if (!touch.pending) settle(windowStep(event.translationY, event.velocityY, height, event.canceled));
    },
    onFinalize: () => {
      'worklet'; const touch = finger.value; if (!touch.active) return;
      finger.value = { ...touch, active: false, ended: true, cancelled: true };
      if (!touch.pending) settle(0);
    },
  });
  const touch = useMemo<PageTouch>(() => ({ native: vertical, phase, owner }), [vertical, phase, owner]);
  return <GestureDetector gesture={vertical}><View style={{ width, height, overflow: 'hidden', backgroundColor: '#000' }}>
    {windowPages(index, count).map(position => <Page key={ids[position]} position={position} active={position === index} height={height} offset={offset}>
      {renderPage(ids[position], position, position === index, position !== index, true, touch)}
    </Page>)}
  </View></GestureDetector>;
});
