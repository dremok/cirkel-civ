import { DocPage } from './DocPage.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { GamePage } from './GamePage.tsx'
import { Home } from './Home.tsx'
import { useRoute } from './route.ts'
import { Toasts } from './toast.tsx'

export function App() {
  const route = useRoute()
  const key = route.page === 'game' ? `game-${route.gameId}` : route.page === 'doc' ? `doc-${route.doc}` : 'home'
  return (
    <>
      <ErrorBoundary key={key}>
        {route.page === 'game' ? (
          <GamePage gameId={route.gameId} />
        ) : route.page === 'doc' ? (
          <DocPage doc={route.doc} />
        ) : (
          <Home />
        )}
      </ErrorBoundary>
      <Toasts />
    </>
  )
}
