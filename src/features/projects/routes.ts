import { Router } from 'express'
import { z } from 'zod'
import { errorResponses, registry, sessionCookie } from '../../lib/openapi.js'
import { limitRequests } from '../../lib/rateLimit.js'
import { requireSession } from '../auth/session.js'
import { ConnectInput, Project, ProjectDetail, ProjectParams, Repository } from './schemas.js'
import { connectRepositories, getProject, listProjects, listRepositories, removeProject } from './service.js'

export const projectsRouter = Router()

const security = [{ [sessionCookie.name]: [] }]

registry.registerPath({
  method: 'get',
  path: '/api/projects',
  tags: ['projects'],
  summary: 'Projects the person can see',
  description:
    'Every project whose repository the person can access on the provider, whoever connected it, most recently synced first. Access is read from GitHub at most once a minute per person.',
  security,
  responses: {
    200: { description: 'The projects.', content: { 'application/json': { schema: z.array(Project) } } },
    ...errorResponses(401, 429),
  },
})

projectsRouter.get('/projects', async (req, res) => {
  const { user } = await requireSession(req)
  res.json(await listProjects(user.id))
})

registry.registerPath({
  method: 'get',
  path: '/api/projects/{projectId}',
  tags: ['projects'],
  summary: 'One project with its features',
  description: "The whole project page: the project, and its current features with the person's New or Changed marks.",
  security,
  request: { params: ProjectParams },
  responses: {
    200: { description: 'The project.', content: { 'application/json': { schema: ProjectDetail } } },
    ...errorResponses(400, 401, 404, 429),
  },
})

projectsRouter.get('/projects/:projectId', async (req, res) => {
  const { user } = await requireSession(req)
  res.json(await getProject(user.id, ProjectParams.parse(req.params).projectId))
})

registry.registerPath({
  method: 'delete',
  path: '/api/projects/{projectId}',
  tags: ['projects'],
  summary: 'Remove a project from Testick',
  description:
    'Deletes the project and everything Testick stored for it: syncs, features, scenarios and results, for the whole team. The repository on GitHub is untouched, and it can be connected again later. Only a Lead (admin or maintain access) may: anyone else gets 403. Limited to 10 requests per 15 minutes per caller.',
  security,
  request: { params: ProjectParams },
  responses: { 204: { description: 'Removed.' }, ...errorResponses(400, 401, 403, 404, 429) },
})

projectsRouter.delete('/projects/:projectId', limitRequests(10, 15), async (req, res) => {
  const { user } = await requireSession(req)
  await removeProject(user.id, ProjectParams.parse(req.params).projectId)
  res.status(204).end()
})

registry.registerPath({
  method: 'get',
  path: '/api/repositories',
  tags: ['projects'],
  summary: 'Repositories the person can connect',
  description:
    'Every repository the person can access that the Testick GitHub App is installed on, most recently pushed first. `projectId` is set when it is already a project. Asks GitHub each time, so it is limited to 60 requests per 15 minutes per caller.',
  security,
  responses: {
    200: { description: 'The repositories.', content: { 'application/json': { schema: z.array(Repository) } } },
    ...errorResponses(401, 429),
  },
})

projectsRouter.get('/repositories', limitRequests(60, 15), async (req, res) => {
  const { user } = await requireSession(req)
  res.json(await listRepositories(user.id))
})

registry.registerPath({
  method: 'post',
  path: '/api/projects',
  tags: ['projects'],
  summary: 'Connect repositories as projects',
  description:
    'Each one starts its first sync, which stays `running` until it ends. One already connected is returned as it is. A repository the person cannot access is a 404, and then nothing is connected. Limited to 30 requests per 15 minutes per caller.',
  security,
  request: { body: { required: true, content: { 'application/json': { schema: ConnectInput } } } },
  responses: {
    201: {
      description: 'The projects, in the order asked.',
      content: { 'application/json': { schema: z.array(Project) } },
    },
    ...errorResponses(400, 401, 404, 429),
  },
})

projectsRouter.post('/projects', limitRequests(30, 15), async (req, res) => {
  const { user } = await requireSession(req)
  res.status(201).json(await connectRepositories(user.id, ConnectInput.parse(req.body).repositoryIds))
})
