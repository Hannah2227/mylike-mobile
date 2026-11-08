import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Animated, Easing, FlatList, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { mediaHeaders, redactMediaUrls, resolveMedia, type MediaResult } from './douyin';
import { readLibraryWork, type ReviewPoint } from './library-store';
import type { LibraryWork } from './library-format';
import { GalleryFrame, GestureSurface, MediaMessage, PlaybackIndicator, ReviewVideo } from './ReviewMedia';
import { LiveClip } from './LiveClip';
import { GalleryMusic } from './GalleryMusic';
import { ReviewChrome } from './ReviewChrome';
import type { ReviewSelection } from './use-review';
import { workOffset, workSwipeStep } from './swipe';

const mediaCache = new Map<string, { result: MediaResult; expires: number }>();
const rates = [0.75, 1, 1.25, 1.5, 2];
const queueRowHeight = 54;

function cachedMedia(id: string) {
  const entry = mediaCache.get(id);
  return entry && entry.expires > Date.now() ? entry.result : null;
}

function useLibraryWork(id: string) {
  const [work, setWork] = useState<LibraryWork | null>(null);
  useEffect(() => {
    let current = true;
    void readLibraryWork(id).then((result) => { if (current) setWork(result); }).catch(() => undefined);
    return () => { current = false; };
  }, [id]);
  return work;
}

type ReviewProps = {
  selection: ReviewSelection;
  stopPlayback: RefObject<(() => void) | null>;
  move: (index: number, key: number) => boolean;
  checkpoint: (key: number, point: ReviewPoint, force: boolean) => void;
  clear: boolean;
  setClear: (value: boolean) => void;
  auto: boolean;
  setAuto: (value: boolean) => void;
  rate: number;
  setRate: (value: number) => void;
  saveError: string;
  onLibrary: () => void;
  reshuffle: (key: number) => void;
};

type LiveTestOptions = { active: boolean; toggle: () => void; refresh: () => void };
type WorkPager = {
  onWork: (step: number) => boolean;
  onWorkDrag: (offset: number) => void;
  onWorkRelease: (offset: number, velocity: number) => void;
};

function ReviewPoster({ work }: { work: LibraryWork | null }) {
  if (!work) return null;
  return (
    <>
      {work.title ? <View style={styles.poster}><Text numberOfLines={2} style={styles.posterTitle}>{work.title}</Text></View> : null}
      {work.coverUrl && (
        <Image source={{ uri: work.coverUrl, headers: mediaHeaders }} resizeMode="contain" style={StyleSheet.absoluteFill} />
      )}
    </>
  );
}

type WorkSlotProps = ReviewProps & {
  pager: WorkPager;
  active: boolean; onReady: (key: number) => void; optionsOpen: boolean; onHold: (live?: LiveTestOptions) => void;
};

function WorkSlot({ warm, ...props }: WorkSlotProps & { warm: boolean }) {
  const { queue, index } = props.selection;
  const work = useLibraryWork(queue.ids[index]);
  return props.active || warm ? <ReviewItem {...props} work={work} /> : <ReviewPoster work={work} />;
}

function PositionedSlot({ slot, height, offset, active, settling, children }: {
  slot: number; height: number; offset: Animated.Value; active: boolean; settling: boolean; children: ReactNode;
}) {
  const translateY = useMemo(() => Animated.add(offset, -workOffset(slot, height)), [offset, slot, height]);
  return (
    <Animated.View style={[styles.slot, { transform: [{ translateY }] }]}
      pointerEvents={active && !settling ? 'auto' : 'none'} accessibilityElementsHidden={!active}>
      {children}
    </Animated.View>
  );
}

function ReviewItem({ selection, stopPlayback, checkpoint, clear, auto, rate, active, pager, onLibrary, onReady, optionsOpen, onHold, work }: WorkSlotProps & {
  work: LibraryWork | null;
}) {
  const { queue, index, key, point } = selection;
  const id = queue.ids[index];
  const [result, setResult] = useState(() => cachedMedia(id));
  const [error, setError] = useState('');
  const [waitingDetails, setWaitingDetails] = useState(false);
  const [request, setRequest] = useState(0);
  const [candidate, setCandidate] = useState(0);
  const [page, setPage] = useState(point?.kind === 'gallery' ? Math.floor(point.value) : 0);
  const [testingLive, setTestingLive] = useState(false);
  const [liveTrial, setLiveTrial] = useState(0);
  const [galleryPaused, setGalleryPaused] = useState(false);
  const [galleryBoosted, setGalleryBoosted] = useState(false);
  const [musicUnavailable, setMusicUnavailable] = useState(false);
  const stopMusic = useRef<(() => void) | null>(null);
  const stopClip = useRef<(() => void) | null>(null);
  const position = useRef(point?.kind === 'video' ? point.value : 0);
  const paused = useRef(false);
  const visible = useRef(active);
  visible.current = active;
  const preloadFailed = useRef(false);
  const markReady = useCallback(() => { if (active) onReady(key); }, [active, key, onReady]);

  useEffect(() => {
    const cached = cachedMedia(id);
    if (cached) {
      setResult(cached);
      return;
    }
    const controller = new AbortController();
    void resolveMedia(id, controller.signal).then((media) => {
      if (controller.signal.aborted) return;
      if (mediaCache.size >= 8) {
        const oldest = mediaCache.keys().next().value;
        if (oldest) mediaCache.delete(oldest);
      }
      mediaCache.set(id, { result: media, expires: Date.now() + 120_000 });
      setResult(media);
    }).catch((failure) => {
      if (controller.signal.aborted) return;
      if (!visible.current) {
        preloadFailed.current = true;
        return;
      }
      setError(failure instanceof Error ? redactMediaUrls(failure.message) : '暂时无法取得作品详情。');
    });
    return () => controller.abort();
  }, [id, request]);
  useEffect(() => {
    if (!active || !preloadFailed.current) return;
    preloadFailed.current = false;
    setRequest((value) => value + 1);
  }, [active]);
  useEffect(() => {
    if (!active || result || error) {
      setWaitingDetails(false);
      return;
    }
    const timer = setTimeout(() => setWaitingDetails(true), 350);
    return () => clearTimeout(timer);
  }, [active, result, error, request]);

  const album = result && 'images' in result ? result : null;
  const gallery = album?.images ?? null;
  const music = album?.musicCandidates;
  useLayoutEffect(() => {
    if (!active || !album) return;
    const stop = () => {
      stopClip.current?.();
      stopMusic.current?.();
    };
    stopPlayback.current = stop;
    return () => { if (stopPlayback.current === stop) stopPlayback.current = null; };
  }, [active, album, stopPlayback]);

  const galleryIndex = gallery ? Math.min(gallery.length - 1, page) : 0;
  const frame = gallery?.[galleryIndex];
  const liveCount = gallery?.filter((image) => image.liveCandidates.length).length ?? 0;
  const hasLiveTest = testingLive || Boolean(gallery && (liveCount || work?.kind === 'live-gallery'));
  const urls = result && 'candidates' in result ? result.candidates : null;
  const uri = testingLive ? undefined : urls?.[candidate];
  useEffect(() => {
    if (error || (urls && !uri && !testingLive)) markReady();
  }, [error, urls, uri, testingLive, markReady]);
  const videoError = testingLive ? '本次详情未返回图集' : '视频地址暂时无法播放';
  const resetLiveTrial = () => {
    stopClip.current?.();
    setLiveTrial(0);
    setGalleryBoosted(false);
  };
  const retry = () => {
    resetLiveTrial();
    stopMusic.current?.();
    setMusicUnavailable(false);
    mediaCache.delete(id);
    setResult(null);
    setError('');
    setCandidate(0);
    setRequest((value) => value + 1);
  };
  const canPlayClip = Boolean(frame?.liveCandidates.length);
  const canTapGallery = testingLive ? canPlayClip : canPlayClip || Boolean(music?.length);
  function tapGallery() {
    if (testingLive) {
      stopClip.current?.();
      setLiveTrial((value) => value + 1);
      return;
    }
    if (musicUnavailable && !canPlayClip) {
      retry();
      return;
    }
    if (!galleryPaused) stopMusic.current?.();
    setGalleryPaused(!galleryPaused);
  }
  const surface = {
    ...pager,
    onLibrary,
    gallery: Boolean(album || (!result && work && work.kind !== 'video')),
    onPage: gallery ? (step: number) => {
      const next = Math.max(0, Math.min(gallery.length - 1, galleryIndex + step));
      if (next === galleryIndex) return;
      resetLiveTrial();
      setPage(next);
      checkpoint(key, { kind: 'gallery', value: next }, true);
    } : undefined,
    onBoost: canPlayClip && !testingLive ? setGalleryBoosted : undefined,
    onHold: () => onHold(hasLiveTest ? {
      active: testingLive,
      toggle: () => {
        resetLiveTrial();
        if (!testingLive) stopMusic.current?.();
        setTestingLive(!testingLive);
      },
      refresh: retry,
    } : undefined),
    disabled: !active || optionsOpen,
  };
  const live = liveCount > 0 || work?.kind === 'live-gallery';
  const captionNote = testingLive ? '实况试播' :
    musicUnavailable ? (canPlayClip ? '配乐暂不可用' : '配乐失败，点按重试') : undefined;
  const poster = <ReviewPoster work={work} />;
  return (
    <View style={[styles.work, album && !clear && styles.album]} accessibilityElementsHidden={optionsOpen}>
      {active && music && music.length > 0 && <GalleryMusic candidates={music}
        enabled={!galleryPaused && !testingLive} stopMusic={stopMusic} onUnavailable={() => setMusicUnavailable(true)} />}
      {uri ? (
        <ReviewVideo key={candidate} uri={uri} poster={poster} active={active} position={position} paused={paused} surface={surface}
          clear={clear} rate={rate} auto={auto} stopVideo={stopPlayback}
          onReady={markReady}
          reportPoint={(value, force) => checkpoint(key, { kind: 'video', value }, force)}
          onEnd={() => pager.onWork(1)}
          onFailure={() => {
            mediaCache.delete(id);
            setCandidate((current) => current === candidate ? current + 1 : current);
          }} />
      ) : frame ? (
        <GalleryFrame key={galleryIndex} candidates={frame.candidates} surface={surface} retry={retry} poster={poster}
          onReady={markReady}
          hideImageStatus={!active || (testingLive && liveTrial > 0)}
          tapLabel={testingLive ? '试播当前页的实况片段' : '播放或暂停图集'}
          onTap={canTapGallery ? tapGallery : undefined}>
          {active && (testingLive || canPlayClip) && <LiveClip key={testingLive ? `test-${liveTrial}` : 'live'}
            candidates={frame.liveCandidates} playing={!testingLive || liveTrial > 0}
            repeat={!testingLive} paused={!testingLive && galleryPaused && !galleryBoosted}
            rate={galleryBoosted ? 2 : 1} stopVideo={stopClip}
            showDiagnostic={testingLive && !clear} />}
        </GalleryFrame>
      ) : (
        <>
          <GestureSurface {...surface}>{poster}</GestureSurface>
          {active && (error || urls || waitingDetails) && <MediaMessage message={error || (urls ? videoError : '正在取得作品详情…')}
            loading={!error && !urls} retry={error || urls ? retry : undefined} />}
        </>
      )}
      {active && !clear && album && <PlaybackIndicator paused={galleryPaused && !testingLive} boosted={galleryBoosted} />}
      {active && !clear && <ReviewChrome author={result?.author || work?.author || '未知作者'}
        title={work?.title || result?.title || '抖音作品'} page={galleryIndex} pages={gallery?.length ?? 0}
        gallery={Boolean(gallery) || Boolean(work && work.kind !== 'video')}
        live={live} note={captionNote} />}
    </View>
  );
}

function Option({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress} style={[styles.option, selected && styles.optionOn]}>
      <Text style={styles.optionText}>{label}</Text>
    </Pressable>
  );
}

function QueueRow({ id, index, selected, onPress }: { id: string; index: number; selected: boolean; onPress: () => void }) {
  const work = useLibraryWork(id);
  return (
    <Pressable style={[styles.queueRow, selected && styles.optionOn]} onPress={onPress}
      accessibilityRole="button" accessibilityState={{ selected }}>
      <Text style={styles.note}>{index + 1}</Text>
      <Text numberOfLines={1} style={styles.queueTitle}>{work?.title || work?.author || '抖音作品'}</Text>
      {selected && <Text style={styles.note}>当前</Text>}
    </Pressable>
  );
}

export default function ReviewScreen(props: ReviewProps) {
  const { selection, clear, setClear, saveError, move, reshuffle, auto, setAuto, rate, setRate } = props;
  const { queue, index, key } = selection;
  const [openPanel, setPanel] = useState<{ kind: 'options' | 'queue'; key: number; live?: LiveTestOptions } | null>(null);
  const [readyKey, setReadyKey] = useState<number>();
  const [height, setHeight] = useState(0);
  const [settling, setSettling] = useState(false);
  const [offset] = useState(() => new Animated.Value(0));
  const motion = useRef({ version: 0, position: 0, dragging: false, settling: false });
  const dragFrame = useRef<number | null>(null);
  const anchor = workOffset(index, height);
  const panel = openPanel?.key === key ? openPanel : null;
  const slots = height ? [index - 1, index, index + 1].filter((slot) => Boolean(queue.ids[slot])) : [index];

  useLayoutEffect(() => {
    // Keep the exact snapped native offset when selection commits. Slot coordinates do not move.
    const pendingDrag = dragFrame.current !== null;
    if (dragFrame.current !== null) {
      cancelAnimationFrame(dragFrame.current);
      dragFrame.current = null;
    }
    if (pendingDrag || motion.current.position !== anchor) {
      offset.stopAnimation();
      offset.setValue(anchor);
    }
    motion.current = { version: motion.current.version + 1, position: anchor, dragging: false, settling: false };
    setSettling(false);
  }, [anchor, key, offset]);
  useLayoutEffect(() => () => {
    motion.current.version++;
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
    offset.stopAnimation();
  }, [offset]);

  function settle(step: number) {
    if (!height) {
      if (step) move(index + step, key);
      return;
    }
    if (dragFrame.current !== null) {
      cancelAnimationFrame(dragFrame.current);
      dragFrame.current = null;
      offset.setValue(motion.current.position);
    }
    const target = workOffset(index + step, height);
    const remaining = Math.abs(target - motion.current.position);
    if (!step && !remaining) return;
    const version = ++motion.current.version;
    motion.current.settling = true;
    setSettling(true);
    Animated.timing(offset, {
      toValue: target, duration: Math.round(105 + 80 * Math.min(1, remaining / height)),
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start(({ finished }) => {
      if (motion.current.version !== version) return;
      motion.current.position = finished ? target : anchor;
      if (finished && step && move(index + step, key)) return;
      motion.current.position = anchor;
      offset.setValue(anchor);
      motion.current.settling = false;
      setSettling(false);
    });
  }

  const pager: WorkPager = {
    onWork(step) {
      if (motion.current.dragging || motion.current.settling || !queue.ids[index + step]) return false;
      settle(step);
      return true;
    },
    onWorkDrag(distance) {
      if (!height || motion.current.settling) return;
      motion.current.dragging = true;
      const neighbor = queue.ids[index + (distance < 0 ? 1 : -1)];
      const clamped = Math.max(-height, Math.min(height, distance));
      motion.current.position = anchor + (neighbor ? clamped : clamped * 0.22);
      dragFrame.current ??= requestAnimationFrame(() => {
        dragFrame.current = null;
        offset.setValue(motion.current.position);
      });
    },
    onWorkRelease(distance, velocity) {
      motion.current.dragging = false;
      if (motion.current.settling) return;
      const step = workSwipeStep(distance, velocity, height);
      settle(queue.ids[index + step] ? step : 0);
    },
  };

  return (
    <SafeAreaView edges={clear ? [] : ['top', 'left', 'right', 'bottom']} style={styles.screen}>
      <View style={styles.work} onLayout={({ nativeEvent }) => setHeight(nativeEvent.layout.height)}>
        {slots.map((slot) => {
          const active = slot === index;
          const warm = slot === index + 1 && readyKey === key;
          return (
            <PositionedSlot key={queue.ids[slot]} slot={slot} height={height} offset={offset} active={active} settling={settling}>
              <WorkSlot {...props} selection={active ? selection : { ...selection, index: slot, point: null }}
                active={active} warm={warm} pager={pager} onReady={setReadyKey} optionsOpen={active && (panel !== null || settling)}
                onHold={(live) => setPanel({ kind: 'options', key, live })} />
            </PositionedSlot>
          );
        })}
      </View>
      {saveError && !clear ? <Text style={styles.saveError} pointerEvents="none">{saveError}</Text> : null}
      <Modal transparent visible={panel !== null} animationType="fade" onRequestClose={() => setPanel(null)}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="关闭播放选项"
            onPress={() => setPanel(null)} />
          <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.sheet} accessibilityViewIsModal>
            {panel?.kind === 'queue' ? (
              <>
                <View style={styles.sheetHeading}>
                  <Text style={styles.sheetTitle}>{queue.mode === 'shuffle' ? '随机队列' : '回看队列'} · {queue.ids.length} 条</Text>
                  <Option label="返回" onPress={() => setPanel({ ...panel, kind: 'options' })} />
                </View>
                <FlatList data={queue.ids} keyExtractor={(id) => id} initialScrollIndex={Math.max(0, index - 2)}
                  getItemLayout={(_, row) => ({ index: row, length: queueRowHeight, offset: row * queueRowHeight })}
                  style={styles.queue} initialNumToRender={10} windowSize={3} extraData={index}
                  renderItem={({ item, index: row }) => <QueueRow id={item} index={row} selected={index === row}
                    onPress={() => { move(row, key); setPanel(null); }} />} />
              </>
            ) : (
              <>
                <Text style={styles.sheetTitle}>播放选项</Text>
                <View style={styles.optionRow}>
                  <Option label={auto ? '自动连播 · 开' : '自动连播 · 关'} selected={auto} onPress={() => setAuto(!auto)} />
                  <Option label={clear ? '退出清屏' : '清屏'} selected={clear}
                    onPress={() => { setClear(!clear); setPanel(null); }} />
                  <Option label="队列" onPress={() => setPanel({ kind: 'queue', key, live: panel?.live })} />
                  {queue.ids.length > 1 && <Option label={queue.mode === 'shuffle' ? '重新随机' : '随机播放'} onPress={() => {
                    reshuffle(key);
                    setPanel(null);
                  }} />}
                  {panel?.live && <Option label={panel.live.active ? '退出实况试播' : '实况试播'}
                    selected={panel.live.active}
                    onPress={() => {
                      if (!panel.live?.active) setClear(false);
                      panel.live?.toggle();
                      setPanel(null);
                    }} />}
                  {panel?.live?.active && <Option label="重新取链" onPress={() => {
                    panel.live?.refresh();
                    setPanel(null);
                  }} />}
                </View>
                <Text style={styles.note}>视频倍速</Text>
                <View style={styles.optionRow}>
                  {rates.map((value) => <Option key={value} label={`${value}×`} selected={value === rate}
                    onPress={() => setRate(value)} />)}
                </View>
              </>
            )}
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  work: { flex: 1, overflow: 'hidden', backgroundColor: '#000' },
  slot: { ...StyleSheet.absoluteFill, backgroundColor: '#000', overflow: 'hidden' },
  poster: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 28 },
  posterTitle: { color: '#ccc', fontSize: 15, textAlign: 'center' },
  album: { backgroundColor: '#2d2823' },
  note: { color: '#c4c4c8', fontSize: 13 },
  saveError: { position: 'absolute', left: 14, right: 14, top: 70, color: '#ffd0c4' },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0007' },
  sheet: { backgroundColor: '#1a1a1d', padding: 16, paddingTop: 18, borderTopLeftRadius: 22, borderTopRightRadius: 22, gap: 12 },
  sheetHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sheetTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { minHeight: 44, borderRadius: 10, backgroundColor: '#343438', paddingHorizontal: 12, justifyContent: 'center' },
  optionOn: { backgroundColor: '#505057' },
  optionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  queue: { maxHeight: queueRowHeight * 6 },
  queueRow: { height: queueRowHeight, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 12, borderRadius: 6 },
  queueTitle: { flex: 1, color: '#fff', fontSize: 14 },
});
