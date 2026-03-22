import { useState } from 'react'

function Counter() {
  const [count, setCount] = useState(0)
  return (
    <button onClick={() => { setCount(c => c + 1); console.log(`counter: ${count + 1}`) }}>
      Count: {count}
    </button>
  )
}

export default function App() {
  return (
    <div style={{ padding: 20, fontFamily: 'system-ui' }}>
      <h1>vite-live-dev-mcp test app</h1>
      <Counter />
      <br /><br />
      <button onClick={() => console.error('test-error-marker')}>
        Throw Error
      </button>
      <button onClick={() => console.log('test-log-marker')}>
        Log Message
      </button>
      <button onClick={() => { Promise.reject(new Error('test-rejection-marker')) }}>
        Reject Promise
      </button>
      <button onClick={() => fetch('/test-fetch-endpoint')}>
        Fetch
      </button>
    </div>
  )
}
