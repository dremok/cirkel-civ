import type { ErrorCode } from '../../shared/protocol.ts'

const TEXT: Record<ErrorCode, string | null> = {
  bad_request: 'The server did not understand that. Reload the page and try again.',
  not_found: 'This game no longer exists.',
  bad_token: null,
  forbidden: 'You cannot do that in this game.',
  full: 'There are no open seats left. You can still watch.',
  wrong_phase: 'That is not possible right now. The game may already have started.',
  stale_turn: null, // a fresh state follows
  kicked: 'The host gave your seat away. You are watching now.',
  internal: 'Something went wrong on the server. Your orders are kept; press Ready again.',
  fog_hidden: null, // shown as its own screen (a fog game cannot be watched while it runs)
}

/** The text to show for a server error, or null when nothing should be shown. */
export function errorText(m: { message: string; code?: ErrorCode }): string | null {
  if (m.code) return TEXT[m.code]
  return m.message
}
