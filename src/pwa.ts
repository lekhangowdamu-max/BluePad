import { registerSW } from 'virtual:pwa-register'

let installPromptEvent: BeforeInstallPromptEvent | null = null
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | undefined
let registered = false

export interface PwaStatus {
  isInstalled: boolean
  isOnline: boolean
  offlineReady: boolean
  updateReady: boolean
  canInstall: boolean
}

export type BeforeInstallPromptEvent = Event & {
  readonly platforms: string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt(): Promise<void>
}

export const pwaStatus = {
  isInstalled: false,
  isOnline: navigator.onLine,
  offlineReady: false,
  updateReady: false,
  canInstall: false,
}

export const registerPwa = () => {
  if (registered) {
    return updateServiceWorker
  }

  registered = true
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      pwaStatus.updateReady = true
      window.dispatchEvent(new CustomEvent('pwa:update-ready'))
    },
    onOfflineReady() {
      pwaStatus.offlineReady = true
      window.dispatchEvent(new CustomEvent('pwa:offline-ready'))
    },
  })

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    installPromptEvent = event as BeforeInstallPromptEvent
    pwaStatus.canInstall = true
    window.dispatchEvent(new CustomEvent('pwa:install-available'))
  })

  window.addEventListener('appinstalled', () => {
    pwaStatus.isInstalled = true
    pwaStatus.canInstall = false
    window.dispatchEvent(new CustomEvent('pwa:installed'))
  })

  window.addEventListener('online', () => {
    pwaStatus.isOnline = true
    window.dispatchEvent(new CustomEvent('pwa:online'))
  })

  window.addEventListener('offline', () => {
    pwaStatus.isOnline = false
    window.dispatchEvent(new CustomEvent('pwa:offline'))
  })

  if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as Navigator & { standalone?: boolean }).standalone) {
    pwaStatus.isInstalled = true
  }

  return updateServiceWorker
}

export const installPwa = async () => {
  if (!installPromptEvent) {
    return false
  }

  await installPromptEvent.prompt()
  const choice = await installPromptEvent.userChoice
  installPromptEvent = null
  pwaStatus.canInstall = false
  return choice.outcome === 'accepted'
}

export const refreshApp = async () => {
  await updateServiceWorker?.(true)
}
