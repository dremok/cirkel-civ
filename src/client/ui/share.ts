import { toast } from './toast.tsx'

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Older Safari / insecure origins: fall back to a hidden textarea.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    return ok
  }
}

export const canShare = () => typeof navigator.share === 'function' && matchMedia('(pointer: coarse)').matches

/** Native share sheet on phones, else copy the link. */
export async function shareLink(url: string, title: string): Promise<void> {
  if (canShare()) {
    try {
      await navigator.share({ title, text: `Join ${title} on Cirkel-Civ`, url })
      return
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return
    }
  }
  toast((await copyText(url)) ? 'Link copied.' : 'Could not copy the link.')
}
