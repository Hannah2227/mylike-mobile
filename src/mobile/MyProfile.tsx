import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { AccountPicker } from './AccountPicker';
import { useMobile } from './context';
import { NameEditor } from './NameEditor';
import { meColors as c } from './me-theme';
import type { Source } from './model';

export function MyProfile({ totals, onSource }: { totals: Record<Source, number>; onSource: (source: Source) => void }) {
  const { nickname, rename } = useMobile(); const { width } = useWindowDimensions();
  const [editing, setEditing] = useState(false); const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null); const button = useRef<ComponentRef<typeof View>>(null);
  return <View style={styles.profile}><View style={styles.identity}>
    <View style={styles.avatarRing}><View style={styles.avatar}><Ionicons name="person-outline" size={32} color={c.secondary} /></View></View>
    <Pressable style={({ pressed }) => [styles.identityText, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`编辑本机 ID，当前为 ${nickname}`} onPress={() => setEditing(true)}>
      <View style={styles.nameRow}><Text numberOfLines={1} style={styles.name}>{nickname}</Text><Ionicons name="pencil-outline" size={13} color={c.muted} /></View>
      <Text style={styles.hint}>自定义 ID</Text>
    </Pressable>
    <Pressable ref={button} accessibilityRole="button" accessibilityLabel="切换本机账号" accessibilityState={{ expanded: Boolean(anchor) }} onPress={() => button.current?.measureInWindow((x, y, w, h) => setAnchor({ top: y + h + 8, right: Math.max(12, width - x - w) }))} style={({ pressed }) => [styles.account, pressed && styles.pressed]}><Ionicons name="chevron-down" size={18} color={c.secondary} /></Pressable>
    </View>
    <View style={styles.stats}>{([['all', '已导入'], ['likes', '喜欢'], ['favorites', '收藏']] as const).map(([key, label], index) => <Pressable style={({ pressed }) => [styles.stat, index > 0 && styles.statDivider, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`${label} ${totals[key]} 条，查看${label}内容`} key={key} onPress={() => onSource(key)}>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={styles.number}>{totals[key].toLocaleString()}</Text><Text style={styles.label}>{label}</Text>
    </Pressable>)}</View>
    {editing && <NameEditor value={nickname} onSave={rename} onClose={() => setEditing(false)} />}{anchor && <AccountPicker anchor={anchor} onClose={() => setAnchor(null)} />}
  </View>;
}
const styles = StyleSheet.create({
  profile: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 18, gap: 18 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarRing: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: '#ffffff1a', alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 62, height: 62, borderRadius: 31, backgroundColor: c.raised, alignItems: 'center', justifyContent: 'center' },
  identityText: { flex: 1, minWidth: 0, paddingVertical: 8, gap: 5 }, nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  name: { flexShrink: 1, color: c.text, fontSize: 24, lineHeight: 31, fontWeight: '700', letterSpacing: 0.2 }, hint: { color: c.muted, fontSize: 12, lineHeight: 17 },
  account: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: c.line, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', paddingVertical: 8, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 18 },
  stat: { flex: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: 8, gap: 3 }, statDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: '#ffffff14' },
  number: { color: c.text, fontSize: 22, lineHeight: 27, fontWeight: '700', fontVariant: ['tabular-nums'] }, label: { color: c.muted, fontSize: 12, lineHeight: 17 }, pressed: { opacity: 0.6 },
});
