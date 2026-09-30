# EAC 市场当前接手入口

更新时间：2026-09-30。**所有新协作者先读本文，再开始改代码。** 本文是当前接手入口；旧阶段报告和旧计划已经移到 `archive/2026-09-legacy/`，只能追溯。

## 当前事实

- 源码仓库：`D:/eac-market`
- 当前协作分支：`refactor/market-core-adapter`
- 桌面适配器源码候选：`@dsh-eac/market@0.1.0-mvp.10`
- Core 源码候选：`@dsh-eac/market-core@0.1.0`
- 当前正式可安装版：`0.1.0-mvp.9` 单包
- 当前 Client 已完成：发现页、全部插件目录、详情、导航返回快照、筛选、任务/皮肤/作者工具交互收口和兼容 fallback。
- 当前真实宿主仍待验：公网 Core 来源、官方 Desktop 全新安装/升级、读屏、forced-colors、120%–200% 缩放、真实网络图片和官方插件管理器长链路。

源码候选不等于正式发行版。不要把协作分支、workspace 包名或本地 `.tgz` 写成用户下载地址。

## 必读顺序

1. [最新版升级指南](../UPGRADE-GUIDE.md)：当前版本、构建、发布、回退和证据规则。
2. [Core / Desktop Adapter 底座指南](../CORE-ADAPTER-GUIDE.md)：两包职责、公开 API、协议和所有权边界。
3. [后端协作者指南](BACKEND-CONTRIBUTOR-GUIDE-2026-09-30.md)：Core、Host、目录、适配器的可执行接入规则。
4. [Client 维护边界](../../packages/market/src/client/README.md)：前端只能消费现有 Remote，不重复实现业务规则。
5. [当前交互审查](INTERACTION-AUDIT-2026-09-30.md)：已完成的交互收口、统一动作状态和未验宿主边界。
6. [UI 重构合同](UI-REBUILD-CONTRACT-2026-09-30.md)：发现页、全部插件、动效、兼容性和不变边界。
7. [协作约定](NEXT-AGENT-PLAYBOOK.md)：文件 owner、合同先行、验证串行和交接格式。

## 当前工作边界

### Client 协作者可以改

- `packages/market/src/client/**`
- 对应的 `tests/client/**`
- `DESIGN.md`、当前交互记录和交接说明

### 未经主控批准不得改

- `packages/market-core`
- Core contracts、安装计划和任务协议
- Host / DSH 适配器、官方 pluginManager 接线
- `package.json`、锁文件、正式发行入口
- 官方 DSH 源码、真实用户 profile、凭据和外部仓库资料

如果需求需要改公共合同，先在交接记录写清消费者、兼容策略、迁移和测试，再由主控串行处理。

## Client 当前状态合同

前端消费现有 `MarketRemote` 和 Core 返回值，不伪造后台状态：

| 后台事实 | Client 展示 |
| --- | --- |
| 目录刷新成功 | 已完成，并说明目录不会自动安装或更新 |
| 插件动作失败 | 失败原因 + 可执行重试 |
| 插件动作 `unknown` | 结果未知 + 先重新读取，不自动重放 |
| 插件动作 `restart-required` | 需要重新核对 + 重启 DSH 后再读 |
| 任务 `partial` | 部分完成 + 成功项保留 + 失败项下一步 |
| 任务 `awaiting-approval` / `awaiting-resume` | 显示授权或重启动作 |
| 皮肤切换结果未确认 | 重新读取状态，禁止重复切换 |
| 作者草稿版本冲突 | 保留本地编辑，不伪造已保存 |

动作生命周期实现位于 `packages/market/src/client/action-state.ts` 和 `action-feedback.tsx`，它们不改变 Remote 合同。

## 接手后的最小步骤

```powershell
git fetch --all --prune
git status --short --branch
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test -- tests/client
```

改动 Client 后至少运行：

```powershell
pnpm typecheck
pnpm lint
pnpm test -- tests/client
node tests/client/browser-check.mjs
```

必要时再运行完整 `pnpm check`。合成 browser-check 不能替代真实官方 Desktop 验收；未做真实验收就必须标记 partial。

## 文档规则

- 版本、下载地址、当前分支和未验范围以本文与 [最新版升级指南](../UPGRADE-GUIDE.md) 为准。
- `docs/handoff/archive/2026-09-legacy/` 中的文件只保留历史证据，不是任务清单或操作入口。
- 不要复制旧报告里的旧版本号、旧 commit、旧路径或“已完成”结论到新文档。
- 新交接文档必须写：日期、分支、范围、不变边界、已验证证据、未验证项目和下一步。

当前 GitHub 和 Gitee 都有协作分支；同步前先 fetch，禁止强推覆盖他人提交。
