# Client 维护边界

本目录是 EAC Market 的桌面 Client。它通过 `MarketRemote` 消费 JSON 服务，负责页面展示、用户确认、导航恢复和失败后的下一步；不直接导入 Host、Node 文件系统或 Core 内部实现。

## 文件职责

- `MarketPage.tsx`：发现、全部插件、我的插件、详情、设置、帮助、作者和扩展页面的导航与组合。
- `data-controller.ts`：读取代次、环境校验、轮询、任务合并和库存刷新。
- `InstallPlanDialog.tsx`：只消费 Host 计划；目标变化会使旧计划失效。
- `TaskDrawer.tsx`：任务状态、授权、重启核对、AI 提案和真实失败下一步。
- `SkinCenter.tsx`：皮肤管理器状态、切换前复核、失败回退和重试。
- `AuthorWorkspace.tsx`：草稿 revision、README 差异、媒体传输和资料 ZIP。
- `action-state.ts` / `action-feedback.tsx`：把已有 Remote 结果映射成准备中、执行中、完成、部分完成、失败、未知和重新核对；不改变后端合同。
- `extensions/`：受限扩展合同和宿主提供的上下文；扩展不能绕过安装计划或作者 revision。

## 不变边界

- 不修改 `packages/market-core`、Core contracts、Host、Remote、安装协议、`package.json` 或锁文件来解决纯 UI 问题。
- 不重复实现目录排序、安装计划、任务执行、官方 pluginManager 或作者资料规则。
- `CatalogSnapshot.discovery` 缺少真实数据时隐藏区块；图片失败时降级为标题和简介文字卡。
- `failed`、`unknown`、`restart-required`、`partial` 和 revision 冲突必须保留真实语义，不能统一成成功或普通 loading。
- 旧 DSH、窄面板、暗色、forced-colors、reduced-motion 和图片失败时仍要有可读静态 fallback。

## 开发与验证

在 `D:/eac-market` 执行：

```powershell
pnpm typecheck
pnpm lint
pnpm test -- tests/client
node tests/client/browser-check.mjs
```

真实官方 Desktop 的读屏、120%–200% 缩放、forced-colors、嵌入式 Modal 覆盖范围和官方 pluginManager 长链路仍需独立验收。合成 browser-check 不能替代这些验收。

当前设计和交接入口：

- [DESIGN.md](../../DESIGN.md)
- [当前交互审查](../../docs/handoff/INTERACTION-AUDIT-2026-09-30.md)
- [UI 重构合同](../../docs/handoff/UI-REBUILD-CONTRACT-2026-09-30.md)
- [当前接手入口](../../docs/handoff/START-HERE.md)
