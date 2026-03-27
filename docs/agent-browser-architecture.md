# Agent ↔ Browser Architecture

## What we have now

Agent talks to browser **only through MCP tools** — predefined commands, no live DOM access.

```mermaid
sequenceDiagram
    participant Agent
    participant MCP as MCP Server (SSE)
    participant Gateway
    participant Browser

    Note over Agent,Browser: Agent uses predefined MCP tools
    Agent->>MCP: tools/call: get_page_markdown
    MCP->>Gateway: getBrowserStub()
    Gateway->>Browser: capnweb RPC: getPageMarkdown()
    Browser-->>Gateway: { markdown: "..." }
    Gateway-->>MCP: result
    MCP-->>Agent: markdown text

    Note over Agent: Agent parses markdown, extracts URL
    Agent->>MCP: tools/call: navigate({ url })
    MCP->>Gateway: getBrowserStub()
    Gateway->>Browser: capnweb RPC: eval("window.location.href = ...")
    Browser-->>Agent: ok
```

**Limitations:**
- Every interaction is a separate MCP tool call
- Tools are predefined (click, fill, query_dom, etc.)
- No way to chain DOM operations
- `eval_in_browser` blocked by CSP on many sites
- Agent can't traverse DOM — must know exact CSS selector

## What you want

Agent gets **live remote DOM access** — chain querySelector, walk the tree, click elements. Like using DevTools but programmatic.

```mermaid
sequenceDiagram
    participant Agent
    participant Gateway
    participant Browser

    Note over Agent,Browser: Agent connects via capnweb, gets remote document
    Agent->>Gateway: capnweb: gateway.document
    Gateway->>Browser: capnweb: stub.document
    Browser-->>Gateway: AnyTarget(document)
    Gateway-->>Agent: remote document proxy

    Note over Agent: Agent chains DOM calls directly
    Agent->>Browser: doc.querySelector('.titleline a')
    Browser-->>Agent: remote Element proxy
    Agent->>Browser: el.textContent
    Browser-->>Agent: "DOOM Over DNS"
    Agent->>Browser: el.parentElement.parentElement.nextElementSibling
    Browser-->>Agent: remote Element proxy (subtext row)
    Agent->>Browser: row.querySelector('a:last-child')
    Browser-->>Agent: remote Element proxy (comments link)
    Agent->>Browser: link.click()
    Browser-->>Agent: { clicked: true }
```

## Recommended: both paths coexist

```mermaid
graph TB
    Agent[AI Agent]

    subgraph "Gateway :3333"
        MCP["MCP Server<br/>/__mcp/sse<br/>(predefined tools)"]
        AgentRPC["Agent RPC<br/>/__rpc/agent<br/>(live remote DOM)"]
        BrowserRPC["Browser RPC<br/>/__rpc<br/>(capnweb)"]
    end

    Browser[Browser]

    Agent -->|"MCP (SSE/JSON-RPC)<br/>get_page_markdown, click, screenshot..."| MCP
    Agent -->|"capnweb WebSocket<br/>doc.querySelector().click()"| AgentRPC
    AgentRPC -->|"cross-session proxy"| BrowserRPC
    BrowserRPC -->|"capnweb WebSocket"| Browser

    MCP -.->|"uses internally"| BrowserRPC
```

**MCP path** — simple, works with any MCP client, good for high-level operations (get diagnostics, take screenshot, get markdown).

**capnweb path** — powerful, live DOM access, chaining, no CSP issues, but requires a capnweb client. An agent SDK or script can use it directly.

Both use the same browser connection. MCP tools internally call the browser stub the same way the agent would through capnweb.

## What needs to be built

1. **`/__rpc/agent` endpoint** — new WebSocket path on gateway. When agent connects, server creates session with a `GatewayApi` target that exposes `document` (proxied from browser stub).

2. **`GatewayApi` RpcTarget** — server-side class that bridges agent session to browser session:
   ```
   class GatewayApi extends RpcTarget {
     get document() { return getBrowserStub().document }
     get window()   { return getBrowserStub().window }
   }
   ```

3. **Client library** (optional) — thin wrapper for agents:
   ```js
   import { connectBrowser } from 'web-dev-mcp/agent'
   const { document } = await connectBrowser('ws://localhost:3333/__rpc/agent')
   const el = await document.querySelector('a')
   await el.click()
   ```

The cross-session capnweb proxy **already works** (tested). Just need to wire up the endpoint.
