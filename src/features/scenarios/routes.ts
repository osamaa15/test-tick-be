import { Router } from 'express'
import { z } from 'zod'
import { errorResponses, registry, sessionCookie } from '../../lib/openapi.js'
import { limitRequests } from '../../lib/rateLimit.js'
import { requireSession } from '../auth/session.js'
import {
  FeatureDetail,
  FeatureIdParams,
  FeatureParams,
  NewScenario,
  RegenerateInput,
  ResultInput,
  Scenario,
  ScenarioInput,
  ScenarioParams,
} from './schemas.js'
import { addScenario, editScenario, getFeature, regenerateScenarios, setResult } from './service.js'

export const scenariosRouter = Router()

const security = [{ [sessionCookie.name]: [] }]
const scenarioResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: Scenario } },
})

// One count for every change to scenarios. Marking a long list one by one stays well under it.
const writeLimit = limitRequests(300, 15)

registry.registerPath({
  method: 'get',
  path: '/api/projects/{projectId}/features/{featureId}',
  tags: ['scenarios'],
  summary: 'One feature with its scenarios',
  description:
    "Both roles' scenarios, in the order they were written. Also clears the feature's New or Changed mark for the person; `change` is the mark as it was.",
  security,
  request: { params: FeatureParams },
  responses: {
    200: { description: 'The feature.', content: { 'application/json': { schema: FeatureDetail } } },
    ...errorResponses(400, 401, 404, 429),
  },
})

scenariosRouter.get('/projects/:projectId/features/:featureId', async (req, res) => {
  const { user } = await requireSession(req)
  const { projectId, featureId } = FeatureParams.parse(req.params)
  res.json(await getFeature(user.id, projectId, featureId))
})

registry.registerPath({
  method: 'put',
  path: '/api/scenarios/{scenarioId}/result',
  tags: ['scenarios'],
  summary: "Mark the team's result",
  description:
    'One result per scenario, shared by the whole team. Records who marked it and when. `null` clears it. Scenario changes share a limit of 300 requests per 15 minutes per caller.',
  security,
  request: {
    params: ScenarioParams,
    body: { required: true, content: { 'application/json': { schema: ResultInput } } },
  },
  responses: { 200: scenarioResponse('The scenario with its result.'), ...errorResponses(400, 401, 404, 429) },
})

scenariosRouter.put('/scenarios/:scenarioId/result', writeLimit, async (req, res) => {
  const { user } = await requireSession(req)
  const { scenarioId } = ScenarioParams.parse(req.params)
  res.json(await setResult(user.id, scenarioId, ResultInput.parse(req.body).verdict))
})

registry.registerPath({
  method: 'post',
  path: '/api/features/{featureId}/scenarios',
  tags: ['scenarios'],
  summary: 'Add a scenario',
  description:
    "A person's own scenario for one role, with origin `manual` and no result. Text is trimmed and empty steps are dropped; a title and an expected result are required.",
  security,
  request: {
    params: FeatureIdParams,
    body: { required: true, content: { 'application/json': { schema: NewScenario } } },
  },
  responses: { 201: scenarioResponse('The scenario as saved.'), ...errorResponses(400, 401, 404, 429) },
})

scenariosRouter.post('/features/:featureId/scenarios', writeLimit, async (req, res) => {
  const { user } = await requireSession(req)
  const { featureId } = FeatureIdParams.parse(req.params)
  const { role, ...input } = NewScenario.parse(req.body)
  res.status(201).json(await addScenario(user.id, featureId, role, input))
})

registry.registerPath({
  method: 'patch',
  path: '/api/scenarios/{scenarioId}',
  tags: ['scenarios'],
  summary: "Change a scenario's text",
  description:
    'Send the whole text. An `ai` scenario becomes `edited`; a `manual` one stays `manual`. The result is kept.',
  security,
  request: {
    params: ScenarioParams,
    body: { required: true, content: { 'application/json': { schema: ScenarioInput } } },
  },
  responses: { 200: scenarioResponse('The scenario as saved.'), ...errorResponses(400, 401, 404, 429) },
})

scenariosRouter.patch('/scenarios/:scenarioId', writeLimit, async (req, res) => {
  const { user } = await requireSession(req)
  const { scenarioId } = ScenarioParams.parse(req.params)
  res.json(await editScenario(user.id, scenarioId, ScenarioInput.parse(req.body)))
})

registry.registerPath({
  method: 'post',
  path: '/api/features/{featureId}/regenerate',
  tags: ['scenarios'],
  summary: "Rewrite one role's AI scenarios",
  description:
    "The AI rewrites the role's `ai` scenarios from the feature's code at the current sync; they get new ids and no result. `edited` and `manual` scenarios stay as they are. Takes up to a minute. It costs money, so it is limited to 20 requests an hour per caller.",
  security,
  request: {
    params: FeatureIdParams,
    body: { required: true, content: { 'application/json': { schema: RegenerateInput } } },
  },
  responses: {
    200: {
      description: "That role's scenarios afterwards, in the order they were written.",
      content: { 'application/json': { schema: z.array(Scenario) } },
    },
    ...errorResponses(400, 401, 404, 429),
  },
})

scenariosRouter.post('/features/:featureId/regenerate', limitRequests(20, 60), async (req, res) => {
  const { user } = await requireSession(req)
  const { featureId } = FeatureIdParams.parse(req.params)
  res.json(await regenerateScenarios(user.id, featureId, RegenerateInput.parse(req.body).role))
})
