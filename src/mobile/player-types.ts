import type { ReactNode } from 'react';
import type { PanGesture } from 'react-native-gesture-handler';
import type { SharedValue } from 'react-native-reanimated';

export type PagerHandle = { go: (index: number) => boolean; isMoving: () => boolean };
export type PagerGesture = PanGesture;
export type PageTouch = { native: PagerGesture; phase: SharedValue<number>; owner: SharedValue<number> };
export type WorkPagerProps = {
  ids: string[]; index: number; height: number; width: number; enabled: boolean; gallery: boolean; boostable: boolean;
  photo: number; photos: number; photoX: SharedValue<number>; x: SharedValue<number>;
  onCommit: (index: number, arrivedAt?: number) => void; onPhoto: (index: number) => void; onSide: (side: 'author') => void; onPrepare: (value: boolean) => void;
  onMotion: (moving: boolean) => void;
  onPlaybackTarget?: (index: number | null, requestedAt?: number) => void;
  onTap: () => void; onLike: () => void; onHold: () => void; onBoost: (value: boolean) => void; onBoostTarget: (value: boolean) => void; onBoostLock: (id: string) => void; onPinch: (value: boolean) => void;
  renderMedia: (id: string, active: boolean, warm: boolean, retain?: boolean) => ReactNode;
  renderChrome: (id: string, active: boolean, gesture?: PagerGesture) => ReactNode;
};
