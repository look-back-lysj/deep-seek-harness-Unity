import type { CatalogPlugin } from '../contracts/types.ts'
import type { MarketPluginMetadata } from './model.ts'
import { validatePackageMetadata, validatePublicManifest } from './public-format.ts'
import * as v from './input.ts'

/** 目录里的 files 只供静态预检；下载后必须再次对真实 tgz 文件表核对。 */
export function parseMetadata(value: unknown, plugin: CatalogPlugin): MarketPluginMetadata {
  const item = v.object(value, 'metadata')
  if (item.kind === 'dsh-std') {
    const manifest = v.raw(item.manifest, 'metadata.manifest')
    validatePublicManifest(manifest.bytes, plugin)
    return { kind: 'dsh-std', manifest: manifest.record }
  }
  if (item.kind !== 'official-bundle') v.invalid('metadata-kind', '元数据必须声明 official-bundle 或 dsh-std')
  const packageJson = v.raw(item.packageJson, 'metadata.packageJson')
  const metadata = v.object(v.json(packageJson.bytes, 'package.json'), 'package.json')
  if (metadata.name !== plugin.packageName || metadata.version !== plugin.version) v.invalid('metadata-identity', '官方 package.json 身份与目录不符')
  const projection = Object.fromEntries(['dependencies', 'peerDependencies', 'engines'].filter(key => metadata[key] !== undefined).map(key => [key, metadata[key]]))
  if (metadata.dsh !== undefined) {
    const dsh = v.object(metadata.dsh, 'dsh')
    // Official package metadata is extensible (e.g. the EAC dsh.skin
    // convention). Validate the known loader fields, retain all original bytes,
    // and never pass extra metadata through the strict public Manifest schema.
    projection.dsh = Object.fromEntries(['manifestVersion', 'bundle', 'profile', 'client'].filter(key => dsh[key] !== undefined).map(key => [key, dsh[key]]))
  }
  // npm peer/engine ranges may enumerate many official prerelease versions.
  // Keep the public dsh-std limit unchanged; official raw package metadata has
  // its own bounded range budget and is never truncated or rewritten.
  if (Object.keys(projection).length) validatePackageMetadata(projection, 'package.json', 4096)
  const files = v.array(item.files, 'metadata.files', 20000).map(path => v.relativeFile(path, 'metadata.file'))
  if (new Set(files.map(path => path.toLowerCase())).size !== files.length || !files.includes('package.json')) v.invalid('metadata-files', '官方文件表存在碰撞或缺少 package.json')
  const bundle = metadata.dsh === undefined ? undefined : v.object(metadata.dsh, 'dsh').bundle
  const patch = bundle === undefined ? undefined : v.relativeFile(v.object(bundle, 'dsh.bundle').patch, 'dsh.bundle.patch')
  if (patch !== undefined && !files.includes(patch)) v.invalid('metadata-missing-patch', '官方 bundle patch 不在包内文件表中')
  if (plugin.installability === 'bundle-installable' && patch === undefined) v.invalid('metadata-missing-bundle', '缺少官方 bundle 声明，不能标记可一键安装')
  return { kind: 'official-bundle', packageJson: packageJson.record, files }
}
