// Test the gateway with Playwright
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import http from 'node:http'

const GATEWAY_URL = 'http://localhost:3333'

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = ''
      res.on('data', (chunk) => data += chunk)
      res.on('end', () => resolve(JSON.parse(data)))
    }).on('error', reject)
  })
}

async function test() {
  console.log('Launching browser...')
  const browser = await chromium.launch({ headless: false })
  const page = await browser.newPage()

  console.log('Navigating to', GATEWAY_URL)
  await page.goto(GATEWAY_URL)
  await page.waitForTimeout(2000)

  // Check client loaded
  const clientLoaded = await page.evaluate(() => window.__WEB_DEV_MCP_LOADED__)
  console.log('Client loaded:', clientLoaded)

  // Trigger console logs via Playwright
  console.log('Triggering console events...')
  await page.evaluate(() => {
    console.log('Hello from Playwright!')
    console.warn('Warning from Playwright!')
    console.error('Error from Playwright!')
  })

  // Wait for events to be sent over WebSocket
  await page.waitForTimeout(2000)

  // Check status
  try {
    const status = await httpGet(`${GATEWAY_URL}/__status`)
    console.log('\nGateway status: uptime', status.uptime_ms, 'ms')

    // Check console logs
    const consoleLogs = readFileSync(status.session.files.console, 'utf-8').trim()
    const consoleLines = consoleLogs ? consoleLogs.split('\n') : []
    console.log(`\nConsole logs (${consoleLines.length} events):`)
    for (const line of consoleLines) {
      const event = JSON.parse(line)
      console.log(`  [${event.payload.level}] ${event.payload.args.join(' ')}`)
    }

    // Check error logs
    const errorLogs = readFileSync(status.session.files.errors, 'utf-8').trim()
    const errorLines = errorLogs ? errorLogs.split('\n') : []
    console.log(`\nError logs (${errorLines.length} events):`)
    for (const line of errorLines) {
      const event = JSON.parse(line)
      console.log(`  [${event.payload.type}] ${event.payload.message}`)
    }

    // Check network logs
    if (status.session.files.network) {
      const networkLogs = readFileSync(status.session.files.network, 'utf-8').trim()
      const networkLines = networkLogs ? networkLogs.split('\n') : []
      console.log(`\nNetwork logs (${networkLines.length} events):`)
      for (const line of networkLines) {
        const event = JSON.parse(line)
        console.log(`  ${event.payload.method} ${event.payload.url} → ${event.payload.status}`)
      }
    }
  } catch (err) {
    console.error('Error checking status:', err.message)
  }

  // Test fetch interception
  console.log('\nTriggering fetch...')
  await page.evaluate(() => fetch('/api/data'))
  await page.waitForTimeout(1500)

  try {
    const status = await httpGet(`${GATEWAY_URL}/__status`)
    if (status.session.files.network) {
      const networkLogs = readFileSync(status.session.files.network, 'utf-8').trim()
      const networkLines = networkLogs ? networkLogs.split('\n') : []
      console.log(`Network logs after fetch (${networkLines.length} events):`)
      for (const line of networkLines) {
        const event = JSON.parse(line)
        console.log(`  ${event.payload.method} ${event.payload.url} → ${event.payload.status}`)
      }
    }
  } catch (err) {
    console.error('Error checking network:', err.message)
  }

  console.log('\nAll tests complete!')
  await browser.close()
}

test().catch((err) => {
  console.error('Test failed:', err)
  process.exit(1)
})
