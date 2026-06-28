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

## Architecture
- React + TypeScript + Tailwind CSS
- Zustand for app state
- Repository layer for persistence
- Encryption service for optional note protection
- Bluetooth service and sync service for offline synchronization workflows
