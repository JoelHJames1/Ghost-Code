#!/usr/bin/env bun
/**
 * Seed Ghost's knowledge base — Volume 4
 * Mobile (Swift/Android), Game Dev (SpriteKit/Unity/Unreal), 3D (Three.js), MCP
 * Run: bun scripts/seed-knowledge-v4.ts
 */

import { assertBelief } from '../src/knowledge/beliefs.js'
import { ensureEntity, addRelation } from '../src/knowledge/graph.js'
import { practiceSkill, addSkillNote } from '../src/growth/skills.js'

function seedTopic(
  topic: string,
  domain: string,
  concepts: string[],
  subConcepts: Array<{ name: string; type: string; relation: string }> = [],
) {
  console.log(`\n📚 Seeding: ${topic} (${concepts.length} concepts)`)
  ensureEntity(topic, 'technology', {
    seededAt: new Date().toISOString(),
    source: 'claude-expert-knowledge-v4',
    conceptCount: String(concepts.length),
  })
  for (const concept of concepts) {
    assertBelief(concept, 'technical', `Expert knowledge on ${topic}`, 'claude-seeded')
  }
  for (const sub of subConcepts) {
    ensureEntity(sub.name, sub.type as any)
    addRelation(sub.name, sub.type as any, topic, 'technology', sub.relation as any, `${sub.name} ${sub.relation} ${topic}`, 0.9, 'claude-seeded')
  }
  practiceSkill(topic, domain, true, `Expert knowledge seeded: ${concepts.length} concepts`)
  addSkillNote(topic, `Deep knowledge seeded by Claude (v4).`)
}

// ════════════════════════════════════════════════════════════════════════
// SWIFT & iOS DEVELOPMENT
// ════════════════════════════════════════════════════════════════════════

seedTopic('Swift & iOS', 'technology', [
  // Swift language
  'Swift is Apple\'s modern, type-safe language for iOS, macOS, watchOS, and tvOS. It replaces Objective-C with safer, more expressive syntax.',
  'Optionals (?/!) are core to Swift\'s null safety. String? means might be nil. Force unwrap (!) crashes on nil — always use if let or guard let.',
  'guard let provides early exit: guard let user = getUser() else { return }. Cleaner than nested if-let for precondition checks.',
  'Enums with associated values: enum Result { case success(Data), case failure(Error) }. Pattern match with switch for exhaustive handling.',
  'Protocols define behavior contracts: protocol Drawable { func draw() }. Protocol-oriented programming is preferred over class inheritance in Swift.',
  'Extensions add functionality to existing types without subclassing: extension String { var isEmail: Bool { ... } }.',
  'Closures are first-class: let sorted = names.sorted { $0 < $1 }. Trailing closure syntax eliminates boilerplate.',
  'Structs are value types (copied on assignment), classes are reference types (shared). Prefer structs — they\'re safer and faster.',
  'async/await in Swift: func fetchData() async throws -> Data { let (data, _) = try await URLSession.shared.data(from: url) }.',
  'Actors protect mutable state from data races: actor Counter { var count = 0; func increment() { count += 1 } }.',
  'Property wrappers: @Published, @State, @Binding, @AppStorage — reusable property behavior. @propertyWrapper struct Clamped { ... }.',
  'Error handling: do { try operation() } catch { print(error) }. Define custom errors with enum MyError: Error { case notFound }.',
  'Generics: func swap<T>(_ a: inout T, _ b: inout T). Constrain with where: func process<T: Codable>(_ item: T).',

  // SwiftUI
  'SwiftUI is declarative UI: describe WHAT the interface looks like, not HOW to build it. var body: some View { Text("Hello") }.',
  'Views are structs, not classes. They\'re cheap to create and destroy. SwiftUI diffs them and only updates what changed.',
  '@State for local mutable state, @Binding for child access to parent state, @ObservedObject/@StateObject for reference-type models.',
  '@EnvironmentObject injects shared state down the view hierarchy without passing through every view. Like React Context.',
  'NavigationStack replaces NavigationView. NavigationLink(value:) + .navigationDestination(for:) for type-safe navigation.',
  'List renders scrollable rows efficiently (like UITableView but declarative). ForEach with Identifiable data for dynamic content.',
  'Combine framework: Publisher/Subscriber pattern for reactive data flow. $property creates a publisher from @Published values.',
  'MVVM is the standard architecture for SwiftUI: View observes ViewModel (@ObservableObject), ViewModel calls Model/Services.',
  'Preview: #Preview { MyView() } renders live previews in Xcode. Use .previewLayout(.sizeThatFits) for component isolation.',
  'Animations: withAnimation(.spring) { isExpanded.toggle() } animates all changes within the closure. .matchedGeometryEffect for hero transitions.',

  // UIKit & advanced iOS
  'UIKit is imperative UI (still used for complex views). UIViewController lifecycle: viewDidLoad → viewWillAppear → viewDidAppear.',
  'Auto Layout: NSLayoutConstraint defines relationships between views. Use anchors: view.topAnchor.constraint(equalTo: parent.topAnchor).',
  'Core Data is Apple\'s persistence framework. NSManagedObject entities with relationships. Use NSFetchRequest with predicates for queries.',
  'SwiftData (iOS 17+) is the modern replacement for Core Data. @Model macro, simpler API, works natively with SwiftUI.',
  'URLSession for networking. Combine with Codable for JSON parsing: URLSession.shared.dataTaskPublisher(for: url).decode(type: User.self).',
  'Push notifications: register with UNUserNotificationCenter, handle tokens via APNs or Firebase Cloud Messaging.',
  'App Store review: follow Human Interface Guidelines, handle rejection gracefully, use TestFlight for beta testing.',
  'Keychain for secure credential storage. Never store passwords in UserDefaults — it\'s unencrypted.',
  'Instruments (Xcode profiler): Time Profiler for CPU, Allocations for memory leaks, Network for HTTP requests. Profile on device, not simulator.',
], [
  { name: 'SwiftUI', type: 'technology', relation: 'part_of' },
  { name: 'UIKit', type: 'technology', relation: 'part_of' },
  { name: 'Combine', type: 'technology', relation: 'uses' },
  { name: 'Core Data', type: 'technology', relation: 'uses' },
  { name: 'SwiftData', type: 'technology', relation: 'uses' },
  { name: 'Xcode', type: 'technology', relation: 'uses' },
])

// ════════════════════════════════════════════════════════════════════════
// ANDROID DEVELOPMENT (KOTLIN)
// ════════════════════════════════════════════════════════════════════════

seedTopic('Android Development', 'technology', [
  // Kotlin
  'Kotlin is the primary language for Android. Null-safe by default: String vs String?. Use ?. for safe calls, ?: for defaults.',
  'Data classes: data class User(val name: String, val age: Int) auto-generates equals, hashCode, toString, copy. Like Swift structs.',
  'Sealed classes: sealed class Result { data class Success(val data: String) : Result(); data class Error(val msg: String) : Result() }.',
  'Coroutines for async: launch { }, async { }. Structured concurrency with CoroutineScope. viewModelScope auto-cancels with ViewModel.',
  'Flow is Kotlin\'s reactive stream: flow { emit(value) }. StateFlow for state, SharedFlow for events. Replaces LiveData in modern apps.',
  'Extension functions: fun String.isEmail(): Boolean. Add methods to existing classes without inheritance.',
  'Scope functions: let, run, with, apply, also. Use let for null checks: user?.let { print(it.name) }.',

  // Jetpack Compose
  'Jetpack Compose is Android\'s declarative UI (like SwiftUI). @Composable functions describe UI: @Composable fun Greeting() { Text("Hi") }.',
  'remember { mutableStateOf(0) } for local state. State triggers recomposition when changed. Like React useState.',
  'LaunchedEffect(key) runs side effects when key changes. Like React useEffect. Use for API calls, subscriptions.',
  'Modifier chain: Modifier.fillMaxWidth().padding(16.dp).clickable { }. Order matters — padding before vs after background changes behavior.',
  'Navigation Compose: NavHost(navController, startDestination = "home") { composable("home") { HomeScreen() } }.',
  'Material 3: MaterialTheme wraps the app with colors, typography, shapes. Use MaterialTheme.colorScheme.primary for themed colors.',
  'LazyColumn/LazyRow for efficient scrolling lists (like RecyclerView but declarative). items(list) { item -> ItemRow(item) }.',
  'ViewModel + StateFlow: ViewModel holds business logic, exposes StateFlow<UiState>. Composable collects with collectAsState().',

  // Architecture
  'MVVM is standard: View (Compose) → ViewModel (logic + state) → Repository (data) → DataSource (Room, Retrofit, DataStore).',
  'Hilt for dependency injection: @HiltAndroidApp on Application, @AndroidEntryPoint on Activity, @Inject constructor for ViewModels.',
  'Room database: @Entity, @Dao, @Database annotations. Compile-time SQL verification. Flow<List<Entity>> for reactive queries.',
  'Retrofit for HTTP: interface ApiService { @GET("users") suspend fun getUsers(): List<User> }. Moshi or kotlinx.serialization for JSON.',
  'DataStore replaces SharedPreferences. Proto DataStore for typed data, Preferences DataStore for key-value. Coroutine-based.',
  'WorkManager for background tasks that survive process death: one-time, periodic, chained, constrained (network, charging).',
  'Gradle build system: build.gradle.kts (Kotlin DSL). Version catalogs (libs.versions.toml) for centralized dependency management.',
  'ProGuard/R8 for code shrinking and obfuscation in release builds. Reduces APK size and protects against reverse engineering.',
  'Android lifecycle: Activity/Fragment have complex lifecycles. ViewModel survives configuration changes. Use lifecycle-aware components.',
], [
  { name: 'Jetpack Compose', type: 'technology', relation: 'part_of' },
  { name: 'Kotlin', type: 'technology', relation: 'uses' },
  { name: 'Hilt', type: 'technology', relation: 'uses' },
  { name: 'Room', type: 'technology', relation: 'uses' },
  { name: 'Retrofit', type: 'technology', relation: 'uses' },
])

// ════════════════════════════════════════════════════════════════════════
// SPRITEKIT & 2D GAME DEVELOPMENT
// ════════════════════════════════════════════════════════════════════════

seedTopic('SpriteKit', 'technology', [
  'SpriteKit is Apple\'s 2D game framework for iOS/macOS. SKScene is the canvas, SKNode is the base of all visible objects.',
  'SKSpriteNode displays images: let player = SKSpriteNode(imageNamed: "hero"). Add to scene with addChild(player).',
  'Game loop: update(_ currentTime:) called every frame (~60fps). Calculate delta time for frame-rate independent movement.',
  'SKAction for animations: SKAction.sequence([.moveTo(x: 100, duration: 0.5), .fadeOut(withDuration: 0.3)]). Chain, group, repeat.',
  'Physics: SKPhysicsBody for collision detection and gravity. physicsBody = SKPhysicsBody(rectangleOf: size). Set categoryBitMask for filtering.',
  'Contact detection: implement SKPhysicsContactDelegate. func didBegin(_ contact: SKPhysicsContact) handles collisions.',
  'SKTileMapNode for tile-based levels. SKEmitterNode for particle effects (fire, smoke, sparks). SKLabelNode for text.',
  'Camera: SKCameraNode follows the player. camera = cameraNode. Use SKConstraint.distance() for smooth following with bounds.',
  'Touch handling: touchesBegan, touchesMoved, touchesEnded on SKScene. Convert to scene coordinates with convertPoint(fromView:).',
  'GameplayKit adds AI: GKStateMachine for state management, GKMinmaxStrategist for turn-based AI, GKNoise for procedural generation.',
  'Texture atlases: group sprites into .atlas folders for automatic batching. Reduces draw calls dramatically.',
  'SKTransition for scene transitions: SKTransition.fade(withDuration: 1.0). presentScene(newScene, transition: transition).',
], [
  { name: 'GameplayKit', type: 'technology', relation: 'uses' },
])

// ════════════════════════════════════════════════════════════════════════
// UNITY ENGINE
// ════════════════════════════════════════════════════════════════════════

seedTopic('Unity Engine', 'technology', [
  // Core
  'Unity is a cross-platform game engine using C#. Component-based architecture: GameObjects have Components that define behavior.',
  'MonoBehaviour is the base class for scripts. Lifecycle: Awake() → Start() → Update() (every frame) → FixedUpdate() (physics).',
  'Transform: every GameObject has position, rotation, scale. transform.Translate(), transform.Rotate(). Use Transform.parent for hierarchy.',
  'Prefabs are reusable templates: create once, instantiate many. Prefab variants inherit and override. Nested prefabs for complex structures.',
  'Input System (new): InputAction assets define bindings. PlayerInput component routes actions to callbacks. Supports keyboard, gamepad, touch.',
  'Physics: Rigidbody for dynamic objects, Collider for collision shapes. OnCollisionEnter/OnTriggerEnter for collision callbacks.',
  'Raycasting: Physics.Raycast(origin, direction, out hit) detects objects along a ray. Used for shooting, selection, ground detection.',

  // Rendering
  'URP (Universal Render Pipeline) for mobile/VR, HDRP (High Definition) for AAA quality. URP is the default for most projects.',
  'Materials use Shaders. Shader Graph: visual node-based shader editor. Create custom effects without writing shader code.',
  'Lighting: Directional (sun), Point (bulb), Spot (flashlight), Area (soft). Baked lighting for static geometry, real-time for dynamic.',
  'Post-processing: Bloom, Color Grading, Ambient Occlusion, Depth of Field via Volume component. Stack effects per camera.',
  'LOD Groups: swap lower-detail meshes at distance. LOD0 (close), LOD1 (medium), LOD2 (far). Critical for performance.',
  'Occlusion Culling: skip rendering objects hidden behind others. Bake occlusion data for static geometry.',
  'GPU instancing: render thousands of identical meshes (grass, trees) in a single draw call. Enable on material.',

  // Animation
  'Animator Controller: state machine for animations. States, transitions with conditions, blend trees for smooth blending.',
  'Blend Trees: blend between walk/run/sprint based on speed parameter. 1D (single param) or 2D (direction + speed).',
  'Animation Rigging: procedural animation at runtime. Aim constraints, two-bone IK, multi-parent constraints.',
  'Timeline: cinematic sequencing tool. Animate cameras, triggers, audio, custom tracks. Playable Director drives playback.',
  'Root Motion: animation drives character movement (not code). More realistic locomotion for humanoid characters.',

  // Advanced
  'Addressables: asset management system. Load assets on demand by address string. Reduces initial download size and memory.',
  'ScriptableObjects: data containers that live as assets. Use for game config, item databases, skill definitions. Not MonoBehaviour.',
  'Object pooling: reuse objects instead of Instantiate/Destroy. Essential for bullets, particles, enemies. Avoid GC spikes.',
  'Job System + Burst Compiler: multithreaded code with safety. IJobParallelFor processes arrays in parallel. Burst compiles to SIMD.',
  'ECS (Entity Component System): data-oriented design for massive entity counts. Entities are IDs, Components are data, Systems are logic.',
  'NavMesh: bake walkable surfaces for AI pathfinding. NavMeshAgent component handles movement. NavMeshObstacle for dynamic blockers.',
  'Cinemachine: intelligent camera system. Virtual cameras with priorities, blending, tracking, noise. One brain, many virtual cameras.',
  'Unity Netcode: multiplayer networking. ServerRpc/ClientRpc for remote calls. NetworkVariable for synchronized state.',
  'ProBuilder: in-editor 3D modeling for level prototyping. Build geometry without leaving Unity.',
  'Profiler: CPU, GPU, Memory, Audio, Rendering profiling. Deep Profile for call stacks. Profile on target device, not editor.',
  'IL2CPP: ahead-of-time compilation to C++ for release builds. Better performance than Mono. Required for iOS.',
], [
  { name: 'C#', type: 'technology', relation: 'uses' },
  { name: 'URP', type: 'technology', relation: 'part_of' },
  { name: 'HDRP', type: 'technology', relation: 'part_of' },
  { name: 'Shader Graph', type: 'technology', relation: 'part_of' },
  { name: 'Cinemachine', type: 'technology', relation: 'part_of' },
  { name: 'ECS', type: 'concept', relation: 'part_of' },
])

// ════════════════════════════════════════════════════════════════════════
// UNREAL ENGINE
// ════════════════════════════════════════════════════════════════════════

seedTopic('Unreal Engine', 'technology', [
  // Core
  'Unreal Engine uses C++ and Blueprints (visual scripting). AAA quality rendering out of the box. Free until $1M revenue.',
  'Actor is the base class for all objects in a level. Components attach to Actors: StaticMeshComponent, CameraComponent, etc.',
  'Blueprints: visual scripting system. Nodes connected by wires. Can do everything C++ can. Great for prototyping and designer tools.',
  'C++ and Blueprints interop: expose C++ with UFUNCTION(BlueprintCallable). Blueprint subclass C++ classes for designer customization.',
  'UPROPERTY() macro exposes variables to the editor and Blueprints. UPROPERTY(EditAnywhere, BlueprintReadWrite) for full access.',
  'GameMode defines rules, GameState holds match state, PlayerController handles input, PlayerState tracks per-player data.',
  'Garbage collection: UObjects are GC\'d. Use UPROPERTY() to prevent premature collection. Raw C++ pointers to UObjects are dangerous.',

  // Rendering (Nanite & Lumen)
  'Nanite: virtualized micropolygon geometry. Import billions of triangles, engine streams only visible detail. No manual LODs needed.',
  'Lumen: fully dynamic global illumination and reflections. No baking needed. Light bounces in real-time. UE5 flagship feature.',
  'World Partition: automatic level streaming for open worlds. Grid-based loading/unloading. Replaces manual level streaming.',
  'Virtual Shadow Maps: high-resolution shadows that scale with Nanite geometry. Consistent quality at any distance.',
  'Material Editor: node-based shader editor. PBR by default (Base Color, Metallic, Roughness, Normal). Material instances for variants.',
  'Niagara: particle/VFX system. GPU-simulated, data-driven. Modules, emitters, systems. Replaces Cascade. Extremely powerful.',
  'MetaHumans: photorealistic digital humans. MetaHuman Creator generates rigged, animated characters ready for Unreal.',

  // Gameplay
  'Enhanced Input System: InputAction + InputMappingContext. Modifiers (dead zones, swizzle) and triggers (pressed, released, hold).',
  'Gameplay Ability System (GAS): data-driven abilities, effects, attributes. Used in Fortnite. Complex but extremely scalable.',
  'Animation Blueprints: state machines + blend spaces for character animation. AnimGraph processes pose at runtime.',
  'Control Rig: procedural animation and rigging in engine. Full-body IK, procedural secondary motion, runtime retargeting.',
  'Chaos Physics: destruction, cloth, rigid body simulation. Field System for force application. Fracture meshes in-editor.',
  'AI: Behavior Trees + Blackboard for decision-making. EQS (Environment Query System) for spatial reasoning. NavMesh for pathfinding.',
  'Sequencer: cinematic tool. Animate actors, cameras, materials, audio on a timeline. Render movie quality output.',

  // Multiplayer & advanced
  'Replication: UPROPERTY(Replicated) syncs variables. UFUNCTION(Server/Client/NetMulticast) for RPCs. Actor relevancy for scalability.',
  'Dedicated servers: Unreal has built-in client-server architecture. Server is authoritative. Clients predict and reconcile.',
  'PCG (Procedural Content Generation): scatter foliage, buildings, roads based on rules. Non-destructive, artist-friendly.',
  'Mass Entity: lightweight entity system for crowds/NPCs. Thousands of entities without full Actor overhead.',
  'Pixel Streaming: run Unreal on a server, stream rendered frames to a browser via WebRTC. No client install needed.',
], [
  { name: 'Nanite', type: 'concept', relation: 'part_of' },
  { name: 'Lumen', type: 'concept', relation: 'part_of' },
  { name: 'Blueprints', type: 'concept', relation: 'part_of' },
  { name: 'Niagara', type: 'technology', relation: 'part_of' },
  { name: 'C++', type: 'technology', relation: 'uses' },
])

// ════════════════════════════════════════════════════════════════════════
// THREE.JS & WEB 3D
// ════════════════════════════════════════════════════════════════════════

seedTopic('Three.js', 'technology', [
  // Core
  'Three.js is the dominant JavaScript library for 3D rendering in the browser. Wraps WebGL with a high-level API.',
  'Scene graph: Scene (root) → Meshes, Lights, Cameras. Mesh = Geometry (shape) + Material (appearance).',
  'Camera types: PerspectiveCamera (3D perspective), OrthographicCamera (flat/isometric). Set FOV, aspect, near/far planes.',
  'Renderer: WebGLRenderer. Call renderer.render(scene, camera) in the animation loop. Set size with renderer.setSize(w, h).',
  'Animation loop: function animate() { requestAnimationFrame(animate); mesh.rotation.y += 0.01; renderer.render(scene, camera); }',
  'OrbitControls: mouse/touch orbit, zoom, pan around a target. import { OrbitControls } from "three/addons/controls/OrbitControls".',

  // Geometry & materials
  'BufferGeometry: vertex data stored in typed arrays (Float32Array). Efficient GPU upload. All geometries use this internally.',
  'Built-in geometries: BoxGeometry, SphereGeometry, PlaneGeometry, CylinderGeometry, TorusKnotGeometry. Good for prototyping.',
  'MeshStandardMaterial: PBR material with roughness and metalness. MeshPhysicalMaterial adds clearcoat, transmission, sheen.',
  'Textures: TextureLoader().load("texture.jpg"). Map to material: new MeshStandardMaterial({ map: texture, normalMap: normalTex }).',
  'ShaderMaterial: write custom GLSL vertex/fragment shaders. For advanced effects: water, fire, custom lighting, post-processing.',
  'Instanced rendering: InstancedMesh(geometry, material, count). Set per-instance transforms with setMatrixAt(). Thousands of objects efficiently.',

  // Lighting & shadows
  'Light types: AmbientLight (uniform), DirectionalLight (sun), PointLight (bulb), SpotLight (cone), HemisphereLight (sky+ground).',
  'Shadows: renderer.shadowMap.enabled = true. Light.castShadow = true. Mesh.castShadow/receiveShadow = true. Shadow map resolution matters.',
  'Environment maps: HDR images for reflections and IBL (image-based lighting). RGBELoader for .hdr files. scene.environment = envMap.',

  // React Three Fiber
  'React Three Fiber (R3F): React renderer for Three.js. <Canvas><mesh><boxGeometry /><meshStandardMaterial /></mesh></Canvas>.',
  'R3F is declarative Three.js: JSX components map to Three.js objects. useFrame() for animation loop. useThree() for scene access.',
  'Drei: helper library for R3F. <OrbitControls />, <Environment />, <Text />, <Html />, <Float />, <Stars />. Saves massive boilerplate.',
  '@react-three/postprocessing: <EffectComposer><Bloom /><ChromaticAberration /></EffectComposer>. Post-processing in JSX.',
  'Physics in R3F: @react-three/rapier for rigid body physics. <RigidBody><mesh>...</mesh></RigidBody>. Colliders, joints, forces.',
  'Zustand integrates natively with R3F for state management. Share game state between 3D scene and HTML UI.',

  // Advanced
  'GLTF is the standard 3D format for the web. useGLTF() in R3F / GLTFLoader in Three.js. Supports meshes, materials, animations, skeletons.',
  'Level of Detail: THREE.LOD switches models based on camera distance. Essential for complex scenes with many objects.',
  'Raycaster: detect mouse/touch intersections with 3D objects. raycaster.intersectObjects(scene.children) returns hits with distance and face.',
  'Post-processing: EffectComposer + RenderPass + custom passes (bloom, SSAO, depth of field, color grading). Multi-pass rendering pipeline.',
  'WebGPU: next-gen graphics API replacing WebGL. Three.js has experimental WebGPU renderer. Lower overhead, compute shaders, better perf.',
], [
  { name: 'React Three Fiber', type: 'technology', relation: 'uses' },
  { name: 'Drei', type: 'technology', relation: 'uses' },
  { name: 'WebGL', type: 'technology', relation: 'uses' },
  { name: 'GLTF', type: 'concept', relation: 'part_of' },
])

// ════════════════════════════════════════════════════════════════════════
// 3D RENDERING CONCEPTS
// ════════════════════════════════════════════════════════════════════════

seedTopic('3D Rendering', 'technology', [
  'Rendering pipeline: Vertex processing → Primitive assembly → Rasterization → Fragment processing → Frame buffer. GPU executes this.',
  'PBR (Physically Based Rendering): materials defined by albedo, metallic, roughness, normal. Energy-conserving. Industry standard.',
  'Global illumination: light bouncing between surfaces. Direct light is easy; indirect light (GI) is computationally expensive.',
  'Ray tracing: cast rays from camera through pixels, trace bounces for reflections, shadows, GI. Physically accurate but expensive.',
  'Path tracing: Monte Carlo ray tracing — random rays converge to the correct image. Used in offline rendering and modern real-time (RTX).',
  'Rasterization: project triangles to screen pixels. Fast, parallelizable on GPU. The traditional real-time rendering approach.',
  'Deferred rendering: render geometry to G-buffer (position, normal, albedo) first, then light in screen space. Handles many lights efficiently.',
  'Forward rendering: light each pixel during geometry pass. Simpler, better for transparency and MSAA. Used in mobile/VR.',
  'Shadow mapping: render scene from light\'s perspective to depth texture. Compare depths during main render to determine shadow.',
  'Screen-space ambient occlusion (SSAO): approximate occlusion from depth buffer. Adds contact shadows. Cheap approximation of GI.',
  'Normal mapping: store per-pixel normals in a texture. Adds surface detail without extra geometry. Tangent space is standard.',
  'Mipmapping: precomputed lower-resolution textures. GPU selects level based on distance. Prevents aliasing, improves cache performance.',
  'Draw calls are expensive — each is CPU overhead to set GPU state. Reduce by: batching, instancing, texture atlases, GPU culling.',
  'Frustum culling: skip objects outside the camera view frustum. Octree or BVH (Bounding Volume Hierarchy) for spatial acceleration.',
  'Vertex and fragment shaders: vertex shader transforms positions, fragment shader computes pixel color. Written in GLSL, HLSL, or MSL.',
], [
  { name: 'PBR', type: 'concept', relation: 'part_of' },
  { name: 'Ray Tracing', type: 'concept', relation: 'part_of' },
  { name: 'Deferred Rendering', type: 'concept', relation: 'part_of' },
])

// ════════════════════════════════════════════════════════════════════════
// MCP SERVERS (MODEL CONTEXT PROTOCOL)
// ════════════════════════════════════════════════════════════════════════

seedTopic('MCP Servers', 'technology', [
  'MCP (Model Context Protocol) is Anthropic\'s open standard for connecting AI models to external tools and data sources.',
  'MCP follows a client-server architecture: the AI app is the client, tools/data are servers. Communication via JSON-RPC over stdio or HTTP+SSE.',
  'MCP servers expose three primitives: Tools (actions the model can call), Resources (data the model can read), Prompts (templates).',
  'Tools in MCP are like function definitions: name, description, JSON Schema for parameters. The model decides when to call them.',
  'Resources are read-only data: files, database records, API responses. The model can request resources by URI.',
  'Prompts are parameterized templates: pre-built instruction sets the user or model can invoke. Like slash commands.',
  'Transport: stdio (local processes, most common), HTTP+SSE (remote servers, streamable). Stdio is simpler, HTTP is for networked tools.',
  'MCP server in TypeScript: import { McpServer } from "@modelcontextprotocol/sdk/server"; server.tool("name", schema, handler).',
  'MCP server in Python: from mcp.server import Server; @server.tool() async def my_tool(args): return result.',
  'Authentication: MCP supports OAuth 2.0 for HTTP transport. Stdio transport inherits the user\'s local permissions.',
  'MCP enables AI to interact with: databases (query/write), APIs (call endpoints), file systems (read/write), browsers (navigate/click).',
  'Composability: one AI app can connect to multiple MCP servers simultaneously. Each server provides different capabilities.',
  'MCP servers are stateful per-session but should be designed for concurrent connections. Use session IDs for state isolation.',
  'Error handling: MCP defines standard error codes. Servers should return structured errors the model can reason about.',
  'Security: servers should validate all inputs, enforce least privilege, log actions. Never trust the model\'s tool calls blindly.',
  'Popular MCP servers: filesystem (read/write files), GitHub (repos, PRs, issues), Slack (messages), databases (SQL queries), browser (Puppeteer).',
  'Building custom MCP servers: define your tools as functions, register with the SDK, handle requests. Deploy as local process or HTTP service.',
  'MCP inspector: debug tool for testing MCP servers. Send tool calls, inspect responses, validate schemas.',
], [
  { name: 'JSON-RPC', type: 'concept', relation: 'uses' },
  { name: 'Anthropic', type: 'organization', relation: 'created' },
])

// ════════════════════════════════════════════════════════════════════════
// GAME DEVELOPMENT CONCEPTS
// ════════════════════════════════════════════════════════════════════════

seedTopic('Game Development', 'technology', [
  // Architecture
  'Game loop: while (running) { processInput(); update(deltaTime); render(); }. Fixed timestep for physics, variable for rendering.',
  'Entity Component System (ECS): entities are IDs, components are data bags, systems process entities with matching components. Cache-friendly.',
  'State machines: menu → playing → paused → game over. Each state handles input/update/render differently. Hierarchical for complex AI.',
  'Scene graph: tree of transforms. Parent-child relationships propagate transforms. Moving a car moves its wheels.',
  'Object pooling: pre-allocate and reuse objects (bullets, particles, enemies). Avoid runtime allocation. Dramatically reduces GC pauses.',
  'Spatial partitioning: grid, quadtree (2D), octree (3D), BSP tree. Accelerate collision detection and visibility queries.',

  // Physics
  'Rigid body dynamics: mass, velocity, forces, torque. Newton\'s laws simulated with numerical integration (Euler, Verlet, RK4).',
  'Collision detection: broad phase (AABB overlap, spatial hash) narrows candidates, narrow phase (GJK, SAT) does exact test.',
  'Continuous collision detection (CCD): prevent fast objects tunneling through thin walls. Sweep test between frames.',
  'Raycasting: fire a ray, find what it hits first. Used for weapons, line of sight, ground detection, mouse picking.',
  'Physics materials: friction and restitution (bounciness). Combine modes determine how materials interact at contact.',

  // AI
  'Finite State Machine (FSM): states with transitions. Idle → Chase (when player seen) → Attack (when close) → Flee (when low health).',
  'Behavior Trees: modular, hierarchical AI. Selector (try children until one succeeds), Sequence (run all children in order).',
  'Navigation mesh (NavMesh): walkable surface baked from geometry. A* pathfinding on the navmesh graph. Agents avoid obstacles.',
  'Steering behaviors: seek, flee, arrive, wander, pursuit, evasion, flocking (separation + alignment + cohesion). Combine for realistic movement.',
  'Utility AI: score each possible action, pick the highest. More flexible than FSMs for many competing priorities.',

  // Networking
  'Client-server: server is authoritative (anti-cheat). Clients send inputs, server simulates, sends state back.',
  'Client-side prediction: client simulates locally for responsive feel. Server corrects with authoritative state. Reconcile differences.',
  'Lag compensation: server rewinds game state to when the client fired. "What did the shooter see?" validation. Used in FPS games.',
  'Deterministic lockstep: all clients run same simulation with same inputs. Only transmit inputs, not state. Used in RTS games.',
  'Network serialization: delta compression (send only changes), quantization (reduce precision), bit packing. Minimize bandwidth.',

  // Performance
  'Frame budget: 60fps = 16.67ms per frame. Allocate: input 1ms, physics 3ms, AI 2ms, rendering 8ms, overhead 2ms.',
  'Profiling: measure before optimizing. CPU-bound vs GPU-bound determines strategy. Reduce draw calls for GPU, optimize logic for CPU.',
  'Level of Detail (LOD): swap lower-poly models at distance. Reduces triangle count without visible quality loss.',
  'Culling: frustum culling (outside camera), occlusion culling (behind other objects), distance culling (too far). Don\'t render what\'s not seen.',
  'Asset streaming: load/unload areas dynamically as player moves. Open-world essential. Budget memory per zone.',
], [
  { name: 'ECS', type: 'concept', relation: 'part_of' },
  { name: 'NavMesh', type: 'concept', relation: 'part_of' },
  { name: 'Behavior Trees', type: 'concept', relation: 'part_of' },
])

// ════════════════════════════════════════════════════════════════════════
// DONE
// ════════════════════════════════════════════════════════════════════════

console.log('\n✅ Knowledge seeding v4 complete!')
console.log('Topics: Swift/iOS, Android, SpriteKit, Unity, Unreal, Three.js, 3D Rendering, MCP, Game Dev')
