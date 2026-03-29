/**
 * Open a source file in the user's editor.
 * Tries dev server endpoint first (Vite / Next.js), falls back to protocol URL.
 */
export const openFile = async (filePath: string, lineNumber?: number): Promise<void> => {
  // Try Vite's open-in-editor
  const params = new URLSearchParams({ file: filePath })
  if (lineNumber) params.set('line', String(lineNumber))
  params.set('column', '1')

  try {
    const res = await fetch(`/__open-in-editor?${params}`)
    if (res.ok) return
  } catch {}

  // Try Next.js editor endpoint
  try {
    const nextParams = new URLSearchParams({ file: filePath })
    if (lineNumber) nextParams.set('line1', String(lineNumber))
    nextParams.set('column1', '1')
    const res = await fetch(`/__nextjs_launch-editor?${nextParams}`)
    if (res.ok) return
  } catch {}

  // Fallback: vscode:// protocol
  const line = lineNumber ? `:${lineNumber}` : ''
  window.open(`vscode://file/${filePath}${line}`, '_blank', 'noopener,noreferrer')
}
