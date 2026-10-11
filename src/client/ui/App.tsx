import { DocPage } from './DocPage.tsx'
import { GamePage } from './GamePage.tsx'
import { Home } from './Home.tsx'
import { useRoute } from './route.ts'
import { Toasts } from './toast.tsx'

export function App() {
  const route = useRoute()
  return (
    <>
      {route.page === 'game' ? (
        <GamePage key={route.gameId} gameId={route.gameId} />
      ) : route.page === 'doc' ? (
        <DocPage doc={route.doc} />
      ) : (
        <Home />
      )}
      <Toasts />
    </>
  )
}
