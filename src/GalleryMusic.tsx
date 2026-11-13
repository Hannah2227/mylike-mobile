import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AppState } from 'react-native';
import { mediaHeaders } from './douyin';

type MusicProps = {
  enabled: boolean;
  stopMusic: RefObject<(() => void) | null>;
};

function appIsForeground() {
  return AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
}

export function GalleryMusic({ candidates, enabled, stopMusic, onUnavailable }: MusicProps & {
  candidates: string[];
  onUnavailable: () => void;
}) {
  const [index, setIndex] = useState(0);
  const uri = candidates[index];
  if (!uri) return null;
  return <Track key={uri} uri={uri} enabled={enabled} stopMusic={stopMusic} onFailure={() => {
    if (index === candidates.length - 1) onUnavailable();
    setIndex((current) => current === index ? current + 1 : current);
  }} />;
}

function Track({ uri, enabled, stopMusic, onFailure }: MusicProps & { uri: string; onFailure: () => void }) {
  const source = useMemo(() => ({ uri, headers: mediaHeaders }), [uri]);
  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);
  const [foreground, setForeground] = useState(appIsForeground);
  const wanted = useRef(false);
  const failure = useRef(onFailure);
  failure.current = onFailure;
  const started = status.playing || status.currentTime > 0;
  const shouldPlay = enabled && foreground;

  useLayoutEffect(() => {
    const stop = () => {
      wanted.current = false;
      player.pause();
    };
    stopMusic.current = stop;
    return () => {
      wanted.current = false;
      player.pause();
      if (stopMusic.current === stop) stopMusic.current = null;
    };
  }, [player, stopMusic]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const next = state === 'active';
      if (!next) {
        wanted.current = false;
        player.pause();
      }
      setForeground(next);
    });
    return () => subscription.remove();
  }, [player]);

  useEffect(() => {
    wanted.current = shouldPlay && appIsForeground();
    if (!wanted.current) {
      player.pause();
      return;
    }
    let active = true;
    player.loop = true;
    void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false }).then(() => {
      if (active && wanted.current) player.play();
    }).catch(() => {
      if (active && wanted.current) failure.current();
    });
    return () => { active = false; };
  }, [shouldPlay, player]);

  useEffect(() => {
    if (!shouldPlay) return;
    function next() {
      if (!wanted.current) return;
      wanted.current = false;
      player.pause();
      failure.current();
    }
    if (status.error) {
      next();
      return;
    }
    if (started) return;
    const timeout = setTimeout(next, 12_000);
    return () => clearTimeout(timeout);
  }, [shouldPlay, player, started, status.error]);

  return null;
}
