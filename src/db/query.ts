import { getPool } from './config';

export async function query<T>(sql: string, params: unknown[] = []): Promise<T> {
  const [rows] = await getPool().query(sql, params);
  return rows as T;
}
