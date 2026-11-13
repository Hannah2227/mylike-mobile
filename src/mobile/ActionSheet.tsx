import { useCallback, useEffect, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { IconButton, ui } from './ui';

export function ActionSheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const { height } = useWindowDimensions(); const offset = useSharedValue(height); const closing = useSharedValue(false);
  useEffect(() => {
    if (visible) { closing.value = false; offset.value = height; offset.value = withTiming(0, { duration: 210 }); }
    return () => cancelAnimation(offset);
  }, [visible, height, offset, closing]);
  const close = useCallback(() => {
    if (closing.value) return; closing.value = true;
    offset.value = withTiming(height, { duration: 180 }, done => { if (done) scheduleOnRN(onClose); });
  }, [height, offset, closing, onClose]);
  const pan = usePanGesture({ activeOffsetY: [-12, 12], failOffsetX: [-18, 18],
    onUpdate: event => { 'worklet'; if (!closing.value) offset.value = Math.max(0, event.translationY); },
    onDeactivate: event => { 'worklet'; if (!event.canceled && event.translationY > 0 && (event.translationY > 85 || event.velocityY > 900)) scheduleOnRN(close); else if (!closing.value) offset.value = withTiming(0, { duration: 180 }); },
  });
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));
  return <Modal transparent visible={visible} animationType="none" statusBarTranslucent onRequestClose={close}>
    <GestureHandlerRootView style={styles.overlay}><Pressable accessibilityLabel={`关闭${title}`} style={StyleSheet.absoluteFill} onPress={close} />
      <Animated.View accessibilityViewIsModal style={[styles.sheet, { maxHeight: height * 0.85 }, style]}><SafeAreaView edges={['bottom']} style={{ flexShrink: 1 }}>
        <GestureDetector gesture={pan}><View style={styles.heading}><View style={styles.grip} /><Text style={ui.title}>{title}</Text><IconButton name="close" label={`关闭${title}`} size={23} onPress={close} /></View></GestureDetector>
        <View style={styles.content}>{children}</View>
      </SafeAreaView></Animated.View>
    </GestureHandlerRootView>
  </Modal>;
}
const styles = StyleSheet.create({ overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0005' }, sheet: { backgroundColor: '#262630', borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: 'hidden' }, heading: { minHeight: 66, paddingTop: 10, paddingLeft: 20, paddingRight: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, grip: { position: 'absolute', top: 8, width: 30, height: 3, borderRadius: 2, backgroundColor: '#707078', left: '46%' }, content: { paddingHorizontal: 20, paddingBottom: 18, gap: 16, flexShrink: 1 } });
