import { compareSync, hashSync } from 'bcryptjs'

export class EncryptionService {
  private static readonly salt = 'bluenote-secure-salt'

  private static async deriveKey(password: string) {
    const baseKey = new TextEncoder().encode(password)
    const baseSalt = new TextEncoder().encode(this.salt)
    const material = await crypto.subtle.importKey('raw', baseKey, 'PBKDF2', false, ['deriveKey'])

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: baseSalt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  }

  private static encode(value: ArrayBuffer | Uint8Array): string {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
    return btoa(String.fromCharCode(...bytes))
  }

  private static decode(value: string): Uint8Array<ArrayBuffer> {
    const binary = atob(value)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return bytes as Uint8Array<ArrayBuffer>
  }

  static async encrypt(value: string, password: string): Promise<string> {
    const key = await this.deriveKey(password)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encodedValue = new TextEncoder().encode(value)
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encodedValue)
    return `${this.encode(iv)}:${this.encode(encrypted)}`
  }

  static async decrypt(value: string, password: string): Promise<string> {
    const [ivValue, contentValue] = value.split(':')
    const iv = this.decode(ivValue)
    const encrypted = this.decode(contentValue)
    const key = await this.deriveKey(password)
    const encryptedBuffer = encrypted.buffer.slice(encrypted.byteOffset, encrypted.byteOffset + encrypted.byteLength)
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encryptedBuffer)
    return new TextDecoder().decode(decrypted)
  }

  static hashPassword(password: string): string {
    return hashSync(password, 10)
  }

  static verifyPassword(password: string, hash: string): boolean {
    return compareSync(password, hash)
  }
}
