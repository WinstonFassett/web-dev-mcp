# vite-live-dev-mcp

Thin re-export of `web-dev-mcp-gateway/vite`. All functionality lives in the gateway package.

This package exists for backward compatibility — existing users of `vite-live-dev-mcp` get the gateway adapter transparently.

```ts
// This package:
export { webDevMcp as viteLiveDevMcp } from 'web-dev-mcp-gateway/vite'

// Users can also import directly:
import { webDevMcp } from 'web-dev-mcp-gateway/vite'
```
