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
# wait ~2-3 seconds for page load and reconnect
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

## eval_js (advanced)

For complex flows within a single eval call — DOM traversal, async operations, state management.

### Multi-step DOM exploration

```js
// Find all links in a table, extract data
const rows = document.querySelectorAll('table tr')
const data = []
for (const row of rows) {
  const link = row.querySelector('a')
  if (link) data.push({ text: link.textContent, href: link.href })
}
return JSON.stringify(data)
```

### Store framework state across calls

```js
// Call 1: grab a store reference
state.store = window.__REDUX_STORE__
return JSON.stringify(state.store.getState())

// Call 2 (later): same ref
state.store.dispatch({ type: 'INCREMENT' })
return JSON.stringify(state.store.getState())
```

### Screenshot after interaction

```js
browser.click('text=Open Modal')
await browser.waitFor('.modal-content', 100, 3000)
return await browser.screenshot('.modal-content')
```
