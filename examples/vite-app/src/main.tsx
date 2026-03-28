import { createRoot } from 'react-dom/client'
import { resolveElementInfo } from 'element-source'
import App from './App'

// Expose element-source to agents via browser.eval()
;(window as any).__resolveElementInfo = resolveElementInfo

createRoot(document.getElementById('root')!).render(<App />)
