# Recipes

## Local Development (MCP tools)

### Test-fix loop

```
clear_logs
# make code change, HMR reloads
get_diagnostics({ since_checkpoint: true })
# check summary: error_count, warning_count, failed_requests
screenshot({ selector: '#root' })
# repeat
```

### Verify a component

```
query_dom({ selector: '#my-component', max_depth: 3 })
# see structure, classes, attributes
get_visible_text('#my-component')
# check rendered text
screenshot({ selector: '#my-component' })
# visual
```

### Fill a form

```
fill("#email", "test@example.com")
fill("#password", "secret123")
click("text=Sign In")
get_diagnostics({ since_checkpoint: true })
screenshot()
```

### Click by visible text

```
click("text=Submit")
click("text=Delete Account")
click("text=Save Changes")
```

### SPA navigation (stays connected)

```
click("text=Settings")          # click a router link
get_diagnostics()               # connection stays alive, no reconnect needed
query_dom({ selector: '#settings-page' })
```

### Full page navigation (disconnects)

```
navigate("http://localhost:3000/login")
# wait ~2-3 seconds for page load and RPC reconnect
get_visible_text('h1')          # verify new page
```

### Debug network requests

```
clear_logs
click("text=Load Data")
get_diagnostics({ since_checkpoint: true })
# logs.network shows fetch/XHR with status, duration, URL
```

### Wait for async UI

```
wait_for_condition({ check: "document.querySelector('.success-toast')", timeout: 5000 })
screenshot()
```

## Browsing & Scraping (requires web-dev-mcp-proxy)

Install the proxy plugin: `npm install web-dev-mcp-proxy`. Then browse any site through the gateway: `http://localhost:3333/https://example.com/`

### Read a page and follow links

```
get_page_markdown()
# [DOOM Over DNS](https://github.com/...) ... [60 comments](item?id=47490705)
navigate("https://news.ycombinator.com/item?id=47490705")
# wait for reconnect
get_page_markdown()
```

## capnweb Agent Client (advanced)

For complex flows — multi-page browsing, DOM traversal chains, programmatic reconnection after navigation. Connect via WebSocket at `ws://localhost:3333/__rpc/agent`.

MCP tools are simpler but limited to one action per call. capnweb gives you the live DOM with promise pipelining.

### Connect and read

```js
import { connect } from 'web-dev-mcp-gateway/agent'

const browser = await connect('ws://localhost:3333/__rpc/agent')
const { document } = browser

const title = await document.querySelector('h1').textContent
const items = document.querySelectorAll('li')
const first = await items[0].textContent
```

### Chain DOM traversal

```js
// Pipelined — these don't need individual awaits
const link = document.querySelector('a[href*="doom"]')
const commentsRow = link.closest('tr').nextElementSibling
const href = await commentsRow.querySelector('.subline a:last-child').href
```

### Navigate and reconnect

```js
await browser.navigate(href)
browser.close()
await new Promise(r => setTimeout(r, 3000))

const page2 = await connect('ws://localhost:3333/__rpc/agent')
console.log(await page2.document.title)
page2.close()
```

### Get markdown from a specific element

```js
const result = await browser.getPageMarkdown('.article-body')
console.log(result.markdown)
```
