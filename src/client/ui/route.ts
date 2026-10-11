import { useEffect, useState } from 'react'

export type Route =
  | { page: 'home' }
  | { page: 'game'; gameId: string }
  | { page: 'doc'; doc: 'spec' | 'rules' }

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'g' && parts[1]) return { page: 'game', gameId: decodeURIComponent(parts[1]) }
  if (parts[0] === 'spec') return { page: 'doc', doc: 'spec' }
  // Old links (#/regler) still land on the rules.
  if (parts[0] === 'rules' || parts[0] === 'regler') return { page: 'doc', doc: 'rules' }
  return { page: 'home' }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash))
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash))
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return route
}

export function go(hash: string): void {
  if (location.hash !== hash) location.hash = hash
}

export const gameHash = (id: string) => `#/g/${encodeURIComponent(id)}`

/** The shareable link to a game (keeps ?local in dev). */
export function gameUrl(id: string): string {
  return `${location.origin}${location.pathname}${location.search}${gameHash(id)}`
}
