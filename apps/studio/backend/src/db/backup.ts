import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

/** Create a consistent SQLite snapshot, including committed WAL data. Destination must be new. */
export async function backupSqlite(sourcePath: string, destinationPath: string): Promise<void> {
  const source = path.resolve(sourcePath)
  const destination = path.resolve(destinationPath)
  if (source === destination) throw new Error('Source and destination must differ')
  if (!fs.existsSync(source)) throw new Error(`Source database does not exist: ${source}`)
  if (fs.existsSync(destination)) throw new Error(`Destination already exists: ${destination}`)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.partial`
  if (fs.existsSync(temporary)) throw new Error(`Temporary destination already exists: ${temporary}`)
  const db = new Database(source, { readonly: true, fileMustExist: true })
  try {
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Source database integrity check failed')
    await db.backup(temporary)
    const snapshot = new Database(temporary, { readonly: true, fileMustExist: true })
    try {
      if (snapshot.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Snapshot integrity check failed')
    } finally {
      snapshot.close()
    }
    fs.renameSync(temporary, destination)
  } finally {
    db.close()
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}
