import { useEffect, useState } from 'react'
import { marked } from 'marked'
import { Icon } from './icons.tsx'

const SOURCES = {
  spec: { url: '/SPEC.md', title: 'Spec' },
  rules: { url: '/docs/RULES.md', title: 'Rules' },
} as const

export function DocPage({ doc }: { doc: keyof typeof SOURCES }) {
  const [html, setHtml] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let alive = true
    setHtml(null)
    setMissing(false)
    fetch(SOURCES[doc].url, { cache: 'no-cache' })
      .then(async (r) => {
        const text = await r.text()
        // A dev server answers unknown paths with the app's index.html.
        if (!r.ok || /^\s*<(!doctype|html)/i.test(text)) throw new Error('missing')
        return text
      })
      .then((md) => {
        if (!alive) return
        setHtml(marked.parse(md, { async: false }) as string)
        document.title = `${SOURCES[doc].title} · Cirkel-Civ`
      })
      .catch(() => alive && setMissing(true))
    return () => {
      alive = false
      document.title = 'Cirkel-Civ'
    }
  }, [doc])

  return (
    <div className="doc-page">
      <nav className="doc-nav">
        <a href="#/" className="doc-back">
          <Icon name="home" size={18} />
          <span className="serif">Cirkel-Civ</span>
        </a>
        <div className="doc-tabs">
          <a href="#/rules" aria-current={doc === 'rules' ? 'page' : undefined}>Rules</a>
          <a href="#/spec" aria-current={doc === 'spec' ? 'page' : undefined}>Spec</a>
        </div>
      </nav>
      {missing ? (
        <article className="doc doc-missing">
          <h1>{SOURCES[doc].title}</h1>
          <p>
            {doc === 'rules'
              ? 'The rules have not been written down yet. Everything that applies right now is in the spec.'
              : 'The spec could not be loaded. Try again in a moment.'}
          </p>
          {doc === 'rules' && <p><a href="#/spec">Read the spec</a></p>}
        </article>
      ) : html === null ? (
        <article className="doc doc-loading" aria-busy="true" />
      ) : (
        <article className="doc" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  )
}
