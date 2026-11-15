import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMobile } from './context';
import { Button, IconButton, ui } from './ui';
import { meColors as c } from './me-theme';

export function AccountPicker({ anchor, onClose }: { anchor: { top: number; right: number }; onClose: () => void }) {
  const window = useWindowDimensions(); const insets = useSafeAreaInsets(); const top = Math.max(insets.top + 8, Math.min(anchor.top, window.height - 250));
  const { accounts, accountId, switchAccount, addAccount, importing } = useMobile();
  const [creating, setCreating] = useState(false); const [label, setLabel] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function act(operation: () => Promise<void>) { if (busy || importing) return; setBusy(true); setError(''); try { await operation(); onClose(); } catch (failure) { setError(failure instanceof Error ? failure.message : '账号切换失败，请重试。'); } finally { setBusy(false); } }
  return <Modal transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.overlay, !creating && { justifyContent: 'flex-start', alignItems: 'flex-end', paddingTop: top, paddingRight: anchor.right }]}>
    <Pressable accessibilityLabel="关闭账号切换" style={StyleSheet.absoluteFill} onPress={() => { if (!busy) onClose(); }} />
    <SafeAreaView edges={creating ? ['bottom'] : []} style={[styles.sheet, !creating && { width: Math.min(320, window.width - 24), maxHeight: window.height - top - insets.bottom - 12, borderRadius: 18, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 14 }]}>
      <View style={styles.heading}><Text style={styles.title}>切换本机账号</Text><IconButton name="close" label="关闭账号切换" size={22} color={c.secondary} onPress={() => { if (!busy) onClose(); }} /></View>
      <Text style={styles.note}>每个账号独立保存清单、喜欢、收藏夹和观看进度。这里的 ID 可自行命名，无需抖音登录。</Text>
      {creating ? <><TextInput accessibilityLabel="新账号 ID" autoFocus maxLength={40} value={label} onChangeText={setLabel} placeholder="输入自定义 ID" placeholderTextColor={c.muted} returnKeyType="done" style={styles.input} onSubmitEditing={() => void act(() => addAccount(label))} />
        <View style={ui.row}><Button title="取消新建" style={styles.secondaryButton} disabled={busy} onPress={() => setCreating(false)} /><Button title={busy ? '创建中…' : '创建并切换'} style={styles.button} disabled={busy || importing} selected onPress={() => void act(() => addAccount(label))} /></View></> : <>
        <FlatList style={{ maxHeight: 300 }} data={accounts} keyExtractor={item => item.id} renderItem={({ item }) => <Pressable accessibilityRole="radio" accessibilityState={{ selected: item.id === accountId, disabled: busy || importing }} disabled={busy || importing} onPress={() => void act(() => switchAccount(item.id))} style={({ pressed }) => [styles.account, item.id === accountId && styles.selectedAccount, pressed && styles.pressed]}>
          <View style={styles.avatar}><Ionicons name="person-outline" size={18} color={item.id === accountId ? c.accentText : c.secondary} /></View><Text numberOfLines={1} style={[ui.text, { flex: 1, fontWeight: item.id === accountId ? '600' : '400' }]}>{item.label}</Text>{item.id === accountId && <Ionicons name="checkmark-circle" size={21} color={c.accent} />}
        </Pressable>} />
        <Button title="添加本机账号" style={styles.addButton} disabled={busy || importing} onPress={() => { setCreating(true); setError(''); }} />
      </>}{importing && <Text style={ui.muted}>请先完成当前导入。</Text>}{error && <Text style={ui.error}>{error}</Text>}
    </SafeAreaView>
  </KeyboardAvoidingView></Modal>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#0009', justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.raised, padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: c.line, gap: 12, maxHeight: '85%' },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { color: c.text, fontSize: 17, fontWeight: '700' }, note: { color: c.muted, fontSize: 12, lineHeight: 19 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 10, borderRadius: 12, marginBottom: 4 }, selectedAccount: { backgroundColor: c.accentSoft },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }, pressed: { opacity: 0.6 },
  input: { color: c.text, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 14, fontSize: 17, padding: 14 },
  button: { flex: 1, borderRadius: 14, minHeight: 44 }, secondaryButton: { flex: 1, borderRadius: 14, minHeight: 44, backgroundColor: '#ffffff0d' }, addButton: { borderRadius: 12, minHeight: 44, backgroundColor: '#ffffff0d' },
});
