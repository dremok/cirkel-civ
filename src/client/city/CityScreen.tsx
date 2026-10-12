// The city screen: a full-screen diorama of one city, with its plots, buildings and people, and a
// quiet layer of panels for the long decisions: what to build where, and what the city focuses on.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BUILDINGS, type BuildingType, type CityFocus, FOCUS_NAMES, PLOTS, PLOT_NEIGHBORS, canPlace, cityOutput, neighborInDir, previewPlacement } from '../../engine/city.ts'
import { FOOD_PER_POP, growthThreshold } from '../../engine/economy.ts'
import type { Biome } from '../../engine/types.ts'
import { PLAYERS } from '../render/palette.ts'
import type { CityScreenProps } from './api.ts'
import './city.css'
import { Icon } from './icons.tsx'
import { DIR_NAMES } from './scene/layout.ts'
import { type CityScene, type Quality, type SceneData, createCityScene } from './scene/scene.ts'

const ORDER: BuildingType[] = ['house', 'farm', 'sawmill', 'harbor', 'workshop', 'market', 'temple', 'barracks', 'tower', 'wall']
const FOCI: CityFocus[] = ['growth', 'balance', 'production']

const UNIT_NAMES: Record<string, string> = { spear: 'Spearman', archer: 'Archer', rider: 'Rider', settler: 'Settler', walls: 'Walls' }

const BIOME_TEXT: Record<Biome, string> = {
  deep: 'the open sea', shallow: 'the shallows', beach: 'the beach', grass: 'meadows', plains: 'plains',
  forest: 'the forest', hills: 'the hills', mountain: 'the mountains', snow: 'snowy peaks',
}

function list(items: string[]): string {
  const u = [...new Set(items)]
  return u.length <= 1 ? u.join('') : `${u.slice(0, -1).join(', ')} and ${u[u.length - 1]}`
}

function turnsFor(cost: number, stored: number, prod: number): number | null {
  if (prod <= 0) return null
  return Math.max(1, Math.ceil(Math.max(0, cost - stored) / prod))
}

const fmt = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')

interface Opts { quality?: Quality | 'auto'; instant?: boolean; tiltShift?: boolean; view?: { dist?: number; yaw?: number; pitch?: number; x?: number; z?: number } }

export function CityScreen(props: CityScreenProps & { sceneOptions?: Opts }) {
  const { state, cityId, interior, me, construction, onBuild, onFocus, onClose } = props
  const city = state.cities.find((c) => c.id === cityId)!
  const map = state.map
  const owner = me !== null && me === city.owner
  const color = PLAYERS[((state.players[city.owner]?.color ?? city.owner) % PLAYERS.length + PLAYERS.length) % PLAYERS.length]

  const host = useRef<HTMLDivElement>(null)
  const chip = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const focusRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<CityScene | null>(null)
  const [phase, setPhase] = useState<'enter' | 'live' | 'exit'>('enter')
  const [selected, setSelected] = useState<number | null>(null)
  const [choice, setChoice] = useState<BuildingType | null>(null)
  const [yields, setYields] = useState(false)
  const yieldRefs = useRef<(HTMLDivElement | null)[]>([])
  /** Building first, plot second: the palette of buildings, then the plots that suit the pick. */
  const [palette, setPalette] = useState(false)
  const [paint, setPaint] = useState<BuildingType | null>(null)
  const paintRef = useRef<BuildingType | null>(null)
  paintRef.current = paint
  const paintRefs = useRef<(HTMLDivElement | null)[]>([])

  const out = useMemo(() => cityOutput(map, city.tile, interior, city.pop), [map, city.tile, interior, city.pop])
  const site = construction && 'building' in construction ? construction : null
  const unit = construction && 'unit' in construction ? construction : null
  const stored = construction?.progress ?? city.prod
  // Where the building picked from the palette could go, best first (by the city's focus).
  const weigh = (d: { food: number; prod: number; housing: number }) =>
    interior.focus === 'growth' ? d.food * 2 + d.prod + d.housing : interior.focus === 'production' ? d.prod * 2 + d.food + d.housing * 0.5 : d.food + d.prod + d.housing * 0.75
  const spotsFor = (t: BuildingType) => {
    const outList: { plot: number; d: { food: number; prod: number; housing: number }; v: number }[] = []
    for (let p = 1; p < PLOTS.length; p++) {
      if (site && site.plot === p) continue
      if (!canPlace(map, city.tile, interior, t, p).ok) continue
      const d = previewPlacement(map, city.tile, interior, city.pop, t, p)
      outList.push({ plot: p, d, v: weigh(d) })
    }
    return outList.sort((a, b) => b.v - a.v || a.plot - b.plot)
  }
  const candidates = useMemo(() => (paint ? spotsFor(paint) : []), [paint, interior, city.pop, site?.plot])

  const sceneData: SceneData = {
    interior, staffed: out.staffed, pop: city.pop, idle: out.idle,
    construction: site ? { building: site.building, plot: site.plot, progress: site.cost > 0 ? site.progress / site.cost : 0 } : null,
  }
  const latest = useRef(sceneData)
  latest.current = sceneData

  // Scene lifecycle (a layout effect, so the scene exists before the data effect below runs).
  useLayoutEffect(() => {
    const el = host.current!
    const scene = createCityScene(el, state, cityId, props.sceneOptions)
    sceneRef.current = scene
    scene.update(latest.current)
    if (import.meta.env.DEV) (window as unknown as { cityScene?: CityScene }).cityScene = scene
    scene.onPick = (p) => {
      if (p === 0) p = null
      const want = paintRef.current
      setPalette(false)
      setPaint(null)
      if (want && p !== null && canPlace(state.map, city.tile, latest.current.interior, want, p).ok) {
        setSelected(p)
        setChoice(want)
        return
      }
      setSelected((cur) => (cur === p ? null : p))
      setChoice(null)
    }
    let alive = true
    requestAnimationFrame(() => {
      if (!alive) return
      scene.enter().then(() => alive && setPhase('live'))
    })
    return () => {
      alive = false
      scene.dispose()
      sceneRef.current = null
    }
    // the scene is built once per city (and again if it changes hands)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId, city.owner, city.capital])

  useLayoutEffect(() => {
    sceneRef.current?.update(latest.current)
  }, [interior, out, city.pop, site?.building, site?.plot, site?.progress, site?.cost])

  useEffect(() => {
    const s = sceneRef.current
    if (!s) return
    s.select(selected)
    const empty = selected !== null && interior.plots[selected] === null && !(site && site.plot === selected)
    s.preview(empty && choice ? { building: choice, plot: selected! } : null)
    // neighbours that feed the chosen building glow softly
    if (paint && selected === null) {
      s.highlight(candidates.map((c) => c.plot))
    } else if (selected !== null && choice && empty) {
      const near = PLOT_NEIGHBORS[selected].filter((n) => {
        const b = interior.plots[n]
        if (choice === 'workshop') return b === 'workshop' || b === 'sawmill'
        if (choice === 'market') return b === 'house'
        if (choice === 'house') return b === 'market'
        if (choice === 'sawmill') return b === 'workshop'
        return false
      })
      s.highlight(near)
    } else s.highlight([])
  }, [selected, choice, interior, site?.plot, paint, candidates])

  // The delta chip follows the ghost on the board.
  const preview = selected !== null && choice ? previewPlacement(map, city.tile, interior, city.pop, choice, selected) : null
  useEffect(() => {
    const s = sceneRef.current
    if (!s) return
    s.onFrame = () => {
      const el = chip.current
      if (el) {
        const p = selected !== null && choice ? s.project(selected) : null
        if (!p) el.style.opacity = '0'
        else {
          el.style.opacity = '1'
          el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`
        }
      }
      if (paint) paintRefs.current.forEach((y, i) => {
        if (!y) return
        const p = s.project(i, 0.1)
        if (!p) { y.style.opacity = '0'; return }
        y.style.opacity = '1'
        y.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`
      })
      if (yields) yieldRefs.current.forEach((y, i) => {
        if (!y) return
        const p = s.project(i, 0.2)
        if (!p) { y.style.opacity = '0'; return }
        y.style.opacity = i === selected ? '0' : '1'
        y.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`
      })
    }
  }, [selected, choice, yields, paint])

  // Frame the town in the part of the screen the panels leave free.
  useLayoutEffect(() => {
    const measure = () => {
      const s = sceneRef.current, root = host.current
      if (!s || !root) return
      const W = root.clientWidth, H = root.clientHeight
      const wide = W >= 900
      const head = headRef.current, panel = panelRef.current, focus = focusRef.current
      const open = panelRef.current?.classList.contains('open') ?? false
      if (wide) {
        s.setInsets({ top: 0, left: 0, bottom: 0, right: open && panel ? W - panel.offsetLeft : 0 })
      } else {
        const top = head ? head.offsetTop + head.offsetHeight : 0
        const bottom = open && panel ? H - panel.offsetTop : focus ? H - focus.offsetTop : 0
        s.setInsets({ top: top * 0.9, left: 0, right: 0, bottom: bottom * 0.9 })
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  })

  const close = () => {
    if (phase === 'exit') return
    setPhase('exit')
    setSelected(null)
    setChoice(null)
    const s = sceneRef.current
    ;(s ? s.exit() : Promise.resolve()).then(() => onClose())
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (choice) setChoice(null)
      else if (selected !== null) setSelected(null)
      else if (paint) { setPaint(null); setPalette(true) }
      else if (palette) setPalette(false)
      else close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---- derived text
  const foodNet = out.food - FOOD_PER_POP * city.pop
  const full = city.pop >= out.housing
  const templeOn = interior.plots.some((b, i) => b === 'temple' && out.staffed[i])
  const need = Math.round(growthThreshold(city.pop) * (templeOn ? 0.75 : 1))
  const growIn = foodNet > 0 && !full ? Math.max(1, Math.ceil((need - city.food) / foodNet)) : null

  const faced = (plot: number) => PLOTS[plot].facing
    .map((d) => neighborInDir(map, city.tile, d))
    .filter((t): t is number => t !== null)
    .map((t) => BIOME_TEXT[map.tiles[t].biome])

  const where = (plot: number) => {
    const p = PLOTS[plot]
    if (p.ring === 1) return `Inner ring, ${DIR_NAMES[plot - 1]} of the square`
    const f = faced(plot)
    const side = sideText(plot)
    const edge = `${side.charAt(0).toUpperCase()}${side.slice(1)} edge`
    return f.length ? `${edge}, facing ${list(f)}` : `${edge}, at the end of the world`
  }

  const sideText = (plot: number) => list(PLOTS[plot].facing.map((d) => DIR_NAMES[d]))

  // ---- panel content
  let panel: React.ReactNode = null
  if (palette && selected === null) {
    panel = (
      <>
        <PanelHead icon="plot" title="Build" sub="Choose what to build, then where" onBack={() => setPalette(false)} />
        <ul className="cv-options" role="listbox" aria-label="Buildings">
          {ORDER.map((t) => {
            const info = BUILDINGS[t]
            const spots = spotsFor(t)
            const best = spots[0]
            const turns = turnsFor(info.cost, stored, out.prod)
            const effect = best ? effectText(t, best.plot, best.d, out.idle) : null
            return (
              <li key={t}>
                <button className="cv-option" disabled={!spots.length} onClick={() => { setPalette(false); setPaint(t) }}>
                  <span className="cv-option-icon"><Icon name={t} /></span>
                  <span className="cv-option-main">
                    <span className="cv-option-name">{info.name}</span>
                    <span className="cv-option-desc">{info.desc}</span>
                    {!best ? <span className="cv-effect warn">No free plot fits</span>
                      : <span className="cv-fits">{spots.length} {spots.length === 1 ? 'plot' : 'plots'}{effect ? '' : ', best'} {effect ? <span className="cv-effect inline">{effect.text}</span> : <Delta food={best.d.food} prod={best.d.prod} housing={best.d.housing} />}</span>}
                  </span>
                  <span className="cv-option-cost num">
                    <span><Icon name="prod" />{info.cost}</span>
                    {turns !== null && <span className="muted">{turns} {turns === 1 ? 'turn' : 'turns'}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </>
    )
  } else if (paint && selected === null) {
    const info = BUILDINGS[paint]
    panel = (
      <>
        <PanelHead icon={paint} title={info.name} sub="Pick a plot. The best spots glow on the board." onBack={() => { setPaint(null); setPalette(true) }} />
        <ul className="cv-options" role="listbox" aria-label="Plots">
          {candidates.slice(0, 6).map((c, i) => {
            const effect = effectText(paint, c.plot, c.d, out.idle)
            return (
              <li key={c.plot}>
                <button className="cv-option cv-spot" onClick={() => { setPaint(null); setSelected(c.plot); setChoice(paint) }}>
                  <span className="cv-option-icon num">{i === 0 ? '★' : i + 1}</span>
                  <span className="cv-option-main">
                    <span className="cv-option-name">{where(c.plot)}</span>
                    {effect ? <span className={`cv-effect${effect.warn ? ' warn' : ''}`}>{effect.text}</span> : <Delta food={c.d.food} prod={c.d.prod} housing={c.d.housing} />}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        {candidates.length > 6 && <p className="cv-note">And {candidates.length - 6} more on the board.</p>}
      </>
    )
  } else if (selected !== null) {
    const b = interior.plots[selected]
    const building = site && site.plot === selected && !b
    if (building && site) {
      const t = turnsFor(site.cost, site.progress, out.prod)
      panel = (
        <>
          <PanelHead icon={site.building} title={`${BUILDINGS[site.building].name}`} sub="Under construction" onBack={() => setSelected(null)} />
          <Progress value={site.progress} max={site.cost} label={`${Math.floor(site.progress)} / ${site.cost}`} turns={t} />
          <p className="cv-desc">{BUILDINGS[site.building].desc}</p>
          {owner && <button className="btn btn-ghost btn-block cv-cancel" onClick={() => { onBuild(null); setSelected(null) }}>Stop building</button>}
        </>
      )
    } else if (b) {
      const info = BUILDINGS[b]
      const y = out.perPlot[selected]
      const staffed = out.staffed[selected]
      let status: React.ReactNode
      if (b === 'house') status = <Line icon="housing" text={`${city.pop} of ${out.housing} homes in town are lived in`} />
      else if (b === 'wall') status = <Line icon="wall" text={`Guards the ${sideText(selected)}`} />
      else if (b === 'tower') status = <Line icon="tower" text={`Covers the ${sideText(selected)}`} />
      else if (b === 'barracks') status = <Line icon="barracks" text="Units cost 25% less" />
      else if (!staffed) status = <Line icon="people" text={out.idle === 0 && city.pop > 0 ? 'No one to work here yet' : 'No worker yet'} muted />
      else if (b === 'temple') status = <Line icon="people" text="Staffed: the city grows faster" />
      else status = <Yields food={y.food} prod={y.prod} label="Gives now" />
      const near = PLOT_NEIGHBORS[selected].map((n) => interior.plots[n])
      const bonus = b === 'workshop' ? `${near.filter((n) => n === 'workshop' || n === 'sawmill').length} workshops or sawmills next door`
        : b === 'market' ? `${Math.min(3, near.filter((n) => n === 'house').length)} houses next door (up to 3 count)`
          : null
      panel = (
        <>
          <PanelHead icon={b} title={info.name} sub={where(selected)} onBack={() => setSelected(null)} />
          <p className="cv-desc">{info.desc}</p>
          <div className="cv-status">{status}</div>
          {bonus && <p className="cv-note">{bonus}</p>}
          {info.worker && <p className="cv-note">{staffed ? 'A citizen works here.' : `Needs a citizen. Focus decides who works where.`}</p>}
        </>
      )
    } else {
      const options = ORDER.filter((t) => canPlace(map, city.tile, interior, t, selected).ok)
      const cur = choice ? BUILDINGS[choice] : null
      const curTurns = choice ? turnsFor(BUILDINGS[choice].cost, stored, out.prod) : null
      panel = (
        <>
          <PanelHead icon="plot" title="Empty plot" sub={where(selected)} onBack={() => (choice ? setChoice(null) : setSelected(null))} />
          {!owner && <p className="cv-note">Only the owner can build here.</p>}
          <ul className="cv-options" role="listbox" aria-label="Buildings">
            {options.map((t) => {
              const info = BUILDINGS[t]
              const pv = previewPlacement(map, city.tile, interior, city.pop, t, selected)
              const turns = turnsFor(info.cost, stored, out.prod)
              const effect = effectText(t, selected, pv, out.idle)
              return (
                <li key={t}>
                  <button className={`cv-option${choice === t ? ' on' : ''}`} aria-pressed={choice === t} disabled={!owner} onClick={() => setChoice(choice === t ? null : t)}>
                    <span className="cv-option-icon"><Icon name={t} /></span>
                    <span className="cv-option-main">
                      <span className="cv-option-name">{info.name}</span>
                      <span className="cv-option-desc">{info.desc}</span>
                      {effect ? <span className={`cv-effect${effect.warn ? ' warn' : ''}`}>{effect.text}</span> : <Delta food={pv.food} prod={pv.prod} housing={pv.housing} />}
                    </span>
                    <span className="cv-option-cost num">
                      <span><Icon name="prod" />{info.cost}</span>
                      {turns !== null && <span className="muted">{turns} {turns === 1 ? 'turn' : 'turns'}</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {owner && cur && choice && (
            <div className="cv-confirm">
              {site && <p className="cv-note">Replaces {BUILDINGS[site.building].name}. Stored production carries over.</p>}
              {unit && <p className="cv-note">Replaces {UNIT_NAMES[unit.unit] ?? unit.unit}. Stored production carries over.</p>}
              <button className="btn btn-primary btn-block" onClick={() => { onBuild({ building: choice, plot: selected }); setChoice(null); setSelected(null) }}>
                Build {cur.name}{curTurns !== null ? ` · ${curTurns} ${curTurns === 1 ? 'turn' : 'turns'}` : ''}
              </button>
            </div>
          )}
        </>
      )
    }
  }

  const panelOpen = panel !== null
  const cTurns = construction ? turnsFor(construction.cost, construction.progress, out.prod) : null
  const cName = site ? BUILDINGS[site.building].name : unit ? UNIT_NAMES[unit.unit] ?? unit.unit : null

  return (
    <div className={`cv-root cv-${phase}${panelOpen ? ' cv-has-panel' : ''}`} style={{ ['--team' as string]: color.base, ['--team-light' as string]: color.light, ['--team-dark' as string]: color.dark }}>
      <div className="cv-canvas" ref={host} />
      {yields && (
        <div className="cv-yields" aria-hidden="true">
          {interior.plots.map((b, i) => {
            if (!b) return null
            const info = BUILDINGS[b]
            const y = out.perPlot[i]
            let body: React.ReactNode
            if (info.worker && !out.staffed[i]) body = <span className="idle"><Icon name="people" />idle</span>
            else if (y.food || y.prod) body = <>{y.food ? <span><Icon name="food" />{y.food}</span> : null}{y.prod ? <span><Icon name="prod" />{y.prod}</span> : null}</>
            else if (b === 'house') body = <span><Icon name="housing" />2</span>
            else return null
            return <div key={i} className="cv-yield num" ref={(el) => { yieldRefs.current[i] = el }}>{body}</div>
          })}
        </div>
      )}
      {paint && selected === null && (
        <div className="cv-yields" aria-hidden="true">
          {candidates.map((c, i) => {
            const e = effectText(paint, c.plot, c.d, out.idle)
            return (
              <div key={c.plot} className={`cv-yield num${i === 0 ? ' best' : ''}`} ref={(el) => { paintRefs.current[c.plot] = el }}>
                {e ? <span className="idle">{e.warn ? 'no worker' : '✓'}</span> : <>
                  {c.d.food ? <span><Icon name="food" />{fmt(c.d.food)}</span> : null}
                  {c.d.prod ? <span><Icon name="prod" />{fmt(c.d.prod)}</span> : null}
                  {c.d.housing ? <span><Icon name="housing" />{fmt(c.d.housing)}</span> : null}
                </>}
              </div>
            )
          })}
        </div>
      )}
      <div className="cv-chip" ref={chip} aria-hidden="true">
        {preview && choice && selected !== null && (() => {
          const e = effectText(choice, selected, preview, out.idle)
          return e ? <span className={`cv-delta compact${e.warn ? ' warn' : ''}`}><span className="none">{e.text}</span></span> : <Delta food={preview.food} prod={preview.prod} housing={preview.housing} compact />
        })()}
      </div>

      <header className="cv-head glass" ref={headRef}>
        <div className="cv-title">
          <span className="swatch" style={{ ['--c' as string]: color.base }} />
          <div>
            <h1 className="serif">{city.name}</h1>
            <div className="label">{city.capital ? 'Capital' : 'Town'} {'·'} {state.players[city.owner]?.name ?? ''}</div>
          </div>
        </div>
        <div className="cv-stats num">
          <Stat icon="people" value={`${city.pop}`} unit={`/ ${out.housing}`} title="Citizens / housing" warn={full} />
          <Stat icon="food" value={fmt(foodNet)} title="Food per turn, after eating" warn={foodNet < 0} />
          <Stat icon="prod" value={fmt(out.prod)} title="Production per turn" />
        </div>
        <div className="cv-build">
          {construction && cName ? (
            <button className="cv-build-row" onClick={() => site && (setPalette(false), setPaint(null), setSelected(site.plot), setChoice(null))} disabled={!site}>
              <span className="cv-build-icon">{site ? <Icon name={site.building} /> : <Icon name="barracks" />}</span>
              <span className="cv-build-main">
                <span className="cv-build-name">{site ? 'Building' : 'Training'} <b>{cName}</b></span>
                <span className="cv-build-meter">
                  <span className="cv-bar"><i style={{ width: `${Math.min(100, (construction.progress / Math.max(1, construction.cost)) * 100)}%` }} /></span>
                  <span className="cv-build-turns num">{cTurns !== null ? `${cTurns} ${cTurns === 1 ? 'turn' : 'turns'}` : '\u2013'}</span>
                </span>
              </span>
            </button>
          ) : (
            <div className="cv-build-row idle"><span className="cv-build-icon"><Icon name="plot" /></span><span className="cv-build-name muted">Nothing in production.</span></div>
          )}
          {owner && (
            <button className={`cv-build-btn${palette || paint ? ' on' : ''}`} onClick={() => { setSelected(null); setChoice(null); setPaint(null); setPalette(!(palette || paint)) }}>
              <Icon name="prod" />Build
            </button>
          )}
        </div>
        <div className="cv-grow muted">
          {full ? 'Housing is full. Build a house to grow.' : growIn ? `Grows in ${growIn} ${growIn === 1 ? 'turn' : 'turns'}.` : foodNet < 0 ? 'Starving. More food needed.' : 'Not growing.'}
          {out.idle > 0 ? ` ${out.idle} without work.` : ''}
        </div>
      </header>

      <button className="cv-close glass" onClick={close} aria-label="Back to the map"><Icon name="close" /></button>

      <div className="cv-focus glass" role="group" aria-label="Focus" ref={focusRef}>
        <span className="label">Focus</span>
        <div className="seg">
          {FOCI.map((f) => (
            <button key={f} aria-pressed={interior.focus === f} disabled={!owner} onClick={() => onFocus(f)}>{FOCUS_NAMES[f]}</button>
          ))}
        </div>
        <button className={`cv-eye${yields ? ' on' : ''}`} aria-pressed={yields} onClick={() => setYields(!yields)} title="Show what each building gives" aria-label="Show yields"><Icon name="food" /><Icon name="prod" /></button>
      </div>

      <aside className={`cv-panel glass${panelOpen ? ' open' : ''}`} aria-live="polite" ref={panelRef}>
        {panel}
      </aside>
    </div>
  )
}

/** What a building does when its gain is not food, production or housing (or when it has none yet). */
function effectText(t: BuildingType, plot: number, pv: { food: number; prod: number; housing: number }, idle: number): { text: string; warn?: boolean } | null {
  if (pv.food || pv.prod || pv.housing) return null
  const sides = list(PLOTS[plot].facing.map((d) => DIR_NAMES[d]))
  switch (t) {
    case 'barracks': return { text: 'Units 25% cheaper' }
    case 'tower': return { text: `Shoots further to the ${sides}` }
    case 'wall': return { text: `+50% defence from the ${sides}` }
    case 'temple': return idle > 0 ? { text: 'Score, and faster growth' } : { text: 'Needs a free citizen', warn: true }
    default: return BUILDINGS[t].worker && idle === 0 ? { text: 'Needs a free citizen', warn: true } : { text: 'No output yet', warn: true }
  }
}

function PanelHead({ icon, title, sub, onBack }: { icon: Parameters<typeof Icon>[0]['name']; title: string; sub: string; onBack: () => void }) {
  return (
    <div className="cv-panel-head">
      <span className="cv-panel-icon"><Icon name={icon} /></span>
      <div className="cv-panel-titles">
        <h2 className="serif">{title}</h2>
        <div className="cv-sub">{sub}</div>
      </div>
      <button className="icon-btn" onClick={onBack} aria-label="Close"><Icon name="close" /></button>
    </div>
  )
}

function Stat({ icon, value, unit, title, warn }: { icon: 'people' | 'food' | 'prod'; value: string; unit?: string; title: string; warn?: boolean }) {
  return (
    <div className={`cv-stat${warn ? ' warn' : ''}`} title={title}>
      <Icon name={icon} />
      <span className="v">{value}</span>
      {unit && <span className="u">{unit}</span>}
    </div>
  )
}

function Delta({ food, prod, housing, compact }: { food: number; prod: number; housing: number; compact?: boolean }) {
  const parts: React.ReactNode[] = []
  if (food) parts.push(<span key="f" className={food < 0 ? 'neg' : ''}><Icon name="food" />{fmt(food)}{compact ? '' : ' food'}</span>)
  if (prod) parts.push(<span key="p" className={prod < 0 ? 'neg' : ''}><Icon name="prod" />{fmt(prod)}{compact ? '' : ' production'}</span>)
  if (housing) parts.push(<span key="h"><Icon name="housing" />{fmt(housing)}{compact ? '' : ' housing'}</span>)
  if (!parts.length) parts.push(<span key="n" className="none">{compact ? 'no output' : 'No output now'}</span>)
  return <span className={`cv-delta num${compact ? ' compact' : ''}`}>{parts}</span>
}

function Yields({ food, prod, label }: { food: number; prod: number; label: string }) {
  return (
    <div className="cv-line"><span className="label">{label}</span><Delta food={food} prod={prod} housing={0} /></div>
  )
}

function Line({ icon, text, muted }: { icon: Parameters<typeof Icon>[0]['name']; text: string; muted?: boolean }) {
  return <div className={`cv-line${muted ? ' muted' : ''}`}><Icon name={icon} /><span>{text}</span></div>
}

function Progress({ value, max, label, turns }: { value: number; max: number; label: string; turns: number | null }) {
  return (
    <div className="cv-progress">
      <span className="cv-bar"><i style={{ width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%` }} /></span>
      <span className="num">{label}</span>
      <span className="muted num">{turns !== null ? `${turns} ${turns === 1 ? 'turn' : 'turns'} left` : 'No production'}</span>
    </div>
  )
}
