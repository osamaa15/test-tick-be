import { z } from 'zod'

// Names match frontend/src/features/auth/types.ts.

export const Role = z.enum(['tester', 'developer']).meta({ id: 'Role' })
export type Role = z.infer<typeof Role>

export const Provider = z.enum(['github']).meta({ id: 'Provider' })

export const User = z
  .object({
    id: z.uuid(),
    name: z.string(),
    username: z.string().meta({ description: "The person's handle on the provider." }),
    avatarUrl: z.string().nullable(),
    role: Role.nullable().meta({ description: 'Null until they choose it after their first sign-in.' }),
  })
  .meta({ id: 'User' })
export type User = z.infer<typeof User>

export const Session = z.object({ user: User, provider: Provider }).meta({ id: 'Session' })
export type Session = z.infer<typeof Session>

export const RoleInput = z.object({ role: Role }).meta({ id: 'RoleInput' })
