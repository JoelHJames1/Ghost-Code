#!/usr/bin/env bun
/**
 * Deep React error/solution database + project setup patterns
 * Run: bun scripts/seed-errors-react-deep.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

interface ErrorEntry {
  id: string; error: string; errorKey: string; tool: string; context: string;
  solution: string; occurrences: number; confidence: number; firstSeen: string; lastSeen: string;
}

const storePath = join(homedir(), '.local', 'share', 'ghost-code', 'errors.json')
const now = new Date().toISOString()

function normalize(error: string): string {
  return error.replace(/\/[\w./-]+/g, '<PATH>').replace(/v?\d+\.\d+(\.\d+)?/g, '<VER>')
    .replace(/[0-9a-f]{8,}/gi, '<HASH>').replace(/:\d{4,5}/g, ':<PORT>')
    .replace(/@[\w/-]+/g, '@<PKG>').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 200)
}

function err(error: string, tool: string, context: string, solution: string): ErrorEntry {
  return { id: `err_rd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    error, errorKey: normalize(error), tool, context, solution,
    occurrences: 5, confidence: 0.9, firstSeen: now, lastSeen: now }
}

const errors: ErrorEntry[] = []

// ═══════════════════════════════════════════════════════════════
// REACT PROJECT SETUP PATTERNS (not errors — setup solutions)
// ═══════════════════════════════════════════════════════════════

errors.push(err(
  'How to set up a new React project with Tailwind and Framer Motion',
  'user-reported', 'project setup',
  'npm create vite@latest my-app -- --template react-ts && cd my-app && npm install && npm install -D @tailwindcss/vite && npm install framer-motion lucide-react. In vite.config.ts: import tailwindcss from "@tailwindcss/vite" and add to plugins. In src/index.css: @import "tailwindcss".',
))

errors.push(err(
  'How to set up Tailwind CSS v4 with Vite',
  'user-reported', 'tailwind setup',
  'Tailwind v4 setup: 1) npm install -D tailwindcss @tailwindcss/vite, 2) vite.config.ts: import tailwindcss from "@tailwindcss/vite"; export default defineConfig({ plugins: [react(), tailwindcss()] }), 3) src/index.css: @import "tailwindcss". No tailwind.config.js needed in v4.',
))

errors.push(err(
  'How to add dark mode to React with Tailwind',
  'user-reported', 'dark mode setup',
  'In CSS: @import "tailwindcss"; @custom-variant dark (&:where(.dark, .dark *));. Then toggle: document.documentElement.classList.toggle("dark"). Use dark: prefix: className="bg-white dark:bg-gray-950". Persist with localStorage.',
))

errors.push(err(
  'How to add Framer Motion page transitions',
  'user-reported', 'animation setup',
  'Wrap pages in AnimatePresence + motion.div: <AnimatePresence mode="wait"><motion.div key={pathname} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} transition={{duration:0.3}}>{children}</motion.div></AnimatePresence>',
))

errors.push(err(
  'How to add scroll animations in React',
  'user-reported', 'scroll animation',
  'Use framer-motion useInView: const ref = useRef(null); const inView = useInView(ref, {once:true, margin:"-100px"}); return <motion.div ref={ref} initial={{opacity:0,y:30}} animate={inView ? {opacity:1,y:0} : {}}>{children}</motion.div>',
))

// ═══════════════════════════════════════════════════════════════
// TAILWIND CSS v4 SPECIFIC
// ═══════════════════════════════════════════════════════════════

errors.push(err(
  '@tailwind base is not a valid CSS',
  'user-reported', 'Tailwind v4',
  'Tailwind v4 no longer uses @tailwind directives. Replace ALL @tailwind directives with: @import "tailwindcss"; in your CSS file. Delete tailwind.config.js — v4 uses CSS-based configuration.',
))

errors.push(err(
  'Cannot find module tailwindcss/plugin',
  'user-reported', 'Tailwind v4',
  'Tailwind v4 changed plugin imports. Use: import plugin from "tailwindcss/plugin" is now just CSS. Most v3 plugins are replaced by native CSS features in v4. Check tailwindcss.com/docs/upgrade-guide.',
))

errors.push(err(
  'tailwind.config.js is not recognized',
  'user-reported', 'Tailwind v4',
  'Tailwind v4 does not use tailwind.config.js. Configure in CSS: @theme { --color-primary: #4285F4; --font-sans: Inter, sans-serif; }. Custom utilities: @utility my-util { ... }. Delete tailwind.config.js entirely.',
))

errors.push(err(
  'postcss.config.js is not needed',
  'user-reported', 'Tailwind v4 + Vite',
  'When using @tailwindcss/vite plugin, PostCSS config is not needed. Delete postcss.config.js. The Vite plugin handles everything. Only keep PostCSS if you need other PostCSS plugins.',
))

// ═══════════════════════════════════════════════════════════════
// VITE + REACT ERRORS
// ═══════════════════════════════════════════════════════════════

errors.push(err(
  'Failed to resolve import from node_modules',
  'user-reported', 'Vite resolve',
  'Vite cannot resolve a package. Fix: 1) npm install the package, 2) Clear Vite cache: rm -rf node_modules/.vite, 3) Restart dev server, 4) Check if package supports ESM (some CJS-only packages need vite-plugin-commonjs).',
))

errors.push(err(
  'Pre-transform error: Failed to load',
  'user-reported', 'Vite HMR',
  'Vite hot module replacement failed. Fix: 1) Clear cache: rm -rf node_modules/.vite, 2) Check import paths (case-sensitive), 3) Restart dev server. If persistent, check for circular imports.',
))

errors.push(err(
  'process is not defined',
  'user-reported', 'Vite browser',
  'process.env is Node.js, not available in browser. Fix: use import.meta.env.VITE_MY_VAR in Vite. Env vars must be prefixed with VITE_ to be exposed to client code. Define in .env file.',
))

errors.push(err(
  'require is not defined',
  'user-reported', 'Vite ESM',
  'require() is CommonJS, Vite uses ESM. Fix: change require("pkg") to import pkg from "pkg". For dynamic imports: const mod = await import("./module.js"). For images: import img from "./image.png".',
))

// ═══════════════════════════════════════════════════════════════
// FRAMER MOTION ERRORS
// ═══════════════════════════════════════════════════════════════

errors.push(err(
  'Warning: Cannot update a component while rendering a different component',
  'user-reported', 'Framer Motion / React',
  'State update during render. With Framer Motion, this often happens with onAnimationComplete or layout animations. Fix: wrap state updates in setTimeout(() => setState(x), 0) or move to useEffect.',
))

errors.push(err(
  'motion is not exported from framer-motion',
  'user-reported', 'Framer Motion import',
  'Wrong import. Correct: import { motion, AnimatePresence } from "framer-motion". The "motion" is a named export, not default. Check framer-motion version: npm ls framer-motion.',
))

errors.push(err(
  'AnimatePresence only works with direct children',
  'user-reported', 'Framer Motion',
  'AnimatePresence needs motion.div as direct children with key prop. Wrong: <AnimatePresence><div>...</div></AnimatePresence>. Right: <AnimatePresence><motion.div key={id} exit={{opacity:0}}>...</motion.div></AnimatePresence>.',
))

// ═══════════════════════════════════════════════════════════════
// LUCIDE-REACT ICON ERRORS (comprehensive)
// ═══════════════════════════════════════════════════════════════

errors.push(err(
  "does not provide an export named 'Linkedin'",
  'user-reported', 'lucide-react',
  'In lucide-react, LinkedIn icon is named "Linkedin" (capital L, lowercase rest). If that fails, try: import { LinkedinIcon } from "lucide-react". Check exact names at lucide.dev/icons — search for the icon name.',
))

errors.push(err(
  "does not provide an export named 'Mail'",
  'user-reported', 'lucide-react',
  'Try: import { Mail } from "lucide-react" — Mail should work. If not, try MailIcon. For all icons, check lucide.dev/icons. Import format: PascalCase name matching the icon.',
))

errors.push(err(
  "does not provide an export named 'ExternalLink'",
  'user-reported', 'lucide-react',
  'ExternalLink was renamed. Try: import { ExternalLink } from "lucide-react" or { ExternalLinkIcon }. In newer versions it might be { SquareArrowOutUpRight }. Check lucide.dev/icons.',
))

errors.push(err(
  'lucide-react icons not rendering',
  'user-reported', 'lucide-react',
  'Icons render as SVG. Make sure: 1) Correct import: import { Heart } from "lucide-react", 2) Use as component: <Heart size={24} />, 3) Check CSS not hiding SVGs, 4) size prop for dimensions, color prop or className for color.',
))

// ═══════════════════════════════════════════════════════════════
// REACT ROUTER / NEXT.JS NAVIGATION
// ═══════════════════════════════════════════════════════════════

errors.push(err(
  'useNavigate() may be used only in the context of a Router',
  'user-reported', 'React Router',
  'Component using useNavigate is not inside <BrowserRouter>. Fix: wrap your App in <BrowserRouter> in main.tsx/index.tsx: <BrowserRouter><App /></BrowserRouter>.',
))

errors.push(err(
  'useParams() may be used only in the context of a Router',
  'user-reported', 'React Router',
  'Same fix as useNavigate: wrap App in <BrowserRouter>. useParams, useLocation, useNavigate all require Router context.',
))

errors.push(err(
  'No routes matched location',
  'user-reported', 'React Router',
  'URL does not match any defined route. Check: 1) Route path spelling, 2) Leading slash: path="/about" not path="about", 3) Nested routes need <Outlet/> in parent, 4) Catch-all: <Route path="*" element={<NotFound/>}/>.',
))

// ═══════════════════════════════════════════════════════════════
// CSS / STYLING ERRORS
// ═══════════════════════════════════════════════════════════════

errors.push(err(
  'Tailwind classes not applying',
  'user-reported', 'Tailwind CSS',
  'Classes not working. Check: 1) CSS file imported in main.tsx: import "./index.css", 2) @import "tailwindcss" in index.css (v4) or @tailwind directives (v3), 3) Vite plugin configured, 4) Clear browser cache, 5) Check class names are valid — typos are silent failures.',
))

errors.push(err(
  'backdrop-filter blur not working',
  'user-reported', 'CSS',
  'backdrop-filter needs: 1) The element must have a semi-transparent background: bg-white/80 not bg-white, 2) -webkit-backdrop-filter for Safari: add both, 3) Parent cannot have overflow:hidden in some cases.',
))

errors.push(err(
  'position sticky not working',
  'user-reported', 'CSS',
  'Sticky requires: 1) top/bottom value set: top-0, 2) Parent cannot have overflow:hidden or overflow:auto, 3) Parent must have enough height for scrolling, 4) No ancestor with overflow:hidden between element and scroll container.',
))

errors.push(err(
  'z-index not working',
  'user-reported', 'CSS',
  'z-index only works on positioned elements (relative, absolute, fixed, sticky). Check: 1) Add position:relative, 2) Check stacking context — transform, opacity<1, or filter on a parent creates a new stacking context that limits z-index scope.',
))

errors.push(err(
  'flexbox items not centering',
  'user-reported', 'CSS',
  'For horizontal + vertical center: display:flex; justify-content:center; align-items:center. In Tailwind: flex items-center justify-center. For full-page centering, also add min-h-screen. Check: parent must have explicit height.',
))

errors.push(err(
  'grid items overflowing container',
  'user-reported', 'CSS',
  'Grid children with long content can overflow. Fix: 1) Add min-width:0 to grid children (Tailwind: min-w-0), 2) Use overflow:hidden or text-overflow:ellipsis, 3) For auto-fill: grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)).',
))

// ═══════════════════════════════════════════════════════════════
// DEPLOYMENT ERRORS
// ═══════════════════════════════════════════════════════════════

errors.push(err(
  'Vercel build failed',
  'user-reported', 'Vercel deployment',
  'Check build logs in Vercel dashboard. Common causes: 1) TypeScript errors (Vercel runs strict build), 2) Missing env vars — add in Vercel dashboard Settings → Environment Variables, 3) Node version mismatch — set in package.json engines field.',
))

errors.push(err(
  'Netlify deploy failed',
  'user-reported', 'Netlify deployment',
  'Check deploy logs. Common: 1) Build command wrong — should be "npm run build" or "vite build", 2) Publish directory: "dist" for Vite, "out" for Next.js export, ".next" for Next.js, 3) Missing env vars in Netlify settings.',
))

errors.push(err(
  '404 on page refresh in SPA',
  'user-reported', 'SPA routing',
  'Server returns 404 for client-side routes. Fix: configure server to serve index.html for all routes. Vercel: vercel.json with {"rewrites":[{"source":"/(.*)", "destination":"/index.html"}]}. Netlify: _redirects file with /* /index.html 200.',
))

// Save
const dir = join(homedir(), '.local', 'share', 'ghost-code')
if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
let store = { errors: [] as ErrorEntry[] }
try { if (existsSync(storePath)) store = JSON.parse(readFileSync(storePath, 'utf-8')) } catch {}
const existingKeys = new Set(store.errors.map(e => e.errorKey))
let added = 0
for (const e of errors) { if (!existingKeys.has(e.errorKey)) { store.errors.push(e); added++ } }
writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8')
console.log(`\n✅ Seeded ${added} React-deep error fixes (${store.errors.length} total)`)
