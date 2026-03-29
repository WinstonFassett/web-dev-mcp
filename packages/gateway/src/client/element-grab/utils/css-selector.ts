/**
 * Generate a unique CSS selector for an element.
 * Tries: #id → [data-testid] → [aria-label] → nth-child chain.
 */

const PREFERRED_ATTRS = [
  'data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa',
  'aria-label', 'role', 'name', 'title', 'alt',
] as const

const MAX_ATTR_LEN = 120

const escape = (v: string) =>
  typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : v.replace(/[^a-zA-Z0-9_-]/g, c => `\\${c}`)

const isUnique = (el: Element, sel: string): boolean => {
  try {
    const matches = el.ownerDocument.querySelectorAll(sel)
    return matches.length === 1 && matches[0] === el
  } catch { return false }
}

export const createElementSelector = (el: Element): string => {
  // Fast path: id
  if (el instanceof HTMLElement && el.id) {
    const sel = `#${escape(el.id)}`
    if (isUnique(el, sel)) return sel
  }

  // Preferred attributes
  for (const attr of PREFERRED_ATTRS) {
    const val = el.getAttribute(attr)
    if (!val || val.length > MAX_ATTR_LEN) continue
    const quoted = JSON.stringify(val)

    const attrSel = `[${attr}=${quoted}]`
    if (isUnique(el, attrSel)) return attrSel

    const tagSel = `${el.tagName.toLowerCase()}${attrSel}`
    if (isUnique(el, tagSel)) return tagSel
  }

  // Fallback: nth-child chain
  const root = el.ownerDocument.body ?? el.ownerDocument.documentElement
  const parts: string[] = []
  let cur: Element | null = el

  while (cur) {
    if (cur instanceof HTMLElement && cur.id) {
      parts.unshift(`#${escape(cur.id)}`)
      break
    }
    const parent = cur.parentElement
    if (!parent) {
      parts.unshift(cur.tagName.toLowerCase())
      break
    }
    const siblings = Array.from(parent.children)
    const idx = siblings.indexOf(cur) + 1
    parts.unshift(`${cur.tagName.toLowerCase()}:nth-child(${idx})`)
    if (parent === root) {
      parts.unshift(root.tagName.toLowerCase())
      break
    }
    cur = parent
  }

  return parts.join(' > ')
}
