/**
 * 按键互斥锁：同一电箱的写操作串行化，避免 SQLite 并发写 "database is locked"。
 * 注意：这只是降噪；占用正确性由条件 UPDATE (updateMany ... where status=FREE) 保证。
 */
const waiters = new Map<string, Promise<unknown>>();

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  while (waiters.has(key)) {
    await waiters.get(key).catch(() => undefined);
  }
  let release: () => void;
  const ticket = new Promise<void>((resolve) => (release = resolve));
  waiters.set(key, ticket);
  try {
    return await fn();
  } finally {
    waiters.delete(key);
    release!();
  }
}
