/** Authoring 模块入口：草稿、安全Markdown、固定commit README、资料ZIP与有界传输。 */
export {
  AuthorDraftConflictError,
  AuthorDraftStore,
  AuthorDraftValidationError,
  type DraftStoreOptions,
} from './drafts.ts'
export {
  MarkdownSecurityError,
  renderSafeMarkdown,
  rewriteRelativeImages,
  rewriteRelativeLinks,
  type RelativeLinkResolvers,
  type SafeMarkdownResult,
} from './markdown.ts'
export {
  MediaStore,
  MediaValidationError,
  type MediaLimits,
  type StoredMedia,
} from './media.ts'
export {
  createZip,
  readZip,
  safeZipPath,
  ZipSecurityError,
  DEFAULT_ZIP_LIMITS,
  type ZipEntry,
  type ZipLimits,
} from './zip.ts'
export {
  AUTHOR_EXPORT_FILENAME,
  AuthorPackageError,
  AuthorPackageService,
  type AuthorPackageResult,
  type AuthorProvenance,
} from './package.ts'
export {
  ReadmeImporter,
  ReadmeImportError,
  type ReadmeImporterOptions,
  type RemoteBytesReader,
} from './readme.ts'
export {
  TransferError,
  TransferManager,
  type TransferContext,
  type TransferFinisher,
  type TransferLimits,
  type TransferReadResult,
} from './transfer.ts'
