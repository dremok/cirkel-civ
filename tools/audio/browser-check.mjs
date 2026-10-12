// Browser check for the audio: every asset decodes in Chromium (WebAudio), and the sandbox runs the
// engine (unlock, music, ambience, a fake replay) without errors.
//
//   npx vite --port 5197 &   then   node tools/audio/browser-check.mjs [url] [--webkit]
import { chromium, webkit } from 'playwright'

const args = process.argv.slice(2)
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5197'
const browser = args.includes('--webkit') ? await webkit.launch() : await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(`${base}/sandbox/audio.html`)
await page.waitForFunction(() => window.audio)
await page.mouse.click(10, 10) // the unlock gesture

const decoded = await page.evaluate(async () => {
  const { ASSETS } = await import('/audio/assets.gen.ts')
  const ctx = new (window.AudioContext ?? window.webkitAudioContext)()
  const out = []
  for (const [id, a] of Object.entries(ASSETS)) {
    for (const f of a.files) {
      try {
        const ab = await (await fetch(`/audio/${f}`)).arrayBuffer()
        const b = await new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej))
        const x = b.getChannelData(0)
        let lead = 0
        while (lead < x.length && Math.abs(x[lead]) <= 5e-4) lead++
        let peak = 0
        for (let c = 0; c < b.numberOfChannels; c++) for (const s of b.getChannelData(c)) peak = Math.max(peak, Math.abs(s))
        out.push({ id, f, ok: true, dur: b.duration, ch: b.numberOfChannels, lead: lead / b.sampleRate, peak, expect: a.dur, loop: a.loop ?? null })
      } catch (e) {
        out.push({ id, f, ok: false, err: String(e) })
      }
    }
  }
  return out
})

let bad = 0
for (const d of decoded) {
  if (!d.ok) { bad++; console.log(`FAIL ${d.f}: ${d.err}`); continue }
  const loopOk = !d.loop || d.dur >= d.loop[1]
  if (!loopOk || d.peak >= 1) bad++
  console.log(`${d.f.padEnd(30)} ${d.dur.toFixed(3).padStart(8)}s ch${d.ch} lead ${(d.lead * 1000).toFixed(1).padStart(5)} ms peak ${d.peak.toFixed(3)}${d.loop ? ` loop ${d.loop.join('..')} ${loopOk ? 'ok' : 'BEYOND BUFFER'}` : ''}`)
}

// Drive the engine through the sandbox buttons.
const click = (text) => page.getByRole('button', { name: text, exact: true }).first().click()
await click('planning')
await click('world')
await page.waitForTimeout(1500)
await click('tap')
await click('clash')
await click('Skirmish')
await page.waitForTimeout(5000)
await click('Big march (16 units)')
await page.waitForTimeout(4500)
await click('Siege and capture')
await page.waitForTimeout(4500)
await click('Economy turn')
await page.waitForTimeout(3000)
await click('Scouting (fog)')
await page.waitForTimeout(4500)
const state = await page.evaluate(() => {
  const a = window.audio
  return {
    unlocked: a.unlocked,
    ctx: a.ctx?.state,
    musicTime: a.playing?.deck.el.currentTime ?? null,
    musicPaused: a.playing?.deck.el.paused ?? null,
    beds: [...(a.beds?.keys() ?? [])],
    voices: a.voices?.length,
  }
})
console.log('engine', JSON.stringify(state))
console.log(errors.length ? `console errors:\n  ${errors.join('\n  ')}` : 'no console errors')
await browser.close()
process.exit(bad || errors.length || !state.unlocked ? 1 : 0)
