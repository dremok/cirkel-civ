// One JSON file per game in <dataDir>/games. Writes are atomic (temp file, fsync, rename) and
// coalesced per game, so a crash or redeploy leaves either the old or the new file, never half.
import { mkdir, open, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { migrate, SCHEMA_VERSION } from './migrate.ts'
import type { GameRecord } from './types.ts'

interface Slot {
  rec: GameRecord
  again: boolean
  running: Promise<void>
}

export class Store {
  readonly dir: string
  private slots = new Map<string, Slot>()
  private seq = 0

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'games')
  }

  private file(id: string) {
    return join(this.dir, `${id}.json`)
  }

  /**
   * Creates the directory, removes temp files left by a crash, and returns every usable game,
   * migrated to the current schema. A migrated game's original file is kept in games/backup/.
   * Files that cannot be read or migrated are left alone and skipped.
   */
  async loadAll(): Promise<GameRecord[]> {
    await mkdir(this.dir, { recursive: true })
    const games: GameRecord[] = []
    for (const name of await readdir(this.dir)) {
      const path = join(this.dir, name)
      if (name.endsWith('.tmp')) {
        await unlink(path).catch(() => {})
        continue
      }
      if (!name.endsWith('.json')) continue
      try {
        const text = await readFile(path, 'utf8')
        const { rec, from } = migrate(JSON.parse(text))
        if (`${rec.id}.json` !== name) throw new Error(`id ${rec.id} does not match the file name`)
        if (from < SCHEMA_VERSION) {
          await mkdir(join(this.dir, 'backup'), { recursive: true })
          await writeFile(join(this.dir, 'backup', `${rec.id}.v${from}.json`), text)
          this.save(rec)
          console.log(`store: ${name} migrated from schema v${from} to v${SCHEMA_VERSION}`)
        }
        games.push(rec)
      } catch (e) {
        console.error(`store: skipping ${name}: ${(e as Error).message}`)
      }
    }
    return games
  }

  /** Schedules a write of the record's current contents. Calls during a write coalesce into one more write. */
  save(rec: GameRecord): void {
    const slot = this.slots.get(rec.id)
    if (slot) {
      slot.rec = rec
      slot.again = true
      return
    }
    const s: Slot = { rec, again: false, running: Promise.resolve() }
    s.running = (async () => {
      do {
        s.again = false
        await this.write(s.rec).catch((e) => console.error(`store: write ${rec.id} failed: ${(e as Error).message}`))
      } while (s.again)
      this.slots.delete(rec.id)
    })()
    this.slots.set(rec.id, s)
  }

  private async write(rec: GameRecord) {
    const json = JSON.stringify(rec)
    const file = this.file(rec.id)
    const tmp = `${file}.${process.pid}.${++this.seq}.tmp`
    const fh = await open(tmp, 'w')
    try {
      await fh.writeFile(json)
      await fh.sync()
    } finally {
      await fh.close()
    }
    await rename(tmp, file)
  }

  async remove(id: string): Promise<void> {
    await this.slots.get(id)?.running
    await unlink(this.file(id)).catch(() => {})
  }

  /** Resolves when every scheduled write has reached the disk. */
  async flush(): Promise<void> {
    while (this.slots.size) await Promise.all([...this.slots.values()].map((s) => s.running))
  }
}
