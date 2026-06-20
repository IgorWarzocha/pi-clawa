type DbModule = typeof import('../db.js');

export async function withDb<T>(operation: (db: DbModule) => T | Promise<T>): Promise<T> {
  const db = await import('../db.js');
  db.initDb();

  try {
    return await operation(db);
  } finally {
    db.closeDb();
  }
}
