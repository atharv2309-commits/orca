// WAL bytes and per-column bytes written while a 100 KB answer streams as text snapshots.

import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import Database from '../../sqlite/sync-database'
import { message, messageFixture } from './journal-sql-message.test-fixture'

const SAVES = 150
const ANSWER_CHARS = 100 * 1024

async function stream(answers: number) {
  const dir = mkdtempSync(join(tmpdir(), 'text-snapshot-wal-'))
  const path = join(dir, 'journal.db')
  const db = new Database(path)
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('wal_autocheckpoint = 0')
    const { commit } = messageFixture(db)
    const walBefore = statSync(`${path}-wal`).size
    const columns = { payload: 0, wire: 0, detail: 0, outline: 0 }
    const started = performance.now()
    for (let save = 1; save <= SAVES; save++) {
      const text = 'word '.repeat(Math.ceil((ANSWER_CHARS * save) / SAVES / 5))
      for (let answer = 0; answer < answers; answer++) {
        await commit(message(text, `assistant-${answer}`))
      }
      const row = db
        .prepare(
          `SELECT length(payload_json) p, coalesce(length(wire_json),0) w, coalesce(length(detail_json),0) d,
            coalesce(length(outline_source_json),0) o FROM journal_items WHERE item_id='orca:assistant-0'`
        )
        .get() as { p: number; w: number; d: number; o: number }
      columns.payload += row.p
      columns.wire += row.w
      columns.detail += row.d
      columns.outline += row.o
    }
    const ms = performance.now() - started
    const walBytes = statSync(`${path}-wal`).size - walBefore
    return { answers, saves: SAVES, walBytes, walBytesPerAnswer: walBytes / answers, columnsAnswer0: columns, msTotal: ms }
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

it('reports WAL bytes per streamed 100 KB answer', { timeout: 600_000 }, async () => {
  for (const answers of [1, 150]) {
    const result = await stream(answers)
    console.log(JSON.stringify(result))
    expect(result.walBytes).toBeGreaterThan(0)
  }
})
