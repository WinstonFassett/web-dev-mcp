# Recipes

## Local Development

### Test-fix loop

```
clear_logs
# make code change, HMR reloads
get_diagnostics({ since_checkpoint: true })
# check summary: error_count, warning_count, failed_requests
screenshot({ selector: '#root' })
# repeat
```

### Verify a component renders correctly

```
query_dom({ selector: '#my-component', max_depth: 3 })
# see HTML structure, check classes, attributes
screenshot({ selector: '#my-component' })
# visual confirmation
get_visible_text('#my-component')
# check rendered text
```

### Fill a form and check for errors

```
fill("#email", "test@example.com")
fill("#password", "secret123")
click("text=Sign In")
get_diagnostics({ since_checkpoint: true })
# check for console errors, failed network requests
screenshot()
```

### Click by visible text

```
click("text=Submit")
click("text=Delete Account")
click("text=60 comments")
```

The `text=` prefix searches visible text content. Works on buttons, links, any element.

### Wait for async UI

```
wait_for_condition({ check: "document.querySelector('.success-toast')", timeout: 5000 })
screenshot()
```

### Debug network requests

```
clear_logs
click("text=Load Data")
get_diagnostics({ since_checkpoint: true })
# logs.network shows fetch/XHR with status, duration, URL
```

## Browsing & Scraping (via gateway proxy)

### Instrument any website

Browse through the gateway proxy — `http://localhost:3333/https://example.com/`. MCP tools work on the proxied page.

### Read a page and follow links

```
get_page_markdown()
# output: [DOOM Over DNS](https://github.com/resumex/doom-over-dns) ... [60 comments](item?id=47490705)
navigate("https://news.ycombinator.com/item?id=47490705")
```

### capnweb: direct remote DOM

For complex traversal, connect via capnweb at `ws://localhost:3333/__rpc/agent`:

```js
import { connect } from 'web-dev-mcp-gateway/agent'

const browser = await connect('ws://localhost:3333/__rpc/agent')
const { document } = browser

// Promise-pipelined chain — minimal round trips
const link = document.querySelector('a[href*="doom"]')
const commentsRow = link.closest('tr').nextElementSibling
const href = await commentsRow.querySelector('.subline a:last-child').href

await browser.navigate(href)
browser.close()

// Reconnect after navigation
const page2 = await connect('ws://localhost:3333/__rpc/agent')
const topComment = await page2.document.querySelector('.commtext').textContent
page2.close()
```

No `eval()`, no CSP issues. Full DOM API via remote proxies.

### capnweb: get markdown from a specific element

```js
const result = await browser.getPageMarkdown('.commtext')
console.log(result.markdown)
```
