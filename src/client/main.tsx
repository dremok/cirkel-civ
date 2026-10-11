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

// `?local` runs the game in this tab against an in-browser server (for development and tests).
if (new URLSearchParams(location.search).has('local')) {
  const { LocalServer } = await import('./net/local.ts')
  setTransport(new LocalServer())
}

createRoot(document.getElementById('root')!).render(<App />)
