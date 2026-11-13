import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
export const colors = { background: '#151723', accent: '#fc2f56', text: '#fff', muted: '#bababb', panel: '#262630' };
export function IconButton({ name, label, onPress, onLongPress, color = '#fff', size = 26 }: {
  name: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; onLongPress?: () => void; color?: string; size?: number;
}) { return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onLongPress={onLongPress} delayLongPress={450} hitSlop={6} style={ui.icon}><Ionicons name={name} size={size} color={color} /></Pressable>; }
export function Button({ title, onPress, selected, disabled, style }: { title: string; onPress: () => void; selected?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={[ui.button, selected && ui.selected, disabled && { opacity: 0.4 }, style]}><Text style={ui.text}>{title}</Text></Pressable>;
}
export function PageHeader({ title, back, children }: { title: string; back?: () => void; children?: React.ReactNode }) {
  return <View style={ui.header}>{back ? <IconButton name="chevron-back" label="返回" onPress={back} /> : <View style={ui.icon} />}<Text style={ui.title}>{title}</Text><View style={ui.icon}>{children}</View></View>;
}
export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, text: { color: '#fff', fontSize: 14 }, muted: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 }, title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 }, button: { backgroundColor: '#30333f', minHeight: 38, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 6, alignItems: 'center', justifyContent: 'center' }, selected: { backgroundColor: colors.accent },
  empty: { padding: 35, alignItems: 'center', justifyContent: 'center', gap: 16 }, error: { color: '#f5c0c8', fontSize: 13, padding: 14, textAlign: 'center' },
});
