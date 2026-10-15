---
name: new-endpoint
description: Add an API endpoint to the Testick backend from the frontend's API contract, with its Zod schemas, service, route, Swagger entry and tests. Use when asked to build, add or implement a route, endpoint or API for a feature.
---

# Add an endpoint

Work in the main conversation. No subagents, nothing left running in the background.

## 1. Read the contract first

- Find the endpoint's row in `../frontend/docs/api-contract.md`: method, path, request, response, and the notes under the table.
- Open the types it names in `../frontend/src/features/<name>/types.ts`. The response must match them field for field: camelCase, string ids, ISO date strings, `null` where they allow it.
- If the contract and the request disagree, ask the user before writing anything.

## 2. Schemas: `src/features/<name>/schemas.ts`

- One Zod schema per request body and per response type, **named exactly like the frontend type** (`ContactMessage`, `Scenario`), with `.meta({ id: 'TheName' })` so Swagger shows it as a named schema.
- `export type X = z.infer<typeof X>` beside each one. Never write the same type by hand.
- Strings: `.trim()` and a `.max()`. Fixed sets: `z.enum([...])`. Ids from the database: `z.uuid()`. Params get a schema too (`z.object({ projectId: z.uuid() })`).
- Error messages are plain sentences for people, as the frontend shows them.

## 3. Service: `src/features/<name>/service.ts`

- Database and provider calls only. It takes plain typed values and returns the response type. No `req` or `res` in here.
- `const { data, error } = await supabase.from(...)...; if (error) throw error`
- Turn snake_case rows into the camelCase response shape here.
- Something that does not exist, **or that the person may not see**, is `throw new HttpError(404, 'Not found.')`. Same answer for both, so nothing leaks.
- Several writes that must happen together go in one Postgres function, called with `supabase.rpc(...)` (see `docs/database.md`).

## 4. Route: `src/features/<name>/routes.ts`

Register the path in Swagger directly above the route, with the same schemas the handler parses:

```ts
registry.registerPath({
  method: 'patch',
  path: '/api/scenarios/{scenarioId}',      // OpenAPI writes params as {name}
  tags: ['scenarios'],
  summary: "Change a scenario's text",
  request: { params: ScenarioParams, body: { required: true, content: { 'application/json': { schema: ScenarioInput } } } },
  responses: {
    200: { description: 'The scenario as saved.', content: { 'application/json': { schema: Scenario } } },
    ...errorResponses(400, 404, 429),
  },
})

scenariosRouter.patch('/scenarios/:scenarioId', async (req, res) => {
  const { scenarioId } = ScenarioParams.parse(req.params)
  res.json(await updateScenario(scenarioId, ScenarioInput.parse(req.body)))
})
```

- The handler parses, calls the service, and answers. Nothing else. No try/catch: Express 5 forwards the rejection to `handleErrors`.
- Status codes: 200 for a read or change, 201 for a created thing, 204 with `res.status(204).end()` for nothing to return.
- A public route, or one that writes, costs money (AI) or sends something, adds its own `limitRequests(limit, minutes)` before the handler, and says so in the `description`.
- A new feature's router is mounted in `src/app.ts` inside `app.use('/api', limitRequests(...), contactRouter, newRouter)`.

## 5. Test: `src/features/<name>/<name>.test.ts`, or extend `src/app.test.ts`

- At least: a wrong body is a 400 that names the field, and a missing thing is a 404. These need no database.
- Logic with branches (who is a Lead, what regenerate keeps) gets a test of its own on the service's pure parts.
- Then the `check` skill.

## 6. Docs

- Add the endpoint to the Status in `CLAUDE.md` when it completes a roadmap step.
- If the endpoint differs from `../frontend/docs/api-contract.md` in any way, tell the user. Do not change the frontend's files unless they ask.
