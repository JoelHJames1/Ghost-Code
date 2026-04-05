#!/usr/bin/env bun
/**
 * Seed error database v2 — React, Swift/iOS, C#/.NET, Android, Unity, Git, general web dev
 * Run: bun scripts/seed-errors-v2.ts
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
  return { id: `err_v2_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    error, errorKey: normalize(error), tool, context, solution,
    occurrences: 5, confidence: 0.85, firstSeen: now, lastSeen: now }
}

const errors: ErrorEntry[] = []

// ═══════════════════════════════════════════════════════════════
// REACT / NEXT.JS ERRORS
// ═══════════════════════════════════════════════════════════════

errors.push(err(
  "does not provide an export named 'Github'",
  'user-reported', 'lucide-react icon import',
  'lucide-react icon names changed. Github → GitHubIcon. Check exact names at lucide.dev/icons. Common: Github→GitHubIcon, Linkedin→LinkedinIcon, Mail→MailIcon. Or import all: import * as Icons from "lucide-react" then use Icons.Github.',
))

errors.push(err(
  'does not provide an export named',
  'user-reported', 'ES module import',
  'The named export does not exist in the module. Check: 1) Correct export name (case-sensitive), 2) Module might use default export: import Pkg from "pkg" not { Pkg }, 3) Package version changed exports — check docs.',
))

errors.push(err(
  'Cannot read properties of undefined',
  'user-reported', 'React runtime error',
  'Accessing a property on undefined/null. Common causes: 1) API data not loaded yet — add loading check: if (!data) return <Loading/>, 2) Optional chaining missing: data?.user?.name, 3) Array index out of bounds.',
))

errors.push(err(
  'Cannot read properties of null',
  'user-reported', 'React runtime error',
  'Null reference. Common causes: 1) useRef.current is null before mount — check in useEffect, 2) document.getElementById returned null — element not in DOM yet, 3) State not initialized.',
))

errors.push(err(
  'Objects are not valid as a React child',
  'user-reported', 'React render error',
  'Trying to render an object directly in JSX. Fix: render specific properties: {user.name} not {user}. For dates: {date.toLocaleDateString()}. For arrays of objects: {items.map(i => <span>{i.name}</span>)}.',
))

errors.push(err(
  'Each child in a list should have a unique key prop',
  'user-reported', 'React warning',
  'Missing key prop in .map(). Fix: add key={item.id} to the outermost element in the map callback. Use a unique stable ID, never array index (unless list never reorders).',
))

errors.push(err(
  'Too many re-renders. React limits the number of renders',
  'user-reported', 'React infinite loop',
  'setState called during render, causing infinite loop. Common causes: 1) onClick={setCount(count+1)} should be onClick={() => setCount(count+1)}, 2) useEffect missing dependency array, 3) State update in render body without condition.',
))

errors.push(err(
  'Invalid hook call. Hooks can only be called inside of the body of a function component',
  'user-reported', 'React hooks error',
  'Hook called outside a component or in wrong order. Rules: 1) Only call hooks at top level (not in if/for/callbacks), 2) Only in function components or custom hooks, 3) Check for duplicate React versions: npm ls react.',
))

errors.push(err(
  'Rendered more hooks than during the previous render',
  'user-reported', 'React hooks error',
  'Hooks called conditionally — number of hooks must be same every render. Fix: move all hooks above any early returns or conditions. Never put hooks inside if/else blocks.',
))

errors.push(err(
  'Minified React error',
  'user-reported', 'React production error',
  'React error in production build (messages minified). Look up the error number at reactjs.org/docs/error-decoder.html?invariant=<number>. Common: #418 = hydration mismatch, #321 = multiple React copies.',
))

errors.push(err(
  "Module not found: Can't resolve 'tailwindcss'",
  'Bash', 'build/dev',
  'Tailwind CSS not installed or wrong version. For Tailwind v4: npm install tailwindcss @tailwindcss/vite. For v3: npm install -D tailwindcss postcss autoprefixer && npx tailwindcss init -p.',
))

errors.push(err(
  'Unknown at rule @tailwind',
  'user-reported', 'CSS/PostCSS',
  'Editor does not recognize @tailwind directive. For Tailwind v4: use @import "tailwindcss" instead of @tailwind directives. For v3: install PostCSS Language Support VS Code extension.',
))

errors.push(err(
  'window is not defined',
  'user-reported', 'Next.js SSR error',
  'Accessing browser-only API (window, document, localStorage) during server-side rendering. Fix: wrap in useEffect, use dynamic import with { ssr: false }, or check typeof window !== "undefined".',
))

errors.push(err(
  'document is not defined',
  'user-reported', 'Next.js SSR error',
  'Same as window is not defined. The document object only exists in the browser. Use useEffect for DOM manipulation, or dynamic(() => import("./Component"), { ssr: false }).',
))

errors.push(err(
  'Failed to compile. next/image',
  'Bash', 'next build',
  'next/image requires width and height props for external images, or use fill prop with relative parent. For external domains, add them to next.config.js: images: { remotePatterns: [{ hostname: "example.com" }] }.',
))

errors.push(err(
  'Attempted import error: does not contain a default export',
  'user-reported', 'React import error',
  'File uses named export but you imported as default. Fix: change import Component from "./Component" to import { Component } from "./Component", or add "export default" to the component file.',
))

// ═══════════════════════════════════════════════════════════════
// SWIFT / iOS ERRORS
// ═══════════════════════════════════════════════════════════════

errors.push(err(
  'Type does not conform to protocol Codable',
  'user-reported', 'Swift compilation',
  'All properties must be Codable. Check: 1) Custom types need their own Codable conformance, 2) Optional properties are fine, 3) Enums need raw value type or manual Codable impl, 4) Computed properties are excluded by default.',
))

errors.push(err(
  'Cannot convert value of type to expected argument type',
  'user-reported', 'Swift type error',
  'Type mismatch. Common fixes: 1) String(number) for Int→String, 2) Int(string) for String→Int (returns optional), 3) as! for forced cast (dangerous), 4) as? for safe optional cast.',
))

errors.push(err(
  'Value of optional type must be unwrapped',
  'user-reported', 'Swift optional error',
  'Trying to use an optional without unwrapping. Fix: if let value = optional { use(value) }, or guard let value = optional else { return }, or optional?.method() for optional chaining. Avoid force unwrap (!) in production.',
))

errors.push(err(
  'Thread 1: Fatal error: Unexpectedly found nil while unwrapping an Optional value',
  'user-reported', 'Swift crash',
  'Force unwrap (!) on a nil value. Find the line that crashed and replace ! with safe unwrapping: if let, guard let, or ?? default value. Common with IBOutlets (not connected in storyboard) and force-unwrapped API responses.',
))

errors.push(err(
  'Escaping closure captures mutating self parameter',
  'user-reported', 'Swift struct error',
  'Structs are value types — async closures cannot mutate self. Fix: 1) Change struct to class, 2) Use @MainActor and ObservableObject, 3) Capture specific properties instead of self.',
))

errors.push(err(
  'Publishing changes from background threads is not allowed',
  'user-reported', 'SwiftUI error',
  'UI updates must happen on main thread. Fix: wrap in MainActor.run { } or await MainActor.run { }, or mark the entire class @MainActor, or use .receive(on: DispatchQueue.main) for Combine publishers.',
))

errors.push(err(
  'Referencing initializer init on ObservableObject requires that',
  'user-reported', 'SwiftUI error',
  'Using @StateObject or @ObservedObject with wrong type. @StateObject/@ObservedObject require the type to conform to ObservableObject. Add: class MyModel: ObservableObject { @Published var data = [] }.',
))

errors.push(err(
  'The compiler is unable to type-check this expression in reasonable time',
  'user-reported', 'Swift compilation',
  'Complex expression exceeds type checker limits. Fix: break the expression into smaller parts with explicit type annotations. Common with long SwiftUI view builders — extract subviews into separate computed properties.',
))

errors.push(err(
  'Signing for requires a development team',
  'user-reported', 'Xcode build',
  'No development team selected. In Xcode: select the project → Signing & Capabilities → Team. You need an Apple Developer account (free for device testing, $99/year for App Store).',
))

errors.push(err(
  'Failed to register bundle identifier',
  'user-reported', 'Xcode build',
  'Bundle ID already taken or not allowed. Fix: change the Bundle Identifier in Xcode to something unique like com.yourname.appname. Each app needs a globally unique bundle ID.',
))

// ═══════════════════════════════════════════════════════════════
// C# / .NET ERRORS
// ═══════════════════════════════════════════════════════════════

errors.push(err(
  'NullReferenceException: Object reference not set to an instance of an object',
  'user-reported', 'C# runtime',
  'Accessing member on null. Fix: 1) Add null checks: if (obj != null), 2) Use null-conditional: obj?.Method(), 3) Use null-coalescing: value ?? defaultValue, 4) Enable nullable reference types in .csproj: <Nullable>enable</Nullable>.',
))

errors.push(err(
  'InvalidOperationException: Sequence contains no elements',
  'user-reported', 'C# LINQ',
  'Calling .First() or .Single() on empty collection. Fix: use .FirstOrDefault() (returns null/default if empty), or check .Any() before accessing. .SingleOrDefault() for single-or-none.',
))

errors.push(err(
  'Cannot implicitly convert type',
  'user-reported', 'C# compilation',
  'Type mismatch. Fix: explicit cast (int)value, Convert.ToInt32(value), .ToString(), or parse: int.Parse(str) / int.TryParse(str, out var result). For nullable: (int?)value or value.GetValueOrDefault().',
))

errors.push(err(
  "No service for type 'IService' has been registered",
  'user-reported', 'ASP.NET Core DI',
  'Service not registered in DI container. Add to Program.cs: builder.Services.AddScoped<IService, ServiceImpl>() or .AddTransient or .AddSingleton. Make sure interface and implementation match.',
))

errors.push(err(
  'A possible object cycle was detected',
  'user-reported', 'ASP.NET Core JSON',
  'Circular reference in JSON serialization. Fix: 1) Use [JsonIgnore] on navigation properties, 2) Use DTOs instead of entities, 3) builder.Services.AddControllers().AddJsonOptions(o => o.JsonSerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles).',
))

errors.push(err(
  'Unable to create a DbContext of type. The parameterless constructor',
  'user-reported', 'EF Core migration',
  'EF tools cannot create DbContext. Fix: add IDesignTimeDbContextFactory<AppDbContext> class, or register DbContext in DI: builder.Services.AddDbContext<AppDbContext>(o => o.UseNpgsql(connectionString)).',
))

errors.push(err(
  'The entity type requires a primary key',
  'user-reported', 'EF Core',
  'Entity class missing primary key. Fix: add [Key] attribute or configure in OnModelCreating: modelBuilder.Entity<MyEntity>().HasKey(e => e.Id). Convention: property named "Id" or "<TypeName>Id" is auto-detected.',
))

errors.push(err(
  'CORS policy: No Access-Control-Allow-Origin',
  'user-reported', 'ASP.NET Core',
  'CORS not configured. Add to Program.cs: builder.Services.AddCors(o => o.AddDefaultPolicy(b => b.WithOrigins("http://localhost:3000").AllowAnyMethod().AllowAnyHeader())); then app.UseCors() BEFORE app.UseAuthorization().',
))

errors.push(err(
  'An error occurred while updating the entries',
  'user-reported', 'EF Core save',
  'Database save failed. Check inner exception for details. Common: unique constraint violation (duplicate key), foreign key violation (referenced row missing), not-null violation (required field empty). Wrap in try-catch and log ex.InnerException.',
))

// ═══════════════════════════════════════════════════════════════
// ANDROID / KOTLIN ERRORS
// ═══════════════════════════════════════════════════════════════

errors.push(err(
  'Cannot create an instance of ViewModel',
  'user-reported', 'Android',
  'ViewModel constructor has parameters but no factory/Hilt. Fix: 1) With Hilt: add @HiltViewModel and @Inject constructor, add @AndroidEntryPoint to Activity/Fragment, 2) Without Hilt: create ViewModelFactory, 3) For Compose: hiltViewModel().',
))

errors.push(err(
  'Only safe or non-null asserted calls are allowed on a nullable receiver',
  'user-reported', 'Kotlin',
  'Calling method on nullable type. Fix: use safe call ?. (obj?.method()), non-null assert !! (risky), let block (obj?.let { it.method() }), or elvis operator (obj?.value ?: defaultValue).',
))

errors.push(err(
  'NetworkOnMainThreadException',
  'user-reported', 'Android',
  'Network call on main thread blocks UI. Fix: use coroutines: viewModelScope.launch { withContext(Dispatchers.IO) { apiCall() } }, or use Retrofit with suspend functions, or use Flow.',
))

errors.push(err(
  'Gradle sync failed',
  'user-reported', 'Android Studio',
  'Gradle cannot resolve dependencies. Fix: 1) File → Invalidate Caches/Restart, 2) Check internet connection, 3) Update Gradle version in gradle-wrapper.properties, 4) Check for version conflicts in build.gradle.kts, 5) Try: ./gradlew --refresh-dependencies.',
))

// ═══════════════════════════════════════════════════════════════
// UNITY C# ERRORS
// ═══════════════════════════════════════════════════════════════

errors.push(err(
  'NullReferenceException: Object reference not set',
  'user-reported', 'Unity',
  'Common Unity null ref. Check: 1) SerializeField not assigned in Inspector — drag the reference, 2) GetComponent<T>() returns null if component missing, 3) Find/FindWithTag returns null if object not in scene, 4) Destroyed objects are null.',
))

errors.push(err(
  'MissingReferenceException: The object has been destroyed',
  'user-reported', 'Unity',
  'Accessing a destroyed GameObject. Fix: check if (obj != null) before access (Unity overloads == for destroyed objects). Common with pooled objects or scene transitions. Cancel coroutines in OnDestroy.',
))

errors.push(err(
  'Can not play a disabled audio source',
  'user-reported', 'Unity',
  'AudioSource component is disabled or GameObject is inactive. Fix: ensure gameObject.SetActive(true) and audioSource.enabled = true before calling Play(). Check if the AudioSource is on an active GameObject.',
))

errors.push(err(
  'Animator is not playing an AnimatorController',
  'user-reported', 'Unity',
  'Animator has no controller assigned. Fix: create an Animator Controller asset, add states and transitions, assign it to the Animator component in the Inspector.',
))

errors.push(err(
  'SetDestination can only be called on an active agent',
  'user-reported', 'Unity NavMesh',
  'NavMeshAgent not active or not on a NavMesh. Fix: 1) Ensure agent.enabled = true, 2) Bake the NavMesh (Window → AI → Navigation → Bake), 3) Check agent is placed on the NavMesh surface, 4) Wait one frame after enabling before SetDestination.',
))

// ═══════════════════════════════════════════════════════════════
// GIT ERRORS
// ═══════════════════════════════════════════════════════════════

errors.push(err(
  'Your local changes to the following files would be overwritten',
  'Bash', 'git pull/checkout',
  'Uncommitted changes conflict with incoming changes. Fix: 1) git stash, then git pull, then git stash pop, 2) git commit your changes first, then pull, 3) git checkout -- <file> to discard local changes (destructive).',
))

errors.push(err(
  'detached HEAD',
  'Bash', 'git checkout',
  'HEAD is not on a branch — you checked out a specific commit. Fix: git checkout main to go back to a branch, or git checkout -b new-branch to create a branch from this commit.',
))

errors.push(err(
  'Permission denied (publickey)',
  'Bash', 'git push/pull',
  'SSH key not configured for GitHub. Fix: 1) Generate key: ssh-keygen -t ed25519, 2) Add to agent: ssh-add ~/.ssh/id_ed25519, 3) Copy public key: cat ~/.ssh/id_ed25519.pub, 4) Add to GitHub: Settings → SSH Keys. Or use HTTPS instead of SSH.',
))

errors.push(err(
  'remote: Repository not found',
  'Bash', 'git push',
  'Repo does not exist or you lack access. Check: 1) Correct URL: git remote -v, 2) Repo exists on GitHub, 3) You have push access, 4) If private, authenticate: gh auth login.',
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
console.log(`\n✅ Seeded ${added} error fixes (${store.errors.length} total)`)
console.log('Covers: React, Next.js, Swift/iOS, C#/.NET, Android/Kotlin, Unity, Git')
