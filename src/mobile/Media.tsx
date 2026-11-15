import { useEvent, useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ActivityIndicator, AppState, Image, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { GalleryMusic } from '../GalleryMusic';
import { LiveClip } from '../LiveClip';
import { mediaHeaders, type MediaResult } from '../douyin';
import { forgetMedia, loadMedia, peekMedia } from './media-cache';
import type { Point, Work } from './model';
import { useMobile } from './context';
import { neighborPages, pageTranslation, videoFit, type MediaSize } from './layout';
import { createFramePrewarm, createPlaybackIntent, resumeSeekTarget, type PlaybackHandoff } from './playback';
import { createFrameProbe, createPlaybackStartProbe } from './frame-metrics';

export type MediaControl = { id: string; retry: () => void; seek: ((seconds: number) => void) | null; silence?: () => void };
export type MediaInfo = { id: string; work: Work | null; data: MediaResult | null; error: string; photos: number; hasLive: boolean; musicUnavailable: boolean; livePhase: 'none' | 'loading' | 'ready' | 'failed' };
export function Poster({ work, fit = 'contain' }: { work: Pick<Work, 'title' | 'coverUrl' | 'kind'> | null; fit?: 'contain' | 'cover' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [work?.coverUrl]);
  return <View style={styles.poster}>
    {work?.coverUrl && !failed ? <Image source={{ uri: work.coverUrl, headers: mediaHeaders }} onError={() => setFailed(true)} fadeDuration={0} resizeMode={fit} style={StyleSheet.absoluteFill} /> :
      <View style={styles.placeholder}><Text style={styles.watermark}>{work?.kind === 'video' ? '▶' : '▧'}</Text><Text style={styles.posterTitle} numberOfLines={2}>{work?.title || 'MyLike'}</Text></View>}
  </View>;
}
export const MediaSlot = memo(function MediaSlot({ id, current, active, warm, prepare, retained, preserve, paused, boosted, seeking, auto, rate, point, photo, photoX, width, height, allowZoom, revision, control, handoff, onInfo, onTime, onReady, onEnd, onPause }: {
  id: string; current: boolean; active: boolean; warm: boolean; prepare: boolean; retained: boolean; preserve: boolean; paused: boolean; boosted: boolean; seeking: boolean; auto: boolean; rate: number;
  point: Point | null; photo: number; photoX: SharedValue<number>; width: number; height: number; allowZoom: boolean; revision: number; control: RefObject<MediaControl | null>; handoff: PlaybackHandoff;
  onInfo: (info: MediaInfo) => void; onTime: (id: string, seconds: number, duration: number, force: boolean) => void;
  onReady: (id: string) => void; onEnd: () => boolean; onPause: () => void;
}) {
  const { store } = useMobile(); const { work: readWork } = store; const [work, setWork] = useState<Work | null>(null); const [data, setData] = useState<MediaResult | null>(() => peekMedia(id));
  const [error, setError] = useState(''); const [attempt, setAttempt] = useState(0); const [candidate, setCandidate] = useState(0);
  const [waiting, setWaiting] = useState(false); const [musicUnavailable, setMusicUnavailable] = useState(false); const [liveFailed, setLiveFailed] = useState(false);
  const [visibleFrame, setVisibleFrame] = useState<object | null>(null);
  const [livePhase, setLivePhase] = useState<MediaInfo['livePhase']>('none');
  const lastTime = useRef(point?.kind === 'video' ? point.value : 0);
  const currentRole = useRef(current); currentRole.current = current;
  const preloadFailed = useRef(false);
  const stopMusic = useRef<(() => void) | null>(null); const stopClip = useRef<(() => void) | null>(null);
  const needed = active || warm || retained;
  const preparedVideo = useRef(false);
  useEffect(() => { let mounted = true; void readWork(id).then(value => { if (mounted) setWork(value); }).catch(() => { if (mounted) setWork(null); }); return () => { mounted = false; }; }, [id, revision, attempt]);
  useEffect(() => {
    if (!needed || data) return;
    const abort = new AbortController(); setError('');
    void loadMedia(id, abort.signal).then(value => { if (!abort.signal.aborted) setData(value); })
      .catch(failure => { if (!abort.signal.aborted) { preloadFailed.current = !currentRole.current; setError(failure instanceof Error ? failure.message : '无法取得作品详情。'); } });
    return () => abort.abort();
  }, [id, needed, data, attempt]);
  useEffect(() => {
    if (!current || data || error) { setWaiting(false); return; }
    const timeout = setTimeout(() => setWaiting(true), 350); return () => clearTimeout(timeout);
  }, [current, data, error]);
  useLayoutEffect(() => { setLiveFailed(false); setLivePhase('none'); }, [photo]);
  const retry = useCallback(() => { stopMusic.current?.(); stopClip.current?.(); forgetMedia(id); setData(null); setError(''); setCandidate(0); setMusicUnavailable(false); setLiveFailed(false); setAttempt(n => n + 1); }, [id]);
  const commands = useMemo<MediaControl>(() => ({ id, retry, seek: null, silence: () => { stopMusic.current?.(); stopClip.current?.(); } }), [id, retry]);
  const localControl = useRef<MediaControl | null>(commands); localControl.current = commands;
  useLayoutEffect(() => {
    if (!current) return;
    control.current = commands;
    return () => { if (control.current === commands) control.current = null; };
  }, [current, commands, control]);
  const album = data && 'images' in data ? data : null;
  const frame = album?.images[Math.max(0, Math.min(photo, album.images.length - 1))];
  const uri = data && 'candidates' in data ? data.candidates[candidate] : undefined;
  const size = data && 'candidates' in data ? data.size : undefined;
  const failure = error || (data && 'candidates' in data && !uri ? '媒体地址暂不可播放，请重新取链。' : '');
  useEffect(() => { if (current && active && preloadFailed.current && failure) { preloadFailed.current = false; setError(''); setCandidate(0); setAttempt(value => value + 1); } }, [current, active, failure]);
  const keepVideo = Boolean(uri) && (active || retained || warm && prepare || preserve && preparedVideo.current);
  // A rebuilt player at the same URL still needs its own first-frame event.
  // An old player's delayed event cannot uncover a newly created player.
  const frameToken = useMemo(() => ({}), [uri, keepVideo]);
  const revealFrame = useCallback(() => setVisibleFrame(frameToken), [frameToken]);
  useLayoutEffect(() => { preparedVideo.current = keepVideo; }, [keepVideo]);
  useLayoutEffect(() => {
    onInfo({ id, work, data, error: failure, photos: album?.images.length ?? 1, hasLive: Boolean(frame?.liveCandidates.length) && !liveFailed, musicUnavailable, livePhase });
  }, [id, work, data, failure, album, frame, liveFailed, musicUnavailable, livePhase, onInfo]);
  useEffect(() => { if (current && failure) onReady(id); }, [current, failure, id, onReady]);
  const clipFailed = useCallback(() => setLiveFailed(true), []);
  const musicFailed = useCallback(() => setMusicUnavailable(true), []);
  return <View style={[StyleSheet.absoluteFill, styles.surface]}>
    {uri && keepVideo && <Video key={uri} id={id} uri={uri} current={current} active={active} prime={warm && !current} prepare={prepare} paused={paused} boosted={boosted} seeking={seeking} rate={rate} auto={auto}
      width={width} height={height} sourceSize={size} allowZoom={allowZoom} position={lastTime} control={localControl} handoff={handoff} onFrame={revealFrame} onTime={onTime} onReady={onReady} onEnd={onEnd} onPause={onPause} onFailure={() => { if (!currentRole.current) preloadFailed.current = true; setCandidate(n => n === candidate ? n + 1 : n); }} />}
    {!album && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: keepVideo && visibleFrame === frameToken ? 0 : 1 }]}><Poster work={work} fit={videoFit(width, height, size, allowZoom)} /></View>}
    {album && <Gallery id={id} images={album.images} photo={photo} width={width} x={photoX} current={current} active={active} retained={retained}
      paused={paused} boosted={boosted} rate={rate} stopClip={stopClip} onReady={onReady} onUnavailable={clipFailed} onPhase={setLivePhase} />}
    {album && current && needed && album.musicCandidates.length > 0 && <GalleryMusic key={id} candidates={album.musicCandidates} enabled={active && !paused} stopMusic={stopMusic} onUnavailable={musicFailed} />}
    {waiting && current && active && <ActivityIndicator color="#fff" style={styles.wait} />}
  </View>;
});
function Video({ id, uri, current, active, prime, prepare, paused, boosted, seeking, rate, auto, width, height, sourceSize, allowZoom, position, control, handoff, onFrame, onTime, onReady, onEnd, onPause, onFailure }: {
  id: string; uri: string; current: boolean; active: boolean; prime: boolean; prepare: boolean; paused: boolean; boosted: boolean; seeking: boolean; rate: number; auto: boolean;
  width: number; height: number; sourceSize?: MediaSize; allowZoom: boolean; position: RefObject<number>; control: RefObject<MediaControl | null>; handoff: PlaybackHandoff; onTime: (id: string, seconds: number, duration: number, force: boolean) => void;
  onFrame: () => void; onReady: (id: string) => void; onEnd: () => boolean; onPause: () => void; onFailure: () => void;
}) {
  const source = useMemo(() => ({ uri, headers: mediaHeaders }), [uri]);
  const player = useVideoPlayer(source, value => { value.staysActiveInBackground = false; value.muted = true; value.timeUpdateEventInterval = 0.5; value.bufferOptions = { preferredForwardBufferDuration: 3, waitsToMinimizeStalling: false, minBufferForPlayback: 0.25 }; });
  const intent = useMemo(() => createPlaybackIntent(player, handoff), [player, handoff]);
  const prewarm = useMemo(() => createFramePrewarm(intent, player), [intent, player]);
  const probe = useMemo(() => __DEV__ ? createFrameProbe(() => performance.now(), value => console.info('[MyLike first frame]', value)) : null, []);
  const startProbe = useMemo(() => __DEV__ ? createPlaybackStartProbe(() => Date.now(), value => console.info('[MyLike playback start]', value)) : null, []);
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const metadata = useEvent(player, 'sourceLoad');
  const track = useEvent(player, 'videoTrackChange', { videoTrack: player.videoTrack });
  // Detail dimensions describe display orientation; native tracks can report coded orientation.
  const size = sourceSize ?? track.videoTrack?.size ?? metadata?.availableVideoTracks[0]?.size;
  const fit = videoFit(width, height, size, allowZoom);
  const [frame, setFrame] = useState(false); const [waiting, setWaiting] = useState(false); const restored = useRef(false);
  const decoded = useRef(false); const sampleTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ended = useRef(false);
  const [primeRetry, setPrimeRetry] = useState(0); const primeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Delay new decode work, but let an existing short prime finish rather than
  // discarding a partially decoded first frame as the finger starts moving.
  const primeAllowed = prime && (prepare || prewarm.ticket() !== null);
  const recovery = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wanted = active && !paused && !seeking;
  const callbacks = useRef({ onTime, onReady, onEnd, onPause, onFailure, active, current, auto, wanted, prime, rate }); callbacks.current = { onTime, onReady, onEnd, onPause, onFailure, active, current, auto, wanted, prime, rate };
  const cancelPrimeTimeout = useCallback(() => { if (primeTimeout.current !== null) clearTimeout(primeTimeout.current); primeTimeout.current = null; }, []);
  const cadence = useMemo(() => ({ value: 0.5 }), [player]);
  const updateInterval = useCallback((value: number) => { if (cadence.value !== value) { player.timeUpdateEventInterval = value; cadence.value = value; } }, [cadence, player]);
  const refreshInterval = useCallback(() => { updateInterval(startProbe?.pending() || prewarm.ticket() !== null ? 1 / 30 : 0.5); }, [updateInterval, startProbe, prewarm]);
  const clearSampleTimeout = useCallback(() => { if (sampleTimeout.current !== null) clearTimeout(sampleTimeout.current); sampleTimeout.current = null; }, []);
  const cancelSampling = useCallback(() => { clearSampleTimeout(); startProbe?.cancel(); refreshInterval(); }, [clearSampleTimeout, startProbe, refreshInterval]);
  const sampleStart = useCallback(() => {
    refreshInterval();
    if (!startProbe?.pending()) { clearSampleTimeout(); return; }
    if (sampleTimeout.current !== null) return;
    sampleTimeout.current = setTimeout(() => { sampleTimeout.current = null; startProbe.expire(); refreshInterval(); }, 3000);
  }, [refreshInterval, startProbe, clearSampleTimeout]);
  const finishPrime = useCallback((ticket = prewarm.ticket()) => {
    if (!prewarm.finish(ticket)) return false;
    cancelPrimeTimeout(); refreshInterval(); return true;
  }, [prewarm, cancelPrimeTimeout, refreshInterval]);
  const cancelRecovery = useCallback(() => { if (recovery.current !== null) clearTimeout(recovery.current); recovery.current = null; }, []);
  const advance = useMemo(() => {
    let ticket: number | null = null; let baseline = 0;
    return {
      start(at?: number) {
        if (callbacks.current.current || !callbacks.current.prime || player.status !== 'readyToPlay' || AppState.currentState !== 'active') return false;
        cancelRecovery(); cancelPrimeTimeout(); prewarm.cancel();
        const atEnd = player.duration > 0 && player.currentTime >= player.duration - 0.005;
        if (atEnd) player.currentTime = 0;
        baseline = atEnd ? 0 : player.currentTime;
        startProbe?.prestart(decoded.current, baseline, at); startProbe?.command();
        ticket = intent.prestart(callbacks.current.rate);
        if (ticket === null) { cancelSampling(); return false; }
        sampleStart(); return true;
      },
      arrive(at?: number) {
        if (AppState.currentState !== 'active') { cancelSampling(); return; }
        if (callbacks.current.current && ticket === null) return; // a cancelled swipe returning to the same work
        startProbe?.select(decoded.current, player.currentTime, at);
        if (ticket !== null) {
          const previous = ticket; ticket = null;
          const atEnd = player.duration > 0 && player.currentTime >= player.duration - 0.005;
          if (atEnd) player.currentTime = 0;
          if (intent.arrive(previous, callbacks.current.rate)) {
            // Continue the clock already running in the visible incoming view;
            // restoring its old zero bookmark here would flush the warm frame.
            position.current = atEnd ? 0 : player.currentTime; restored.current = true; ended.current = false;
          }
        }
        sampleStart();
      },
      cancel() {
        const previous = ticket; ticket = null;
        if (previous !== null && intent.cancelPrestart(previous) && player.currentTime > baseline + 0.12) player.currentTime = baseline;
        cancelSampling();
      },
    };
  }, [player, cancelRecovery, cancelPrimeTimeout, prewarm, startProbe, intent, cancelSampling, sampleStart, position]);
  useLayoutEffect(() => {
    const unregister = handoff.register(id, advance);
    return () => { unregister(); cancelSampling(); };
  }, [handoff, id, advance, cancelSampling]);
  useLayoutEffect(() => { if (current && active) probe?.select(); else probe?.leave(); }, [current, active, probe]);
  useLayoutEffect(() => {
    if (!current || !active || !wanted) return;
    startProbe?.select(decoded.current, player.currentTime); sampleStart();
    return cancelSampling;
  }, [current, active, wanted, startProbe, player, sampleStart, cancelSampling]);
  useLayoutEffect(() => { player.loop = !auto; }, [player, auto]);
  useLayoutEffect(() => {
    if (!active || !current || control.current?.id !== id) return;
    const seek = (seconds: number) => {
      const limit = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : seconds;
      player.currentTime = Math.max(0, Math.min(limit, seconds)); position.current = player.currentTime;
      callbacks.current.onTime(id, player.currentTime, player.duration, true);
    };
    control.current.seek = seek;
    const previousSilence = control.current.silence; const silence = () => intent.stop(); control.current.silence = silence;
    return () => {
      if (control.current?.seek === seek) control.current.seek = null;
      if (control.current?.silence === silence) control.current.silence = previousSilence;
    };
  }, [id, active, current, control, player, position, intent]);
  useLayoutEffect(() => {
    if (active && status === 'readyToPlay' && player.duration > 0 && !restored.current) {
      restored.current = true; const seek = resumeSeekTarget(position.current, player.currentTime, player.duration); if (seek !== null) player.currentTime = seek;
    }
  }, [active, status, player, position, metadata]);
  useLayoutEffect(() => {
    cancelRecovery();
    // On iOS setting rate can start AVPlayer, so only assign it in the play branch.
    const foreground = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    const play = wanted && status !== 'error' && foreground;
    if (play && ended.current) { player.currentTime = 0; ended.current = false; }
    if (play) { startProbe?.select(decoded.current, player.currentTime); startProbe?.command(); }
    const mode = intent.sync(play, boosted ? 2 : rate, !current && prime && foreground && status !== 'error');
    if (mode !== 'warm') { cancelPrimeTimeout(); prewarm.cancel(); refreshInterval(); }
    if (play) sampleStart(); else if (current) cancelSampling();
    if (mode === 'stop' && current) callbacks.current.onTime(id, position.current, player.duration, true);
  }, [id, active, current, wanted, boosted, rate, prime, player, position, status, intent, prewarm, cancelRecovery, cancelPrimeTimeout, startProbe, refreshInterval, sampleStart, cancelSampling]);
  useEffect(() => {
    if (active || !primeAllowed || frame || prewarm.ticket() !== null || status !== 'readyToPlay' || AppState.currentState === 'background' || AppState.currentState === 'inactive') return;
    // Decode a real frame while muted. Hold after ~50ms advance while awaiting
    // the native frame callback; a bounded deadline allows one retry.
    const ticket = prewarm.begin(); if (ticket === null) return;
    updateInterval(1 / 30);
    primeTimeout.current = setTimeout(() => { primeTimeout.current = null; if (finishPrime(ticket)) setPrimeRetry(value => value + 1); }, 1200);
    // Buffering and late sourceLoad events must not cancel a pending warmup.
    // Role changes/unmount cancel it above; a missed first frame retries once.
  }, [active, primeAllowed, status, frame, primeRetry, player, prewarm, finishPrime, updateInterval]);
  useLayoutEffect(() => () => { cancelRecovery(); cancelPrimeTimeout(); prewarm.cancel(); intent.stop(); if (callbacks.current.current) callbacks.current.onTime(id, position.current, 0, true); }, [id, position, intent, prewarm, cancelRecovery, cancelPrimeTimeout]);
  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    cancelRecovery(); if (isPlaying || !callbacks.current.wanted || ended.current) return;
    const ticket = intent.generation();
    recovery.current = setTimeout(() => {
      recovery.current = null;
      if (!callbacks.current.wanted || ended.current || AppState.currentState !== 'active' || player.status !== 'readyToPlay' || player.playing) return;
      if (player.duration > 0 && player.currentTime >= player.duration - 0.05) return;
      intent.recover(ticket);
    }, 100);
  });
  useEventListener(player, 'timeUpdate', event => {
    const sampling = startProbe?.pending(); startProbe?.advance(event.currentTime);
    if (sampling && !startProbe?.pending()) { clearSampleTimeout(); refreshInterval(); }
    if (prewarm.ticket() !== null && !callbacks.current.active && event.currentTime >= 0.05) prewarm.hold();
    if (!callbacks.current.active || !Number.isFinite(event.currentTime)) return;
    position.current = event.currentTime; callbacks.current.onTime(id, event.currentTime, player.duration, false);
  });
  useEventListener(player, 'playToEnd', () => {
    if (callbacks.current.active && callbacks.current.auto) { ended.current = true; cancelRecovery(); intent.stop(); if (!callbacks.current.onEnd()) callbacks.current.onPause(); }
  });
  useEffect(() => { if (status === 'error') callbacks.current.onFailure(); }, [status]);
  useEffect(() => { if (frame && current) callbacks.current.onReady(id); }, [frame, current, id]);
  useEffect(() => {
    if (!wanted || status !== 'loading' && frame) { setWaiting(false); return; }
    const timeout = setTimeout(() => setWaiting(true), 350); return () => clearTimeout(timeout);
  }, [wanted, status, frame]);
  return <>
    <VideoView player={player} nativeControls={false} contentFit={fit} surfaceType="textureView" allowsVideoFrameAnalysis={false} style={[StyleSheet.absoluteFill, styles.surface]}
      onFirstFrameRender={() => { decoded.current = true; probe?.frame(); finishPrime(); setFrame(true); onFrame(); if (callbacks.current.current) callbacks.current.onReady(id); }} />
    {waiting && active && <ActivityIndicator style={styles.wait} color="#fff" />}
  </>;
}
function Picture({ candidates, onLoad }: { candidates: string[]; onLoad?: () => void }) {
  const [candidate, set] = useState(0); const [loaded, setLoaded] = useState(false); const uri = candidates[candidate];
  // A preloaded picture may become current without another native load event.
  useEffect(() => { if (loaded) onLoad?.(); }, [loaded, onLoad]);
  return uri ? <Image source={{ uri, headers: mediaHeaders }} onLoad={() => setLoaded(true)} onError={() => { set(n => n === candidate ? n + 1 : n); }} fadeDuration={0} resizeMode="contain" style={[StyleSheet.absoluteFill, styles.surface]} /> : <View style={[StyleSheet.absoluteFill, styles.placeholder, styles.surface]}><Text style={styles.posterTitle}>图片暂不可用</Text></View>;
}
function PhotoSlot({ index, x, width, current, children }: { index: number; x: SharedValue<number>; width: number; current: boolean; children: React.ReactNode }) {
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: current ? pageTranslation(x.value, index, width) : 0 }] }));
  return <Animated.View style={[StyleSheet.absoluteFill, styles.surface, style]}>{children}</Animated.View>;
}
function Gallery({ id, images, photo, width, x, current, active, retained, paused, boosted, rate, stopClip, onReady, onUnavailable, onPhase }: {
  id: string; images: Extract<MediaResult, { images: unknown }>['images']; photo: number; width: number; x: SharedValue<number>;
  current: boolean; active: boolean; retained: boolean; paused: boolean; boosted: boolean; rate: number; stopClip: RefObject<(() => void) | null>;
  onReady: (id: string) => void; onUnavailable: () => void;
  onPhase: (phase: 'loading' | 'ready' | 'failed') => void;
}) {
  // Keep the previous picture in the prepared album until it becomes current.
  const lastPhoto = useRef(0);
  if (current) lastPhoto.current = Math.max(0, Math.min(images.length - 1, photo));
  const selected = lastPhoto.current;
  const slots = current ? neighborPages(selected, images.length) : [selected];
  return <View style={[StyleSheet.absoluteFill, styles.surface]}>
    {slots.map(index => <PhotoSlot key={index} index={index} x={x} width={width} current={current}>
      <Picture candidates={images[index].candidates} onLoad={current && index === selected ? () => onReady(id) : undefined} />
      {current && index === selected && (active || retained) && images[index].liveCandidates.length > 0 && <LiveClip key={`${id}:${index}`} candidates={images[index].liveCandidates}
        playing repeat paused={!active || paused} rate={boosted ? 2 : rate} stopVideo={stopClip} showDiagnostic={false}
        poster={<Picture candidates={images[index].candidates} />} onUnavailable={onUnavailable} onPhase={onPhase} />}
    </PhotoSlot>)}
  </View>;
}
const styles = StyleSheet.create({ surface: { backgroundColor: '#000', overflow: 'hidden' }, poster: { ...StyleSheet.absoluteFill, backgroundColor: '#000' }, placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 45 }, watermark: { color: '#ffffff20', fontSize: 70 }, posterTitle: { color: '#ffffff66', textAlign: 'center', marginTop: 15 }, wait: { position: 'absolute', top: '48%', alignSelf: 'center', zIndex: 1 } });
