// Screenshot a page so an agent can LOOK at its work.
// Usage: node scripts/shot.mjs <url> <out.png> [--w 1440] [--h 900] [--wait 2500] [--mobile] [--eval "js"]
// Uses the installed Google Chrome (GPU) when available, else Playwright's Chromium.
// Prints console errors from the page.
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const url = args[0]
const out = args[1]
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
const mobile = args.includes('--mobile')
const w = Number(opt('w', mobile ? 390 : 1440))
const h = Number(opt('h', mobile ? 844 : 900))
const wait = Number(opt('wait', 2500))
const evalJs = opt('eval', null)

let browser
try {
  browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
} catch {
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
}
const ctx = await browser.newContext({
  viewport: { width: w, height: h },
  deviceScaleFactor: mobile ? 3 : 2,
  isMobile: mobile,
  hasTouch: mobile,
})
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`) })
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(wait)
if (evalJs) { await page.evaluate(evalJs); await page.waitForTimeout(800) }
await page.screenshot({ path: out })
const fps = await page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now()
  const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(n) }
  requestAnimationFrame(f)
}))
console.log(`saved ${out} (${w}x${h}${mobile ? ' mobile' : ''}), ~${fps} fps`)
if (errors.length) console.log(errors.slice(0, 20).join('\n'))
await browser.close()
