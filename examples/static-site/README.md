# Static Site Example

Plain HTML/JS — no framework, no bundler. Uses the gateway proxy to instrument the page.

## Setup

```bash
# Terminal 1: start gateway (with proxy plugin)
npm install web-dev-mcp-proxy  # once
npx web-dev-mcp-gateway

# Terminal 2: serve static files
npx serve examples/static-site -p 8080
```

## Browse

Open through the gateway proxy:
```
http://localhost:3333/http://localhost:8080/
```

The proxy injects `client.js` which connects to the gateway for MCP observability.

## Alternative: manual script tag

If you don't want to use the proxy, add this to your HTML:
```html
<script src="http://localhost:3333/__client.js"></script>
```
