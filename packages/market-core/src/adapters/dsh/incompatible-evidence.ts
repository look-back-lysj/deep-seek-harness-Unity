import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { lstat, open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { validVersion } from '../../core/semver.ts'
import { canonicalJson } from '../../core/canonical.ts'

/** Host-private evidence, never a Remote DTO or authority to manage the package. */
export interface IncompatibleBundleEvidence {
  readonly packageName: string
  readonly version: string
  readonly dependencyRef: string
  readonly peers: Readonly<Record<string, string>>
  readonly fingerprint: string
  readonly sharedImpact: 'none' | 'unknown'
}

export const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u
const MAX_MANIFEST_BYTES = 1024 * 1024

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid installed identity record')
  return value as Record<string, unknown>
}

/** Read metadata only, with a bounded handle and a same-handle change check. */
async function metadata(filename: string): Promise<{ value: Record<string, unknown>; digest: string }> {
  const named = await lstat(filename)
  if (!named.isFile() || named.isSymbolicLink() || named.size > MAX_MANIFEST_BYTES) throw new Error('unsafe installed manifest file')
  const handle = await open(filename, 'r')
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size > MAX_MANIFEST_BYTES || named.dev !== before.dev || named.ino !== before.ino) throw new Error('invalid installed manifest size')
    const bytes = Buffer.alloc(before.size + 1)
    let length = 0
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, null)
      if (read.bytesRead === 0) break
      length += read.bytesRead
    }
    const after = await handle.stat()
    const afterNamed = await lstat(filename)
    if (!afterNamed.isFile() || afterNamed.isSymbolicLink() || afterNamed.dev !== before.dev || afterNamed.ino !== before.ino) throw new Error('installed manifest path changed')
    if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error('installed manifest changed during read')
    }
    const data = bytes.subarray(0, length)
    return { value: object(JSON.parse(data.toString('utf8'))), digest: createHash('sha256').update(data).digest('hex') }
  } finally { await handle.close() }
}

function within(directory: string, filename: string): boolean {
  const part = relative(directory, filename)
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep))
}

interface RuntimeOwner {
  readonly name?: unknown
  readonly version?: unknown
  readonly dir?: unknown
  readonly manifestPath?: unknown
}

interface RuntimeEntryLoader {
  entries?(): Iterable<unknown>
  readonly builtins?: { readonly include?: unknown; readonly group?: unknown }
}

interface RuntimePackageService {
  readonly packageOf?: (specifier: string, parentURL: string) => RuntimeOwner | undefined
}

function officialSystemEntry(entry: Record<string, unknown>, loader: RuntimeEntryLoader): boolean {
  const options = object(entry.options)
  const name = options.name
  const fiberValue = entry.fiber
  if (typeof fiberValue !== 'object' || fiberValue === null || Array.isArray(fiberValue)) return false
  const fiber = fiberValue as Record<string, unknown>
  const runtimeValue = fiber.runtime
  if (typeof runtimeValue !== 'object' || runtimeValue === null || Array.isArray(runtimeValue)) return false
  const callback = (runtimeValue as Record<string, unknown>).callback
  const builtins = loader.builtins
  // DSH mounts the root configuration through its own HostResolvedRootInclude
  // class. It is a Loader entry, but it is not a user package and must not be
  // sent through package resolution. The callback identity is the important
  // guard: merely starting a name with `cordis:` is not enough.
  if ((name === 'cordis:include' || name === '@deepseek-ai/cordis-plugin-include')
    && builtins?.include !== undefined && callback === builtins.include) return true
  // Groups are Loader-owned composition nodes, not npm packages. Keep the
  // explicit group marker/name checks narrow and require the official callback
  // when it is exposed by the running Loader.
  if ((options.group === true || name === 'cordis:group' || name === '@deepseek-ai/cordis-plugin-group')
    && (builtins?.group === undefined || callback === builtins.group)) return true
  return false
}

/**
 * A rejected bundle must not still contribute runtime code. Resolve the live
 * Loader's modules through the official DSH package-resolution service, without
 * importing/executing them. Missing Loader facts, aliases we cannot resolve,
 * or live code from this root cannot establish absence of shared impact. No
 * profile YAML is read here.
 */
async function runtimeEvidence(ctx: Context, directory: string): Promise<{ sharedImpact: 'none' | 'unknown'; fingerprint: string }> {
  const loader = (ctx as unknown as { loader?: RuntimeEntryLoader }).loader
  if (typeof loader?.entries !== 'function') return { sharedImpact: 'unknown', fingerprint: 'loader-unavailable' }
  const packages = (ctx as unknown as { get?: (name: string) => unknown }).get?.('pluginPackages') as RuntimePackageService | undefined
  if (typeof packages?.packageOf !== 'function') return { sharedImpact: 'unknown', fingerprint: 'plugin-packages-unavailable' }
  const roots: { id: string; name: string; packageName: string; version: string; manifestPath: string; manifestDigest: string }[] = []
  let sharedImpact: 'none' | 'unknown' = 'none'
  for (const raw of loader.entries()) {
    const entry = object(raw)
    if (officialSystemEntry(entry, loader)) continue
    const options = object(entry.options)
    const parent = object(entry.parent)
    const tree = object(parent.tree)
    const scope = object(tree.ctx)
    if (typeof entry.id !== 'string' || typeof options.name !== 'string' || !PACKAGE_NAME.test(options.name) || typeof scope.baseUrl !== 'string') {
      throw new Error('runtime module identity unavailable')
    }
    const url = new URL(scope.baseUrl)
    if (url.protocol !== 'file:' || url.username || url.password || url.search || url.hash) throw new Error('runtime base URL unavailable')
    const owner = packages.packageOf(options.name, scope.baseUrl)
    if (owner === undefined || typeof owner.manifestPath !== 'string' || !isAbsolute(owner.manifestPath)
      || typeof owner.name !== 'string' || typeof owner.version !== 'string') throw new Error('runtime package owner unavailable')
    const manifestPath = await realpath(owner.manifestPath)
    const installed = await metadata(manifestPath)
    const manifestName = installed.value.name
    const manifestVersion = installed.value.version
    if (manifestName !== owner.name || manifestVersion !== owner.version || typeof manifestName !== 'string' || typeof manifestVersion !== 'string') {
      throw new Error('runtime package owner identity changed')
    }
    const packageDirectory = await realpath(join(manifestPath, '..'))
    if (within(directory, packageDirectory)) sharedImpact = 'unknown'
    roots.push({ id: entry.id, name: options.name, packageName: manifestName, version: manifestVersion, manifestPath, manifestDigest: installed.digest })
  }
  roots.sort((a, b) => a.id.localeCompare(b.id))
  return { sharedImpact, fingerprint: canonicalJson(roots) }
}

/**
 * Anchors come exclusively from the running Host. The official resolver's
 * installation-first precedence prevents attributing a shadow profile copy to
 * the package rejected by listBundles(). Read only package.json metadata.
 */
export async function readIncompatibleBundleEvidence(ctx: Context, packageName: string): Promise<IncompatibleBundleEvidence> {
  const profile = ctx.profileContext
  if (!PACKAGE_NAME.test(packageName) || packageName.length > 214 || !isAbsolute(profile.dir) || !isAbsolute(profile.installAnchor)) {
    throw new Error('trusted profile anchors unavailable')
  }
  // Do not read approval contents. Existing/unreadable approvals mean a package
  // may previously have been loaded; this narrow recovery cannot prove otherwise.
  try {
    await stat(join(profile.dir, 'compatibility.json'))
    throw new Error('compatibility history may affect runtime')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const profileRecord = await metadata(join(profile.dir, 'package.json'))
  const dependencies = object(profileRecord.value.dependencies)
  const dependencyRef = dependencies[packageName]
  if (typeof dependencyRef !== 'string' || dependencyRef.length === 0) throw new Error('installed dependency reference unavailable')
  // Resolving official Host utilities is not importing the rejected plugin.
  const official = createRequire(import.meta.url)('@deepseek-ai/dsh-app-boot') as {
    resolveBundleDir?: (bin: string, name: string, anchor: string, profileDir: string) => string
  }
  if (typeof official.resolveBundleDir !== 'function') throw new Error('official bundle resolver unavailable')
  const directory = await realpath(official.resolveBundleDir('dsh', packageName, profile.installAnchor, profile.dir))
  const installed = await metadata(join(directory, 'package.json'))
  const manifest = installed.value
  if (manifest.name !== packageName || typeof manifest.version !== 'string' || !validVersion(manifest.version)) throw new Error('installed package identity mismatch')
  const dsh = object(manifest.dsh)
  const bundle = object(dsh.bundle)
  const patches = typeof bundle.patch === 'string' ? [bundle.patch] : bundle.patch
  if (!Array.isArray(patches) || patches.length === 0 || patches.some(value => typeof value !== 'string' || value.length === 0)) throw new Error('installed bundle declaration unavailable')
  const peers = object(manifest.peerDependencies)
  if (Object.values(peers).some(value => typeof value !== 'string')) throw new Error('installed peer metadata malformed')
  const runtime = await runtimeEvidence(ctx, directory)
  // Re-resolve and re-read after the runtime read; later inventory sampling also
  // compares this fingerprint. No inferred path, username, or persistent write.
  const afterDirectory = await realpath(official.resolveBundleDir('dsh', packageName, profile.installAnchor, profile.dir))
  const afterProfile = await metadata(join(profile.dir, 'package.json'))
  const afterInstalled = await metadata(join(afterDirectory, 'package.json'))
  if (directory !== afterDirectory || profileRecord.digest !== afterProfile.digest || installed.digest !== afterInstalled.digest) {
    throw new Error('installed identity changed during evidence read')
  }
  return {
    packageName, version: manifest.version, dependencyRef, peers: peers as Record<string, string>, sharedImpact: runtime.sharedImpact,
    fingerprint: canonicalJson({ directory, dependencyRef, profile: profileRecord.digest, manifest: installed.digest, runtime: runtime.fingerprint }),
  }
}
