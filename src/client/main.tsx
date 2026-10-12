import { createRoot } from 'react-dom/client'
import '@fontsource-variable/fraunces/opsz.css'
import '@fontsource-variable/fraunces/opsz-italic.css'
import '@fontsource-variable/inter/index.css'
import './styles/base.css'
import './styles/home.css'
import './styles/lobby.css'
import './styles/play.css'
import './styles/doc.css'
import { setTransport } from './net/connection.ts'
import { App } from './ui/App.tsx'
import { audio } from './audio/index.ts'

// `?local` runs the game in this tab against an in-browser server (for development and tests).
if (new URLSearchParams(location.search).has('local')) {
  const { LocalServer } = await import('./net/local.ts')
  setTransport(new LocalServer())
}

// Dev only: lets test scripts check what the game asks the audio module to play.
if (import.meta.env.DEV) (window as unknown as { __audio: unknown }).__audio = audio

createRoot(document.getElementById('root')!).render(<App />)
