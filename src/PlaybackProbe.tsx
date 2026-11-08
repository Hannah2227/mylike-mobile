import { useEvent, useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { mediaHeaders, redactMediaUrls, resolveVideo, SAMPLE_ID } from './douyin';
import type { VideoResult } from './douyin';

function Action({ label, onPress, disabled = false, primary = false }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, primary && styles.primary, (pressed || disabled) && styles.dimmed]}
    >
      <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
    </Pressable>
  );
}

function Player({ uri, report }: { uri: string; report: (message: string) => void }) {
  const source = useMemo(() => ({ uri, headers: mediaHeaders, contentType: 'auto' as const }), [uri]);
  const player = useVideoPlayer(source, (instance) => {
    instance.timeUpdateEventInterval = 0.5;
    instance.loop = true;
    instance.play();
  });
  const { status, error } = useEvent(player, 'statusChange', { status: player.status });
  const [frame, setFrame] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [slow, setSlow] = useState(false);
  const frameSeen = useRef(false);
  const timeSeen = useRef(false);

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (currentTime < 0.25 || timeSeen.current) return;
    timeSeen.current = true;
    setAdvanced(true);
    report(`播放：进度已到 ${currentTime.toFixed(1)} 秒`);
  });

  useEffect(() => {
    if (status !== 'error') return;
    report(`播放失败：${redactMediaUrls(error?.message ?? '播放器未返回详细错误')}`);
  }, [status, error?.message, report]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (frameSeen.current || player.status === 'error') return;
      setSlow(true);
      report('播放：15 秒内未收到首帧，可试备用地址');
    }, 15_000);
    return () => clearTimeout(timer);
  }, [player, report]);

  return (
    <View style={styles.playerArea}>
      <VideoView
        player={player}
        style={styles.video}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        onFirstFrameRender={() => {
          if (frameSeen.current) return;
          frameSeen.current = true;
          setFrame(true);
          report('播放：已显示首帧');
        }}
      />
      <Text style={[styles.note, status === 'error' && styles.error]}>
        {status === 'error'
          ? '播放器报错，请查看诊断或试备用地址。'
          : frame && advanced ? '已显示首帧，播放进度已推进。'
          : frame ? '已显示首帧，等待播放进度。'
          : slow ? '等待首帧超时，可试备用地址。'
          : '已取得地址，等待播放器显示首帧…'}
      </Text>
    </View>
  );
}

export default function PlaybackProbe({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [result, setResult] = useState<VideoResult | null>(null);
  const [candidate, setCandidate] = useState(0);
  const pending = useRef(false);
  const report = useCallback((message: string) => {
    setLines((previous) => [...previous, message].slice(-32));
  }, []);

  const run = useCallback(async (value: string) => {
    if (pending.current) return;
    Keyboard.dismiss();
    pending.current = true;
    setBusy(true);
    setFailure('');
    setResult(null);
    setCandidate(0);
    setLines(['MyLike 游客播放测试 · 手机直连 · 未提供 Cookie']);
    try {
      const resolved = await resolveVideo(value, report);
      report(`播放器：地址 1/${resolved.candidates.length} · ${new URL(resolved.candidates[0]).hostname}`);
      setResult(resolved);
    } catch (error) {
      const message = error instanceof Error ? redactMediaUrls(error.message) : '无法完成取链。';
      setFailure(message);
      report(`取链失败：${message}`);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, [report]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Action label="返回内容库" onPress={onClose} />
          <Text style={styles.title}>游客取链测试</Text>
          <Text style={styles.note}>输入公开抖音视频的分享链接或作品 ID。手机直接取链并播放。</Text>
          <TextInput
            accessibilityLabel="抖音分享链接或作品 ID"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            multiline
            maxLength={4096}
            onChangeText={setInput}
            placeholder="粘贴分享链接或作品 ID"
            placeholderTextColor="#667085"
            style={styles.input}
            value={input}
          />
          <View style={styles.actions}>
            <Action label={busy ? '正在取链…' : '取链并播放'} onPress={() => void run(input)} disabled={busy || !input.trim()} primary />
            <Action label="测试公开样例" disabled={busy} onPress={() => {
              setInput(SAMPLE_ID);
              void run(SAMPLE_ID);
            }} />
          </View>
          {failure ? <Text accessibilityLiveRegion="polite" style={styles.error}>{failure}</Text> : null}

          {result ? (
            <View style={styles.section}>
              <Text style={styles.heading} numberOfLines={2}>{result.title}</Text>
              <Player key={`${result.id}:${candidate}`} uri={result.candidates[candidate]} report={report} />
              <Text style={styles.note}>播放地址 {candidate + 1} / {result.candidates.length}</Text>
              {result.candidates.length > 1 ? <Action label="换备用地址" onPress={() => {
                const next = (candidate + 1) % result.candidates.length;
                report(`播放器：地址 ${next + 1}/${result.candidates.length} · ${new URL(result.candidates[next]).hostname}`);
                setCandidate(next);
              }} /> : null}
            </View>
          ) : null}

          {lines.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.heading}>诊断</Text>
              <Text selectable style={styles.log}>{lines.join('\n')}</Text>
              <Action label="分享诊断" onPress={() => {
                void Share.share({ message: lines.join('\n') }).catch(() => undefined);
              }} />
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f6f8fc' },
  content: { padding: 20, gap: 14 },
  eyebrow: { color: '#2444a0', fontSize: 12, letterSpacing: 1.4, fontWeight: '700' },
  title: { color: '#182230', fontSize: 31, fontWeight: '800' },
  note: { color: '#475467', fontSize: 14, lineHeight: 21 },
  input: { minHeight: 76, borderWidth: 1, borderColor: '#cdd5e1', borderRadius: 12, padding: 12, color: '#182230', backgroundColor: '#fff', fontSize: 16, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#e8edf8' },
  primary: { backgroundColor: '#2444a0' },
  dimmed: { opacity: 0.5 },
  buttonText: { color: '#203a81', fontSize: 15, fontWeight: '700' },
  primaryText: { color: '#fff' },
  section: { backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 10 },
  heading: { color: '#182230', fontSize: 17, fontWeight: '700' },
  playerArea: { gap: 8 },
  video: { width: '100%', height: 310, borderRadius: 10, backgroundColor: '#101828' },
  log: { color: '#344054', fontSize: 13, lineHeight: 20 },
  error: { color: '#a22621', fontSize: 14, lineHeight: 21 },
});
