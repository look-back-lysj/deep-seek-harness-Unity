# DSH 核心宽泛兼容阶段一记录（2026-09-29）

本文记录 `0.1.0-mvp.8` 的核心准入兼容改造、真实验证边界和后续维护约束。它是新增记录，不覆盖历史报告。

## 1. 结论

阶段一目标已完成到“已知官方核心可加载、官方准入门禁宽泛化、适配层不伪造未知结果”：

- 官方 `0.1.7-rc.2`：官方 `evaluatePluginCompatibility` peer gate 通过；项目 TypeScript/测试通过。
- 官方 `0.2.0-rc.1`：真实官方 Desktop 隔离实例加载市场成功；EAC 页面、发现页、我的插件页和官方管理器返回状态可用。
- 未来未知核心：可通过 peer gate 的概率提高，但**不等于任意未来 API 已运行验证**。若官方改变 `ChangeResult`、插件管理器或 atomic-write API，市场会返回 `unknown/fail loud`，不会伪造安装成功。

## 2. 根因

旧包把 4 个 DSH peer 精确写成 `0.1.7-rc.2`：

```text
@deepseek-ai/dsh-app-boot
@deepseek-ai/dsh-atomic-write
@deepseek-ai/dsh-plugin-manager
@deepseek-ai/dsh-typert-protocol
```

官方 `0.2.0-rc.1` 的兼容检查会检查所有 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` peer 范围，因此旧市场会在加载前被拒绝。实际 API 调研中，市场需要的 `listPlugins/listBundles/installBundle/setBundleEnabled/removeBundle/cancelInstall/waitForInstall`、`writeFileAtomic/withFileLock` 在 0.1.7 与 0.2.0 间保持可用；主要断裂是 peer 版本声明和 `removeBundle` 多传参数。

## 3. 方案选择

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 保持精确版本 | 风险最低 | 每个新核心都会被拒绝 | 不采用 |
| 为每个已知核心写范围 | 能覆盖有限版本 | 未来版本仍会拒绝，维护成本高 | 仅作过渡 |
| `workspace:*` + `engines.dsh: *` | 通过官方宽泛准入，包可被不同核心解析 | 只保证准入，不保证未知 API 运行正确 | **采用** |

`workspace:*` 是用户要求的宽泛门禁表达；它不能被解释成“所有未来 DSH 都已实测”。非 DSH peer（`cordis`、`schemastery`、`react`）保持稳定范围。

## 4. 代码改动

- `packages/market/package.json`、`dsh-plugin.json`：版本统一为 `0.1.0-mvp.8`；DSH peer 改为 `workspace:*`；`engines.dsh` 改为 `*`。
- `packages/market/src/adapters/dsh/host-port.ts`：官方方法缺失时返回真实 `unknown`；`removeBundle(name)` 使用官方单参数签名；保留未知错误码、失败诊断并脱敏路径/凭据/Token。
- `packages/market/src/adapters/dsh/manager.ts`：能力探测改为按实际方法判断，不再把缺方法当成功；inventory 保留 `unknownItems`。
- `packages/market/src/adapters/dsh/persistence-adapter.ts`：atomic-write 懒加载并严格校验 `writeFileAtomic`/`withFileLock`；缺能力时不降级普通写入、不自制锁。
- `tests/adapter/host-port.test.ts`、`tests/host/ai-runtime.test.ts`：补运行时形状、单参数 `removeBundle`、未知错误码和真实官方返回形状测试。
- `tests/compatibility/manifest-compatibility.test.ts`：锁定宽泛 peer、稳定非 DSH peer 和版本一致性。
- `scripts/verify-official-compat.mjs`：只读调用官方 `evaluatePluginCompatibility`，支持官方 app-boot/DSH 根目录参数。

## 5. 验证记录

| 层级 | 结果 | 证据/边界 |
|---|---|---|
| V1 build | PASS | `pnpm build` |
| V2 tests | PASS | `pnpm check`：54 files、392 tests passed、2 skipped |
| V2 typecheck | PASS | `pnpm typecheck` |
| P package | PASS | `pnpm test:pack`：176 files、Remote descriptors 30 |
| peer gate 0.1.7 | PASS | `verify-official-compat.mjs` |
| peer gate 0.2.0 | PASS | 同上 |
| peer gate unknown | PASS | 合成 `0.3.0-unknown`，只证明准入 |
| D Desktop 0.2.0 | PASS（隔离） | `DSH_HOME=D:\eac-market-verify\official-compat-stage1-20260929\home-0.2.0-rc.1`；独立 Electron user-data；`webserver.port=0` 避让生产端口 |
| D UI | PASS（隔离） | 真实 Desktop 打开 EAC；发现页正常；我的插件显示 `@dsh-eac/market 0.1.0-mvp.8` 运行中；展开官方与系统组件 13 项 |
| 0.1.7 Desktop | not-run | 当前机器没有独立 0.1.7 Desktop 可执行包；已做官方 peer gate、类型和单元验证 |
| 官方“添加插件”UI 安装链 | partial | 本次市场包通过隔离 profile 的官方 pnpm 安装并真实加载；未把 UI 点击安装当作已验证链路 |
| 任意未来 DSH API | not-guaranteed | 未来接口变化会 fail loud/unknown，需逐版本 smoke |

验证包：

```text
D:\eac-market-verify\official-compat-stage1-20260929\dsh-eac-market-0.1.0-mvp.8.tgz
大小 839313 bytes
SHA256 14DFE071D6E3766163BFE237DF66074C193E99310F7DA81BA518283119B0B2FE
```

这是验证用包，不代表已发布。`pnpm peers check` 在隔离 profile 报缺少 runtime peer，因为官方 Desktop 的基础运行时由 app.asar 提供，不在 profile 的 pnpm 依赖树中；这与真实 Desktop 已加载并不矛盾，但后续发布前应补一条发行环境说明，不能把该警告隐藏成通过。

## 6. 后续维护门槛

1. 新 DSH 核心先跑 `verify-official-compat.mjs`，再跑真实 Desktop smoke。
2. 不修改官方源码、不创建 `compatibility.json` 豁免、不改第三方 tarball 冒充作者适配。
3. `ChangeResult`、manager 或 atomic-write 形状变化时，保留 `unknown`，补适配层和契约测试后再扩大支持声明。
4. 正式发布前重新构建 tgz、记录 SHA256、跑 `pnpm check`、隔离 Desktop 安装/重启/我的插件页检查。
