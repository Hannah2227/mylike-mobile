import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ui } from './ui';
export function NameEditor({ value, onSave, onClose }: { value: string; onSave: (value: string) => Promise<void>; onClose: () => void }) {
  const [text, setText] = useState(value); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function save() { if (busy) return; setBusy(true); try { await onSave(text); onClose(); } catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败，请重试。'); } finally { setBusy(false); } }
  return <Modal transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
    <Pressable accessibilityLabel="关闭名称编辑" style={StyleSheet.absoluteFill} onPress={() => { if (!busy) onClose(); }} /><SafeAreaView edges={['bottom']} style={styles.sheet}>
      <Text style={ui.title}>自定义 ID</Text><Text style={ui.muted}>用于区分本机账号，不修改抖音账号。</Text><TextInput accessibilityLabel="本机账号 ID" autoFocus selectTextOnFocus maxLength={40} value={text} onChangeText={setText} style={styles.input} returnKeyType="done" onSubmitEditing={() => void save()} />
      {error && <Text style={ui.error}>{error}</Text>}<View style={ui.row}><Button title="取消" disabled={busy} onPress={onClose} /><Button title={busy ? '保存中…' : '保存'} selected disabled={busy} onPress={() => void save()} /></View>
    </SafeAreaView>
  </KeyboardAvoidingView></Modal>;
}
const styles = StyleSheet.create({ overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0008' }, sheet: { backgroundColor: '#262630', padding: 24, borderTopLeftRadius: 18, borderTopRightRadius: 18, gap: 16 }, input: { color: '#fff', fontSize: 18, padding: 14, borderRadius: 6, backgroundColor: '#353842' } });
