import Ionicons from '@expo/vector-icons/Ionicons';
import { DarkTheme, NavigationContainer, useIsFocused } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MobileProvider, useMobile } from './context';
import { FeedScreen } from './FeedScreen';
import { LibraryScreen, type OpenQueue } from './LibraryScreen';
import { type Scope, type Session, type Source } from './model';
import { colors, ui } from './ui';
import { HistoryScreen } from './HistoryScreen';
import { SettingsScreen } from './SettingsScreen';
import { feedFooterHeight } from './layout';
import { MoreScreen } from './MoreScreen';
import { SwipeBack } from './SwipeBack';
import { MeScreen } from './MeScreen';

type Routes = { Main: undefined; Work: { session: Session; scope: Scope; title: string }; Search: undefined; More: undefined; History: undefined; Settings: undefined };
const Stack = createNativeStackNavigator<Routes>();
const navigationTheme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: colors.background, card: colors.background } };
const swipeOptions = { fullScreenGestureEnabled: true, gestureEnabled: true, fullScreenGestureShadowEnabled: false, animationMatchesGesture: true };
export default function MobileApp() {
  return <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}><SafeAreaProvider style={{ flex: 1, backgroundColor: colors.background }}><MobileProvider>
    <RootNavigator />
  </MobileProvider></SafeAreaProvider></GestureHandlerRootView>;
}
function RootNavigator() {
  const { epoch } = useMobile();
  return <NavigationContainer key={epoch} theme={navigationTheme}><Stack.Navigator initialRouteName="Main" screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background }, animation: 'slide_from_right' }}>
    <Stack.Screen name="Main" component={Main} /><Stack.Screen name="Work" component={WorkDetail} /><Stack.Screen name="Search" component={Search} options={swipeOptions} /><Stack.Screen name="More" component={More} options={swipeOptions} /><Stack.Screen name="History" component={History} /><Stack.Screen name="Settings" component={Settings} />
  </Stack.Navigator></NavigationContainer>;
}
function Main({ navigation }: NativeStackScreenProps<Routes, 'Main'>) {
  const insets = useSafeAreaInsets(); const focused = useIsFocused();
  const { preferences, ready, pick, importing, store, initialTab } = useMobile(); const { counts } = store;
  const [tab, setTab] = useState<'home' | 'me'>(initialTab); const [source, setSource] = useState<Source>('all'); const [overlay, setOverlay] = useState(false);
  const [temporaryClear, setTemporaryClear] = useState(false);
  const open = useCallback<OpenQueue>((session, scope, title) => navigation.push('Work', { session, scope, title }), [navigation]);
  const search = useCallback(() => navigation.navigate('Search'), [navigation]);
  const importList = useCallback(async () => {
    const before = await counts().catch(() => ({ all: -1 })); const success = await pick();
    if (success && before.all === 0) { setTab('home'); setSource('all'); }
  }, [pick]);
  useEffect(() => {
    if (!focused || tab !== 'me') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { setTab('home'); return true; }); return () => subscription.remove();
  }, [focused, tab]);
  const clear = tab === 'home' && preferences.clear;
  const footerVisible = tab === 'me' || !clear && !temporaryClear && !overlay;
  const footerHeight = feedFooterHeight(insets.bottom);
  if (!ready) return <SafeAreaView style={ui.screen}><ActivityIndicator color="#fff" style={{ flex: 1 }} /></SafeAreaView>;
  return <View style={[ui.screen, { backgroundColor: tab === 'home' && !overlay ? '#000' : '#151723' }]}>
    <StatusBar barStyle="light-content" hidden={(clear || temporaryClear) && focused && tab === 'home'} />
    <View collapsable={false} pointerEvents="box-none" style={styles.main}>
      <View style={[StyleSheet.absoluteFill, { display: tab === 'home' ? 'flex' : 'none' }]}><FeedScreen key={source} source={source} visible={tab === 'home'} onSource={setSource}
        bottomInset={clear ? 0 : footerHeight} onImport={() => void importList()} onOpen={open} onOverlay={setOverlay} onTemporaryClear={setTemporaryClear} /></View>
      <SafeAreaView pointerEvents={tab === 'me' ? 'auto' : 'none'} edges={['top','left','right']} style={[StyleSheet.absoluteFill, { bottom: footerHeight, opacity: tab === 'me' ? 1 : 0, zIndex: tab === 'me' ? 1 : -1 }]}><MeScreen visible={tab === 'me' && focused} onOpen={open} onImport={() => void importList()} onSearch={search} onMore={() => navigation.navigate('More')} /></SafeAreaView>
    </View>
    {footerVisible && <View style={[styles.footer, { position: 'absolute', bottom: 0, left: 0, right: 0, height: footerHeight, paddingBottom: Math.max(8, insets.bottom), paddingLeft: insets.left, paddingRight: insets.right }]}>
      <Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === 'home' }} style={styles.tab} onPress={() => setTab('home')}><Text style={[styles.tabText, tab === 'home' && styles.selected]}>首页</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="导入清单" disabled={importing} style={styles.tab} onPress={() => void importList()}><View style={styles.importButton}><Ionicons name="add" size={26} color="#fff" /></View></Pressable>
      <Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === 'me' }} style={styles.tab} onPress={() => setTab('me')}><Text style={[styles.tabText, tab === 'me' && styles.selected]}>我</Text></Pressable>
    </View>}
  </View>;
}
function WorkDetail({ navigation, route }: NativeStackScreenProps<Routes, 'Work'>) {
  const { preferences, pick } = useMobile();
  const open = useCallback<OpenQueue>((session, scope, title) => navigation.push('Work', { session, scope, title }), [navigation]);
  return <View style={ui.screen}>
    <StatusBar barStyle="light-content" hidden={preferences.clear} />
    <FeedScreen sessionKey={`detail:${route.key}`} initial={route.params.session} scope={route.params.scope} title={route.params.title}
      onOpen={open} onBack={() => navigation.goBack()} onImport={() => { void pick(); }} />
  </View>;
}
function History({ navigation }: NativeStackScreenProps<Routes, 'History'>) {
  const open = useCallback<OpenQueue>((session, scope, title) => navigation.push('Work', { session, scope, title }), [navigation]);
  return <SafeAreaView edges={['top','bottom','left','right']} style={ui.screen}><StatusBar barStyle="light-content" hidden={false} /><HistoryScreen onBack={() => navigation.goBack()} onOpen={open} /></SafeAreaView>;
}
function Settings({ navigation }: NativeStackScreenProps<Routes, 'Settings'>) {
  return <SafeAreaView edges={['top','bottom','left','right']} style={ui.screen}><StatusBar barStyle="light-content" hidden={false} /><SettingsScreen onBack={() => navigation.goBack()} /></SafeAreaView>;
}
function Search({ navigation }: NativeStackScreenProps<Routes, 'Search'>) {
  const { pick } = useMobile(); const focused = useIsFocused();
  const open = useCallback<OpenQueue>((session, scope, title) => navigation.push('Work', { session, scope, title }), [navigation]);
  return <SwipeBack onBack={() => navigation.goBack()}><SafeAreaView edges={['top','bottom','left','right']} style={ui.screen}><StatusBar barStyle="light-content" hidden={false} /><LibraryScreen searchOnly visible={focused} onBack={() => navigation.goBack()} onOpen={open} onImport={() => { void pick(); }} /></SafeAreaView></SwipeBack>;
}
function More({ navigation }: NativeStackScreenProps<Routes, 'More'>) {
  const { pick } = useMobile(); const focused = useIsFocused();
  const open = useCallback<OpenQueue>((session, scope, title) => navigation.push('Work', { session, scope, title }), [navigation]);
  return <SwipeBack onBack={() => navigation.goBack()}><SafeAreaView edges={['top','bottom','left','right']} style={ui.screen}><StatusBar barStyle="light-content" hidden={false} /><MoreScreen visible={focused} onBack={() => navigation.goBack()} onOpen={open} onImport={() => { void pick(); }} onManage={page => navigation.navigate(page === 'history' ? 'History' : 'Settings')} /></SafeAreaView></SwipeBack>;
}
const styles = StyleSheet.create({
  main: { flex: 1 },
  footer: { zIndex: 20, elevation: 20, flexDirection: 'row', alignItems: 'center', backgroundColor: '#161616', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#252525' },
  tab: { flex: 1, height: 50, alignItems: 'center', justifyContent: 'center' },
  tabText: { color: '#999', fontSize: 18, lineHeight: 24, fontWeight: '600' },
  selected: { color: '#fff', fontWeight: '700' },
  importButton: { width: 38, height: 30, borderWidth: 2.2, borderColor: '#fff', borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});
