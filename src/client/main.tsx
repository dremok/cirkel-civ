// SKELETON: the UI agent owns this file and replaces it.
import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { marked } from 'marked'
import './skeleton.css'

function SpecPage() {
  const [html, setHtml] = useState('')
  useEffect(() => {
    fetch('/SPEC.md').then((r) => r.text()).then((md) => setHtml(marked.parse(md) as string))
  }, [])
  return <article className="doc" dangerouslySetInnerHTML={{ __html: html }} />
}

function Home() {
  return (
    <main className="home">
      <h1>Cirkel-Civ</h1>
      <p>Första demon byggs just nu.</p>
      <p><a href="#/spec">Läs specen</a></p>
    </main>
  )
}

function App() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return hash.startsWith('#/spec') ? <SpecPage /> : <Home />
}

createRoot(document.getElementById('root')!).render(<App />)
