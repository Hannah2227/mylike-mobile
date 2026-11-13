import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, useCompetingGestures, useExclusiveGestures, useLongPressGesture, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { swipeStep } from './model';
import { neighborPages, pageTranslation } from './layout';
import { pinchTransform, type PinchOrigin } from './pinch';
import { snapDuration } from './motion';
import { boostDropTarget } from './boost';

export type PagerHandle = { go: (index: number) => boolean };
function Slot({ y, index, height, chrome, children }: { y: SharedValue<number>; index: number; height: number; chrome?: boolean; children: ReactNode }) {
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: pageTranslation(y.value, index, height) }] }));
  return <Animated.View pointerEvents={chrome ? 'box-none' : 'none'} style={[StyleSheet.absoluteFill, chrome && { zIndex: 3 }, style]}>{children}</Animated.View>;
}
function ZoomedMedia({ active, scale, x, y, children }: { active: boolean; scale: SharedValue<number>; x: SharedValue<number>; y: SharedValue<number>; children: ReactNode }) {
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: active ? x.value : 0 }, { translateY: active ? y.value : 0 }, { scale: active ? scale.value : 1 }] }));
  return <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}><Animated.View style={[StyleSheet.absoluteFill, style]}>{children}</Animated.View></View>;
}
export const WorkPager = forwardRef<PagerHandle, {
  ids: string[]; index: number; height: number; width: number; enabled: boolean; gallery: boolean; boostable: boolean;
  photo: number; photos: number; photoX: SharedValue<number>; x: SharedValue<number>;
  onCommit: (index: number) => void; onPhoto: (index: number) => void; onSide: (side: 'author') => void; onPrepare: (value: boolean) => void;
  onBoundary: (step: -1 | 1) => void;
  onTap: () => void; onLike: () => void; onHold: () => void; onBoost: (value: boolean) => void; onBoostTarget: (value: boolean) => void; onBoostLock: (id: string) => void; onPinch: (value: boolean) => void;
  renderMedia: (id: string, active: boolean, warm: boolean) => ReactNode;
  renderChrome: (id: string, active: boolean) => ReactNode;
}>(function WorkPager({ ids, index, height, width, enabled, gallery, boostable, photo, photos, photoX, x, onCommit, onPhoto, onSide, onPrepare, onBoundary, onTap, onLike, onHold, onBoost, onBoostTarget, onBoostLock, onPinch, renderMedia, renderChrome }, ref) {
  const y = useSharedValue(-index * height); const current = useSharedValue(index);
  const currentPhoto = useSharedValue(photo); const axis = useSharedValue(0); const locked = useSharedValue(false); const boosting = useSharedValue(false);
  const boostStart = useSharedValue(0); const boostIndex = useSharedValue(index); const boostTarget = useSharedValue(false); const holdDistance = useSharedValue(12);
  const animation = useSharedValue(0); const dragOrigin = useSharedValue({ y: 0, photo: 0, x: 0 });
  const extent = useRef({ height, width });
  const zoom = useSharedValue(1); const zoomX = useSharedValue(0); const zoomY = useSharedValue(0);
  const multi = useSharedValue(false); const hadMulti = useSharedValue(false);
  const origin = useSharedValue<PinchOrigin>({ scale: 1, x: 0, y: 0, focalX: 0, focalY: 0 });
  useLayoutEffect(() => { if (current.value !== index || extent.current.height !== height) { animation.value++; cancelAnimation(y); current.value = index; y.value = -index * height; locked.value = false; } extent.current.height = height; }, [index, height, y, current, locked, animation]);
  useLayoutEffect(() => { const resized = extent.current.width !== width; if (currentPhoto.value !== photo || resized) { if (resized) animation.value++; cancelAnimation(photoX); currentPhoto.value = photo; photoX.value = -photo * width; if (resized || axis.value === 2) locked.value = false; } extent.current.width = width; }, [photo, width, currentPhoto, photoX, locked, animation, axis]);
  useEffect(() => () => { animation.value++; cancelAnimation(y); cancelAnimation(x); cancelAnimation(photoX); }, [y, x, photoX, animation]);
  useLayoutEffect(() => { if (!enabled) { animation.value++; cancelAnimation(y); cancelAnimation(photoX); y.value = -current.value * height; photoX.value = -currentPhoto.value * width; locked.value = false; } }, [enabled, height, width, y, photoX, current, currentPhoto, animation, locked]);
  useLayoutEffect(() => {
    cancelAnimation(zoom); cancelAnimation(zoomX); cancelAnimation(zoomY); zoom.value = 1; zoomX.value = 0; zoomY.value = 0; multi.value = false; hadMulti.value = false;
    boosting.value = false; boostTarget.value = false; holdDistance.value = 12; onBoost(false); onBoostTarget(false); onPinch(false);
    return () => { cancelAnimation(zoom); cancelAnimation(zoomX); cancelAnimation(zoomY); };
  }, [enabled, index, width, height, zoom, zoomX, zoomY, multi, hadMulti, boosting, boostTarget, holdDistance, onBoost, onBoostTarget, onPinch]);
  function beginMulti() {
    'worklet'; hadMulti.value = true; if (multi.value) return; multi.value = true;
    animation.value++; cancelAnimation(y); cancelAnimation(photoX); cancelAnimation(x); locked.value = false;
    y.value = -current.value * height; photoX.value = -currentPhoto.value * width; x.value = 0;
    if (boosting.value) { boosting.value = false; scheduleOnRN(onBoost, false); }
    boostTarget.value = false; holdDistance.value = 12; scheduleOnRN(onBoostTarget, false);
    scheduleOnRN(onPrepare, false); scheduleOnRN(onPinch, true);
  }
  const pinch = usePinchGesture({ enabled,
    onTouchesDown: e => { 'worklet'; if (e.numberOfTouches >= 2) beginMulti(); else if (!multi.value) hadMulti.value = false; },
    onActivate: e => {
      'worklet'; beginMulti(); cancelAnimation(zoom); cancelAnimation(zoomX); cancelAnimation(zoomY);
      origin.value = { scale: zoom.value, x: zoomX.value, y: zoomY.value, focalX: e.focalX, focalY: e.focalY };
    },
    onUpdate: e => { 'worklet'; if (!multi.value) return; const value = pinchTransform(e.scale, e.focalX, e.focalY, origin.value, width, height); zoom.value = value.scale; zoomX.value = value.x; zoomY.value = value.y; },
    onFinalize: () => {
      'worklet'; if (!multi.value) return;
      zoomX.value = withTiming(0, { duration: 180 }); zoomY.value = withTiming(0, { duration: 180 });
      zoom.value = withTiming(1, { duration: 180 }, done => { if (done) { multi.value = false; scheduleOnRN(onPinch, false); } });
    },
  });
  useImperativeHandle(ref, () => ({ go(next) {
    if (!ids[next] || next === current.value || locked.value || multi.value) return false;
    locked.value = true; const token = ++animation.value;
    // Promote at release, not at animation completion. Both visible keyed slots
    // survive the promotion, so playback can start during the remaining snap.
    current.value = next; onCommit(next);
    y.value = withTiming(-next * height, { duration: snapDuration(-next * height - y.value, 0, height), easing: Easing.out(Easing.cubic) }, () => { if (token === animation.value) locked.value = false; });
    return true;
  } }), [ids, index, height, y, current, locked, multi, onCommit, animation]);
  const pan = usePanGesture({ enabled, minDistance: 14, maxPointers: 1,
    onBegin: e => { 'worklet'; axis.value = 0; if (e.numberOfPointers === 1 && !multi.value) hadMulti.value = false; },
    onActivate: e => {
      'worklet'; if (multi.value || hadMulti.value) return;
      animation.value++; cancelAnimation(y); cancelAnimation(photoX); cancelAnimation(x); locked.value = false;
      dragOrigin.value = { y: y.value - e.translationY, photo: photoX.value - e.translationX, x: x.value - e.translationX };
    },
    onUpdate: e => {
      'worklet'; if (locked.value || multi.value || hadMulti.value || e.numberOfPointers !== 1) return;
      if (!axis.value) { axis.value = Math.abs(e.translationY) >= Math.abs(e.translationX) ? 1 : 2; if (axis.value === 2 && !gallery && e.translationX < 0) scheduleOnRN(onPrepare, true); }
      if (axis.value === 1) {
        const delta = dragOrigin.value.y + e.translationY + current.value * height;
        const edge = current.value === 0 && delta > 0 || current.value === ids.length - 1 && delta < 0;
        y.value = -current.value * height + Math.max(-height, Math.min(height, delta * (edge ? 0.22 : 1)));
      } else if (gallery) {
        const delta = dragOrigin.value.photo + e.translationX + currentPhoto.value * width;
        const edge = currentPhoto.value === 0 && delta > 0 || currentPhoto.value >= photos - 1 && delta < 0;
        photoX.value = -currentPhoto.value * width + Math.max(-width, Math.min(width, delta * (edge ? 0.22 : 1)));
      } else x.value = Math.max(-width, Math.min(0, dragOrigin.value.x + e.translationX));
    },
    onDeactivate: e => {
      'worklet'; if (locked.value || multi.value || hadMulti.value) return;
      if (axis.value === 1) {
        const step = e.canceled ? 0 : swipeStep(y.value + current.value * height, e.velocityY, height);
        const next = Math.max(0, Math.min(ids.length - 1, current.value + step));
        locked.value = true; const token = ++animation.value;
        const changed = next !== current.value;
        if (changed) { current.value = next; scheduleOnRN(onCommit, next); }
        y.value = withTiming(-next * height, { duration: snapDuration(-next * height - y.value, e.velocityY, height), easing: Easing.out(Easing.cubic) }, done => {
          if (token !== animation.value) return; locked.value = false;
          if (done && !changed && step) scheduleOnRN(onBoundary, step);
        });
      } else if (axis.value === 2 && gallery) {
        const next = Math.max(0, Math.min(photos - 1, currentPhoto.value + (e.canceled ? 0 : swipeStep(photoX.value + currentPhoto.value * width, e.velocityX, width))));
        locked.value = true; const token = ++animation.value;
        photoX.value = withTiming(-next * width, { duration: snapDuration(-next * width - photoX.value, e.velocityX, width), easing: Easing.out(Easing.cubic) }, done => {
          if (token !== animation.value) return; locked.value = false;
          if (done && next !== currentPhoto.value) { currentPhoto.value = next; scheduleOnRN(onPhoto, next); }
        });
      } else if (axis.value === 2) {
        const step = e.canceled ? 0 : swipeStep(x.value, e.velocityX, width);
        locked.value = true; const token = ++animation.value; const target = step > 0 ? -width : 0;
        x.value = withTiming(target, { duration: snapDuration(target - x.value, e.velocityX, width), easing: Easing.out(Easing.cubic) }, done => {
          if (token !== animation.value) return;
          locked.value = false; if (done && step > 0) scheduleOnRN(onSide, 'author'); else scheduleOnRN(onPrepare, false);
        });
      }
    },
    onFinalize: e => {
      'worklet'; if (e.canceled && !locked.value && !multi.value) { y.value = withTiming(-current.value * height); photoX.value = withTiming(-currentPhoto.value * width); x.value = withTiming(0); }
    },
  });
  const double = useTapGesture({ enabled, numberOfTaps: 2, maxDelay: 240, maxDistance: 12, onActivate: () => { 'worklet'; if (!locked.value && !multi.value && !hadMulti.value) scheduleOnRN(onLike); } });
  const single = useTapGesture({ enabled, maxDuration: 250, maxDistance: 12, onActivate: () => { 'worklet'; if (!locked.value && !multi.value && !hadMulti.value) scheduleOnRN(onTap); } });
  const hold = useLongPressGesture({ enabled, minDuration: 450, maxDistance: holdDistance, numberOfPointers: 1, shouldCancelWhenOutside: false,
    onActivate: e => {
      'worklet'; if (locked.value || multi.value || hadMulti.value) return;
      if (e.x < width * 0.25 || e.x > width * 0.75) { boosting.value = true; boostStart.value = e.y; boostIndex.value = current.value; boostTarget.value = false; holdDistance.value = (width + height) * 2; scheduleOnRN(onBoost, true); }
      else scheduleOnRN(onHold);
    },
    onTouchesMove: e => {
      'worklet'; if (!boosting.value || !boostable || multi.value || e.numberOfTouches !== 1) return;
      const touch = e.allTouches[0]; if (!touch) return;
      const armed = boostDropTarget(boostStart.value, touch.y, height, boostTarget.value);
      if (armed !== boostTarget.value) { boostTarget.value = armed; scheduleOnRN(onBoostTarget, armed); }
    },
    onFinalize: e => {
      'worklet'; if (boosting.value) {
        const commit = !e.canceled && boostIndex.value === current.value && boostDropTarget(boostStart.value, e.y, height, boostTarget.value) && boostable && !multi.value && !hadMulti.value;
        boosting.value = false; boostTarget.value = false; holdDistance.value = 12;
        if (commit) scheduleOnRN(onBoostLock, ids[boostIndex.value]);
        scheduleOnRN(onBoost, false); scheduleOnRN(onBoostTarget, false);
      }
    },
  });
  const taps = useExclusiveGestures(double, single); const singleFinger = useCompetingGestures(pan, hold, taps); const gesture = useSimultaneousGestures(pinch, singleFinger);
  const slots = neighborPages(index, ids.length);
  return <View style={{ height, overflow: 'hidden' }}>
    {slots.map(i => <Slot key={ids[i]} y={y} index={i} height={height}><ZoomedMedia active={i === index} scale={zoom} x={zoomX} y={zoomY}>{renderMedia(ids[i], i === index, i !== index)}</ZoomedMedia></Slot>)}
    <GestureDetector gesture={gesture}><Animated.View style={[StyleSheet.absoluteFill, { zIndex: 2 }]} /></GestureDetector>
    {slots.map(i => <Slot chrome key={ids[i]} y={y} index={i} height={height}>{renderChrome(ids[i], i === index)}</Slot>)}
  </View>;
});
