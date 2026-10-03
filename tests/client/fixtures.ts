import type {
  CatalogPlugin,
  CatalogSnapshot,
  EnvironmentHello,
  InventorySnapshot,
  TaskState,
} from '../../packages/market/src/types.ts'

export const helloFixture: EnvironmentHello = {
  protocolVersion: '2.0.0',
  schemaVersion: '1',
  marketVersion: '0.1.0-mvp.0',
  environmentId: 'test-environment',
  profileName: 'desktop',
  hostVersion: '0.1.7-rc.2',
  capabilities: ['browse', 'install', 'enable', 'disable', 'remove', 'restart-handoff', 'core-maintenance', 'update-check', 'catalog-source-list', 'agent-forge-refresh', 'update-policy'],
}

const basePlugin: CatalogPlugin = {
  id: 'plugin-alpha',
  name: '超长名称插件用于检查中文与 English 混排不会撑破窄面板',
  packageName: '@example/a-very-long-package-name-for-hardening',
  version: '1.2.0',
  summary: '把复杂任务整理成清晰步骤，并在安装前说明版本、来源和必要设置。',
  author: 'EAC 社区作者',
  distribution: 'recommended',
  capabilityTier: 'workspace-write',
  verification: 'verified',
  installability: 'bundle-installable',
  artifactDigest: 'sha256:test-alpha',
  presentationId: 'presentation-alpha',
  categories: ['效率', '编程'],
  screenshots: [{ id: 'shot-1', alt: '插件真实界面截图', sourceUrl: 'https://example.invalid/screenshot.png', width: 1200, height: 675 }],
  enabledPolicy: 'requires-setup',
  requiresRestart: false,
  requiresSetup: true,
  largeExternalResource: false,
}

export const pluginFixtures = {
  verified: basePlugin,
  unverified: {
    ...basePlugin,
    id: 'plugin-beta',
    name: '资料整理助手',
    packageName: '@example/research-helper',
    presentationId: 'presentation-beta',
    distribution: 'external',
    verification: 'unverified',
    artifactDigest: 'sha256:test-beta',
    categories: ['资料整理'],
    screenshots: [],
  },
  blocked: {
    ...basePlugin,
    id: 'plugin-gamma',
    name: '旧版界面扩展',
    packageName: '@example/legacy-ui',
    presentationId: 'presentation-gamma',
    distribution: 'unclassified',
    verification: 'hard-incompatible',
    installability: 'missing-bundle',
    categories: ['界面'],
    screenshots: [],
    requiresSetup: false,
    enabledPolicy: 'default-off',
  },
} as const satisfies Record<string, CatalogPlugin>

export const catalogFixture: CatalogSnapshot = {
  schemaVersion: '1',
  revision: 'fixture-2026-09-27',
  generatedAt: '2026-09-27T12:00:00.000Z',
  origin: 'embedded',
  stale: false,
  plugins: Object.values(pluginFixtures),
  packs: [{
    id: 'pack-workflow',
    name: '作者工作流组合',
    version: '1.0.0',
    summary: '组合安装资料整理与编程辅助，确认页会列出新增、升级、降级和阻止项。',
    category: 'workflow',
    components: [
      { pluginId: 'plugin-alpha', version: '1.2.0', required: true },
      { pluginId: 'plugin-beta', version: '1.0.0', required: false },
    ],
    lockDigest: 'sha256:pack-lock',
    execution: {
      schemaVersion: '1',
      packId: 'pack-workflow',
      packVersion: '1.0.0',
      lockDigest: 'sha256:pack-lock',
      coverage: 'partial',
      edges: [{ prerequisiteId: 'plugin-alpha', consumerId: 'plugin-beta', milestone: 'installed' }],
      provenance: 'fixture',
    },
  }],
  presentations: [{
    id: 'presentation-alpha',
    revision: '1',
    title: '结构化任务面板',
    summary: '从安装到首次使用都有清晰下一步。',
    markdown: '## 真实介绍\n\n- 标题、段落、列表和代码示例\n- 固定信息区仍显示真实安装状态\n\n```text\n只复制示例，不执行命令\n```',
    media: [],
  }],
  deliveries: [{
    pluginId: 'plugin-alpha',
    version: '1.2.0',
    artifactDigest: 'sha256:test-alpha',
    packageName: '@example/a-very-long-package-name-for-hardening',
    sources: [{ kind: 'registry-tarball', ref: 'fixture://alpha', priority: 1, size: 1024 }],
  }],
}

export const inventoryFixture: InventorySnapshot = {
  environmentId: 'test-environment',
  revision: 'inventory-fixture',
  items: [
    {
      packageName: '@example/a-very-long-package-name-for-hardening',
      version: '1.1.0',
      source: 'profile',
      installed: true,
      bundleEnabled: true,
      removable: true,
      rows: [{ id: 'alpha-row', name: '@example/a-very-long-package-name-for-hardening', state: 'enabled' }],
      restartRequired: true,
    },
    {
      packageName: '@example/research-helper',
      version: '0.9.0',
      source: 'installation',
      installed: true,
      bundleEnabled: false,
      removable: false,
      readOnlyReason: 'management-required',
      rows: [{ id: 'beta-row', name: '@example/research-helper', state: 'load-error', error: 'LOAD_ERROR' }],
      restartRequired: false,
    },
  ],
  unknownItems: ['unknown-package'],
}

export function taskFixture(overrides: Partial<TaskState> = {}): TaskState {
  return {
    taskId: 'task-1',
    planId: 'plan-1',
    planDigest: 'sha256:plan',
    environmentId: 'test-environment',
    status: 'partial',
    createdAt: '2026-09-27T12:00:00.000Z',
    updatedAt: '2026-09-27T12:01:00.000Z',
    items: [
      {
        pluginId: 'plugin-alpha',
        packageName: '@example/alpha',
        targetVersion: '1.2.0',
        status: 'restart-required',
        changed: true,
        installOutcome: 'restart-required',
        permissionChanges: [],
      },
      {
        pluginId: 'plugin-beta',
        packageName: '@example/beta',
        targetVersion: '1.0.0',
        status: 'blocked-by-dependency',
        changed: false,
        installOutcome: 'unknown',
        permissionChanges: [],
      },
    ],
    events: [
      { sequence: 1, at: '2026-09-27T12:00:10.000Z', phase: 'installing', message: '开始安装 @example/alpha', level: 'info' },
      { sequence: 2, at: '2026-09-27T12:00:40.000Z', phase: 'partial', message: '@example/beta 因依赖未满足而暂停', level: 'warning' },
    ],
    nextAction: '成功项已保留；依赖项暂停，等待处理。',
    ...overrides,
  }
}

export function readOnlyRemote() {
  return {
    hello: async () => helloFixture,
    catalog: async () => catalogFixture,
    inventory: async () => inventoryFixture,
    listTasks: async () => [taskFixture()],
  }
}
