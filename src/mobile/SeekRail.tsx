import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

export function clock(value: number) { const s = Math.max(0, Math.floor(value)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
export function SeekRail({ enabled, seconds, duration, paused, clear, bottom = 0, onBegin, onCommit, onCancel }: {
  enabled: boolean; seconds: number; duration: number; paused: boolean; clear: boolean;
  bottom?: number; onBegin: () => void; onCommit: (seconds: number) => void; onCancel: () => void;
}) {
  const width = useSharedValue(1); const drag = useSharedValue(false); const position = useSharedValue(0);
  const [scrubbing, setScrubbing] = useState(false); const [display, setDisplay] = useState(0);
  useEffect(() => { if (!drag.value) position.value = duration ? seconds / duration : 0; }, [seconds, duration, drag, position]);
  useAnimatedReaction(() => Math.floor(position.value * duration), (value, before) => { if (drag.value && value !== before) scheduleOnRN(setDisplay, value); });
  const style = useAnimatedStyle(() => ({ width: `${Math.max(0, Math.min(1, position.value)) * 100}%` }));
  const pan = usePanGesture({ enabled: enabled && duration > 0, activeOffsetX: [-6, 6], failOffsetY: [-12, 12],
    onActivate: e => { 'worklet'; drag.value = true; position.value = Math.max(0, Math.min(1, e.x / width.value)); scheduleOnRN(setScrubbing, true); scheduleOnRN(onBegin); },
    onUpdate: e => { 'worklet'; position.value = Math.max(0, Math.min(1, e.x / width.value)); },
    onDeactivate: e => { 'worklet'; if (e.canceled) scheduleOnRN(onCancel); else scheduleOnRN(onCommit, position.value * duration); },
    onFinalize: e => { 'worklet'; if (e.canceled && drag.value) scheduleOnRN(onCancel); drag.value = false; scheduleOnRN(setScrubbing, false); },
  });
  const visible = scrubbing || !clear && (paused || duration > 15);
  return <GestureDetector gesture={pan}><Animated.View accessibilityLabel="拖动调整播放进度" style={[styles.hit, { bottom }]} onLayout={e => { width.value = e.nativeEvent.layout.width; }}>
    {scrubbing && <Text pointerEvents="none" style={styles.time}>{clock(display)} / {clock(duration)}</Text>}
    {visible && <View pointerEvents="none" style={[styles.track, (scrubbing || paused) && styles.wide]}><Animated.View style={[styles.progress, style]} /></View>}
  </Animated.View></GestureDetector>;
}
const styles = StyleSheet.create({ hit: { position: 'absolute', bottom: 0, left: 12, right: 12, height: 36, justifyContent: 'flex-end', paddingBottom: 2 }, track: { height: 1.5, backgroundColor: '#ffffff45', borderRadius: 2, overflow: 'hidden' }, wide: { height: 3 }, progress: { height: '100%', backgroundColor: '#f5f5f5' }, time: { color: '#fff', fontWeight: '600', fontSize: 18, alignSelf: 'center', position: 'absolute', bottom: 44 } });
