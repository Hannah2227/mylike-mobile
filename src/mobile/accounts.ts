import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import * as data from './accounts-data';
import { createMobileStore } from './store';
import type { QueryDb } from './local-data';
function queries(db: SQLiteDatabase): QueryDb { return { runAsync: (sql, values = []) => db.runAsync(sql, values), getFirstAsync: <T>(sql: string, values: (string | number | null)[] = []) => db.getFirstAsync<T>(sql, values), getAllAsync: <T>(sql: string, values: (string | number | null)[] = []) => db.getAllAsync<T>(sql, values) }; }
let opening: ReturnType<typeof openDatabaseAsync> | undefined;
let pending = Promise.resolve();
async function database() { return opening ??= openDatabaseAsync('mylike-accounts.db').then(async db => { await db.execAsync(data.accountsSchema); return db; }).catch(error => { opening = undefined; throw error; }); }
function write<T>(operation: () => Promise<T>) { const task = pending.then(operation); pending = task.then(() => undefined, () => undefined); return task; }
export function loadAccounts() { return write(async () => {
  const db = await database(); let name = 'MyLike';
  if (!await db.getFirstAsync('SELECT 1 FROM accounts LIMIT 1')) {
    const stored = await createMobileStore().readState('nickname');
    try { const value = JSON.parse(stored ?? 'null'); if (typeof value === 'string' && value.trim()) name = value; } catch { /* Existing local ID remains optional. */ }
  }
  return data.readAccounts(queries(db), name);
}); }
export function selectAccount(id: string) { return write(async () => data.selectAccount(queries(await database()), id)); }
export function addAccount(label: string) { return write(async () => {
  const db = await database(); let account!: data.LocalAccount;
  await db.withExclusiveTransactionAsync(async transaction => {
    const query = queries(transaction);
    account = await data.addAccount(query, label, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
    await data.selectAccount(query, account.id);
  });
  return account;
}); }
export function renameAccount(id: string, label: string) { return write(async () => data.renameAccount(queries(await database()), id, label)); }
