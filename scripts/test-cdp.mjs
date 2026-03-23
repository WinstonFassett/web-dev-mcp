#!/usr/bin/env node
// Test CDP connection with Playwright
// Usage: node scripts/test-cdp.mjs [cdp-url]
// Default CDP URL: http://localhost:5173/__cdp

import { chromium } from 'playwright'

const cdpUrl = process.argv[2] || 'http://localhost:5173/__cdp'

async function main() {
  console.log('Testing CDP connection to:', cdpUrl)

  // First, check if the CDP endpoints are responding
  console.log('\n1. Checking /json/version...')
  try {
    const versionRes = await fetch(`${cdpUrl}/json/version`)
    const version = await versionRes.json()
    console.log('   Version:', JSON.stringify(version, null, 2))
  } catch (err) {
    console.error('   Failed:', err.message)
    console.log('\n   Make sure the Vite dev server is running and a browser is connected.')
    process.exit(1)
  }

  console.log('\n2. Checking /json (page list)...')
  try {
    const pagesRes = await fetch(`${cdpUrl}/json`)
    const pages = await pagesRes.json()
    console.log('   Pages:', JSON.stringify(pages, null, 2))

    if (pages.length === 0) {
      console.log('\n   No browser pages connected yet.')
      console.log('   Open the Vite app in a browser first, then run this script again.')
      process.exit(1)
    }
  } catch (err) {
    console.error('   Failed:', err.message)
    process.exit(1)
  }

  console.log('\n3. Connecting Playwright via connectOverCDP...')
  try {
    const browser = await chromium.connectOverCDP(cdpUrl)
    console.log('   Connected!')

    const contexts = browser.contexts()
    console.log('   Contexts:', contexts.length)

    for (const ctx of contexts) {
      const pages = ctx.pages()
      console.log('   Pages in context:', pages.length)

      for (const page of pages) {
        console.log('   - Page:', await page.title(), '|', page.url())

        // Try evaluating something
        const result = await page.evaluate(() => ({
          title: document.title,
          url: window.location.href,
          bodyText: document.body?.innerText?.slice(0, 100) + '...',
        }))
        console.log('   - Evaluated:', result)
      }
    }

    await browser.close()
    console.log('\n✓ CDP connection test passed!')
  } catch (err) {
    console.error('   Failed to connect:', err.message)
    console.error(err.stack)
    process.exit(1)
  }
}

main().catch(console.error)
