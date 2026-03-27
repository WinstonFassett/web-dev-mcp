'use client'

import { useState } from 'react'

export default function Home() {
  const [count, setCount] = useState(0)

  const handleClick = () => {
    const newCount = count + 1
    setCount(newCount)
    console.log('Button clicked!', { count: newCount, timestamp: new Date().toISOString() })
    console.warn('This is a warning message')
    console.error('This is an error message')
    console.info('Count is now:', newCount)
  }

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Next.js MCP Test App</h1>
      <p>Testing console logging via MCP</p>

      <div style={{ marginTop: '2rem' }}>
        <button
          onClick={handleClick}
          style={{
            padding: '1rem 2rem',
            fontSize: '1.2rem',
            background: '#0070f3',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
          }}
        >
          Click me (Count: {count})
        </button>
      </div>

      <div style={{ marginTop: '2rem', color: '#666' }}>
        <p>Open browser console and MCP tools to see logs</p>
        <p>Check: <code>/tmp/vite-harness-*/console.ndjson</code></p>
      </div>
    </main>
  )
}
