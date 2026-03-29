const ATTRIBUTE_NAME = 'data-element-grab'
const FONT_LINK_ID = 'element-grab-fonts'
const FONT_LINK_URL = 'https://fonts.googleapis.com/css2?family=Geist:wght@500&display=swap'
const Z_INDEX_HOST = 2147483647
const MOUNT_ROOT_RECHECK_DELAY_MS = 1000

const loadFonts = () => {
  if (document.getElementById(FONT_LINK_ID)) return
  if (!document.head) return
  const link = document.createElement('link')
  link.id = FONT_LINK_ID
  link.rel = 'stylesheet'
  link.href = FONT_LINK_URL
  document.head.appendChild(link)
}

export const mountRoot = (cssText?: string): HTMLDivElement => {
  loadFonts()

  const existing = document.querySelector(`[${ATTRIBUTE_NAME}]`)
  if (existing) {
    const root = existing.shadowRoot?.querySelector(`[${ATTRIBUTE_NAME}]`)
    if (root instanceof HTMLDivElement && existing.shadowRoot) return root
  }

  const host = document.createElement('div')
  host.setAttribute(ATTRIBUTE_NAME, 'true')
  host.style.zIndex = String(Z_INDEX_HOST)
  host.style.position = 'fixed'
  host.style.inset = '0'
  host.style.pointerEvents = 'none'

  const shadowRoot = host.attachShadow({ mode: 'open' })

  if (cssText) {
    const style = document.createElement('style')
    style.textContent = cssText
    shadowRoot.appendChild(style)
  }

  const root = document.createElement('div')
  root.setAttribute(ATTRIBUTE_NAME, 'true')
  shadowRoot.appendChild(root)

  const doc = document.body ?? document.documentElement
  doc.appendChild(host)

  // Re-append after delay to win stacking order after hydration
  setTimeout(() => doc.appendChild(host), MOUNT_ROOT_RECHECK_DELAY_MS)

  return root
}
