# Recipes

## Read a page and find a link

```
1. get_page_markdown()
2. Parse markdown — links appear as [text](url)
3. navigate({ url: "the-url-you-found" })
```

Agent sees: `[60 comments](item?id=47490705)` — extract the URL, navigate to it.

## Test-fix loop

```
1. clear_logs()
2. (make code change — HMR auto-reloads)
3. get_diagnostics({ since_checkpoint: true })
4. Check: errors? warnings? failed requests?
5. screenshot({ selector: '#my-component' })
6. Repeat
```

Only see events since the last `clear_logs` — no noise from earlier.

## Fill a form and submit

```
1. get_page_markdown() — find form fields and button
2. fill({ selector: '#email', value: 'test@example.com' })
3. fill({ selector: '#password', value: 'secret' })
4. click({ selector: 'button[type=submit]' })
5. get_diagnostics() — check for errors
```

## Browse any site through the gateway proxy

Gateway in hub mode proxies any URL:

```
http://localhost:3333/https://example.com/page
```

Client script auto-injected. Relative assets work via `<base>` tag. MCP tools and capnweb available for the proxied page.

## capnweb: find element by text, click nearby link

```js
const { document } = browser

// Find a heading
const heading = await document.querySelector('h2')
const text = await heading.textContent  // "DOOM Over DNS"

// Traverse to a sibling link
const container = heading.closest('article')
const link = container.querySelector('a[href*="comments"]')
await link.click()
```

No CSS selector gymnastics — walk the DOM naturally.

## capnweb: read a table

```js
const rows = document.querySelectorAll('table tr')
// Note: querySelectorAll returns a remote NodeList
// Access by index:
const firstRow = rows[0]
const cells = firstRow.querySelectorAll('td')
const name = await cells[0].textContent
const value = await cells[1].textContent
```

## capnweb: fill and submit without knowing selectors

```js
const form = document.querySelector('form')
const inputs = form.querySelectorAll('input')
// Set values via the remote proxy
inputs[0].value = 'test@example.com'
inputs[1].value = 'password123'
form.querySelector('button').click()
```
