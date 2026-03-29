// element-grab server-side: selection store + MCP tool + HTTP endpoint
// Push-then-pull model: browser pushes selection via HTTP POST, agent pulls via MCP tool.
// Selections have a 5-minute TTL.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { IncomingMessage, ServerResponse } from 'node:http'

const SELECTION_TTL_MS = 5 * 60 * 1000 // 5 minutes

interface ElementSelection {
  card: string
  timestamp: number
  url: string
  browserId?: string
}

// Store last N selections (ring buffer, newest first)
const MAX_SELECTIONS = 10
const selections: ElementSelection[] = []

function pruneExpired() {
  const now = Date.now()
  while (selections.length > 0 && now - selections[selections.length - 1].timestamp > SELECTION_TTL_MS) {
    selections.pop()
  }
}

export function pushSelection(sel: ElementSelection) {
  pruneExpired()
  selections.unshift(sel)
  if (selections.length > MAX_SELECTIONS) selections.pop()
}

export function getLatestSelection(): ElementSelection | null {
  pruneExpired()
  return selections[0] ?? null
}

export function getAllSelections(): ElementSelection[] {
  pruneExpired()
  return [...selections]
}

// --- MCP Tool Registration ---
export function registerElementGrabTool(mcp: McpServer) {
  mcp.tool(
    'get_element_context',
    `Get the latest UI element selected by the user in the browser. The user holds Cmd+C to activate element-grab, hovers over an element, and clicks to select it. Returns a compact component card with: component name, source file location, CSS selector, and a live ref hint (window.__LAST_GRABBED__.element) that can be used with eval_js_rpc for live DOM manipulation.`,
    {
      all: z.boolean().optional().describe('Return all recent selections (max 10) instead of just the latest'),
    },
    async (args) => {
      if (args.all) {
        const all = getAllSelections()
        if (all.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No element has been selected yet. Ask the user to hold Cmd+C in the browser, hover an element, and click to select it.' }],
          }
        }
        return {
          content: [{ type: 'text' as const, text: all.map(s =>
            `[${Math.round((Date.now() - s.timestamp) / 1000)}s ago] ${s.url}\n${s.card}`
          ).join('\n\n---\n\n') }],
        }
      }

      const latest = getLatestSelection()
      if (!latest) {
        return {
          content: [{ type: 'text' as const, text: 'No element has been selected yet. Ask the user to hold Cmd+C in the browser, hover an element, and click to select it.' }],
        }
      }
      return {
        content: [{ type: 'text' as const, text: latest.card }],
      }
    },
  )
}

// --- HTTP Endpoint ---
export function handleElementGrabRequest(req: IncomingMessage, res: ServerResponse, url: string): boolean {
  if (url === '/__element-grab/selection' && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        const payload = data.payload || data

        pushSelection({
          card: payload.card || '',
          timestamp: payload.timestamp || Date.now(),
          url: payload.url || '',
          browserId: data.browserId,
        })

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        })
        res.end(JSON.stringify({ ok: true }))
      } catch {
        res.writeHead(400, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        })
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
      }
    })
    return true
  }

  if (url === '/__element-grab/selection' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    const latest = getLatestSelection()
    res.end(JSON.stringify(latest ? {
      card: latest.card,
      url: latest.url,
      age_sec: Math.round((Date.now() - latest.timestamp) / 1000),
    } : { status: 'no_selection' }, null, 2))
    return true
  }

  return false
}
