import { Router } from 'express'
import { errorResponses, registry } from '../../lib/openapi.js'
import { limitRequests } from '../../lib/rateLimit.js'
import { ContactMessage, ContactReceipt } from './schemas.js'
import { saveContactMessage } from './service.js'

export const contactRouter = Router()

registry.registerPath({
  method: 'post',
  path: '/api/contact',
  tags: ['contact'],
  summary: 'Send a message to the Testick team',
  description: 'Needs no session: visitors send it from the public contact page. Limited to 5 messages an hour per caller.',
  request: { body: { required: true, content: { 'application/json': { schema: ContactMessage } } } },
  responses: {
    201: { description: 'The message is stored.', content: { 'application/json': { schema: ContactReceipt } } },
    ...errorResponses(400, 429),
  },
})

// Public and writes to the database, so it is limited far below the rest of the API.
contactRouter.post('/contact', limitRequests(5, 60), async (req, res) => {
  res.status(201).json(await saveContactMessage(ContactMessage.parse(req.body)))
})
