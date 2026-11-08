import { useEvent, useEventListener } from 'expo';
import { File, Paths } from 'expo-file-system';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { mediaHeaders, redactMediaUrls } from './douyin';

type StopVideo = RefObject<(() => void) | null>;
const maxClipBytes = 16 * 1024 * 1024;
let downloadNumber = 0;

export function LiveClip({ candidates, playing, stopVideo, showDiagnostic, repeat, paused, rate }: {
  candidates: string[]; playing: boolean; stopVideo: StopVideo; showDiagnostic: boolean; repeat: boolean; paused: boolean; rate: number;
}) {
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  if (!candidates.length) return showDiagnostic ? <Diagnostic>本页未取得实况片段</Diagnostic> : null;
  if (!playing) return showDiagnostic ? <Diagnostic>{`本页 ${candidates.length} 个地址 · 点按试播`}</Diagnostic> : null;
  const uri = candidates[attempt];
  if (!uri) return showDiagnostic ? <Diagnostic>{`试播失败 · ${error} · 长按可重新取链`}</Diagnostic> : null;
  return <PreparedClip key={attempt} uri={uri} address={`地址 ${attempt + 1}/${candidates.length}`} stopVideo={stopVideo}
    showDiagnostic={showDiagnostic} repeat={repeat} paused={paused} rate={rate}
    onFailure={(message) => {
      setError(message);
      setAttempt((current) => current === attempt ? current + 1 : current);
    }} />;
}

type ClipProps = {
  uri: string; address: string; stopVideo: StopVideo; onFailure: (message: string) => void; showDiagnostic: boolean;
  repeat: boolean; paused: boolean; rate: number;
};

function PreparedClip({ uri, address, stopVideo, onFailure, showDiagnostic, repeat, paused, rate }: ClipProps) {
  const [localUri, setLocalUri] = useState<string>();
  const [cancelled, setCancelled] = useState(false);
  const failure = useRef(onFailure);
  failure.current = onFailure;

  useEffect(() => {
    const file = new File(Paths.cache, `mylike-live-test-${Date.now()}-${++downloadNumber}.mp4`);
    const controller = new AbortController();
    let active = true;
    let error = '';
    function remove() {
      try { if (file.exists) file.delete(); } catch { /* The cache can be reclaimed by iOS. */ }
    }
    const stop = () => {
      active = false;
      controller.abort();
      setCancelled(true);
    };
    stopVideo.current = stop;
    const appState = AppState.addEventListener('change', (state) => {
      if (!repeat && state !== 'active' && stopVideo.current === stop) stop();
    });
    const timeout = setTimeout(() => {
      error = '下载实况片段超时';
      controller.abort();
    }, 12_000);
    void File.downloadFileAsync(uri, file, {
      headers: mediaHeaders,
      signal: controller.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (Math.max(bytesWritten, totalBytes) > maxClipBytes) {
          error = '实况片段超过 16 MiB';
          controller.abort();
        }
      },
    }).then((download) => {
      if (!active) {
        remove();
        return;
      }
      if (error || !download.size || download.size > maxClipBytes)
        throw new Error(error || '实况片段为空或超过 16 MiB');
      setLocalUri(download.uri);
    }).catch((cause) => {
      remove();
      if (active) failure.current(error || redactMediaUrls(cause instanceof Error ? cause.message : '片段下载失败'));
    }).finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
      appState.remove();
      if (stopVideo.current === stop) stopVideo.current = null;
      remove();
    };
  }, [uri, stopVideo, repeat]);

  if (localUri && !cancelled) {
    return <Clip uri={localUri} address={address} stopVideo={stopVideo} onFailure={onFailure}
      showDiagnostic={showDiagnostic} repeat={repeat} paused={paused} rate={rate} />;
  }
  return showDiagnostic ? <Diagnostic>{cancelled ? '已停止 · 点按重播' : `正在准备实况片段 · ${address}`}</Diagnostic> : null;
}

function Clip({ uri, address, stopVideo, onFailure, showDiagnostic, repeat, paused, rate }: ClipProps) {
  const source = useMemo(() => ({ uri, contentType: 'progressive' as const }), [uri]);
  const player = useVideoPlayer(source, (instance) => {
    instance.timeUpdateEventInterval = 0.2;
    instance.staysActiveInBackground = false;
    instance.loop = repeat;
    if (repeat) instance.audioMixingMode = 'mixWithOthers';
    if (!paused && isForeground()) {
      instance.playbackRate = rate;
      instance.play();
    }
  });
  const { status, error } = useEvent(player, 'statusChange', { status: player.status });
  const metadata = useEvent(player, 'sourceLoad');
  const [frame, setFrame] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [foreground, setForeground] = useState(isForeground);
  const [outcome, setOutcome] = useState<'stopped' | 'ended' | null>(null);
  const stopped = useRef(false);
  const failure = useRef(onFailure);
  failure.current = onFailure;

  const stop = useCallback(() => {
    if (stopped.current) return;
    stopped.current = true;
    player.pause();
    setOutcome('stopped');
  }, [player]);
  useLayoutEffect(() => {
    stopVideo.current = stop;
    return () => { if (stopVideo.current === stop) stopVideo.current = null; };
  }, [stop, stopVideo]);
  useEffect(() => {
    if (!repeat && !isForeground()) stop();
    const subscription = AppState.addEventListener('change', (state) => {
      if (!repeat && state !== 'active') {
        stop();
        return;
      }
      if (state !== 'active' && !stopped.current) player.pause();
      setForeground(state === 'active');
    });
    return () => subscription.remove();
  }, [player, repeat, stop]);
  useEffect(() => {
    if (stopped.current) return;
    if (paused || !foreground || !isForeground()) {
      player.pause();
      return;
    }
    player.playbackRate = rate;
    if (!player.playing) player.play();
  }, [paused, foreground, player, rate]);
  useEffect(() => {
    if (stopped.current || status !== 'error') return;
    stop();
    failure.current(redactMediaUrls(error?.message || '播放器报错'));
  }, [status, error?.message, stop]);

  useEffect(() => {
    if (outcome || paused || !foreground) return;
    const timeout = setTimeout(() => {
      if (stopped.current) return;
      stop();
      failure.current(frame ? '播放进度停滞' : '8 秒内未显示首帧');
    }, 8_000);
    return () => clearTimeout(timeout);
  }, [outcome, paused, foreground, frame, seconds, stop]);

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (!stopped.current && Number.isFinite(currentTime)) setSeconds(currentTime);
  });
  useEventListener(player, 'playToEnd', () => {
    if (repeat || stopped.current) return;
    stopped.current = true;
    const currentTime = player.currentTime;
    if (Number.isFinite(currentTime)) setSeconds((previous) => Math.max(previous, currentTime));
    setOutcome('ended');
  });

  const phase = outcome === 'ended' ? '已播完 · 点按重播' : outcome === 'stopped' ? '已停止 · 点按重播' : frame ? '正在试播' : '等待画面';
  return (
    <>
      {!outcome && <VideoView player={player} nativeControls={false} contentFit="contain" surfaceType="textureView"
        allowsVideoFrameAnalysis={false} style={StyleSheet.absoluteFill}
        onFirstFrameRender={() => {
          if (stopped.current) return;
          setFrame(true);
          if (!paused && foreground && !player.playing) player.play();
        }} />}
      {showDiagnostic && <Diagnostic>
        {`${phase} · ${address}\n${frame ? '已显示首帧' : '尚无首帧'} · 进度 ${seconds.toFixed(2)} 秒`}
        {metadata ? ` · 音轨 ${metadata.availableAudioTracks.length}` : ''}
      </Diagnostic>}
    </>
  );
}

function isForeground() {
  return AppState.currentState !== 'inactive' && AppState.currentState !== 'background';
}

function Diagnostic({ children }: { children: ReactNode }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', top: 18, left: 14, right: 14, padding: 9, borderRadius: 8, backgroundColor: '#202025ee' },
  text: { color: '#fff', fontSize: 13, lineHeight: 19 },
});
