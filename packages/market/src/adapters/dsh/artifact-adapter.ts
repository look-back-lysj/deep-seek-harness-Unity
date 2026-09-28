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
    private readonly deliveries: () => readonly CatalogDelivery[],
    private readonly allowLocalFileSources: readonly string[] = [],
  ) {}

  async acquire(request: ArtifactAcquireRequest, signal?: AbortSignal): Promise<ArtifactAcquisition> {
    signal?.throwIfAborted()
    const delivery = this.deliveries().find((candidate) =>
      candidate.pluginId === request.pluginId
      && candidate.packageName === request.packageName
      && candidate.version === request.version
      && candidate.artifactDigest === request.artifactDigest)
    if (delivery === undefined) throw new Error('exact catalog delivery is unavailable')
    const acquired = await this.cache.download(delivery, {
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
