/**
 * Connects verified delivery cache to the core ArtifactPort. `localRef` stays
 * inside Host code and is never included in a Remote result.
 */
import type { CatalogDelivery } from '../../contracts/types.ts'
import type { ArtifactAcquireRequest, ArtifactAcquisition, ArtifactPort } from '../../core/ports.ts'
import { ArtifactCache } from '../../delivery/cache.ts'

export class CatalogArtifactPort implements ArtifactPort {
  constructor(
    private readonly cache: ArtifactCache,
    // Kept as a constructor compatibility argument; execution never consults
    // the live catalog after the user has confirmed a plan.
    _deliveries: () => readonly CatalogDelivery[],
    private readonly allowLocalFileSources: readonly string[] = [],
  ) {}

  async acquire(request: ArtifactAcquireRequest, signal?: AbortSignal): Promise<ArtifactAcquisition> {
    signal?.throwIfAborted()
    const delivery = request.delivery
    if (delivery === undefined) throw new Error('该计划缺少冻结的下载来源，请重新查看安装方案')
    if (delivery.pluginId !== request.pluginId || delivery.packageName !== request.packageName
      || delivery.version !== request.version
      || delivery.artifactDigest.replace(/^sha256:/, '') !== request.artifactDigest.replace(/^sha256:/, '')) {
      throw new Error('冻结下载来源与已确认的插件或摘要不一致')
    }
    const acquired = await this.cache.download(delivery, {
      signal,
      referenceId: request.requestId,
      // Retain conservatively: an official dependency may persist as file:.
      // Cleanup only removes files with no active-task or installed reference.
      referenceKind: 'installed',
      requireBundle: true,
      allowLocalFileSources: this.allowLocalFileSources,
    })
    return {
      pluginId: request.pluginId,
      packageName: request.packageName,
      version: request.version,
      artifactDigest: request.artifactDigest,
      localRef: acquired.localPath,
      size: acquired.verified.size,
    }
  }

  async release(localRef: string): Promise<void> {
    // Installed `file:` dependencies may continue to reference the verified
    // cache. Release is intentionally conservative and never deletes by path.
    void localRef
  }
}
