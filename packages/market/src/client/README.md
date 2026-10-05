# Client 维护边界

本目录是 EAC Market 的桌面 Client。它通过 `MarketRemote` 消费 JSON 服务，负责页面展示、用户确认、导航恢复和失败后的下一步；不直接导入 Host、Node 文件系统或 Core 内部实现。

## 文件职责

- `MarketPage.tsx`：发现、全部插件、我的插件、详情、设置、帮助、作者和扩展页面的导航与组合。
- `data-controller.ts`：读取代次、环境校验、轮询、任务合并和库存刷新。
- `media.tsx` / `mediaStyles.ts`：消费可选icon/previews和声明theme；图标加载/失败文字fallback、画廊失败重试和放大均为前端中间态；只加载无凭据HTTPS，不把媒体声明当审核或适配证据。样式字符串由MarketPage统一注入，无独立CSS发行入口。
- `PendingListings.tsx`：登记项仍不可安装；收起时不生成媒体图片请求，展开后才消费后端完整画廊。
- `InstallPlanDialog.tsx`：消费 Host 版本事实和计划；前端选择适配升级、保留有效手选，目标或上下文变化使旧计划失效，降级仍需二次确认。
- `release-selection.ts`：只从后端排序的 selectable/compatibility/relation 集合选版本、拼接同上下文分页并解释事实；不重做 semver 范围、来源信任或制品规则。
- `task-request-guard.ts`：超时只停止接受回包，原 Promise 未结束前不释放同任务在途锁；身份切换或卸载丢弃迟到结果。
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

在当前工程工作区执行（本轮为 `G:/Code/fork/agent-market`，不要把历史检出路径当运行时默认目录）：

```powershell
pnpm typecheck
pnpm lint
pnpm test -- tests/client
node tests/client/browser-check.mjs
```

真实官方 Desktop 的读屏、120%–200% 缩放、forced-colors、嵌入式 Modal 覆盖范围和官方 pluginManager 长链路仍需独立验收。合成 browser-check 不能替代这些验收。

2026-10-04 新能力按 `hello.capabilities` 和 optional 方法双重探测；没有 `host-release-context` 的旧 Host 使用原目录锁定预检。`operation-recovery` 查询只携带原 plan/key，不重放写入；`not-found` 不能证明没有执行。目录“重新核对”只读 catalog/库存/任务，不重新调用 refresh。后端不返回默认版本、loading、弹窗阶段或轮询频率。当前执行及验收证据见 [任务账本](../../../../docs/handoff/REMAINING-WORK-2026-10-04.md)。

当前设计和交接入口：

2026-10-05 管理恢复：启用、停用和卸载在写入前按环境保存最小原操作指针（packageName、expectedVersion、action、idempotencyKey），不保存凭据、库存或业务结果。20秒展示超时不终止原Promise、不生成新key；断线、not-found、旧记录缺完整业务结果及unknown均保留重复提交保护。页面重开只读调用原操作查询；官方receipt/stage与完整result分开展示，仅可信终态且指针安全清除后允许新管理写。存储不可用或损坏停止新写入，引导官方插件页核对。执行、维护状态提交及耐久业务事实仍由Core负责；前端只负责超时、核对、提示及页面恢复。

- [DESIGN.md](../../DESIGN.md)
- [当前交互审查](../../docs/handoff/INTERACTION-AUDIT-2026-09-30.md)
- [UI 重构合同](../../docs/handoff/UI-REBUILD-CONTRACT-2026-09-30.md)
- [当前接手入口](../../docs/handoff/START-HERE.md)
