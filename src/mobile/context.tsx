import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { decodeLibrary, MAX_LIBRARY_BYTES } from '../library-format';
import { defaultPreferences, parsePreferences, type Preferences, type Work } from './model';
import { createMobileStore, type MobileStore } from './store';
import { validName } from './local-data';
import * as accountsStore from './accounts';
import type { LocalAccount } from './accounts-data';

type MobileContext = { revision: number; changed: () => void; importing: boolean; pick: () => Promise<boolean>; preferences: Preferences; setPreferences: (patch: Partial<Preferences>) => Promise<boolean>; ready: boolean;
  store: MobileStore; accountId: string; accounts: LocalAccount[]; switchAccount: (id: string) => Promise<void>; addAccount: (label: string) => Promise<void>; initialTab: 'home' | 'me';
  epoch: number; nickname: string; rename: (value: string) => Promise<void>; reset: (kind: 'likes' | 'favorites' | 'groups' | 'all') => Promise<void>; clear: () => Promise<void>; groupsChanged: (id: string) => void;
  marks: Record<string, Partial<Pick<Work, 'liked' | 'saved'>>>; setMark: (id: string, key: 'liked' | 'saved', value: boolean) => void };
const Context = createContext<MobileContext | null>(null);
export const useMobile = () => { const value = useContext(Context); if (!value) throw new Error('Missing mobile context'); return value; };
export function MobileProvider({ children }: { children: ReactNode }) {
  const [registry, setRegistry] = useState<Awaited<ReturnType<typeof accountsStore.loadAccounts>> | null>(null); const [failure, setFailure] = useState(''); const [attempt, setAttempt] = useState(0); const [initialTab, setInitialTab] = useState<'home' | 'me'>('home');
  const switching = useRef(false);
  useEffect(() => { let alive = true; setFailure(''); void accountsStore.loadAccounts().then(value => { if (alive) setRegistry(value); }).catch(() => { if (alive) setFailure('无法读取本机账号，请点按重试。'); }); return () => { alive = false; }; }, [attempt]);
  const switchAccount = useCallback(async (id: string) => {
    if (switching.current) throw new Error('正在切换账号。'); switching.current = true;
    try { const active = await accountsStore.selectAccount(id); setInitialTab('me'); setRegistry(value => value && ({ ...value, active })); } finally { switching.current = false; }
  }, []);
  const addAccount = useCallback(async (label: string) => {
    if (switching.current) throw new Error('正在切换账号。'); switching.current = true;
    try { const account = await accountsStore.addAccount(label); setInitialTab('me'); setRegistry(value => value && ({ accounts: [...value.accounts, account], active: account })); } finally { switching.current = false; }
  }, []);
  const rename = useCallback(async (id: string, label: string) => { const name = await accountsStore.renameAccount(id, label); setRegistry(value => value && ({ accounts: value.accounts.map(row => row.id === id ? { ...row, label: name } : row), active: value.active.id === id ? { ...value.active, label: name } : value.active })); }, []);
  if (!registry) return <View style={{ flex: 1, backgroundColor: '#151723', alignItems: 'center', justifyContent: 'center' }}>{failure ? <Pressable onPress={() => setAttempt(value => value + 1)}><Text style={{ color: '#fff' }}>{failure}</Text></Pressable> : <ActivityIndicator color="#fff" />}</View>;
  return <AccountProvider key={registry.active.id} account={registry.active} accounts={registry.accounts} switchAccount={switchAccount} addAccount={addAccount} renameAccount={rename} initialTab={initialTab}>{children}</AccountProvider>;
}
function AccountProvider({ children, account, accounts, switchAccount, addAccount, renameAccount, initialTab }: { children: ReactNode; account: LocalAccount; accounts: LocalAccount[]; switchAccount: (id: string) => Promise<void>; addAccount: (label: string) => Promise<void>; renameAccount: (id: string, label: string) => Promise<void>; initialTab: 'home' | 'me' }) {
  const store = useMemo(() => createMobileStore(account.database), [account.database]);
  const { clearLibrary, duplicateCount, importCollection, mark, readState, resetLocal, undoSaved, writeState } = store;
  const [revision, setRevision] = useState(0); const [importing, setImporting] = useState(false);
  const [preferences, set] = useState(defaultPreferences); const [ready, setReady] = useState(false);
  const busy = useRef(false);
  const [epoch, setEpoch] = useState(0); const nickname = account.label;
  const [notice, setNotice] = useState<{ text: string; action?: () => void } | null>(null);
  const preferencesRef = useRef(defaultPreferences);
  const [marks, setMarks] = useState<MobileContext['marks']>({}); const markVersions = useRef(new Map<string, number>());
  useEffect(() => { let mounted = true; void readState('preferences').then(value => { if (mounted) { preferencesRef.current = parsePreferences(value); set(preferencesRef.current); } })
    .catch(() => Alert.alert('设置读取失败', '已使用默认播放设置，内容库未更改。')).finally(() => { if (mounted) setReady(true); }); return () => { mounted = false; }; }, [readState]);
  const changed = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 6500); return () => clearTimeout(timer); }, [notice]);
  const rename = useCallback(async (value: string) => { await renameAccount(account.id, validName(value)); }, [account.id, renameAccount]);
  const changeAccount = useCallback(async (id: string) => { if (busy.current) throw new Error('请先完成当前清单导入。'); if (id !== account.id) await switchAccount(id); }, [account.id, switchAccount]);
  const createAccount = useCallback(async (label: string) => { if (busy.current) throw new Error('请先完成当前清单导入。'); await addAccount(label); }, [addAccount]);
  const groupsChanged = useCallback((id: string) => { setMarks(previous => { const next = { ...previous, [id]: { ...previous[id] } }; delete next[id].saved; return next; }); changed(); }, [changed]);
  const reset = useCallback(async (kind: 'likes' | 'favorites' | 'groups' | 'all') => {
    await resetLocal(kind); markVersions.current.clear(); setNotice(null);
    setMarks(previous => Object.fromEntries(Object.entries(previous).map(([id, flags]) => { const next = { ...flags }; if (kind === 'likes' || kind === 'all') delete next.liked; if (kind === 'favorites' || kind === 'all') delete next.saved; return [id, next]; }))); changed();
  }, [changed]);
  const clear = useCallback(async () => { await clearLibrary(); markVersions.current.clear(); setMarks({}); setNotice(null); changed(); setEpoch(v => v + 1); }, [changed]);
  const setPreferences = useCallback(async (patch: Partial<Preferences>) => {
    const next = { ...preferencesRef.current, ...patch }; preferencesRef.current = next; set(next);
    try { await writeState('preferences', next); return true; } catch { Alert.alert('设置未保存', '当前设置仍有效，重启后可能恢复旧值。'); return false; }
  }, []);
  const setMark = useCallback((id: string, key: 'liked' | 'saved', value: boolean) => {
    const name = `${id}:${key}`; const version = (markVersions.current.get(name) ?? 0) + 1; markVersions.current.set(name, version);
    setMarks(previous => ({ ...previous, [id]: { ...previous[id], [key]: value } }));
    void mark(id, key, value).then(undo => {
      changed();
      if (undo && markVersions.current.get(name) === version) setNotice({ text: '已取消收藏', action: () => {
        setNotice(null); void undoSaved(undo).then(restored => { if (restored && markVersions.current.get(name) === version) groupsChanged(id); else if (!restored) Alert.alert('无法撤销', '该作品的收藏状态已再次修改。'); }).catch(() => Alert.alert('撤销未完成', '请稍后重试。'));
      } });
    }).catch(() => {
      if (markVersions.current.get(name) === version) setMarks(previous => { const next = { ...previous, [id]: { ...previous[id] } }; delete next[id][key]; return next; });
      changed(); Alert.alert('标记未保存', '请重试；作品和导入记录没有被删除。');
    });
  }, [changed, groupsChanged]);
  const pick = useCallback(async () => {
    if (busy.current) return false;
    busy.current = true; setImporting(true); let file: File | undefined;
    try {
      const selected = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (selected.canceled) return false;
      const asset = selected.assets[0]; file = new File(asset.uri);
      if (!file.exists || Math.max(file.size, asset.size ?? 0) > MAX_LIBRARY_BYTES) throw new Error('无法读取清单，或文件超过 64 MiB。');
      const library = decodeLibrary(await file.text()); const duplicate = await duplicateCount(library);
      const accepted = await new Promise<boolean>(resolve => Alert.alert('导入清单', `当前本机账号：${account.label}\n${library.sourceLabel}\n导出时间：${new Date(library.exportedAt).toLocaleString()}\n共 ${library.works.length} 条，新增 ${library.works.length - duplicate} 条，重复 ${duplicate} 条\n收藏夹 ${library.folders.length} 个\n本机喜欢和收藏修改会保留。`, [
        { text: '取消', style: 'cancel', onPress: () => resolve(false) }, { text: '导入', onPress: () => resolve(true) },
      ], { cancelable: false }));
      if (!accepted) return false;
      await importCollection(library); changed(); return true;
    } catch (error) { Alert.alert('导入未完成', error instanceof Error ? error.message : '请重试，原有内容库已保留。'); return false; }
    finally {
      if (file?.uri.startsWith(Paths.cache.uri.replace(/\/?$/, '/'))) { try { file.delete(); } catch { /* Only the picker cache copy. */ } }
      busy.current = false; setImporting(false);
    }
  }, [changed, account.label]);
  return <Context.Provider value={{ store, accountId: account.id, accounts, switchAccount: changeAccount, addAccount: createAccount, initialTab, revision, changed, importing, pick, preferences, setPreferences, ready, marks, setMark, epoch, nickname, rename, reset, clear, groupsChanged }}>{children}
    {notice && <View pointerEvents="box-none" style={styles.noticeArea}><View style={styles.notice}><Text style={{ color: '#fff', flex: 1 }}>{notice.text}</Text>{notice.action && <Pressable accessibilityRole="button" onPress={notice.action} hitSlop={12}><Text style={{ color: '#ff8ca5' }}>撤销</Text></Pressable>}</View></View>}
  </Context.Provider>;
}
const styles = StyleSheet.create({ noticeArea: { position: 'absolute', bottom: 100, left: 20, right: 20 }, notice: { minHeight: 48, padding: 16, borderRadius: 10, backgroundColor: '#353742', flexDirection: 'row', alignItems: 'center', gap: 20 } });
