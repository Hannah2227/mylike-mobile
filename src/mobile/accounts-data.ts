import type { QueryDb } from './local-data.ts';
import { validName } from './local-data.ts';

export type LocalAccount = { id: string; label: string; database: string };
export const accountsSchema = `CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,label TEXT NOT NULL COLLATE NOCASE UNIQUE,database_name TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS account_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);`;
const columns = 'id,label,database_name AS database';
export async function readAccounts(db: QueryDb, defaultName = 'MyLike') {
  await db.runAsync('INSERT OR IGNORE INTO accounts VALUES(?,?,?)', ['default', validName(defaultName), 'mylike-mobile.db']);
  const accounts = await db.getAllAsync<LocalAccount>(`SELECT ${columns} FROM accounts ORDER BY CASE WHEN id='default' THEN 0 ELSE 1 END,rowid`);
  const saved = await db.getFirstAsync<{ value: string }>("SELECT value FROM account_state WHERE key='active'");
  const active = accounts.find(row => row.id === saved?.value) ?? accounts.find(row => row.id === 'default')!;
  if (!active || accounts.some(row => row.id === 'default' ? row.database !== 'mylike-mobile.db' : !/^mylike-account-[a-z0-9-]+\.db$/.test(row.database))) throw new Error('本机账号记录无效，请检查数据。');
  return { accounts, active };
}
export async function selectAccount(db: QueryDb, id: string) {
  const account = await db.getFirstAsync<LocalAccount>(`SELECT ${columns} FROM accounts WHERE id=?`, [id]);
  if (!account) throw new Error('本机账号不存在。');
  await db.runAsync("INSERT INTO account_state VALUES('active',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [id]);
  return account;
}
async function uniqueName(db: QueryDb, value: string, except = '') {
  const label = validName(value);
  if (await db.getFirstAsync('SELECT 1 FROM accounts WHERE label=? COLLATE NOCASE AND id<>?', [label, except])) throw new Error('这个 ID 已被其他本机账号使用。');
  return label;
}
export async function addAccount(db: QueryDb, value: string, id: string) {
  if (!/^[a-z0-9-]{8,80}$/.test(id) || id === 'default') throw new Error('账号标识无效。');
  const label = await uniqueName(db, value); const database = `mylike-account-${id}.db`;
  await db.runAsync('INSERT INTO accounts VALUES(?,?,?)', [id, label, database]);
  return { id, label, database };
}
export async function renameAccount(db: QueryDb, id: string, value: string) {
  const label = await uniqueName(db, value, id);
  if (!await db.getFirstAsync('SELECT 1 FROM accounts WHERE id=?', [id])) throw new Error('本机账号不存在。');
  await db.runAsync('UPDATE accounts SET label=? WHERE id=?', [label, id]); return label;
}
