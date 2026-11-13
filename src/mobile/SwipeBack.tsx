import type { ReactNode } from 'react';
import { Platform, View, useWindowDimensions } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { colors } from './ui';

// iOS uses the native-stack interactive gesture; Android gets the same direction.
export function SwipeBack({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  const { width } = useWindowDimensions();
  const gesture = usePanGesture({ enabled: Platform.OS === 'android', activeOffsetX: 24, failOffsetY: [-14, 14], maxPointers: 1,
    onDeactivate: event => { 'worklet'; if (!event.canceled && event.translationX > 24 && (event.translationX > width / 3 || event.velocityX > 800)) scheduleOnRN(onBack); },
  });
  return <GestureDetector gesture={gesture}><View style={{ flex: 1, backgroundColor: colors.background }}>{children}</View></GestureDetector>;
}
