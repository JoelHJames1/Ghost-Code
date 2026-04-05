/**
 * Browser tool — gives Ghost eyes to see and debug websites.
 *
 * Uses Puppeteer (headless Chrome) to:
 * 1. Navigate to a URL and wait for it to load
 * 2. Capture all console errors/warnings
 * 3. Take a screenshot (model has vision — can see the page)
 * 4. Check for JavaScript errors, failed network requests
 *
 * This enables a self-healing build loop:
 *   Write code → run dev server → Browser checks page →
 *   finds errors → fixes them → Browser verifies fix
 */

import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, mkdirSync } from 'fs'
import type { ToolDefinition } from './types.js'

const SCREENSHOT_DIR = join(tmpdir(), 'ghost-code-screenshots')

export const BrowserTool: ToolDefinition = {
  spec: {
    type: 'function',
    function: {
      name: 'Browser',
      description:
        'Open a URL in headless Chrome, capture console errors, and take a screenshot. ' +
        'Use this to verify a website works, check for JavaScript errors, or see what the page looks like. ' +
        'Returns: console errors/warnings, network failures, page title, and a screenshot path you can view with Read.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL to open (e.g., "http://localhost:5173")',
          },
          waitFor: {
            type: 'number',
            description: 'Milliseconds to wait after page load for JS to render. Default: 3000.',
          },
          screenshot: {
            type: 'boolean',
            description: 'Take a screenshot of the page. Default: true.',
          },
          fullPage: {
            type: 'boolean',
            description: 'Capture the full scrollable page, not just viewport. Default: false.',
          },
          viewport: {
            type: 'string',
            description: 'Viewport size: "desktop" (1280x800), "mobile" (375x812), "tablet" (768x1024). Default: "desktop".',
          },
        },
        required: ['url'],
      },
    },
  },

  async execute(args) {
    const url = args.url as string
    const waitFor = (args.waitFor as number) || 3000
    const takeScreenshot = args.screenshot !== false
    const fullPage = (args.fullPage as boolean) || false
    const viewportName = (args.viewport as string) || 'desktop'

    const viewports: Record<string, { width: number; height: number }> = {
      desktop: { width: 1280, height: 800 },
      mobile: { width: 375, height: 812 },
      tablet: { width: 768, height: 1024 },
    }
    const viewport = viewports[viewportName] || viewports.desktop!

    try {
      // Dynamic import — puppeteer is optional
      const puppeteer = await import('puppeteer')

      const browser = await puppeteer.default.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
      })

      const page = await browser.newPage()
      await page.setViewport(viewport)

      // Collect console messages
      const consoleErrors: string[] = []
      const consoleWarnings: string[] = []
      const consoleLogs: string[] = []

      page.on('console', (msg) => {
        const type = msg.type()
        const text = msg.text()
        if (type === 'error') consoleErrors.push(text)
        else if (type === 'warning') consoleWarnings.push(text)
        else if (type === 'log' && text.length < 200) consoleLogs.push(text)
      })

      // Collect page errors (uncaught exceptions)
      const pageErrors: string[] = []
      page.on('pageerror', (err) => {
        pageErrors.push(err.message)
      })

      // Collect failed network requests
      const networkErrors: string[] = []
      page.on('requestfailed', (req) => {
        networkErrors.push(`${req.failure()?.errorText || 'failed'}: ${req.url().slice(0, 100)}`)
      })

      // Navigate
      const startTime = Date.now()
      let loadError = ''
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 })
      } catch (e: any) {
        loadError = e.message
      }

      // Wait for JS rendering
      await new Promise(r => setTimeout(r, waitFor))

      const loadTime = Date.now() - startTime
      const title = await page.title()

      // Take screenshot
      let screenshotPath = ''
      if (takeScreenshot) {
        if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true })
        screenshotPath = join(SCREENSHOT_DIR, `screenshot-${Date.now()}.png`)
        await page.screenshot({ path: screenshotPath, fullPage })
      }

      await browser.close()

      // Build report
      const lines: string[] = []

      if (loadError) {
        lines.push(`❌ Page failed to load: ${loadError}`)
      } else {
        lines.push(`✅ Page loaded in ${loadTime}ms — "${title}"`)
      }

      lines.push(`📐 Viewport: ${viewport.width}x${viewport.height} (${viewportName})`)

      if (pageErrors.length > 0) {
        lines.push(`\n🔴 JavaScript Errors (${pageErrors.length}):`)
        for (const err of pageErrors.slice(0, 10)) {
          lines.push(`  ✗ ${err.slice(0, 200)}`)
        }
      }

      if (consoleErrors.length > 0) {
        lines.push(`\n🟠 Console Errors (${consoleErrors.length}):`)
        for (const err of consoleErrors.slice(0, 10)) {
          lines.push(`  ✗ ${err.slice(0, 200)}`)
        }
      }

      if (consoleWarnings.length > 0) {
        lines.push(`\n⚠️ Console Warnings (${consoleWarnings.length}):`)
        for (const warn of consoleWarnings.slice(0, 5)) {
          lines.push(`  ⚠ ${warn.slice(0, 200)}`)
        }
      }

      if (networkErrors.length > 0) {
        lines.push(`\nNetwork Failures (${networkErrors.length}):`)
        for (const err of networkErrors.slice(0, 5)) {
          lines.push(`  ✗ ${err}`)
        }
      }

      if (pageErrors.length === 0 && consoleErrors.length === 0 && !loadError) {
        lines.push(`\n✅ No errors detected — site is working correctly`)
      }

      if (screenshotPath) {
        lines.push(`\n📸 Screenshot saved: ${screenshotPath}`)
        lines.push(`Use Read tool on this path to view the screenshot.`)
      }

      return lines.join('\n')

    } catch (e: any) {
      if (e.message?.includes('Cannot find module') || e.message?.includes('puppeteer')) {
        return 'Error: Puppeteer not installed. Run: npm install puppeteer (in the Ghost Code directory)'
      }
      return `Error launching browser: ${e.message}`
    }
  },
}
