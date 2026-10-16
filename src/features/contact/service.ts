import { config } from '../../config.js'
import { logger } from '../../lib/logger.js'
import { supabase } from '../../lib/supabase.js'
import type { ContactMessage, ContactReceipt } from './schemas.js'

/** Emails a visitor's message to the team's inbox (Resend). Replying answers the visitor. */
export async function emailTeam({ name, email, topic, message }: ContactMessage) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: config.CONTACT_FROM,
      to: [config.CONTACT_INBOX],
      reply_to: email,
      subject: `Testick ${topic}: ${name.replace(/\s+/g, ' ')}`,
      text: `${message}\n\n--\n${name} <${email}>\nTopic: ${topic}`,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
}

/**
 * Stores a visitor's message, then emails it to the team. Stored first, so a failed email loses nothing.
 * shortcut: a message whose email failed is only in contact_messages and the logs; add an emailed_at column
 * and a resend job if that starts happening.
 */
export async function saveContactMessage(message: ContactMessage): Promise<ContactReceipt> {
  const { data, error } = await supabase.from('contact_messages').insert(message).select('id').single()
  if (error) throw error
  await emailTeam(message).catch((err: unknown) => logger.error({ err, contactMessageId: data.id }, 'could not email a contact message'))
  return data
}
