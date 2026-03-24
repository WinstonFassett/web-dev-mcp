// Simple test server to proxy through the gateway
import http from 'node:http'

const server = http.createServer((req, res) => {
  if (req.url === '/api/data') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ hello: 'world', time: Date.now() }))
    return
  }

  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Test App</title>
  <style>
    body { font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 0 20px; }
    button { padding: 8px 16px; margin: 4px; cursor: pointer; }
    #output { background: #f5f5f5; padding: 12px; border-radius: 4px; margin-top: 12px; min-height: 40px; }
  </style>
</head>
<body>
  <h1>Test App</h1>
  <p>This page is served through the web-dev-mcp gateway.</p>

  <div>
    <button onclick="console.log('Hello from button!')">console.log</button>
    <button onclick="console.warn('Warning!')">console.warn</button>
    <button onclick="console.error('Error!')">console.error</button>
    <button onclick="throwError()">Throw Error</button>
    <button onclick="fetchData()">Fetch /api/data</button>
  </div>

  <div id="output">Click a button...</div>

  <script>
    function throwError() {
      throw new Error('Test unhandled error')
    }

    async function fetchData() {
      const res = await fetch('/api/data')
      const data = await res.json()
      document.getElementById('output').textContent = JSON.stringify(data, null, 2)
      console.log('Fetched:', data)
    }

    console.log('Test app loaded!', { timestamp: Date.now() })
  </script>
</body>
</html>`)
})

server.listen(4567, () => {
  console.log('Test target server running on http://localhost:4567')
})
