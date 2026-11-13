import { useState } from 'react';
import { Linking, Platform, Share, StyleSheet, Text, View } from 'react-native';
import { publicWorkLink, shareText } from './sharing';
import { Button, ui } from './ui';

export function ShareActions({ id, title, gallery, onShared }: { id: string; title: string; gallery: boolean; onShared: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function act(open: boolean) {
    if (busy) return; setBusy(true); setError('');
    try {
      const link = publicWorkLink(id, gallery);
      if (open) await Linking.openURL(link);
      else { const result = await Share.share(Platform.OS === 'ios' ? { url: link, message: title.trim().slice(0, 160) || '抖音作品' } : { message: shareText(title, link) }); if (result.action === Share.sharedAction) onShared(); }
    } catch { setError(open ? '无法打开原作品，请稍后重试。' : '未能打开系统分享，请稍后重试。'); }
    finally { setBusy(false); }
  }
  return <><Text style={ui.text} numberOfLines={3}>{title}</Text><Text style={ui.muted}>分享作品的公开链接。</Text><View style={styles.actions}><Button title={busy ? '正在打开…' : '系统分享'} disabled={busy} selected onPress={() => void act(false)} /><Button title="打开原作品" disabled={busy} onPress={() => void act(true)} /></View>{error && <Text style={ui.error}>{error}</Text>}</>;
}
const styles = StyleSheet.create({ actions: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' } });
