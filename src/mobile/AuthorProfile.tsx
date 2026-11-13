import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { mediaHeaders } from '../douyin';
import { readGuestAuthor, validAuthorKey, type GuestAuthor } from '../guest-author';
import { ui } from './ui';

export function AuthorProfile({ author, secUid, visible, total }: { author: string; secUid?: string; visible: boolean; total: number }) {
  const [profile, setProfile] = useState<GuestAuthor | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [attempt, setAttempt] = useState(0); const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => {
    if (!visible || !validAuthorKey(secUid)) return; const controller = new AbortController(); setLoading(true); setError('');
    void readGuestAuthor(secUid, controller.signal).then(value => { if (!controller.signal.aborted) setProfile(value); }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '资料读取失败。'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [secUid, visible, attempt]);
  const current = profile?.secUid === secUid ? profile : null; const name = current?.nickname || author;
  useEffect(() => setAvatarFailed(false), [current?.avatarUrl]);
  return <View style={styles.profile}>
    <View style={styles.avatar}>{current?.avatarUrl && !avatarFailed ? <Image source={{ uri: current.avatarUrl, headers: mediaHeaders }} style={StyleSheet.absoluteFill} onError={() => setAvatarFailed(true)} /> : <Text style={styles.initial}>{name.slice(0, 1) || 'M'}</Text>}</View>
    <Text style={styles.name}>{name}</Text>{current?.signature && <Text style={styles.signature}>{current.signature}</Text>}
    {loading && <View style={ui.row}><ActivityIndicator color="#aaa" size="small" /><Text style={ui.muted}>正在读取游客资料…</Text></View>}
    {error && <Pressable onPress={() => setAttempt(value => value + 1)}><Text style={ui.error}>{error} · 点按重试</Text></Pressable>}
    <Text style={ui.muted}>{current ? '作者资料由游客接口读取。' : '作者名称来自导入清单。'}下方为同名的已导入作品，共 {total} 条，未按账号 ID 核验归属。</Text>
  </View>;
}
const styles = StyleSheet.create({ profile: { padding: 20, gap: 12 }, avatar: { width: 72, height: 72, borderRadius: 36, overflow: 'hidden', backgroundColor: '#313543', alignItems: 'center', justifyContent: 'center' }, initial: { color: '#fff', fontSize: 25 }, name: { color: '#fff', fontSize: 23, fontWeight: '700' }, signature: { color: '#ddd', fontSize: 14, lineHeight: 21 } });
