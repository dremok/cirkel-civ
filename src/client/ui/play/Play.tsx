// The play screen: full-bleed 3D view, HUD on top, panels and actions in the thumb zone.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { audio, type ReplayAudio } from '../../audio/index.ts'
import { buildCost } from '../../../engine/index.ts'
import type { BuildingOrder, BuildItem, City, CityFocus, CityId, GameEvent, GameState, Stance, TileId, Unit } from '../../../engine/types.ts'
import type { CityConstruction } from '../../city/api.ts'
import type { GameView, Selection, ViewHandlers } from '../../render/api.ts'
import { createGameView } from '../../render/index.ts'
import { PLAYERS } from '../../render/palette.ts'
import { connection } from '../../net/connection.ts'
import { errorText } from '../../net/errors.ts'
import type { GameSession, GameSnapshot } from '../../net/session.ts'
import { getFlag, getName, getQuality, getSeenTurn, setFlag, setQuality, setSeatToken, setSeenTurn } from '../../net/storage.ts'
import { HelpSheet } from '../HelpSheet.tsx'
import { gameHash, gameUrl, go } from '../route.ts'
import { shareLink } from '../share.ts'
import { turnsWord, unitNoun } from '../strings.ts'
import { toast } from '../toast.tsx'
import { openCity, setCityOpener } from './cityHook.ts'
import { cityEconomy } from './economy.ts'
import { ActionBar, TopBar, type Phase } from './Hud.tsx'
import { describeTurn, type LogLine } from './log.ts'
import { EndScreen, MenuSheet, ReplayPanel, ScoreSheet } from './Overlays.tsx'
import { CityPanel, TilePanel, UnitPanel, type UnitActions } from './Panels.tsx'
import {
  buildPlans, cityAt, cityBuild, cityFocus, emptyDraft, isEnemyAt, isIdle, myUnits, nextUnit, planSteps, safeFindPath, safeReachable, unitAt, unitOrder,
  withCityBuild, withCityFocus, withUnitOrder, type Draft,
} from './planning.ts'

// The city diorama has its own renderer and models: load it only when someone goes into a city.
const CityScreen = lazy(() => import('../../city/index.ts').then((m) => ({ default: m.CityScreen })))

type Sel = { kind: 'unit'; id: number } | { kind: 'city'; id: number } | { kind: 'tile'; tile: TileId } | null

interface Replay {
  prev: GameState
  events: GameEvent[]
  next: GameState
  lines: LogLine[]
  playing: boolean
  tick: number | null
  open: boolean
}

const NO_SELECTION: Selection = { unit: null, city: null, reachable: [], preview: null, hover: null }
const SEND_DEBOUNCE_MS = 450
/** Seconds per tick in the replay; the sounds are scheduled on the same clock. */
const TICK_SECONDS = 0.5
const DRAG_PX = 8
/** Matches the CSS breakpoint where the panel moves to the bottom-left corner. */
const WIDE_PX = 900

export function Play({ session, snap }: { session: GameSession; snap: GameSnapshot }) {
  const msg = snap.view!
  const state = msg.state
  const me = msg.you
  const summary = snap.summary
  const finished = state.winner !== null

  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<GameView | null>(null)
  const [viewError, setViewError] = useState(false)
  const [viewEpoch, setViewEpoch] = useState(0)

  const [draft, setDraftState] = useState<Draft>(() => msg.myOrders ?? emptyDraft())
  const draftRef = useRef(draft)
  const draftTurn = useRef<number>(state.turn)
  const sendTimer = useRef(0)

  const [sel, setSel] = useState<Sel>(null)
  const [pending, setPending] = useState<TileId | null>(null)
  const [hover, setHover] = useState<TileId | null>(null)
  const pointer = useRef<{ type: string; x: number; y: number; moved: boolean; down: number }>({ type: 'mouse', x: 0, y: 0, moved: false, down: 0 })

  const [replay, setReplay] = useState<Replay | null>(null)
  const replayToken = useRef(0)
  const playingRef = useRef(false)
  const latest = useRef(msg)
  latest.current = msg

  const [sheet, setSheet] = useState<'menu' | 'help' | 'scores' | 'end' | null>(() => (getFlag('help') ? null : 'help'))
  // A quiet "Tur 6" beat when a new planning phase begins.
  const [banner, setBanner] = useState<{ turn: number; key: number } | null>(null)
  const showBanner = useCallback((turn: number) => setBanner({ turn, key: Date.now() }), [])
  const [optimisticReady, setOptimisticReady] = useState<boolean | null>(null)
  const [cityView, setCityView] = useState<CityId | null>(null)
  useEffect(
    () =>
      setCityOpener((id) => {
        audio.ui('page')
        setCityView(id)
      }),
    [],
  )

  // Music and ambience: the world outside, the town inside a city. Nothing sounds before the
  // player's first tap or key (the audio module waits for it) and hidden tabs stay silent.
  const inCity = cityView !== null
  useEffect(() => {
    audio.music(inCity ? 'city' : 'game')
    audio.ambience(inCity ? 'town' : 'world')
  }, [inCity])
  const replaySound = useRef<ReplayAudio | null>(null)
  const stung = useRef(false)
  useEffect(() => () => replaySound.current?.stop(), [])

  // ------------------------------------------------------------------ derived

  const mySeat = me !== null ? summary?.seats[me] : undefined
  const serverReady = !!mySeat?.ready
  const ready = optimisticReady ?? serverReady
  const playing = !!replay?.playing
  // Eliminated players keep their seat and watch the rest of the game.
  const out = me !== null && state.players[me]?.alive === false
  const phase: Phase = playing ? 'replay' : finished ? 'finished' : me === null ? 'watching' : out ? 'out' : ready ? 'waiting' : 'planning'
  const editable = phase === 'planning'

  const selUnit = sel?.kind === 'unit' ? state.units.find((u) => u.id === sel.id) ?? null : null
  const selCity = sel?.kind === 'city' ? state.cities.find((c) => c.id === sel.id) ?? null : null
  const mySelUnit = selUnit && me !== null && selUnit.owner === me ? selUnit : null

  useEffect(() => {
    if (optimisticReady !== null && optimisticReady === serverReady) setOptimisticReady(null)
  }, [serverReady, optimisticReady])

  // ------------------------------------------------------------------ the 3D view

  useEffect(() => {
    const host = hostRef.current!
    let view: GameView
    try {
      view = createGameView(host, latest.current.state.map, {
        onTileClick: (t, info) => handlers.current.onTileClick(t, info),
        onTileHover: (t) => handlers.current.onTileHover(t),
      })
    } catch (e) {
      console.error(e)
      setViewError(true)
      return
    }
    viewRef.current = view
    const q = getQuality()
    if (q !== 'auto') view.world.setQuality?.(q)
    const ro = new ResizeObserver(() => view.resize())
    ro.observe(host)
    // Tell taps from drags, and touch from mouse, whatever events the renderer listens to.
    const down = (e: PointerEvent) => {
      const p = pointer.current
      p.down++
      p.type = e.pointerType
      if (p.down === 1) {
        p.x = e.clientX
        p.y = e.clientY
        p.moved = false
      } else p.moved = true
    }
    const move = (e: PointerEvent) => {
      const p = pointer.current
      if (e.pointerType === 'mouse' && p.down === 0) p.type = 'mouse'
      if (p.down > 0 && Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_PX) p.moved = true
    }
    const up = () => {
      pointer.current.down = Math.max(0, pointer.current.down - 1)
    }
    host.addEventListener('pointerdown', down, true)
    host.addEventListener('pointermove', move, true)
    addEventListener('pointerup', up, true)
    addEventListener('pointercancel', up, true)
    setViewEpoch((n) => n + 1)
    return () => {
      host.removeEventListener('pointerdown', down, true)
      host.removeEventListener('pointermove', move, true)
      removeEventListener('pointerup', up, true)
      removeEventListener('pointercancel', up, true)
      ro.disconnect()
      view.dispose()
      viewRef.current = null
    }
  }, [])

  // ------------------------------------------------------------------ incoming states and replays

  const startReplay = useCallback((prev: GameState, events: GameEvent[], next: GameState) => {
    const view = viewRef.current
    const token = ++replayToken.current
    setSel(null)
    setPending(null)
    setReplay({ prev, events, next, lines: describeTurn(prev, events, next, latest.current.you), playing: true, tick: null, open: true })
    playingRef.current = true
    if (!view) return
    view.setPlans([])
    view.setSelection(NO_SELECTION)
    view.setState(prev, latest.current.you)
    replaySound.current?.stop()
    const you = latest.current.you
    const world = view.world
    const sound = audio.onEvents(events, TICK_SECONDS, {
      me: you,
      prev,
      pan: (t) => world.tileTop(t).clone().project(world.camera).x,
    })
    replaySound.current = sound
    // The replay's own sting covers the end of the game when it is in this turn.
    if (events.some((e) => e.kind === 'victory' || (e.kind === 'eliminated' && e.player === you))) stung.current = true
    const done = () => {
      if (token !== replayToken.current) return
      playingRef.current = false
      viewRef.current?.setState(latest.current.state, latest.current.you)
      setReplay((r) => r && { ...r, playing: false, tick: null })
      setSeenTurn(session.gameId, prev.turn)
      if (latest.current.state.winner === null && latest.current.state.turn > prev.turn) {
        showBanner(latest.current.state.turn)
        audio.ui('turn')
        // Something worth hearing about in the log (a city taken, founded, a player out).
        if (describeTurn(prev, events, next, latest.current.you).some((l) => l.important)) audio.ui('notify', { delay: 0.6 })
      }
    }
    view
      .playEvents(prev, events, next, {
        speed: TICK_SECONDS,
        onTick: (t) => {
          if (token !== replayToken.current) return
          sound.tick(t)
          setReplay((r) => r && { ...r, tick: t })
        },
      })
      .then(done, (e) => {
        console.error(e)
        done()
      })
  }, [session.gameId, showBanner])

  const handledSeq = useRef(0)
  const handledEpoch = useRef(0)
  const shownTurn = useRef<number | null>(null)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (handledSeq.current === snap.stateSeq) {
      // Same state, new view (it was recreated): just show the state.
      if (handledEpoch.current !== viewEpoch) {
        handledEpoch.current = viewEpoch
        view.setState(latest.current.state, latest.current.you)
      }
      return
    }
    handledSeq.current = snap.stateSeq
    handledEpoch.current = viewEpoch
    const m = latest.current
    const before = shownTurn.current
    shownTurn.current = m.state.turn
    // Live: every new turn plays (even a quiet one). On load: only an unseen turn with something in it.
    const fresh =
      before === null
        ? m.events.length > 0 && getSeenTurn(session.gameId) < (m.previous?.turn ?? Infinity)
        : m.state.turn > before
    if (m.previous && fresh) startReplay(m.previous, m.events, m.state)
    else if (!playingRef.current) view.setState(m.state, m.you)
    // Opening shot on phones: come in on your capital, close enough to play.
    if (before === null && !fresh && m.you !== null && matchMedia('(pointer: coarse)').matches) {
      const home = m.state.cities.find((c) => c.owner === m.you && c.capital) ?? m.state.cities.find((c) => c.owner === m.you)
      if (home) view.world.focus(home.tile, true, { zoom: 'unit' })
    }
    // A new turn: start a fresh draft (or the one the server kept for us).
    if (draftTurn.current !== m.state.turn || before === null) {
      draftTurn.current = m.state.turn
      const d = m.myOrders ?? (before === null ? draftRef.current : emptyDraft())
      draftRef.current = d
      setDraftState(d)
      setOptimisticReady(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.stateSeq, viewEpoch])

  // ------------------------------------------------------------------ plans and selection → view

  const plans = useMemo(() => (me === null ? [] : buildPlans(state, draft, me)), [state, draft, me])
  useEffect(() => {
    if (playing) return
    viewRef.current?.setPlans(plans)
  }, [plans, playing, viewEpoch])

  const reachable = useMemo(
    () => (mySelUnit && editable ? safeReachable(state, mySelUnit.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mySelUnit?.id, mySelUnit?.tile, state, editable],
  )

  const preview = useMemo<Selection['preview']>(() => {
    if (!mySelUnit || !editable) return null
    const dest = pending ?? (pointer.current.type === 'mouse' ? hover : null)
    if (dest === null || dest === mySelUnit.tile) return null
    const other = unitAt(state, dest)
    if (other && other.owner === me) return null
    if (mySelUnit.type === 'archer' && isEnemyAt(state, me!, dest)) return null
    const path = safeFindPath(state, mySelUnit.id, dest)
    if (!path) return null
    const o = unitOrder(draft, mySelUnit)
    return {
      steps: planSteps(state, mySelUnit.id, path),
      kind: isEnemyAt(state, me!, dest) ? 'attack' : mySelUnit.type === 'settler' && o.found ? 'found' : 'move',
    }
  }, [mySelUnit, editable, pending, hover, state, me, draft])

  useEffect(() => {
    if (playing) return
    viewRef.current?.setSelection({
      unit: selUnit?.id ?? null,
      city: selCity?.id ?? null,
      reachable,
      preview,
      hover: pending ?? (pointer.current.type === 'mouse' ? hover : null) ?? (sel?.kind === 'tile' ? sel.tile : null),
    })
  }, [selUnit?.id, selCity?.id, reachable, preview, hover, pending, sel, playing, viewEpoch])

  // Keep the selection in the part of the map that the HUD does not cover. The insets are
  // stable: the world re-centres instantly on a change, so following every panel open/close
  // would make the map jump under the player's finger. Phones reserve the lower part of the
  // screen for the panel; wide screens only lose the top bar and the action bar.
  const bottomRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const justFocused = useRef(false)
  useEffect(() => {
    const world = viewRef.current?.world
    if (!world?.setViewInsets || !bottomRef.current || !topRef.current) return
    const push = () => {
      const top = topRef.current?.getBoundingClientRect().bottom ?? 0
      const bar = (bottomRef.current?.lastElementChild as HTMLElement | null)?.getBoundingClientRect()
      const barCover = bar ? innerHeight - bar.top : 0
      const reserve = innerWidth < WIDE_PX ? Math.min(380, Math.max(260, innerHeight * 0.36)) : 0
      world.setViewInsets!({ top, bottom: barCover + reserve, left: 0, right: 0 })
    }
    const ro = new ResizeObserver(push)
    ro.observe(topRef.current)
    if (bottomRef.current.lastElementChild) ro.observe(bottomRef.current.lastElementChild)
    addEventListener('resize', push)
    push()
    return () => {
      ro.disconnect()
      removeEventListener('resize', push)
    }
  }, [viewEpoch])

  const selTile = selUnit?.tile ?? selCity?.tile ?? (sel?.kind === 'tile' ? sel.tile : null)
  useEffect(() => {
    const view = viewRef.current
    if (!view || selTile === null) return
    // An explicit focus (Next unit) is already moving the camera.
    if (justFocused.current) {
      justFocused.current = false
      return
    }
    const id = requestAnimationFrame(() => {
      const b = bottomRef.current?.getBoundingClientRect()
      const t = topRef.current?.getBoundingClientRect()
      if (!b || !t) return
      const p = view.world.tileTop(selTile).clone().project(view.world.camera)
      const r = view.world.renderer.domElement.getBoundingClientRect()
      const y = r.top + ((1 - p.y) / 2) * r.height
      const x = r.left + ((p.x + 1) / 2) * r.width
      if (y > b.top - 28 || y < t.bottom + 28 || x < 24 || x > innerWidth - 24) view.focusTile(selTile, true)
    })
    return () => cancelAnimationFrame(id)
  }, [selTile, sel?.kind])

  // ------------------------------------------------------------------ editing the draft

  const unsent = useRef<{ turn: number; d: Draft } | null>(null)
  const flush = useCallback(() => {
    clearTimeout(sendTimer.current)
    if (unsent.current) session.sendOrders(unsent.current.turn, unsent.current.d, false)
    unsent.current = null
  }, [session])
  const setDraft = useCallback(
    (d: Draft) => {
      draftRef.current = d
      setDraftState(d)
      clearTimeout(sendTimer.current)
      unsent.current = { turn: latest.current.state.turn, d }
      sendTimer.current = window.setTimeout(flush, SEND_DEBOUNCE_MS)
    },
    [flush],
  )
  // Never lose the last edit: send it right away when leaving or hiding the page.
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && flush()
    document.addEventListener('visibilitychange', onHide)
    addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      removeEventListener('pagehide', flush)
      flush()
    }
  }, [flush])

  // With a turn timer, the server resolves with whatever it has: send the last edit before the deadline.
  useEffect(() => {
    const deadline = msg.deadline
    if (!deadline) return
    const id = setInterval(() => {
      if (unsent.current && deadline - Date.now() < 2500) flush()
    }, 500)
    return () => clearInterval(id)
  }, [msg.deadline, flush])

  const pressReady = useCallback(() => {
    if (phase !== 'planning') return
    clearTimeout(sendTimer.current)
    unsent.current = null
    session.sendOrders(state.turn, draftRef.current, true)
    audio.ui('confirm')
    setOptimisticReady(true)
    setSel(null)
    setPending(null)
  }, [phase, session, state.turn])

  const unready = useCallback(() => {
    clearTimeout(sendTimer.current)
    unsent.current = null
    session.sendOrders(state.turn, draftRef.current, false)
    audio.ui('cancel')
    setOptimisticReady(false)
  }, [session, state.turn])

  const selectUnit = useCallback((u: Unit | null, focus = false) => {
    if (u) audio.ui('select')
    setPending(null)
    setSel(u ? { kind: 'unit', id: u.id } : null)
    if (u && focus) viewRef.current?.focusTile(u.tile, true)
    if (u) setReplay((r) => (r && !r.playing ? { ...r, open: false } : r))
  }, [])

  const goNext = useCallback(() => {
    if (me === null) return
    const n = nextUnit(state, draftRef.current, me, mySelUnit?.id ?? null)
    if (!n) return
    // On phones, come in close enough to tap the unit. With a mouse the camera only follows if
    // the unit is hidden behind the HUD or off screen.
    if (pointer.current.type !== 'mouse') {
      justFocused.current = true
      viewRef.current?.world.focus(n.tile, true, { zoom: 'unit' })
    }
    selectUnit(n)
  }, [me, state, mySelUnit, selectUnit])

  const unitActions: UnitActions | null = mySelUnit
    ? {
        setStance: (s: Stance) => {
          audio.ui('tap')
          const patch = s === 'hold' ? { stance: s, path: [], found: false } : { stance: s }
          setDraft(withUnitOrder(draftRef.current, mySelUnit, patch))
        },
        toggleFound: () => {
          const o = unitOrder(draftRef.current, mySelUnit)
          audio.ui(o.found ? 'cancel' : 'order')
          setDraft(withUnitOrder(draftRef.current, mySelUnit, { found: !o.found, stance: o.stance === 'hold' ? 'cautious' : o.stance }))
        },
        clear: () => {
          audio.ui('cancel')
          setDraft(withUnitOrder(draftRef.current, mySelUnit, { path: [], found: false, target: null }))
        },
        clearTarget: () => {
          audio.ui('cancel')
          setDraft(withUnitOrder(draftRef.current, mySelUnit, { target: null }))
        },
      }
    : null

  const setBuild = useCallback(
    (item: BuildItem) => {
      if (!selCity) return
      audio.ui('order')
      setDraft(withCityBuild(draftRef.current, selCity, item))
    },
    [selCity, setDraft],
  )

  // ------------------------------------------------------------------ map input

  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef(0)
  const flashNotice = (text: string) => {
    setNotice(text)
    clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2200)
  }
  useEffect(() => setNotice(null), [sel])

  const lastTap = useRef<{ tile: TileId; time: number; unitSelected: boolean } | null>(null)
  const onTap = (tile: TileId) => {
    if (playing) return
    const u = unitAt(state, tile)
    const c = cityAt(state, tile)
    const touch = pointer.current.type !== 'mouse'
    setReplay((r) => (r && !r.playing ? { ...r, open: false } : r))

    // A double tap (or double click) on your own city opens the city view, unless it was meant
    // as a move: that only counts when no unit of yours was selected before the first tap.
    const now = performance.now()
    const prevTap = lastTap.current
    lastTap.current = { tile, time: now, unitSelected: !!mySelUnit && mySelUnit.tile !== tile }
    if (c && me !== null && c.owner === me && prevTap && prevTap.tile === tile && now - prevTap.time < 420 && !prevTap.unitSelected) {
      lastTap.current = null
      setPending(null)
      setSel({ kind: 'city', id: c.id })
      openCity(c.id)
      return
    }

    if (mySelUnit && editable && me !== null) {
      if (tile === mySelUnit.tile) {
        setPending(null)
        setSel(c && c.owner === me ? { kind: 'city', id: c.id } : null)
        return
      }
      if (u && u.owner === me) return selectUnit(u)
      const enemyHere = isEnemyAt(state, me, tile)
      if (mySelUnit.type === 'archer' && enemyHere) {
        setPending(null)
        audio.ui('order')
        setDraft(withUnitOrder(draftRef.current, mySelUnit, { target: tile }))
        return
      }
      const path = safeFindPath(state, mySelUnit.id, tile)
      if (!path) {
        setPending(null)
        flashNotice(`The ${unitNoun(mySelUnit.type)} can\u2019t go there.`)
        return
      }
      if (touch && pending !== tile) {
        audio.ui('tap')
        setPending(tile)
        return
      }
      audio.ui('order')
      const o = unitOrder(draftRef.current, mySelUnit)
      setDraft(
        withUnitOrder(draftRef.current, mySelUnit, {
          path,
          stance: o.stance === 'hold' ? 'cautious' : o.stance,
          found: mySelUnit.type === 'settler' ? !!o.found : false,
        }),
      )
      setPending(null)
      return
    }

    setPending(null)
    if (u) {
      if (sel?.kind === 'unit' && sel.id === u.id) {
        if (c) audio.ui('select')
        setSel(c ? { kind: 'city', id: c.id } : null)
      } else selectUnit(u)
    } else if (c) {
      const closing = sel?.kind === 'city' && sel.id === c.id
      if (!closing) audio.ui('select')
      setSel(closing ? null : { kind: 'city', id: c.id })
    } else {
      setSel(sel?.kind === 'tile' && sel.tile === tile ? null : sel ? null : { kind: 'tile', tile })
    }
  }

  const handlers = useRef<ViewHandlers>({ onTileClick: () => {}, onTileHover: () => {} })
  handlers.current = {
    onTileClick: (tile) => {
      if (pointer.current.moved) return
      onTap(tile)
    },
    onTileHover: (tile) => {
      if (pointer.current.type !== 'mouse') return
      setHover(tile)
    },
  }

  // Dev only: lets test scripts find tiles on screen and inspect the plan.
  if (import.meta.env.DEV) {
    ;(window as unknown as { __play: unknown }).__play = {
      state, draft, sel, me, phase, reachable, preview, openSheet: setSheet, setDraft, findPath: safeFindPath, ready: pressReady,
      replay,
      view: viewRef.current,
      selectCity: (id: number) => setSel({ kind: 'city', id }),
      audio,
      tileScreen(tile: TileId) {
        const v = viewRef.current
        if (!v) return null
        const p = v.world.tileTop(tile).clone().project(v.world.camera)
        const r = v.world.renderer.domElement.getBoundingClientRect()
        return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height }
      },
    }
  }

  // ------------------------------------------------------------------ keyboard

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (sheet || cityView !== null) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Enter') {
        if (t?.tagName === 'BUTTON') return
        e.preventDefault()
        if (phase === 'planning') pressReady()
        else if (phase === 'waiting') unready()
      } else if (e.key === 'Tab') {
        if (phase !== 'planning') return
        e.preventDefault()
        goNext()
      } else if (e.key === 'Escape') {
        if (pending !== null) setPending(null)
        else setSel(null)
      } else if (e.key === '1' || e.key === '2' || e.key === '3') {
        if (!unitActions || !editable) return
        unitActions.setStance((['cautious', 'aggressive', 'hold'] as const)[Number(e.key) - 1])
      } else if (e.key === ' ' && replay?.playing) {
        e.preventDefault()
        skip()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  const skip = () => {
    replaySound.current?.stop()
    viewRef.current?.skipPlayback()
  }

  // The end screen opens once the final replay has played.
  const endShown = useRef(false)
  useEffect(() => {
    if (finished && !playing && !endShown.current) {
      endShown.current = true
      setSheet('end')
      // Opened on a finished game (no replay of the last turn): play the closing phrase here.
      if (!stung.current && me !== null && state.winner !== 'draw') {
        stung.current = true
        audio.sting(state.winner === me ? 'victory' : 'defeat', 0.3)
      }
    }
  }, [finished, playing])

  // ------------------------------------------------------------------ render

  const idle = me === null ? 0 : myUnits(state, me).filter((u) => isIdle(draft, u)).length
  const waitingFor = (summary?.seats ?? []).filter((s) => s.kind === 'human' && !s.ready && s.seat !== me).map((s) => s.name ?? `Spelare ${s.seat + 1}`)
  const accent = me !== null ? PLAYERS[state.players[me]?.color ?? me] : null
  let hint: { text: string; kind: 'confirm' | 'preview' | 'warn' } | null = notice ? { text: notice, kind: 'warn' } : null
  if (!hint && mySelUnit && preview?.steps.length) {
    const last = preview.steps[preview.steps.length - 1]
    const when = last.turn === 0 ? `tick ${last.tick}` : last.turn === 1 ? `next turn, tick ${last.tick}` : `in ${turnsWord(last.turn)}`
    const n = preview.steps.length
    const what =
      preview.kind === 'attack' ? `Attack, arriving ${when}` : preview.kind === 'found' ? `Found a city, arriving ${when}` : `${n === 1 ? '1 step' : `${n} steps`}, arriving ${when}`
    const verb = preview.kind === 'attack' ? 'attack' : 'move there'
    hint = pending !== null ? { text: `${what}. Tap again to confirm.`, kind: 'confirm' } : { text: `${what}. Click to ${verb}.`, kind: 'preview' }
  }

  let panel = null
  if (replay?.open) {
    panel = (
      <ReplayPanel
        turn={replay.prev.turn}
        lines={replay.lines}
        playing={replay.playing}
        tick={replay.tick}
        onReplay={() => startReplay(replay.prev, replay.events, replay.next)}
        onClose={() => setReplay((r) => r && { ...r, open: false })}
        onFocus={(tile) => viewRef.current?.focusTile(tile, true)}
      />
    )
  } else if (selUnit) {
    panel = (
      <UnitPanel
        state={state}
        draft={draft}
        me={me}
        unit={selUnit}
        editable={editable}
        hint={hint}
        actions={unitActions ?? { setStance() {}, toggleFound() {}, clear() {}, clearTarget() {} }}
        onClose={() => selectUnit(null)}
      />
    )
  } else if (selCity) {
    panel = (
      <CityPanel
        state={state}
        draft={draft}
        me={me}
        city={selCity}
        editable={editable}
        economy={cityEconomy(state, selCity, cityFocus(draft, selCity))}
        onBuild={setBuild}
        onEnter={() => openCity(selCity.id)}
        onClose={() => setSel(null)}
      />
    )
  } else if (sel?.kind === 'tile') {
    panel = <TilePanel state={state} tile={sel.tile} onClose={() => setSel(null)} />
  }

  const viewCity = cityView !== null ? state.cities.find((c) => c.id === cityView) ?? null : null
  const construction = (c: City): CityConstruction => {
    const b = cityBuild(draft, c)
    if (!b) return null
    const cost = buildCost(c, b)
    return typeof b === 'string' ? { unit: b, progress: c.prod, cost } : { building: b.building, plot: b.plot, progress: c.prod, cost }
  }
  const cityEdit = (fn: (d: Draft) => Draft, sound: 'order' | 'cancel' | 'tap') => {
    if (!editable) {
      toast(phase === 'waiting' ? 'You are ready. Press Edit orders to change your plans.' : 'You cannot change this city right now.')
      return
    }
    audio.ui(sound)
    setDraft(fn(draftRef.current))
  }

  const rematch = () => {
    const name = getName() || 'Player'
    const conn = connection()
    const off = conn.subscribe((m) => {
      if (m.type === 'error') {
        off()
        toast(errorText(m) ?? 'Could not create the game.', 'error')
      }
      if (m.type === 'joined') {
        off()
        setSeatToken(m.gameId, { token: m.token, seat: m.seat })
        conn.send({ type: 'start' })
        go(gameHash(m.gameId))
      }
    })
    conn.send({ type: 'create', options: { name: `${name} vs bot`, seats: 2, bots: 1, mapSize: 'small', turnSeconds: null }, playerName: name })
  }

  return (
    <div
      className={`play phase-${phase}${viewCity ? ' in-city' : ''}`}
      style={accent ? ({ '--accent': accent.base, '--accent-light': accent.light, '--accent-dark': accent.dark } as CSSProperties) : undefined}
    >
      <div className="play-view" ref={hostRef} />
      {viewError && (
        <div className="play-error">
          <p className="serif">The map could not be shown.</p>
          <p className="muted">This browser does not support 3D (WebGL). Try Safari, Chrome or Firefox.</p>
        </div>
      )}

      <TopBar
        ref={topRef}
        state={state}
        summary={summary}
        me={me}
        phase={phase}
        deadline={msg.deadline}
        tick={replay?.playing ? replay.tick : null}
        offline={snap.status !== 'open'}
        onMenu={() => {
          audio.ui('tap')
          setSheet('menu')
        }}
        onPlayers={() => setSheet('scores')}
      />

      {banner && phase === 'planning' && (
        <div className="turn-banner" key={banner.key} onAnimationEnd={() => setBanner(null)} aria-hidden="true">
          <span className="serif">Turn {banner.turn}</span>
          <span className="label">Time to plan</span>
        </div>
      )}

      <div className="play-bottom" ref={bottomRef}>
        <div className="panel-slot" key={panelKey(sel, replay)}>{panel}</div>
        <ActionBar
          phase={phase}
          idle={idle}
          canNext={me !== null && myUnits(state, me).length > 0}
          waitingFor={waitingFor}
          onNext={goNext}
          onReady={pressReady}
          onUnready={unready}
          onSkip={skip}
          onResults={() => setSheet('end')}
        />
      </div>

      {sheet === 'help' && (
        <HelpSheet
          onClose={() => {
            setFlag('help', true)
            setSheet(null)
          }}
        />
      )}
      {sheet === 'menu' && (
        <MenuSheet
          onClose={() => setSheet(null)}
          onHelp={() => setSheet('help')}
          onShare={() => {
            setSheet(null)
            void shareLink(gameUrl(session.gameId), summary?.name ?? 'Cirkel-Civ')
          }}
          canReplay={!!msg.previous && msg.events.length > 0 && !playing}
          onReplayLast={() => {
            setSheet(null)
            if (msg.previous) startReplay(msg.previous, msg.events, msg.state)
          }}
          quality={getQuality()}
          activeQuality={viewRef.current?.world.quality ?? null}
          canSetQuality={!!viewRef.current?.world.setQuality}
          onQuality={(q) => {
            setQuality(q)
            viewRef.current?.world.setQuality?.(q)
          }}
        />
      )}
      {sheet === 'scores' && <ScoreSheet state={state} me={me} onClose={() => setSheet(null)} />}
      {sheet === 'end' && <EndScreen state={state} me={me} onClose={() => setSheet(null)} onRematch={rematch} />}

      {viewCity && (
        <Suspense fallback={null}>
          <CityScreen
            state={state}
            cityId={viewCity.id}
            interior={{ ...viewCity.interior, focus: cityFocus(draft, viewCity) }}
            me={me}
            construction={construction(viewCity)}
            onBuild={(order: BuildingOrder | null) => cityEdit((d) => withCityBuild(d, viewCity, order), order ? 'order' : 'cancel')}
            onFocus={(f: CityFocus) => cityEdit((d) => withCityFocus(d, viewCity, f), 'tap')}
            onClose={() => {
              audio.ui('page')
              setCityView(null)
            }}
          />
        </Suspense>
      )}
    </div>
  )
}

function panelKey(sel: Sel, replay: Replay | null): string {
  if (replay?.open) return 'replay'
  if (!sel) return 'none'
  return sel.kind === 'tile' ? `tile-${sel.tile}` : `${sel.kind}-${sel.id}`
}
