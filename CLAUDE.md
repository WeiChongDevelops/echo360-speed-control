# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome extension that bypasses Echo360's playback speed restrictions, allowing university students to watch lectures at speeds beyond the standard 2x limit. Supports 45+ Echo360 TLDs worldwide.

## Build & Development Commands

```bash
# Build the extension (TypeScript compilation + asset copying)
npm run build

# Watch mode for development (auto-recompile on changes)
npm run watch

# Copy assets to dist (icons, manifest, popup HTML/CSS)
npm run copy-assets

# Clean build artifacts
npm run clean
```

**Testing the extension:**
1. Build with `npm run build`
2. Load unpacked extension from `dist/` directory in Chrome
3. Navigate to any Echo360 lecture page
4. Test speed controls via popup or on-page player menu

## Architecture

### Extension Component Layers

**Manifest V3 Structure:**
- **Background Service Worker** (`background/service-worker.ts`): Relays speed change messages between popup and content scripts
- **Content Script** (`content-scripts/content.ts`): Bridge between Chrome extension APIs and injected page scripts
- **Injected Scripts** (run in page context):
  - `injected/injector-simple.ts`: Echo360-specific implementation with DOM menu manipulation
  - `injected/injector.ts`: Generic fallback for other video platforms
- **Popup UI** (`popup/popup.ts`): Extension toolbar interface with speed slider and presets

### Communication Flow

```
User Action → Popup → Chrome Runtime Message → Content Script → Window PostMessage → Injected Script → Video Element
```

**Message Types** (defined in `lib/constants.ts`):
- `SET_ECHO_SPEED`: Set playback speed
- `GET_ECHO_SPEED`: Query current speed
- `CURRENT_ECHO_SPEED`: Response with current speed
- `SPEED_CHANGED`: Broadcast speed updates
- `SET_SHORTCUTS_ENABLED`: Toggle keyboard shortcuts

### Speed Enforcement Strategy

The extension uses multiple defensive techniques to bypass Echo360's restrictions:

1. **Property Descriptor Override**: Intercepts `HTMLMediaElement.prototype.playbackRate` getter/setter
2. **Math.min/Math.max Hijacking**: Prevents speed clamping by Echo360's validation code
3. **Continuous Enforcement**: Interval-based speed verification (250ms for initial enforcement, 500ms ongoing)
4. **Speed Button Injection**: Adds custom speed options (up to 4x) to Echo360's native player menu

### Storage & Persistence

**Chrome Storage (sync):**
- `speed_{domain}`: Per-domain speed memory (e.g., `speed_echo360.org.au`)
- `theme`: Light/dark mode preference
- `shortcutsEnabled`: Keyboard shortcuts toggle state

When navigating between lectures on the same domain, the extension restores the last-used speed.

## Key Implementation Details

### Domain Detection
Content script selects appropriate injector based on hostname:
- `echo360` in hostname → `injector-simple.js` (Echo360-specific with menu injection)
- Other domains → `injector.js` (generic video player override)

### Speed Control Limits
- **Min**: 0.25x
- **Max**: 4x (recently raised from 3x, configurable in `lib/constants.ts`)
- **Step**: 0.25x increments
- **Presets**: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3]

### Keyboard Shortcuts
- `Shift + <` / `Shift + ,`: Decrease speed by 0.25x
- `Shift + >` / `Shift + .`: Increase speed by 0.25x
- Shortcuts can be disabled via popup toggle

### Visual Feedback
- **Speed Overlay**: Fixed position (top-right), auto-fades after 2s, shows current speed on change
- **Speed Button Color**: Changes to green (#4CAF50) when custom speeds are active
- **Lightning Bolt (⚡)**: Displayed in menu for speeds above 2x

## File Structure Conventions

```
src/
├── background/        # Service worker for message relay
├── content-scripts/   # Content script (extension → page bridge)
├── injected/          # Scripts injected into page context
│   ├── injector-simple.ts    # Echo360-specific implementation
│   └── injector.ts           # Generic video player override
├── popup/            # Extension popup UI
└── lib/              # Shared constants and utilities
```

**Build Output**: All TypeScript compiles to `dist/` with matching directory structure. Assets (icons, manifest, popup HTML/CSS) are copied to `dist/` via `copy-assets` script.

## TypeScript Configuration

- **Target**: ES2020
- **Module**: ES2020 (required for Manifest V3 service workers)
- **Types**: Chrome extension APIs (@types/chrome)
- **Strict Mode**: Enabled (except `strictPropertyInitialization` for DOM elements)

## Common Development Pitfalls

1. **Node.js globals in injected scripts**: Never use `process`, `__dirname`, etc. in `injected/*.ts` - these run in browser page context, not Node
2. **Message listener async responses**: Always `return true` in message listeners when using `sendResponse` asynchronously
3. **Property descriptor timing**: Speed enforcement must occur at `document_start` before Echo360's scripts load
4. **Storage key consistency**: Domain keys use hostname with `www.` stripped: `speed_${hostname.replace('www.', '')}`

## Debugging Tips

- Check console in both extension context (popup) and page context (injected scripts)
- Use `chrome://extensions` → "Inspect views: service worker" for background debugging
- Verify video element selection with: `document.querySelectorAll('video')`
- Test speed enforcement: `video.playbackRate` should match `targetSpeed` even after Echo360's validation attempts

## Testing Before Release

Always build and load the extension in Chrome before publishing:
```bash
npm run build
# Load unpacked from dist/ in chrome://extensions
# Test on live Echo360 lecture page
```

Verify:
- Speed controls work via popup slider
- Speed presets (buttons) function correctly
- On-page menu shows custom speeds with ⚡ indicator
- Keyboard shortcuts respond (if enabled)
- Speed persists across page navigation within same domain
- Theme toggle saves preference
