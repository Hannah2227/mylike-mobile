import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMobile } from './context';
import type { Folder } from './local-data';

import { Button, IconButton, ui } from './ui';

export function FolderSheet({ workId, selectedId, manage = false, onSelect, onClose }: { workId?: string; selectedId?: string | null; manage?: boolean; onSelect?: (id: string | null, title: string) => void; onClose: () => void }) {
  const { changed, groupsChanged, store } = useMobile(); const { assignGroups, createFolder, editFolder, folders, groups } = store;
  const [items, setItems] = useState<Folder[]>([]); const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null); const [name, setName] = useState(''); const alive = useRef(true);
  const request = useRef(0);
  async function load(initial = false) {
    const generation = ++request.current; setError('');
    try { const [values, memberships] = await Promise.all([folders(), initial && workId ? groups(workId) : Promise.resolve(null)]); if (alive.current && generation === request.current) { setItems(values); if (memberships) setSelected(memberships); else setSelected(before => before.filter(id => values.some(row => row.id === id))); } }
    catch { if (alive.current) setError('无法读取收藏夹，请重试。'); }
    finally { if (alive.current) setLoading(false); }
  }
  useEffect(() => { alive.current = true; void load(true); return () => { alive.current = false; request.current++; }; }, [workId]);
  async function action(task: () => Promise<unknown>) { if (busy) return; setBusy(true); setError(''); try { await task(); changed(); if (alive.current) await load(); } catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : '操作失败，请重试。'); } finally { if (alive.current) setBusy(false); } }
  function options(folder: Folder) { Alert.alert(folder.title, folder.local ? '仅修改本机收藏夹。' : '仅修改本机显示与归属，重复导入会保留修改。', [
    { text: '取消', style: 'cancel' }, { text: '改名', onPress: () => { setName(folder.title); setEditing(folder.id); } },
    { text: '删除', style: 'destructive', onPress: () => Alert.alert('删除收藏夹？', '作品仍保留收藏；重复导入不会恢复已删除的收藏夹。', [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => { void action(() => editFolder(folder.id, null)); } }]) },
  ]); }
  async function saveGroups() {
    if (!workId || busy) return; setBusy(true); setError('');
    try { await assignGroups(workId, selected); groupsChanged(workId); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败，请重试。'); }
    finally { if (alive.current) setBusy(false); }
  }
  return <Modal transparent animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
    <Pressable accessibilityLabel="关闭收藏夹" style={StyleSheet.absoluteFill} onPress={() => { if (!busy) onClose(); }} />
    <SafeAreaView edges={['bottom']} style={styles.sheet}>
      <View style={styles.heading}><Text style={ui.title}>{workId ? '收藏到…' : manage ? '管理收藏夹' : '收藏夹'}</Text><IconButton name="close" label="关闭收藏夹" onPress={() => { if (!busy) onClose(); }} /></View>
      {editing !== null ? <View style={{ gap: 12 }}><TextInput accessibilityLabel="收藏夹名称" autoFocus maxLength={80} value={name} onChangeText={setName} placeholder="收藏夹名称" placeholderTextColor="#999" style={styles.input} returnKeyType="done" />
        <View style={ui.row}><Button title="取消编辑" disabled={busy} onPress={() => setEditing(null)} /><Button title="保存名称" selected disabled={busy} onPress={() => { void action(async () => { if (editing === 'new') { const id = await createFolder(name); if (workId) setSelected(before => [...before, id]); } else await editFolder(editing, name); setEditing(null); }); }} /></View></View> : <>
        {workId && <Text style={ui.muted}>可多选；全部取消后进入未分组。保存会将作品加入本机收藏。</Text>}
        {!workId && !manage && <View style={ui.row}><Button title="全部收藏" selected={selectedId === null} disabled={busy || loading} onPress={() => onSelect?.(null, '全部收藏夹')} /><Button title="未分组" selected={selectedId === 'unfiled'} disabled={busy || loading} onPress={() => onSelect?.('unfiled', '未分组')} /></View>}
        {loading ? <ActivityIndicator color="#fff" /> : <FlatList data={items} keyExtractor={item => item.id} style={{ maxHeight: 330 }} keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={ui.muted}>还没有收藏夹，可以新建一个。</Text>}
          renderItem={({ item }) => <View style={styles.folder}><Pressable accessibilityRole={workId ? 'checkbox' : 'button'} accessibilityState={{ checked: selected.includes(item.id) }} disabled={busy} onLongPress={() => options(item)}
            onPress={() => workId ? setSelected(before => before.includes(item.id) ? before.filter(id => id !== item.id) : [...before, item.id]) : manage ? options(item) : onSelect?.(item.id, item.title)} style={styles.folderName}>
            <Ionicons name={workId ? selected.includes(item.id) ? 'checkbox' : 'square-outline' : 'folder-outline'} size={23} color={selected.includes(item.id) || selectedId === item.id ? '#ff7596' : '#eee'} /><View style={{ flex: 1 }}><Text numberOfLines={1} style={ui.text}>{item.title}</Text><Text style={ui.muted}>{item.count} 条 · {item.local ? '本机新建' : '清单导入'}</Text></View>
          </Pressable><IconButton name="ellipsis-horizontal" label={`管理收藏夹 ${item.title}`} onPress={() => { if (!busy) options(item); }} /></View>} />}
        <View style={ui.row}><Button title="新建收藏夹" disabled={busy || loading} onPress={() => { setEditing('new'); setName(''); }} />{workId && <Button title={busy ? '保存中…' : '保存分组'} selected disabled={busy || loading || Boolean(error)} onPress={() => void saveGroups()} />}</View>
      </>}
      {error && <Pressable onPress={() => { setLoading(true); void load(true); }}><Text style={ui.error}>{error} · 点按重试</Text></Pressable>}
    </SafeAreaView>
  </KeyboardAvoidingView></Modal>;
}
const styles = StyleSheet.create({ overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0008' }, sheet: { backgroundColor: '#262630', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, gap: 14, maxHeight: '90%' }, heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, folder: { flexDirection: 'row', alignItems: 'center', minHeight: 65, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#454650' }, folderName: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }, input: { backgroundColor: '#363945', borderRadius: 6, color: '#fff', padding: 14, fontSize: 16 } });
