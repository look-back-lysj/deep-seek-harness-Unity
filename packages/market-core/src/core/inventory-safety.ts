export function bundleInventoryReadFailed(issue: string): boolean {
  return issue === 'pluginManager:unavailable' || issue.startsWith('listBundles:') || issue === 'bundle-entry:missing-name'
}

export function inventoryIssueAffectsPackage(issue: string, packageName: string): boolean {
  return bundleInventoryReadFailed(issue) || issue === `bundle-version:${packageName}`
    || issue === `bundle-entry:duplicate:${packageName}` || issue.startsWith(`bundle:${packageName}:`)
}
