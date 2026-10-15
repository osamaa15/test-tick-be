import { z } from 'zod'

// Names match frontend/src/features/contact/types.ts.

export const ContactMessage = z
  .object({
    name: z.string().trim().min(1, 'Write your name.').max(200),
    email: z.email('Write a valid email address.').max(320),
    topic: z.enum(['question', 'feedback', 'bug', 'other']),
    message: z.string().trim().min(10, 'Write at least 10 characters.').max(5000),
  })
  .meta({ id: 'ContactMessage' })

export type ContactMessage = z.infer<typeof ContactMessage>

export const ContactReceipt = z.object({ id: z.uuid() }).meta({ id: 'ContactReceipt' })

export type ContactReceipt = z.infer<typeof ContactReceipt>
