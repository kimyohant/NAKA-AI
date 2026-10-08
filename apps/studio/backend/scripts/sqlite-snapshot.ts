import { backupSqlite } from '../src/db/backup.js'

const [mode, source, destination] = process.argv.slice(2)
if (!['backup', 'restore'].includes(mode) || !source || !destination) {
  console.error('Usage: tsx scripts/sqlite-snapshot.ts <backup|restore> <source.sqlite3> <new-destination.sqlite3>')
  process.exitCode = 2
} else {
  try {
    await backupSqlite(source, destination)
    console.log(`${mode === 'restore' ? 'Restored copy' : 'Backup'} verified: ${destination}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
