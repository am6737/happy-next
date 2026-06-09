# Changelog

## Version 13 - 2026-06-09

Session header is reworked with a left-aligned title, a new-session button, and OpenClaw session info sheets; session loading gets a reliability sweep (longer fetch timeout, retry-loop refresh indicator, stuck-load recovery, base64 stack-overflow fix); long user messages collapse and select cleanly on web; the commits list tags the upstream tip; nginx adds a /healthz endpoint; unrecognized tool calls now render as a generic 'other' block and agent-event messages strip ANSI escape codes; Happy CLI updates to v0.5.4 with mid-turn permission-mode forwarding and graceful Stop/ESC interrupts that keep the Claude and Codex backends warm; and Claude Fable 5 (with 1M-context variant) joins the Claude model catalog.

- Session header: unified left-aligned title across iOS / Android / web — new-session button on the header right, header title in the session info screen, and a dedicated OpenClaw session info sheet
- Session header: left-align the title on narrow phones (was center-overflowing), and fix the invisible back icon in dark-theme landscape
- Messages: long user messages (>20k chars) now collapse to a preview with a Show More toggle; web text selection inside messages is fixed
- Messages: per-message action bar no longer flickers when the message flips between thinking and streaming states
- Session loading reliability: message fetch timeout raised 20s → 60s; sessions stuck in permanent load failure now recover; refresh indicator stays visible across the entire retry loop and also on user-opened incremental loads
- Session loading reliability: chunk base64 encoding so very large message payloads no longer trigger a stack overflow when restoring sessions
- Session draft: rewritten as a single source of truth — fewer cases of drafts vanishing or reappearing
- Commits view: the commit at the upstream tip is now tagged
- Deploy: nginx serves a zero-cost `/healthz` endpoint so load balancers and uptime checks have a cheap target
- Tools: unrecognized tool calls now render as a generic 'other' block with a dynamic title and icon, instead of an empty placeholder
- Agent events: agent event messages strip ANSI escape codes from child-CLI stderr so subprocess banner color sequences no longer leak into the chat as raw `[90m…[0m`
- CLI: Happy CLI updated to v0.5.4 — permission-mode switches from the app forward synchronously to the Claude subprocess; Stop/ESC interrupts now keep the Claude and Codex backends warm so the next message resumes instantly instead of cold-restarting; Gemini's interrupt feedback now matches Claude/Codex with a "[Request interrupted by user]" marker
- Models: add Claude Fable 5 (and Fable 5 1M) to the Claude model catalog, with low / medium / high / xhigh / max reasoning effort presets

## Version 12 - 2026-06-02

Happy Voice moves to a new Volcano (Doubao) real-time gateway with streaming speech and native iOS voice calls, selectable voice timbre and speech rate, end-to-end-encrypted voice settings sync, and richer slash-command autocomplete with live capability sync. This update also speeds up session open with incremental catch-up and fixes draft restore and the Claude Opus 4.8 context window.

- Voice: migrated Happy Voice to a new Volcano (火山引擎 / Doubao) real-time gateway, replacing the previous LiveKit / ElevenLabs stack — lower latency and a curated multilingual voice set
- Voice calls: streaming message text-to-speech and native in-call voice on iOS, with connection state gated on room-state changes and the microphone guarded during a call
- Voice personalization: choose your assistant's voice timbre and speech rate; multilingual replies default to the seed-tts-2.0 voice
- Voice quality: smarter LLM text cleaning before speech — trivial short text skips cleaning to cut latency, in-call announcements are localized, and reply length caps were raised
- Voice settings: voice assistant configuration now syncs across devices via end-to-end-encrypted user settings; refreshed language-search header and layout
- Voice tools: refreshed session-management voice tools (start / switch / message a session) with a single-parameter session-settings mode, clearer titles, and an auto-close countdown on the session-picker cancel button
- Autocomplete: slash-command suggestions now show their source scope (repo / user / plugin / system) and kind; session capabilities are stored separately from metadata and sync live so command and skill lists stay fresh
- Messages: fork a conversation directly from an AI reply; sending now shows an optimistic "Processing…" status immediately and a "refreshing" indicator while the list reloads
- Composer: send a message with only attached images and no text — the send button now enables when images are attached even if the text field is empty
- New session: start a session with an empty initial message — no prompt required
- Sessions: tidied "vibing" activity messages and lowercased the "awaiting" status label
- Reliability: message send is hardened for flaky networks, and draft restore is suppressed while a send is in flight
- Reliability: the chat reducer no longer synthesizes out-of-order completed-permission messages
- Performance: opening a session now does an incremental catch-up instead of a full re-bootstrap — large sessions open noticeably faster
- Messages: drafts you've already sent no longer reappear when the sessions list cache refreshes
- Models: added Claude Opus 4.8 to the model catalog, which now correctly defaults to its 1M-token context window
- iOS: transparent native session header with proper top padding, and the chat placeholder is centered in the visible area above the keyboard
- Deploy: docker-compose Happy Voice service points at the Volcano gateway, with the gateway port standardized to 3040
- CLI: Happy CLI updated to v0.5.2

## Version 11 - 2026-05-25

Voice playback for AI replies, a per-message action bar, richer chat formatting, DooTask project autofill, session reliability fixes, and updated model catalogs.

- Messages: read AI replies aloud with a new voice button in the message footer (text-to-speech via Happy Voice), one message at a time
- Messages: per-message action bar with copy, fork-from-here (with progress spinner), and full timestamp on web hover / native tap
- Messages: richer markdown rendering — code-block header with copy button, improved chat formatting
- Composer: keep the keyboard-selected autocomplete suggestion in view; remove the hardcoded cap on slash-command and file autocomplete
- Sessions: preserve 1M context when duplicating a session; several session-encryption reliability fixes (restore from cache, rebuild when entering an unencrypted session)
- DooTask: auto-fill machine and working directory from the project's defaults; markdown indentation / underline / strikethrough; long sender-name truncation and localized assistant label
- Models: curated Claude / Codex / Gemini catalogs, add Gemini 2.5 Flash Lite, centralized per-agent permission modes; Codex updated to 0.133.0
- Agents: sync Claude tools and slash commands from the session init message; Codex skill autocomplete
- Web & platform: theme-consistent native controls, color-scheme guard, HMR bundle-URL fix, refreshed iOS/Android splash images
- CLI: prevent transient image-download failures from killing sessions; spawn Claude CLI via shell on Windows

## Version 10 - 2026-05-18

Sessions cold-start reliability overhaul, local session list cache, agent picker on the machine page, ChatBubble text-overflow fix, iOS build fix, and Happy CLI v0.3.4 with PATH injection for system daemons.

- Sessions cold-start: gate first-load through a state machine that waits for sync to settle before listing, eliminating empty-list flashes and duplicate fetches on app launch
- Sessions cold-start: hydrate machine picker on the new-session screen only after sync completes, so the last-used machine reliably preselects
- Sessions cold-start: fire reconnect listeners on the socket's first successful connect, not just on subsequent reconnects, so initial sync is no longer missed
- Sessions list: cache the session list locally and reconcile server state via deletion tombstones, so opening the app shows yesterday's sessions instantly while the server catches up
- Machine page: pick the agent type (Claude / Codex / Gemini) when spawning a session — choices are limited to whichever CLIs the daemon reports as available, and the new session inherits that agent's last-used permission / model / fast mode
- ChatBubble: tighter text wrapping and overflow handling so long URLs, code, and CJK runs no longer push the bubble past the message column
- Settings: hide the header action button when no actions apply, removing an empty tap target
- iOS build: compile fmt as C++17 to unblock Xcode 26 native builds
- Happy CLI v0.3.4: inject the user's PATH into macOS LaunchAgent plists and Linux systemd unit files so the daemon can find `node` and `npx` after install; surface real `systemctl` errors instead of swallowing them
- Performance: keep older recent-page sessions out of the global session store, lowering memory pressure on long browsing sessions

## Version 9 - 2026-05-15

Native iOS/Android navigation overhaul, deeper DooTask inbox integration, directory autocomplete for path pickers, Gemini 3.1 Pro support, and broad iPad/Mac/Web polish.

- Native navigation: switch iOS and Android to the platform-native bottom tab bar and native header on home, chat, and inbox screens for an OS-consistent feel
- Tabs: reorder bottom tabs to put inbox before sessions, rename "Terminal" to "Session", and replace brutalist placeholders with dedicated navigation icons
- iOS polish: chevron-only back button, header avatar geometry/clipping fixes, centered title in native header, status bar controller, and iOS 26 fixes for scroll-edge fade, full-screen translucent chat overlay, and prompt modal presentation
- DooTask inbox: merge DooTask recents into the main inbox with persistent cache and silent background refresh; session avatars now show for DooTask-related sessions; chat header adapts to dialog type; self HTML messages align correctly
- Path picker: directory autocomplete via remote machine listing, extracted to a shared hook used by web and mobile; web autocomplete focus handling fixed
- Sessions: paginate recent session history for faster loading
- Models: add Gemini 3.1 Pro to the catalog, promote Gemini 3 Flash to GA, and drop the deprecated Gemini 3 Pro Preview; wizard handles new flash model variants; Codex updated to v0.130.0
- Always-on context size: default the "always show context size" setting to on so usage is visible without opening session details
- iPad / Mac: pad sidebar header for windowed-mode window controls, fix session header resize, top-tab insets, list divider rendering, and windowed keyboard overlap; sidebar logo dismisses to root, nav buttons use stack-friendly navigation
- Web: fix bottom tab bundling and session header navigation
- Misc: refresh React Native scroll-edge patch, clean up API endpoint detail styling, downgrade message validation failure log to warn

## Version 8 - 2026-05-07

OpenClaw renders rich AI content blocks, Claude Opus 4.7 and GPT-5.5 support, image upload quality, session title polish, Claude 4.x compatibility fixes, web desktop polish, and mobile text-selection rebuild.

- OpenClaw: full rendering of thinking, tool use, and image content blocks from external AI machines
- Models: add Claude Opus 4.7 to available model list
- Models: add GPT-5.5 to available Codex model list with low/medium/high/xhigh reasoning levels
- Image uploads: raise max dimension to 1568px and skip redundant compression when originals are already within limits, preserving text sharpness in code and UI screenshots
- Session title: seed new sessions with the first user message instead of the project directory name, until an AI summary takes over
- Web: return to home screen after archiving a session instead of staying on the archived page
- Claude Opus 4.7: drop empty thinking blocks emitted by 4.x models that previously caused rendering glitches
- Slash commands: surface Claude Code's result text when a turn (e.g. unknown slash command) produces no assistant message, preventing blank mobile replies
- Web desktop: hover-to-show copy button on chat messages (≥850 width); right-click on options reuses the mobile long-press behavior (fills input instead of sending)
- Mobile text selection: in-app selection page rebuilt to use browser-native long-press with static syntax highlighting (Lezer), fixing first-tap selection on Android and removing the markdownCopyV2 toggle so all mobile users get the improved experience
- Mobile reliability: fix Android text-selection page crash caused by iOS-only WebView props under the new Fabric architecture
- AskUserQuestion: fix empty/missing answers — frontend now keys answers by the full question text to match Claude Code CLI's internal lookup
- iOS 26: align navigation header icons and pin App Store builds to Xcode 26.4.1 (required by Apple for App Store Connect uploads)
- Header action menus: refine action menus on session edit/status/commits, script editor, and OpenClaw machine detail pages for cleaner interactions
- Dependencies: upgrade react-native-audio-api and react-native-keyboard-controller for improved iOS audio recording and keyboard handling

## Version 7 - 2026-03-18

Orchestrator arrives — define multi-agent task DAGs and let Happy schedule, execute, and monitor them automatically, plus offline message queuing, session management upgrades, and dozens of reliability fixes.

- Orchestrator: define task dependency graphs (DAGs) with per-task model and working directory, auto-schedule execution across Claude, Codex, and Gemini, monitor progress with real-time status badges, and follow up on completed tasks via session resume.
- Pending message queue: messages sent while the CLI is busy are queued server-side and auto-dispatched when ready, with a queue panel UI, image count badges, and send-now option.
- Session management: Active/Inactive tab filter replaces the old toggle, device and agent filter dropdowns in history, session preview expand/collapse, metadata caching for faster listing, and CLI hot-upgrade support.
- File viewer: image preview with sharing support directly from the code browser.
- CLI: daemon auto-start on boot (`happy daemon enable`), restart command, Codex v0.116.0 with fast mode, message receipt tracking, and attribution setting (default off).
- DooTask: globalized WebSocket connection with real-time task updates, related task entry in session info, and persistent server-side connection.
- MCP tools: `preview_html` for full-page HTML preview, dual-mode long-press copy in tool details, and colon-separated tool naming support.
- Gemini and Codex compatibility: ACP result format normalization, tool ID prefix fallback matching, Codex v2 protocol fixes, and dynamic permission mode changes.
- 50+ bug fixes across session sharing, feed lifecycle, toast positioning, icon font preloading, markdown rendering, and git status reliability.

## Version 6 - 2026-03-04

The biggest Happy update ever — multi-agent, voice, workspaces, code browser, DooTask, session sharing, and self-hosting all land in one release, plus 200+ bug fixes across the board.

- Full multi-agent support: Claude Code, Codex, and Gemini are now equal first-class agents with session resume, duplicate/fork, per-agent model selection, and accurate cost tracking.
- LiveKit-based voice assistant with pluggable STT/LLM/TTS providers, microphone mute, thinking indicator, and context-aware conversations that understand your full app state.
- Multi-repo worktree workspaces: create workspaces spanning multiple repositories, manage branches per-repo, auto-generate CLAUDE.md, and create PRs with AI-powered code review.
- Built-in code browser with file navigation, Monaco editor, commit history, branch selector, and a full git changes page for staging, committing, and discarding changes.
- Session sharing: share sessions with friends via direct invite (NaCl Box E2E encryption) or public links (token-derived keys), with real-time sync, access control, and a public share web viewer.
- DooTask integration with task lists, detail pages, real-time WebSocket chat, emoji reactions, voice message playback, one-click AI session launch, and in-app task/project creation.
- OpenClaw gateway for connecting to external AI machines with secure Ed25519 key exchange, real-time streaming chat, and relay or direct connection modes.
- AI backend profiles with built-in presets for DeepSeek, Z.AI, OpenAI, Azure, and Google AI — switch LLM backends for Claude Code with custom environment variable mapping.
- Self-hosting with a single `docker-compose` command: Web app, API server, Voice gateway, Postgres, Redis, and MinIO all configured out of the box.
- Major sync reliability improvements: v3 messages API with seq-based sync, HTTP outbox for offline delivery, server-confirmed sends, and message loss prevention.
- Chat UX polish: image attachment and clipboard paste, message pagination, unread blue dot indicator, compact view, session search, /duplicate command, pull-to-refresh, and improved markdown tables.
- CLI: `happy update` self-upgrade command, `happy --version` displays all agent versions, worktree subdirectory detection.

## Version 5 - 2025-12-22

This release expands AI agent support and refines the voice experience, while improving markdown rendering for a better chat experience.

- We are working on adding Gemini support using ACP and hopefully fixing codex stability issues using the same approach soon! Stay tuned.
- Removed model configurations from agents. We were not able to keep up with the models so for now we are removing the configuration from the mobile app. You can still configure it through your CLIs, happy will simply use defaults.
- Elevenlabs ... is epxensive. Voice conversations will soon require a subscription after 3 free trials - we'll soon allow connecting your own ElevenLabs agent if you want to manage your own spendings.
- Improved markdown table rendering in chat - no more ASCII pipes `|--|`, actual formatted tables (layout still needs work, but much better!)

## Version 4 - 2025-09-12

This release revolutionizes remote development with Codex integration and Daemon Mode, enabling instant AI assistance from anywhere. Start coding sessions with a single tap while maintaining complete control over your development environment.

- Introduced Codex support for advanced AI-powered code completion and generation capabilities.
- Implemented Daemon Mode as the new default, enabling instant remote session initiation without manual CLI startup.
- Added one-click session launch from mobile devices, automatically connecting to your development machine.
- Added ability to connect anthropic and gpt accounts to account

## Version 3 - 2025-08-29

This update introduces seamless GitHub integration, bringing your developer identity directly into Happy while maintaining our commitment to privacy and security.

- Added GitHub account connection through secure OAuth authentication flow
- Integrated profile synchronization displaying your GitHub avatar, name, and bio
- Implemented encrypted token storage on our backend for additional security protection
- Enhanced settings interface with personalized profile display when connected
- Added one-tap GitHub disconnect functionality with confirmation protection
- Improved account management with clear connection status indicators

## Version 2 - 2025-06-26

This update focuses on seamless device connectivity, visual refinements, and intelligent voice interactions for an enhanced user experience.

- Added QR code authentication for instant and secure device linking across platforms
- Introduced comprehensive dark theme with automatic system preference detection
- Improved voice assistant performance with faster response times and reduced latency
- Added visual indicators for modified files directly in the session list
- Implemented preferred language selection for voice assistant supporting 15+ languages

## Version 1 - 2025-05-12

Welcome to Happy - your secure, encrypted mobile companion for Claude Code. This inaugural release establishes the foundation for private, powerful AI interactions on the go.

- Implemented end-to-end encrypted session management ensuring complete privacy
- Integrated intelligent voice assistant with natural conversation capabilities
- Added experimental file manager with syntax highlighting and tree navigation
- Built seamless real-time synchronization across all your devices
- Established native support for iOS, Android, and responsive web interfaces