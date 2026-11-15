import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, useCompetingGestures, useExclusiveGestures, useLongPressGesture, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, useAnimatedStyle, useDerivedValue, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { boostDropTarget } from './boost';
import { snapSpring } from './motion';
import { swipeStep } from './model';
import { SlidingWorkPager } from './SlidingWorkPager';
import { pinchTransform, type PinchOrigin } from './pinch';
import type { PageTouch, PagerHandle, WorkPagerProps } from './player-types';

// The ancestor moves the three-page window; horizontal/hold/pinch take a
// temporary input lease and never write its vertical position.
function FeedPage({ workId, position, active, warm, retain, touch, config }: {
  workId: string; position: number; active: boolean; warm: boolean; retain: boolean; touch: PageTouch; config: WorkPagerProps;
}) {
  const { width, height, enabled, gallery, boostable, photo, photos, photoX, x, onBoost, onBoostTarget, onBoostLock, onPinch, onMotion, onPrepare, onLike, onTap, onHold } = config;
  const { native, phase, owner } = touch;
  const scale = useSharedValue(1); const zoomX = useSharedValue(0); const zoomY = useSharedValue(0);
  const multi = useSharedValue(false); const hadMulti = useSharedValue(false); const cancelled = useSharedValue(false);
  const generation = useSharedValue(0); const locked = useSharedValue(false); const panning = useSharedValue(false);
  const currentPhoto = useSharedValue(active ? photo : 0); const originX = useSharedValue(0); const albumDrag = useSharedValue(false);
  const boosting = useSharedValue(false); const boostStart = useSharedValue(0); const boostTarget = useSharedValue(false); const holdDistance = useSharedValue(12);
  const pinchOrigin = useSharedValue<PinchOrigin>({ scale: 1, x: 0, y: 0, focalX: 0, focalY: 0 });
  const allowed = useDerivedValue(() => enabled && active && phase.value === 0);
  const latest = useRef({ active, enabled, config }); latest.current = { active, enabled, config };
  const alive = useRef(true);
  const commitPhoto = useCallback((next: number, token: number) => {
    if (alive.current && latest.current.active && latest.current.enabled && generation.value === token) latest.current.config.onPhoto(next);
  }, [generation]);
  const commitSide = useCallback((token: number) => {
    if (alive.current && latest.current.active && latest.current.enabled && generation.value === token) latest.current.config.onSide('author');
  }, [generation]);
  useLayoutEffect(() => {
    generation.value++; cancelled.value = true; locked.value = false; panning.value = false;
    cancelAnimation(scale); cancelAnimation(zoomX); cancelAnimation(zoomY); scale.value = 1; zoomX.value = 0; zoomY.value = 0;
    multi.value = false; hadMulti.value = false; boosting.value = false; boostTarget.value = false; holdDistance.value = 12;
    if (owner.value === position) {
      cancelAnimation(photoX); cancelAnimation(x); x.value = 0; owner.value = -1;
      onBoost(false); onBoostTarget(false); onPinch(false); onMotion(phase.value !== 0);
    }
  }, [active, enabled, width, height, generation, cancelled, locked, panning, scale, zoomX, zoomY, multi, hadMulti, boosting, boostTarget, holdDistance, owner, position, photoX, x, onBoost, onBoostTarget, onPinch, onMotion, phase]);
  useLayoutEffect(() => {
    if (!active) return;
    if (currentPhoto.value !== photo || !panning.value && !locked.value) { cancelAnimation(photoX); currentPhoto.value = photo; photoX.value = -photo * width; }
  }, [active, photo, width, currentPhoto, photoX, panning, locked]);
  useEffect(() => { alive.current = true; return () => {
    alive.current = false; generation.value++; cancelAnimation(scale); cancelAnimation(zoomX); cancelAnimation(zoomY);
    if (owner.value === position) { cancelAnimation(photoX); cancelAnimation(x); owner.value = -1; onBoost(false); onBoostTarget(false); onPinch(false); onMotion(phase.value !== 0); }
  }; }, [generation, scale, zoomX, zoomY, owner, position, photoX, x, onBoost, onBoostTarget, onPinch, onMotion, phase]);
  function release() {
    'worklet'; if (owner.value !== position) return;
    owner.value = -1; scheduleOnRN(onMotion, phase.value !== 0);
  }
  function beginMulti() {
    'worklet'; if (!allowed.value || cancelled.value || multi.value) return;
    hadMulti.value = true; multi.value = true; generation.value++; locked.value = false; panning.value = false;
    cancelAnimation(photoX); cancelAnimation(x); photoX.value = -currentPhoto.value * width; x.value = 0; owner.value = position;
    boosting.value = false; boostTarget.value = false; holdDistance.value = 12;
    scheduleOnRN(onBoost, false); scheduleOnRN(onBoostTarget, false); scheduleOnRN(onPrepare, false); scheduleOnRN(onPinch, true); scheduleOnRN(onMotion, true);
  }
  const pinch = usePinchGesture({ enabled: allowed, simultaneousWith: native,
    onTouchesDown: e => { 'worklet'; if (e.numberOfTouches === 1 && !multi.value) { cancelled.value = false; hadMulti.value = false; } if (e.numberOfTouches >= 2) beginMulti(); },
    onActivate: e => {
      'worklet'; beginMulti(); if (!multi.value) return;
      generation.value++; cancelAnimation(scale); cancelAnimation(zoomX); cancelAnimation(zoomY);
      pinchOrigin.value = { scale: scale.value, x: zoomX.value, y: zoomY.value, focalX: e.focalX, focalY: e.focalY };
    },
    onUpdate: e => { 'worklet'; if (!multi.value || cancelled.value) return; const value = pinchTransform(e.scale, e.focalX, e.focalY, pinchOrigin.value, width, height); scale.value = value.scale; zoomX.value = value.x; zoomY.value = value.y; },
    onFinalize: () => {
      'worklet'; if (!multi.value || cancelled.value) return; const token = ++generation.value;
      zoomX.value = withTiming(0, { duration: 180 }); zoomY.value = withTiming(0, { duration: 180 });
      scale.value = withTiming(1, { duration: 180 }, done => { if (done && token === generation.value) { multi.value = false; release(); scheduleOnRN(onPinch, false); } });
    },
  });
  const pan = usePanGesture({ enabled: allowed, activeOffsetX: [-14, 14], failOffsetY: [-14, 14], maxPointers: 1, block: native,
    onActivate: e => {
      'worklet'; if (multi.value || hadMulti.value || cancelled.value) return;
      generation.value++; cancelAnimation(photoX); cancelAnimation(x); owner.value = position; locked.value = false; panning.value = true; albumDrag.value = gallery;
      originX.value = (gallery ? photoX.value : x.value) - e.translationX;
      scheduleOnRN(onMotion, true); if (!gallery && e.translationX < 0) scheduleOnRN(onPrepare, true);
    },
    onUpdate: e => {
      'worklet'; if (!panning.value || locked.value || multi.value || hadMulti.value || cancelled.value) return;
      if (albumDrag.value) {
        const delta = originX.value + e.translationX + currentPhoto.value * width;
        const edge = currentPhoto.value === 0 && delta > 0 || currentPhoto.value >= photos - 1 && delta < 0;
        photoX.value = -currentPhoto.value * width + Math.max(-width, Math.min(width, delta * (edge ? 0.22 : 1)));
      } else x.value = Math.max(-width, Math.min(0, originX.value + e.translationX));
    },
    onDeactivate: e => {
      'worklet'; if (!panning.value || multi.value || hadMulti.value || cancelled.value) return;
      panning.value = false; locked.value = true; const token = ++generation.value;
      if (albumDrag.value) {
        const next = Math.max(0, Math.min(photos - 1, currentPhoto.value + (e.canceled ? 0 : swipeStep(photoX.value + currentPhoto.value * width, e.velocityX, width))));
        photoX.value = withSpring(-next * width, snapSpring(-next * width - photoX.value, e.velocityX, width), done => {
          if (token !== generation.value) return; locked.value = false;
          if (done) { currentPhoto.value = next; scheduleOnRN(commitPhoto, next, token); release(); }
        });
      } else {
        const step = e.canceled ? 0 : swipeStep(x.value, e.velocityX, width); const target = step > 0 ? -width : 0;
        x.value = withSpring(target, snapSpring(target - x.value, e.velocityX, width), done => {
          if (token !== generation.value) return; locked.value = false;
          if (done) { release(); if (step > 0) scheduleOnRN(commitSide, token); else scheduleOnRN(onPrepare, false); }
        });
      }
    },
    onFinalize: () => { 'worklet'; if (panning.value && !multi.value && !locked.value) { panning.value = false; photoX.value = -currentPhoto.value * width; x.value = 0; release(); scheduleOnRN(onPrepare, false); } },
  });
  const double = useTapGesture({ enabled: allowed, numberOfTaps: 2, maxDelay: 240, maxDistance: 12, block: native,
    onActivate: () => { 'worklet'; if (!locked.value && !multi.value && !hadMulti.value && !cancelled.value) scheduleOnRN(onLike); } });
  const single = useTapGesture({ enabled: allowed, maxDuration: 250, maxDistance: 12, block: native,
    onActivate: () => { 'worklet'; if (!locked.value && !multi.value && !hadMulti.value && !cancelled.value) scheduleOnRN(onTap); } });
  const hold = useLongPressGesture({ enabled: allowed, minDuration: 450, maxDistance: holdDistance, numberOfPointers: 1, shouldCancelWhenOutside: false, block: native,
    onActivate: e => {
      'worklet'; if (locked.value || multi.value || hadMulti.value || cancelled.value) return;
      owner.value = position; scheduleOnRN(onMotion, true);
      if (e.x < width * 0.25 || e.x > width * 0.75) { boosting.value = true; boostStart.value = e.y; boostTarget.value = false; holdDistance.value = (width + height) * 2; scheduleOnRN(onBoost, true); }
      else scheduleOnRN(onHold);
    },
    onTouchesMove: e => {
      'worklet'; if (!boosting.value || !boostable || multi.value || e.numberOfTouches !== 1) return; const point = e.allTouches[0]; if (!point) return;
      const armed = boostDropTarget(boostStart.value, point.y, height, boostTarget.value);
      if (armed !== boostTarget.value) { boostTarget.value = armed; scheduleOnRN(onBoostTarget, armed); }
    },
    onFinalize: e => {
      'worklet'; if (owner.value !== position || multi.value) return;
      if (boosting.value) {
        const commit = !e.canceled && !cancelled.value && boostable && !hadMulti.value && boostDropTarget(boostStart.value, e.y, height, boostTarget.value);
        boosting.value = false; boostTarget.value = false; holdDistance.value = 12;
        if (commit) scheduleOnRN(onBoostLock, workId); scheduleOnRN(onBoost, false); scheduleOnRN(onBoostTarget, false);
      }
      if (!panning.value && !locked.value) release();
    },
  });
  const taps = useExclusiveGestures(double, single); const singleFinger = useCompetingGestures(pan, hold, taps); const gesture = useSimultaneousGestures(pinch, singleFinger);
  const zoomStyle = useAnimatedStyle(() => ({ transform: [{ translateX: zoomX.value }, { translateY: zoomY.value }, { scale: scale.value }] }));
  return <View style={StyleSheet.absoluteFill}>
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}><Animated.View style={[StyleSheet.absoluteFill, zoomStyle]}>{config.renderMedia(workId, active, warm, retain)}</Animated.View></View>
    <GestureDetector gesture={gesture}><Animated.View style={StyleSheet.absoluteFill} /></GestureDetector>
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>{config.renderChrome(workId, active, native)}</View>
  </View>;
}

export const FeedPager = forwardRef<PagerHandle, WorkPagerProps>(function FeedPager(config, ref) {
  const renderPage = useCallback((workId: string, position: number, active: boolean, warm: boolean, retain: boolean, touch: PageTouch) =>
    <FeedPage workId={workId} position={position} active={active} warm={warm} retain={retain} touch={touch} config={config} />, [config]);
  return <SlidingWorkPager ref={ref} ids={config.ids} index={config.index} width={config.width} height={config.height} enabled={config.enabled}
    onCommit={config.onCommit} onMotion={config.onMotion} onPlaybackTarget={config.onPlaybackTarget} renderPage={renderPage} />;
});
