import { once } from 'node:events'
import { Parser } from 'tar'
import { gitHubFetch } from '../../lib/github.js'

// Reading a repository's code at a commit: one archive download, keeping only the files worth reading.

/** A sync that stopped for a reason people should read. It becomes the sync's `failure` as it is. */
export class SyncFailure extends Error {}

const SKIPPED =
  /(^|\/)(node_modules|dist|build|out|coverage|vendor|target|\.git|\.next|\.nuxt|\.venv|venv|__pycache__)\/|\.(png|jpe?g|gif|webp|ico|svg|bmp|pdf|zip|gz|tgz|tar|jar|woff2?|ttf|otf|eot|mp3|mp4|mov|wav|lock|lockb|map|min\.js|min\.css|snap)$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|composer\.lock|Gemfile\.lock|poetry\.lock|Cargo\.lock)$/i
const MAX_FILE_BYTES = 100_000
const MAX_KEPT_BYTES = 20_000_000
const MAX_ARCHIVE_BYTES = 200_000_000

/** Source and docs, not dependencies, builds, media, lock files or anything over 100 KB. */
export const isCodeFile = (path: string, size: number) => size > 0 && size <= MAX_FILE_BYTES && !SKIPPED.test(path)

/** The code files of a gzipped tar archive, by path, without the archive's top folder. Binary files are left out. */
export async function readArchive(chunks: AsyncIterable<Uint8Array>): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  // GitHub puts everything under one folder named after the repository and commit.
  const inRepo = (path: string) => path.slice(path.indexOf('/') + 1)
  let kept = 0
  const parser = new Parser({
    filter: (path, entry) =>
      'type' in entry && entry.type === 'File' && isCodeFile(inRepo(path), entry.size) && kept + entry.size <= MAX_KEPT_BYTES,
    onReadEntry: (entry) => {
      kept += entry.size
      const parts: Buffer[] = []
      entry.on('data', (part: Buffer) => parts.push(part))
      entry.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8')
        if (!text.includes('\0')) files.set(inRepo(entry.path), text)
      })
    },
  })
  const done = new Promise((resolve, reject) => {
    parser.on('end', resolve)
    parser.on('error', reject)
  })

  let downloaded = 0
  for await (const chunk of chunks) {
    downloaded += chunk.length
    if (downloaded > MAX_ARCHIVE_BYTES) throw new SyncFailure('The repository is too large for Testick to read (over 200 MB).')
    if (!parser.write(Buffer.from(chunk))) await once(parser, 'drain')
  }
  parser.end()
  await done
  return files
}

/** The repository's code files at a commit. */
export async function readRepository(token: string, owner: string, repo: string, sha: string) {
  const res = await gitHubFetch(`/repos/${owner}/${repo}/tarball/${sha}`, token, { signal: AbortSignal.timeout(180_000) })
  if (!res.body) throw new Error('GitHub sent an empty archive')
  return readArchive(res.body)
}
