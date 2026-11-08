import { useEvent, useEventListener } from 'expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  ActivityIndicator, Animated, AppState, Image, PanResponder, Pressable, StyleSheet, Text, View,
  type GestureResponderEvent,
} from 'react-native';
import { mediaHeaders } from './douyin';
import { surfaceSwipe, type SurfaceSwipe } from './swipe';

type SurfaceProps = {
  onWork: (step: number) => void;
  onWorkDrag: (offset: number) => void;
  onWorkRelease: (offset: number, velocity: number) => void;
  onLibrary: () => void;
  gallery: boolean;
  onPage?: (step: number) => void;
  onHold: () => void;
  onBoost?: (held: boolean) => void;
  disabled: boolean;
};

export function GestureSurface({ children, overlay, onTap, tapLabel, ...options }: SurfaceProps & {
  children?: ReactNode;
  overlay?: ReactNode;
  onTap?: () => void;
  tapLabel?: string;
}) {
  const actions = useRef(options);
  actions.current = options;
  const [shift] = useState(() => new Animated.Value(0));
  const gesture = useRef<{ kind: SurfaceSwipe; start: number } | null>(null);
  const width = useRef(0);
  const startX = useRef<number | null>(null);
  const atEdge = useRef(false);
  const boosting = useRef(false);
  const releaseBoost = useCallback(() => {
    if (!boosting.current) return;
    boosting.current = false;
    actions.current.onBoost?.(false);
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') releaseBoost();
    });
    return () => subscription.remove();
  }, [releaseBoost]);
  useEffect(() => () => shift.stopAnimation(), [shift]);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: () => {
      startX.current = null;
      return false;
    },
    onMoveShouldSetPanResponderCapture: (_, { dx, dy, numberActiveTouches }) => {
      if (actions.current.disabled || boosting.current || numberActiveTouches !== 1) return false;
      const kind = surfaceSwipe(dx, dy, startX.current, width.current, actions.current.gallery);
      if (!kind || (kind === 'photo' && !actions.current.onPage)) return false;
      gesture.current = { kind, start: kind === 'work' ? dy : dx };
      return true;
    },
    onPanResponderGrant: () => {
      shift.stopAnimation();
      const current = gesture.current;
      shift.setValue(current?.kind === 'photo' ? current.start * 0.42 : 0);
      if (current?.kind === 'work') actions.current.onWorkDrag(current.start);
    },
    onPanResponderMove: (_, { dx, dy }) => {
      const current = gesture.current;
      if (current?.kind === 'work') actions.current.onWorkDrag(current.start + dy);
      if (current?.kind === 'photo') shift.setValue((current.start + dx) * 0.42);
    },
    onPanResponderRelease: (_, { dx, dy, vx, vy }) => {
      const current = gesture.current;
      gesture.current = null;
      if (!current) return;
      if (current.kind === 'work') {
        if (actions.current.disabled) actions.current.onWorkRelease(0, 0);
        else actions.current.onWorkRelease(current.start + dy, vy);
        return;
      }
      const offset = current.start + dx;
      if (current.kind === 'library') {
        if (!actions.current.disabled && (offset < -52 || (offset < -25 && vx < -0.58))) actions.current.onLibrary();
        return;
      }
      if (!actions.current.disabled && (Math.abs(offset) > 52 || (Math.abs(offset) > 25 && Math.abs(vx) > 0.58))) {
        actions.current.onPage?.(offset < 0 ? 1 : -1);
      }
      Animated.timing(shift, { toValue: 0, duration: 145, useNativeDriver: true }).start();
    },
    onPanResponderTerminate: () => {
      if (gesture.current?.kind === 'work') actions.current.onWorkRelease(0, 0);
      gesture.current = null;
      shift.setValue(0);
    },
  }), [shift]);

  return (
    <View style={StyleSheet.absoluteFill} {...responder.panHandlers}
      onLayout={({ nativeEvent }) => { width.current = nativeEvent.layout.width; }}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ translateX: shift }] }]}>
        {children}
      </Animated.View>
      <Pressable accessibilityRole="button" accessibilityLabel={tapLabel ?? (onTap ? '播放或暂停视频' : '作品画面')}
        accessibilityHint={options.gallery
          ? '上下滑切作品，左右滑翻照片，从右边缘向左滑回内容库'
          : '上下滑切作品，向左滑回内容库，长按中间打开选项'}
        accessibilityActions={[
          { name: 'next', label: '下一条' }, { name: 'previous', label: '上一条' },
          { name: 'options', label: '播放选项' },
          { name: 'library', label: '返回内容库' },
          ...(options.onPage ? [{ name: 'next-page', label: '下一张' }, { name: 'previous-page', label: '上一张' }] : []),
        ]}
        onAccessibilityAction={({ nativeEvent: { actionName } }) => {
          if (options.disabled) return;
          if (actionName === 'next') options.onWork(1);
          if (actionName === 'previous') options.onWork(-1);
          if (actionName === 'options') options.onHold();
          if (actionName === 'library') options.onLibrary();
          if (actionName === 'next-page') options.onPage?.(1);
          if (actionName === 'previous-page') options.onPage?.(-1);
        }}
        disabled={options.disabled} delayLongPress={450}
        onPress={onTap}
        onPressIn={({ nativeEvent }) => {
          const x = nativeEvent.locationX;
          startX.current = x;
          atEdge.current = width.current > 0 && (x < width.current / 4 || x > width.current * 0.75);
        }}
        onLongPress={() => {
          if (!atEdge.current) options.onHold();
          else if (options.onBoost) {
            boosting.current = true;
            options.onBoost(true);
          }
        }}
        onPressOut={releaseBoost} style={StyleSheet.absoluteFill} />
      {overlay}
    </View>
  );
}

export function PlaybackIndicator({ paused, boosted }: { paused: boolean; boosted: boolean }) {
  if (boosted) return <Text pointerEvents="none" style={styles.boost}>2× 快进</Text>;
  if (!paused) return null;
  return (
    <View pointerEvents="none" style={styles.pauseMark} accessibilityLabel="已暂停">
      <Ionicons name="play" size={67} color="#ffffffe0" style={styles.playIcon} />
    </View>
  );
}

export function MediaMessage({ message, retry, loading }: { message: string; retry?: () => void; loading?: boolean }) {
  return (
    <View style={styles.message} pointerEvents="box-none">
      {loading && <ActivityIndicator color="#fff" />}
      <Text style={styles.messageText} pointerEvents="none">{message}</Text>
      {retry && <Pressable accessibilityRole="button" onPress={retry} style={styles.retry}>
        <Text style={styles.messageText}>重试</Text>
      </Pressable>}
    </View>
  );
}

function SeekRail({ position, duration, begin, seek, cancel }: {
  position: number; duration: number; begin: () => void; seek: (seconds: number) => void; cancel: () => void;
}) {
  const width = useRef(0);
  const [drag, setDrag] = useState<number | null>(null);
  const input = useRef({ position, duration, begin, seek, cancel });
  input.current = { position, duration, begin, seek, cancel };
  const responder = useMemo(() => {
    const timeAt = ({ nativeEvent }: GestureResponderEvent) => width.current
      ? Math.max(0, Math.min(1, nativeEvent.locationX / width.current)) * input.current.duration
      : input.current.position;
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, { dx, dy, numberActiveTouches }) =>
        numberActiveTouches === 1 && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => { input.current.begin(); setDrag(timeAt(event)); },
      onPanResponderMove: (event) => setDrag(timeAt(event)),
      onPanResponderRelease: (event) => { input.current.seek(timeAt(event)); setDrag(null); },
      onPanResponderTerminate: () => { input.current.cancel(); setDrag(null); },
    });
  }, []);
  return (
    <View style={styles.railHit} {...responder.panHandlers}
      accessibilityRole="adjustable" accessible accessibilityLabel="视频进度"
      accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(position) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={({ nativeEvent }) => {
        seek(Math.max(0, Math.min(duration, position + (nativeEvent.actionName === 'increment' ? 5 : -5))));
      }}
      onLayout={({ nativeEvent }) => { width.current = nativeEvent.layout.width; }}>
      {drag !== null && (
        <>
          <Text pointerEvents="none" style={styles.seekTime}>{clock(drag)} / {clock(duration)}</Text>
          <View pointerEvents="none" style={styles.rail}>
            <View style={[styles.railFill, { width: `${Math.min(1, drag / duration) * 100}%` }]} />
          </View>
        </>
      )}
    </View>
  );
}

function clock(seconds: number) {
  const elapsed = Math.floor(seconds);
  return `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
}

export function ReviewVideo({
  uri, poster, active, position, paused, surface, clear, rate, auto, stopVideo, reportPoint, onEnd, onFailure, onReady,
}: {
  uri: string; poster?: ReactNode; active: boolean; position: RefObject<number>; paused: RefObject<boolean>;
  surface: SurfaceProps; clear: boolean; rate: number; auto: boolean;
  stopVideo: RefObject<(() => void) | null>;
  reportPoint: (seconds: number, force: boolean) => void;
  onEnd: () => boolean;
  onFailure: () => void;
  onReady?: () => void;
}) {
  const source = useMemo(() => ({ uri, headers: mediaHeaders, contentType: 'auto' as const }), [uri]);
  const player = useVideoPlayer(source, (instance) => {
    instance.staysActiveInBackground = false;
    instance.muted = !active;
    if (!active) instance.bufferOptions = { preferredForwardBufferDuration: 3 };
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const failed = status === 'error';
  const [frame, setFrame] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [isPaused, setIsPaused] = useState(paused.current);
  const [scrubbing, setScrubbing] = useState(false);
  const scrub = useRef(false);
  const [boosted, setBoosted] = useState(false);
  const boost = useRef(false);
  const started = useRef(false);
  const startTime = useRef(position.current);
  const ended = useRef(false);
  const failure = useRef(onFailure);
  failure.current = onFailure;
  const shouldWait = active && !failed && !scrubbing && (!isPaused || boosted) && (!frame || status === 'loading');

  function record(seconds: number, force: boolean) {
    if (!Number.isFinite(seconds)) return;
    position.current = seconds;
    reportPoint(seconds, force);
  }

  function pause() {
    if (started.current && !scrub.current && (!paused.current || boost.current)) record(player.currentTime, true);
    boost.current = false;
    setBoosted(false);
    paused.current = true;
    player.pause();
    setIsPaused(true);
  }

  const pauseRef = useRef(pause);
  pauseRef.current = pause;
  useLayoutEffect(() => {
    if (!active) return;
    const stop = () => pauseRef.current();
    stopVideo.current = stop;
    return () => { if (stopVideo.current === stop) stopVideo.current = null; };
  }, [active, stopVideo]);
  useEffect(() => {
    if (!active) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') pauseRef.current();
    });
    return () => subscription.remove();
  }, [active]);

  useEffect(() => {
    player.muted = !active;
    player.timeUpdateEventInterval = active ? 0.5 : 0;
    player.bufferOptions = { preferredForwardBufferDuration: active ? 0 : 3 };
  }, [active, player]);
  useEffect(() => {
    // Expo Video on iOS assigns AVPlayer.rate when setting playbackRate, which also starts playback.
    if (active && started.current && !paused.current && !scrub.current && !boost.current) player.playbackRate = rate;
  }, [active, player, paused, rate]);
  useEffect(() => { player.loop = !auto; }, [player, auto]);
  const requestAutoplay = useCallback(() => {
    if (!active || paused.current || scrub.current || ended.current || player.status === 'error') return;
    if (AppState.currentState === 'background' || AppState.currentState === 'inactive') return;
    if (!started.current) {
      started.current = true;
      const duration = player.duration;
      startTime.current = duration > 0
        ? Math.min(position.current, Math.max(0, duration - 0.25))
        : position.current;
      if (startTime.current > 0) player.currentTime = startTime.current;
      player.playbackRate = rate;
    }
    if (!player.playing) player.play();
  }, [active, paused, player, position, rate]);

  useEffect(() => { requestAutoplay(); }, [requestAutoplay]);
  useEffect(() => {
    if (!active) return;
    if (status === 'error' || player.status === 'error') {
      failure.current();
      return;
    }
    if (status === 'readyToPlay') requestAutoplay();
  }, [active, status, player, requestAutoplay]);

  useEffect(() => {
    if (!shouldWait) {
      setWaiting(false);
      return;
    }
    const timer = setTimeout(() => setWaiting(true), 420);
    return () => clearTimeout(timer);
  }, [shouldWait]);
  useEffect(() => {
    if (!active || (frame && advanced) || failed || isPaused || scrubbing) return;
    const retry = setTimeout(requestAutoplay, 1800);
    const timeout = setTimeout(() => failure.current(), 12_000);
    return () => { clearTimeout(retry); clearTimeout(timeout); };
  }, [active, frame, advanced, failed, isPaused, scrubbing, requestAutoplay]);
  useEffect(() => { if (active && frame) onReady?.(); }, [active, frame, onReady]);

  useEventListener(player, 'sourceLoad', requestAutoplay);
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (!active || !started.current || scrub.current || (paused.current && !boost.current)) return;
    if (!advanced && player.playing && Math.abs(currentTime - startTime.current) > 0.05) setAdvanced(true);
    record(currentTime, false);
  });
  useEventListener(player, 'playToEnd', () => {
    if (!active || scrub.current) return;
    setAdvanced(true);
    if (!auto) return;
    ended.current = true;
    if (!onEnd()) pause();
  });

  function rewindIfEnded() {
    if (ended.current) {
      player.currentTime = 0;
      ended.current = false;
      record(0, true);
    }
  }

  function resume() {
    if (AppState.currentState === 'background' || AppState.currentState === 'inactive') return;
    rewindIfEnded();
    paused.current = false;
    setIsPaused(false);
    if (!started.current) {
      requestAutoplay();
      return;
    }
    player.playbackRate = rate;
    player.play();
  }

  function holdSpeed(held: boolean) {
    if (!started.current || scrub.current || held === boost.current) return;
    boost.current = held;
    setBoosted(held);
    if (held) {
      rewindIfEnded();
      player.playbackRate = 2;
      player.play();
    } else if (paused.current) {
      record(player.currentTime, true);
      player.pause();
    } else {
      player.playbackRate = rate;
    }
  }

  const seekRail = active && !clear && !surface.disabled && frame && player.duration > 0 ? (
    <SeekRail position={position.current} duration={player.duration}
      begin={() => {
        scrub.current = true;
        setScrubbing(true);
        player.pause();
      }}
      seek={(seconds) => {
        scrub.current = false;
        setScrubbing(false);
        ended.current = false;
        const time = Math.min(seconds, Math.max(0, player.duration - 0.1));
        startTime.current = time;
        player.currentTime = time;
        record(time, true);
        resume();
      }}
      cancel={() => {
        scrub.current = false;
        setScrubbing(false);
        if (!paused.current) resume();
      }} />
  ) : null;
  return (
    <>
      <GestureSurface {...surface} onBoost={holdSpeed} overlay={seekRail}
        onTap={() => {
          if (paused.current || !started.current) resume();
          else pause();
        }}>
        <VideoView player={player} nativeControls={false} contentFit="contain" surfaceType="textureView"
          allowsVideoFrameAnalysis={false} style={StyleSheet.absoluteFill}
          onFirstFrameRender={() => { setFrame(true); requestAutoplay(); }} />
        {!frame && poster}
      </GestureSurface>
      {waiting && shouldWait && (frame
        ? <View pointerEvents="none" style={styles.pauseMark}>
            <ActivityIndicator color="#fff" accessibilityLabel="视频缓冲中" />
          </View>
        : <MediaMessage message="视频加载中…" loading />)}
      {active && !clear && !scrubbing && <PlaybackIndicator paused={isPaused} boosted={boosted} />}
    </>
  );
}

export function GalleryFrame({ candidates, surface, retry, children, onTap, tapLabel, hideImageStatus, onReady, poster }: {
  candidates: string[]; surface: SurfaceProps; retry: () => void; children?: ReactNode; onTap?: () => void;
  tapLabel?: string; hideImageStatus?: boolean;
  onReady?: () => void;
  poster?: ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const uri = candidates[attempt];
  useEffect(() => {
    if (!uri || loaded) return;
    const timer = setTimeout(() => setAttempt((index) => index === attempt ? index + 1 : index), 15_000);
    return () => clearTimeout(timer);
  }, [attempt, loaded, uri]);
  useEffect(() => { if (loaded || !uri) onReady?.(); }, [loaded, uri, onReady]);
  return (
    <>
      <GestureSurface {...surface} onTap={onTap} tapLabel={onTap ? tapLabel : undefined}>
        {!loaded && poster}
        {uri && <Image key={uri} accessibilityIgnoresInvertColors resizeMode="contain"
          source={{ uri, headers: mediaHeaders }} style={StyleSheet.absoluteFill}
          onLoad={() => setLoaded(true)} onError={() => setAttempt((index) => index === attempt ? index + 1 : index)} />}
        {children}
      </GestureSurface>
      {!hideImageStatus && !uri && <MediaMessage message="这张图片暂时无法显示" retry={retry} />}
      {!hideImageStatus && uri && !loaded && <MediaMessage message="图片加载中…" loading />}
    </>
  );
}

const styles = StyleSheet.create({
  message: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  messageText: { color: '#fff', textAlign: 'center', fontSize: 14 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 20, backgroundColor: '#333' },
  railHit: { position: 'absolute', bottom: 0, left: 12, right: 12, height: 42, justifyContent: 'center' },
  rail: { height: 2, borderRadius: 1, backgroundColor: '#ffffff55' },
  railFill: { height: '100%', borderRadius: 1, backgroundColor: '#fff' },
  seekTime: {
    position: 'absolute', top: 0, alignSelf: 'center', color: '#fff', fontSize: 12,
    fontWeight: '600', fontVariant: ['tabular-nums'], textShadowColor: '#000c', textShadowRadius: 4,
  },
  pauseMark: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  playIcon: { textShadowColor: '#0005', textShadowRadius: 7 },
  boost: {
    position: 'absolute', top: 12, alignSelf: 'center', color: '#fff',
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, overflow: 'hidden', backgroundColor: '#0008',
  },
});
