import { supabase } from '../../lib/supabase.js'
import type { ContactMessage, ContactReceipt } from './schemas.js'

/**
 * Stores a visitor's message for the team.
 * shortcut: stored only, not emailed yet; send it to the team's inbox once an email provider is chosen (roadmap step 7).
 */
export async function saveContactMessage(message: ContactMessage): Promise<ContactReceipt> {
  const { data, error } = await supabase.from('contact_messages').insert(message).select('id').single()
  if (error) throw error
  return data
}
