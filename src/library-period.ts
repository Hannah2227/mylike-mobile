export type PublicationPeriod = null | 'unknown' | { year: number; month?: number };

export function publicationBounds(period: { year: number; month?: number }): [number, number] {
  function atMonth(month: number) {
    const date = new Date(0);
    date.setUTCFullYear(period.year, month, 1);
    return date.getTime() - 8 * 60 * 60 * 1000;
  }
  return period.month === undefined ? [atMonth(0), atMonth(12)] : [atMonth(period.month - 1), atMonth(period.month)];
}

export function publicationLabel(period: PublicationPeriod) {
  if (!period) return '不限日期';
  if (period === 'unknown') return '日期未知';
  if (period.month === undefined) return `${period.year}年`;
  return `${period.year}.${String(period.month).padStart(2, '0')}`;
}
