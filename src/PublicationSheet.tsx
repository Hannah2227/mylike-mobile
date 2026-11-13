import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PublicationPeriod } from './library-period';
import { readPublicationDates, type LibraryScope, type PublicationDates } from './library-store';

const yearWidth = 74;
const yearGap = 8;

function Choice({ label, selected, onPress, year }: {
  label: string; selected?: boolean; onPress: () => void; year?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }}
      onPress={onPress} style={[styles.choice, year && styles.year, selected && styles.selected]}>
      <Text style={[styles.choiceText, selected && styles.selectedText]}>{label}</Text>
    </Pressable>
  );
}

export function PublicationSheet({ scope, onApply, onClose, loadDates }: {
  scope: LibraryScope; onApply: (period: PublicationPeriod) => void; onClose: () => void;
  loadDates?: () => Promise<PublicationDates>;
}) {
  const [dates, setDates] = useState<PublicationDates | null>(null);
  const [year, setYear] = useState<number>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const period = scope.period;
  const currentYear = period && period !== 'unknown' ? period.year : undefined;
  const currentMonth = period && period !== 'unknown' ? period.month : undefined;

  useEffect(() => {
    let live = true;
    setFailed(false);
    void (loadDates ? loadDates() : readPublicationDates(scope)).then((available) => {
      if (!live) return;
      setDates(available);
      setYear(available.years.find((entry) => entry.year === currentYear)?.year ?? available.years[0]?.year);
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [scope, currentYear, attempt, loadDates]);

  const yearIndex = dates?.years.findIndex((entry) => entry.year === year) ?? -1;
  const months = yearIndex >= 0 ? dates?.years[yearIndex].months : undefined;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭发布时间筛选" style={StyleSheet.absoluteFill}
          onPress={onClose} />
        <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.heading}>
            <View>
              <Text accessibilityRole="header" style={styles.title}>发布时间</Text>
              <Text style={styles.note}>按北京时间划分年月</Text>
            </View>
            <Choice label="关闭" onPress={onClose} />
          </View>
          <View style={styles.choices}>
            <Choice label="不限日期" selected={period === null} onPress={() => onApply(null)} />
            {(dates?.unknown || period === 'unknown') && (
              <Choice label="日期未知" selected={period === 'unknown'} onPress={() => onApply('unknown')} />
            )}
          </View>
          {failed ? (
            <View style={styles.heading}>
              <Text style={styles.note}>无法读取日期</Text>
              <Choice label="重试" onPress={() => setAttempt((value) => value + 1)} />
            </View>
          ) : !dates ? <ActivityIndicator accessibilityLabel="正在读取可选日期" />
            : dates.years.length === 0 ? <Text style={styles.note}>当前结果里没有已知的发布时间。</Text> : (
              <>
                <FlatList data={dates.years} horizontal keyExtractor={(entry) => String(entry.year)}
                  initialScrollIndex={Math.max(0, yearIndex)} showsHorizontalScrollIndicator={false} extraData={year}
                  getItemLayout={(_, index) => ({ length: yearWidth, offset: index * (yearWidth + yearGap), index })}
                  ItemSeparatorComponent={YearGap} style={styles.years}
                  renderItem={({ item }) => (
                    <Choice label={`${item.year}年`} year selected={year === item.year} onPress={() => setYear(item.year)} />
                  )} />
                {year !== undefined && <View style={styles.choices}>
                  <Choice label="全年" selected={currentYear === year && currentMonth === undefined}
                    onPress={() => onApply({ year })} />
                  {months?.map((month) => (
                    <Choice key={month} label={`${month}月`} selected={currentYear === year && currentMonth === month}
                      onPress={() => onApply({ year, month })} />
                  ))}
                </View>}
              </>
            )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function YearGap() { return <View style={styles.yearGap} />; }

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: '#fff', padding: 16, gap: 14 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: '#161618', fontWeight: '700', fontSize: 19, marginBottom: 4 },
  note: { color: '#626266', fontSize: 13 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  years: { flexGrow: 0 },
  yearGap: { width: yearGap },
  year: { width: yearWidth },
  choice: { paddingHorizontal: 12, minHeight: 42, borderRadius: 8, backgroundColor: '#f1f1f3', alignItems: 'center', justifyContent: 'center' },
  choiceText: { color: '#252529', fontSize: 14 },
  selected: { backgroundColor: '#202024' },
  selectedText: { color: '#fff', fontWeight: '600' },
});
