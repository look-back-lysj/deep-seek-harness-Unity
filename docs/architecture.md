# 架构与模块边界

## 1. 运行形态

市场是一个标准 DSH bundle：Host 服务运行在当前 profile 的 DSH 进程中，Client 注册官方 `main` 与 `sidebar.panellist`。它不另起端口、不创建桌面壳，不读取 Client 传来的任意文件路径。

```text
EAC页面 -> 官方Remote -> eacMarket Host -> 计划/任务 -> 官方 pluginManager
                                      ├-> Catalog/Delivery -> 已核验本地tgz
                                      ├-> Persistence -> <profile>/eac-market
                                      └-> Authoring -> 草稿/媒体/资料包
```

## 2. 目录位置

真正的插件包是 `packages/market`。根 `packages/typert-protocol-shim`、`packages/cordis-shim` 只用于解决独立工程的源码分析，不进入发布包；最终运行仍使用官方包。构建脚本必须确认这些 shim 不在 `npm pack` 文件清单。

`src/index.ts` 是公开 Host/Typert 根；`src/contracts` 是 Host/Client 共享 wire 类型；`src/adapters/dsh` 是唯一接触官方管理器的层。Client 不能直接读取 Node 文件系统、本机路径或私有 HTTP 端口。

## 3. 依赖方向

```text
client -> contracts
host   -> contracts -> core
host   -> adapters/dsh -> official pluginManager
host   -> catalog/delivery/persistence/authoring
core   -X-> React/Cordis/Node fs/network
```

core 的规划器保持纯函数，任务执行器通过 ports 管理状态与副作用；adapter 翻译官方事实，UI 消费契约。任何跨层捷径都要说明依据并补调用链测试。

## 4. 生命周期

bundle 自带 `cordis.patch.yml` 只有一个自插入行；禁止再写用户层同名 insert。Client 先 mount 生成的 `TYPERT_REMOTE`，之后才读取 `remote.eacMarket`。所有 slot、locale、事件订阅、传输任务必须可释放。

Host 写操作进入每 profile 队列。官方调用前后分别记录意图和事实，不把 `undefined` 当成功。进程退出后先核对残留包管理进程和磁盘状态，不自动重放不确定步骤。

## 5. mvp.1 的维护入口

| 职责 | 真实代码位置 | 关键边界 |
| --- | --- | --- |
| Host 组装、Remote 确认 | `src/index.ts`、`host/market-runtime.ts` | 官方 `this.ctx.invocation.peer.id` 绑定连接；用户字段不能伪造连接；只传 JSON 安全视图 |
| 安装与管理协调 | `core/task-manager.ts`、`core/execution-state.ts` | 执行占用与短时记录锁分开；取消可先落盘；未知写入保留持久阻断 |
| 官方事实与回执 | `adapters/dsh/host-port.ts`、`manager.ts` | 真实版本/能力指纹、进程启动身份、缓存字节与依赖引用；不把磁盘版本当运行版本 |
| 原子记录 | `persistence/task-store.ts`、`schema.ts` | schema3提交日志、摘要与可重建索引；坏数据不能静默当空 |
| 发布、目录及镜像 | `catalog/{metadata,releases,lifecycle,collections,submission}.ts`、`delivery/` | 官方-only与真实社区Manifest区分；公共Pack与私有组合分开；每次写前复核撤回 |
| 作者工作区 | `authoring/`、`client/AuthorWorkspace.tsx` | 草稿revision、README预览候选、草稿媒体归属、资料ZIP；导出不等于上架 |
| 页面与数据 | `client/data-controller.ts`、`MarketPage.tsx`、`InstallPlanDialog.tsx`、`TaskDrawer.tsx` | 终态同步库存、按目标拒绝旧回包、单任务AI、无假成功 |
| AI诊断及确认 | `host/{diagnostics,ai-assist,ai-proposal-store,management-impact}.ts` | 无工具模型、有限事实、持久提案、精确范围、风险挑战、未知结果不重放 |
| 双扩展 | `client/extensions/` | 一合同两适配、五类私有位置、逐贡献清理；同JS环境不是安全沙箱 |

上表 `src/` 相对 `packages/market`。作者发布CLI在 `scripts/catalog/`；团队资料模板在 `catalog-source/`；独立扩展示例在 `examples/market-extension/`，不属于生产默认目录。

可选模型服务按调用时查询，缺模型不影响普通市场。AI 的危险操作审查记录必须与当前制品摘要相符；没有足够依赖和数据影响证据时只阻断对应建议。来源证明不是对安装后的每个文件做持续完整性监控，市场锁也不是所有外部工具共享的原子事务。
