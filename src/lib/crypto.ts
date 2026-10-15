import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { config } from '../config.js'

const key = Buffer.from(config.TOKEN_ENCRYPTION_KEY, 'base64')

/** A random, unguessable token for a cookie or an OAuth state. */
export const randomToken = () => randomBytes(32).toString('base64url')

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/** Encrypts a secret for storing (AES-256-GCM). The result also proves, when opened, that nobody changed it. */
export function seal(secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')).join('.')
}

/** Opens what `seal` made. Throws when it was changed or sealed with another key. */
export function unseal(sealed: string): string {
  const [iv, tag, data] = sealed.split('.').map((part) => Buffer.from(part, 'base64url'))
  if (!iv || !tag || !data) throw new Error('Not a sealed value')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
