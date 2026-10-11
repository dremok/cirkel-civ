import { Component, type ReactNode } from 'react'

/** Keeps a crash (or a chunk that failed to load after a deploy) from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error(error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="center-screen">
        <h1 className="serif">Something went wrong</h1>
        <p className="muted">The game could not be shown. Reloading usually fixes it, and your orders are kept.</p>
        <button className="btn btn-primary" onClick={() => location.reload()}>Reload</button>
      </div>
    )
  }
}
