import { useEvent, useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ActivityIndicator, AppState, Image, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { GalleryMusic } from '../GalleryMusic';
import { LiveClip } from '../LiveClip';
import { mediaHeaders, type MediaResult } from '../douyin';
import { forgetMedia, loadMedia, peekMedia } from './media-cache';
import type { Point, Work } from './model';
import { useMobile } from './context';
import { neighborPages, pageTranslation, videoFit, type MediaSize } from './layout';
import { createPlaybackIntent, resumeSeekTarget, type PlaybackHandoff } from './playback';

export type MediaControl = { id: string; retry: () => void; seek: ((seconds: number) => void) | null };
export type MediaInfo = { id: string; work: Work | null; data: MediaResult | null; error: string; photos: number; hasLive: boolean; musicUnavailable: boolean; livePhase: 'none' | 'loading' | 'ready' | 'failed' };
export function Poster({ work, fit = 'contain' }: { work: Pick<Work, 'title' | 'coverUrl' | 'kind'> | null; fit?: 'contain' | 'cover' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [work?.coverUrl]);
  return <View style={styles.poster}>
    {work?.coverUrl && !failed ? <Image source={{ uri: work.coverUrl, headers: mediaHeaders }} onError={() => setFailed(true)} resizeMode={fit} style={StyleSheet.absoluteFill} /> :
      <View style={styles.placeholder}><Text style={styles.watermark}>{work?.kind === 'video' ? '▶' : '▧'}</Text><Text style={styles.posterTitle} numberOfLines={2}>{work?.title || 'MyLike'}</Text></View>}
  </View>;
}
export function MediaSlot({ id, current, active, warm, retained, preserve, paused, boosted, seeking, auto, rate, point, photo, photoX, width, height, allowZoom, revision, control, handoff, onInfo, onTime, onReady, onEnd, onPause }: {
  id: string; current: boolean; active: boolean; warm: boolean; retained: boolean; preserve: boolean; paused: boolean; boosted: boolean; seeking: boolean; auto: boolean; rate: number;
  point: Point | null; photo: number; photoX: SharedValue<number>; width: number; height: number; allowZoom: boolean; revision: number; control: RefObject<MediaControl | null>; handoff: PlaybackHandoff;
  onInfo: (info: MediaInfo) => void; onTime: (id: string, seconds: number, duration: number, force: boolean) => void;
  onReady: (id: string) => void; onEnd: () => boolean; onPause: () => void;
}) {
  const { store } = useMobile(); const { work: readWork } = store; const [work, setWork] = useState<Work | null>(null); const [data, setData] = useState<MediaResult | null>(() => peekMedia(id));
  const [error, setError] = useState(''); const [attempt, setAttempt] = useState(0); const [candidate, setCandidate] = useState(0);
  const [waiting, setWaiting] = useState(false); const [musicUnavailable, setMusicUnavailable] = useState(false); const [liveFailed, setLiveFailed] = useState(false);
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
  const commands = useMemo<MediaControl>(() => ({ id, retry, seek: null }), [id, retry]);
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
  const keepVideo = Boolean(uri) && (needed || preserve && preparedVideo.current);
  useLayoutEffect(() => { preparedVideo.current = keepVideo; }, [keepVideo]);
  useLayoutEffect(() => {
    onInfo({ id, work, data, error: failure, photos: album?.images.length ?? 1, hasLive: Boolean(frame?.liveCandidates.length) && !liveFailed, musicUnavailable, livePhase });
  }, [current, id, work, data, failure, album, frame, liveFailed, musicUnavailable, livePhase, onInfo]);
  useEffect(() => { if (current && failure) onReady(id); }, [current, failure, id, onReady]);
  const clipFailed = useCallback(() => setLiveFailed(true), []);
  const musicFailed = useCallback(() => setMusicUnavailable(true), []);
  return <View style={[StyleSheet.absoluteFill, styles.surface]}>
    {!album && !keepVideo && <Poster work={work} fit={videoFit(width, height, size, allowZoom)} />}
    {uri && keepVideo && <Video key={uri} id={id} uri={uri} current={current} active={active} prime={warm && !current} paused={paused} boosted={boosted} seeking={seeking} rate={rate} auto={auto} poster={work}
      width={width} height={height} sourceSize={size} allowZoom={allowZoom} position={lastTime} control={localControl} handoff={handoff} onTime={onTime} onReady={onReady} onEnd={onEnd} onPause={onPause} onFailure={() => { if (!currentRole.current) preloadFailed.current = true; setCandidate(n => n === candidate ? n + 1 : n); }} />}
    {album && <Gallery id={id} images={album.images} photo={photo} width={width} x={photoX} current={current} active={active} retained={retained}
      paused={paused} boosted={boosted} rate={rate} stopClip={stopClip} onReady={onReady} onUnavailable={clipFailed} onPhase={setLivePhase} />}
    {album && current && needed && album.musicCandidates.length > 0 && <GalleryMusic key={id} candidates={album.musicCandidates} enabled={active && !paused} stopMusic={stopMusic} onUnavailable={musicFailed} />}
    {waiting && current && active && <ActivityIndicator color="#fff" style={styles.wait} />}
  </View>;
}
function Video({ id, uri, current, active, prime, paused, boosted, seeking, rate, auto, poster, width, height, sourceSize, allowZoom, position, control, handoff, onTime, onReady, onEnd, onPause, onFailure }: {
  id: string; uri: string; current: boolean; active: boolean; prime: boolean; paused: boolean; boosted: boolean; seeking: boolean; rate: number; auto: boolean; poster: Work | null;
  width: number; height: number; sourceSize?: MediaSize; allowZoom: boolean; position: RefObject<number>; control: RefObject<MediaControl | null>; handoff: PlaybackHandoff; onTime: (id: string, seconds: number, duration: number, force: boolean) => void;
  onReady: (id: string) => void; onEnd: () => boolean; onPause: () => void; onFailure: () => void;
}) {
  const source = useMemo(() => ({ uri, headers: mediaHeaders }), [uri]);
  const player = useVideoPlayer(source, value => { value.staysActiveInBackground = false; value.muted = true; value.timeUpdateEventInterval = 0.5; value.bufferOptions = { preferredForwardBufferDuration: 3 }; });
  const intent = useMemo(() => createPlaybackIntent(player, handoff), [player, handoff]);
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const metadata = useEvent(player, 'sourceLoad');
  const track = useEvent(player, 'videoTrackChange', { videoTrack: player.videoTrack });
  // Detail dimensions describe display orientation; native tracks can report coded orientation.
  const size = sourceSize ?? track.videoTrack?.size ?? metadata?.availableVideoTracks[0]?.size;
  const fit = videoFit(width, height, size, allowZoom);
  const [frame, setFrame] = useState(false); const [waiting, setWaiting] = useState(false); const restored = useRef(false);
  const ended = useRef(false);
  const primeTicket = useRef<number | null>(null); const primed = useRef(false);
  const recovery = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wanted = active && !paused && !seeking;
  const callbacks = useRef({ onTime, onReady, onEnd, onPause, onFailure, active, current, auto, wanted }); callbacks.current = { onTime, onReady, onEnd, onPause, onFailure, active, current, auto, wanted };
  const finishPrime = useCallback((ticket = primeTicket.current) => {
    if (ticket === null || primeTicket.current !== ticket) return; primeTicket.current = null;
    if (intent.finishPrime(ticket)) { primed.current = true; player.timeUpdateEventInterval = 0.5; }
  }, [player, intent]);
  const cancelRecovery = useCallback(() => { if (recovery.current !== null) clearTimeout(recovery.current); recovery.current = null; }, []);
  useLayoutEffect(() => {
    if (!active || !current || control.current?.id !== id) return;
    const seek = (seconds: number) => {
      const limit = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : seconds;
      player.currentTime = Math.max(0, Math.min(limit, seconds)); position.current = player.currentTime;
      callbacks.current.onTime(id, player.currentTime, player.duration, true);
    };
    control.current.seek = seek;
    return () => { if (control.current?.seek === seek) control.current.seek = null; };
  }, [id, active, current, control, player, position]);
  useLayoutEffect(() => {
    player.loop = !auto;
    cancelRecovery(); primeTicket.current = null; player.timeUpdateEventInterval = 0.5;
    if (active && status === 'readyToPlay' && player.duration > 0 && !restored.current) {
      restored.current = true; const seek = resumeSeekTarget(position.current, player.currentTime, player.duration); if (seek !== null) player.currentTime = seek;
    }
    // On iOS setting rate can start AVPlayer, so only assign it in the play branch.
    if (wanted && status !== 'error' && AppState.currentState !== 'background' && AppState.currentState !== 'inactive') { if (ended.current) { player.currentTime = 0; ended.current = false; } intent.play(boosted ? 2 : rate); }
    else { intent.stop(); if (current) callbacks.current.onTime(id, position.current, player.duration, true); }
  }, [id, active, current, wanted, boosted, rate, auto, player, position, status, metadata, intent, cancelRecovery]);
  useEffect(() => {
    if (active || !prime || frame || primed.current || status !== 'readyToPlay' || AppState.currentState === 'background' || AppState.currentState === 'inactive') return;
    // Decode a real frame while muted. Stop at the first frame, ~50ms advance,
    // or the short deadline; no history/progress is recorded for this branch.
    const ticket = intent.beginPrime(); if (ticket === null) return;
    primeTicket.current = ticket; player.timeUpdateEventInterval = 1 / 30; const timer = setTimeout(() => finishPrime(ticket), 180);
    return () => { clearTimeout(timer); finishPrime(ticket); };
  }, [active, prime, status, frame, player, intent, finishPrime]);
  useLayoutEffect(() => () => { cancelRecovery(); intent.stop(); if (callbacks.current.current) callbacks.current.onTime(id, position.current, 0, true); }, [id, position, intent, cancelRecovery]);
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
    if (primeTicket.current !== null && !callbacks.current.active && event.currentTime >= 0.05) finishPrime();
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
      onFirstFrameRender={() => { finishPrime(); setFrame(true); if (callbacks.current.current) callbacks.current.onReady(id); }} />
    {!frame && <Poster work={poster} fit={fit} />}
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
  // The outgoing album is still visible during the snap. Keep its last picture
  // rather than replacing it with the first picture as soon as ownership moves.
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
const styles = StyleSheet.create({ surface: { backgroundColor: '#000', overflow: 'hidden' }, poster: { ...StyleSheet.absoluteFill, backgroundColor: '#000' }, placeholder: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 45 }, watermark: { color: '#ffffff20', fontSize: 70 }, posterTitle: { color: '#ffffff66', textAlign: 'center', marginTop: 15 }, wait: { position: 'absolute', top: '48%', alignSelf: 'center' } });
