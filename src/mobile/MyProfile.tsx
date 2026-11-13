import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { AccountPicker } from './AccountPicker';
import { useMobile } from './context';
import { NameEditor } from './NameEditor';
import type { Source } from './model';

export function MyProfile({ totals, onSource }: { totals: Record<Source, number>; onSource: (source: Source) => void }) {
  const { nickname, rename } = useMobile(); const { width } = useWindowDimensions();
  const [editing, setEditing] = useState(false); const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null); const button = useRef<ComponentRef<typeof View>>(null);
  return <View style={styles.profile}><View style={styles.identity}><View style={styles.avatar}><Ionicons name="person" size={40} color="#8e9098" /></View>
    <Pressable style={{ flex: 1, paddingVertical: 10 }} accessibilityLabel={`编辑本机 ID，当前为 ${nickname}`} onPress={() => setEditing(true)}><Text numberOfLines={1} style={styles.name}>{nickname}</Text></Pressable>
    <Pressable ref={button} accessibilityRole="button" accessibilityLabel="切换本机账号" onPress={() => button.current?.measureInWindow((x, y, w, h) => setAnchor({ top: y + h + 8, right: Math.max(12, width - x - w) }))} style={styles.account}><Ionicons name="chevron-down" size={20} color="#ddd" /></Pressable></View>
    <View style={styles.stats}>{([['all', '已导入'], ['likes', '喜欢'], ['favorites', '收藏']] as const).map(([key, label]) => <Pressable style={styles.stat} key={key} onPress={() => onSource(key)}><Text style={styles.number}>{totals[key]}</Text><Text style={styles.label}>{label}</Text></Pressable>)}</View>
    {editing && <NameEditor value={nickname} onSave={rename} onClose={() => setEditing(false)} />}{anchor && <AccountPicker anchor={anchor} onClose={() => setAnchor(null)} />}
  </View>;
}
const styles = StyleSheet.create({ profile: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10, gap: 22 }, identity: { flexDirection: 'row', alignItems: 'center', gap: 16 }, avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#2b2e38', alignItems: 'center', justifyContent: 'center' }, name: { color: '#fff', fontSize: 22, lineHeight: 29, fontWeight: '700' }, account: { width: 44, height: 36, borderRadius: 8, backgroundColor: '#262933', alignItems: 'center', justifyContent: 'center' }, stats: { flexDirection: 'row' }, stat: { flex: 1, alignItems: 'center', paddingVertical: 6 }, number: { color: '#fff', fontSize: 19, fontWeight: '700', marginBottom: 5 }, label: { color: '#a3a4aa', fontSize: 13 } });
