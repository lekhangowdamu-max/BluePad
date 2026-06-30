# BluePad

BluePad is an offline-first, Bluetooth-only secure notepad inspired by the instant-share workflow of DontPad.

## Highlights
- Instant note opening by note name
- Offline-first editing with local persistence
- Optional password protection with bcrypt hashing and AES-style encryption
- Bluetooth-only synchronization workflow for local peer devices
- Export/import TXT and local backup restore

## Development
```bash
npm install
npm run dev
```

## Native desktop app (Tauri)
BluePad now includes a native desktop runtime so discovery and note sync are no longer tied to browser Web Bluetooth limitations.

### Run the native app
```bash
npm install
npx tauri dev
```

### What changed
- Native app shell via Tauri for desktop/mobile packaging
- Native host discovery and peer connection bridge for reliable host announcement
- Custom BluePad device names shown during discovery
- Stable host/client connection state with automatic reconnect attempts
- Offline note sync over the local native transport, with LAN fallback discovery for nearby devices
- Password-based notes remain supported through the existing note store

## Progressive Web App
BluePad is installable and works offline after the first successful load.

### What is included
- Installable on desktop and mobile browsers
- Offline mode with local note persistence
- Service worker caching for the app shell, JavaScript bundles, CSS, images, and fonts
- Update prompt when a new version is available, with Update Now and Later actions
- Connectivity banner showing online/offline status and Offline Mode
- Native-like installation experience on supported devices
- IndexedDB-backed note persistence with localStorage migration/fallback
- Reconnect hook that syncs pending local changes when connectivity returns

### PWA files
- Manifest: public/manifest.webmanifest
- Service worker: src/sw.ts
- Runtime registration: src/pwa.ts
- Install/update UI: src/components/PwaStatusBar.tsx
- App icons: public/icons/

### Install behavior
- Chrome, Edge, and Brave show the custom Install BluePad for Offline Use banner when the browser exposes the install prompt.
- Android can add BluePad to the home screen from the install prompt.
- iOS can add BluePad to the home screen from Safari's Share menu. The manifest and Apple touch icon metadata are included for standalone launch.
- Already installed standalone windows hide the install prompt.

### Offline behavior
- The service worker precaches the production build for offline startup.
- App shell, scripts, styles, images, and fonts use Cache First behavior.
- API-style requests under /api/ use Network First with cache fallback.
- Notes are saved locally first and continue working with mobile data, Wi-Fi, or internet unavailable.

### Update behavior
- The app checks for service worker updates at runtime.
- When a new version is ready, BluePad displays A new version is available.
- Update Now activates the new service worker and refreshes the app.
- Later dismisses the prompt until another update event is received.

### Build output
```bash
npm run build
```

Use the production preview to validate installation and offline behavior:
```bash
npm run preview
```

For Lighthouse PWA checks, run the production preview and audit the local URL in Chrome DevTools.

## Architecture
- React + TypeScript + Tailwind CSS
- Zustand for app state
- Repository layer for persistence
- Encryption service for optional note protection
- Bluetooth service and sync service for offline synchronization workflows
