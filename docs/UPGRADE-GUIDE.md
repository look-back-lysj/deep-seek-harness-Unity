# EAC 市场最新版升级指南

当前源码候选：桌面适配器 `@dsh-eac/market@0.1.0-mvp.19`，核心包 `@dsh-eac/market-core@0.1.6`；上游Registry与GitHub固定地址双通道预备包位于 `releases/0.1.0-mvp.18-dual/`，其字节不包含本轮合并后的全部修复，不得覆盖或冒充本轮候选。npm Registry发布与合并后新字节的官方Desktop实机验收尚未完成；普通用户的可安装发行版仍为 `0.1.0-mvp.9`。本文件是当前唯一升级操作指南，历史报告用于追溯，不作为当前安装说明。

2026-10-05当前Git交付见[详细开发者交接](handoff/DEVELOPER-HANDOFF-2026-10-05.md)和[详细修改记录](handoff/MODIFICATION-RECORD-2026-10-05.md)。两次正常合并均有逐文件记录；最新mvp.19全量1906/0/2既有pending、合成browser60/60，build/额外Client tsc/lint/包边界通过；独立布局审计被中断，新官方字节及unknown迟到回执追账待验。以下管理/媒体实机结果仅属于历史不可变候选，不能自动继承给本轮源码。GitHub分支推送不等于公开包发布。

2026-10-05最新管理候选见[管理业务实施实录](handoff/MANAGEMENT-BUSINESS-IMPLEMENTATION-2026-10-05.md)：Core/Client业务回执与原意图恢复完成，最终1866/0/2既有skipped、browser49/49；新官方rc.2隔离安装Core95/95、Adapter96/96一致。官方API管理4组、冷启动只读3组、实际UI管理3组最终核实通过；真实卸载展示超时后保留原key并只读恢复。一次正常退出/冷启动通过，历史退出失败未消除。只属于该本机不可变候选，不是公开发行、原指定rc.1或自然断线cold-start全验收。公开真实媒体源已核实但索引超限、DSH范围/版本/制品映射仍缺；来源未激活。

此前媒体候选详见[媒体实施实录](handoff/AGENT-FORGE-MEDIA-IMPLEMENTATION-2026-10-04.md)：Core94/94、Adapter92/92一致，1796/0/2既有skipped、媒体专项198/0、browser49/49。目录/README两阶段通过但默认目录无media，首次正常退出失败；保留原证据，不混用为最新管理制品结果。原指定rc.1、适配升级/降级、真实任务恢复、官方媒体正向及正式渠道仍待验；不替换mvp.9或授权覆盖日常Profile。

## 2026-10-04 当前源码补齐

版本选择上下文、只读恢复 API、Client 默认适配升级/有效手选/未知提交恢复、TaskCard 在途锁和目录只读核对已补齐。该历史源码批次完整1598 passed / 0 failed / 2 skipped；通用隔离浏览器49/49，build/Client测试tsc/lint/包边界通过。详见 [剩余任务与执行账本](handoff/REMAINING-WORK-2026-10-04.md)。该源码批次结束后已先后安装版本上下文候选及媒体候选，具体字节与结果分别见对应实录，不能混用；均未发布。管理完整业务恢复、正式双包渠道/升级/回退仍待完成，不能把同版本候选源码变化当作发行升级。

## 2026-10-02 本机方案 A 修复候选

2026-10-04 更新：对应冷启动/作者/README 问题已修复，并通过全新隔离官方 Desktop0.2.0-rc.2 复验；最终源码完整测试1404 passed / 2 skipped。详见[修复验收](handoff/OFFICIAL-DESKTOP-FIXES-2026-10-04.md)。仅测试制品，不替换正式mvp.9入口；正式公网Core、整包升级及原指定rc.1等仍待验。

market mvp.17 / Core 0.1.6 已通过串行构建、736 项测试（另 2 项固定协议跳过）、类型与包边界；合成浏览器 48 项通过。此次未增加公开 Remote/G0 合同，也未授权旧皮肤兼容或改变其他用户插件。

本机包已准备在 D:/eac-market-user-trial/20261002-175408-fixA/packages/，已按用户确认覆盖并正常重启：真实官方首页海报/读取通过，但实际安装预检仍被四个旧皮肤相关身份阻断，不能算完整修复验收。adapter 绑定此目录的 Core tgz，安装后试用期间不得移动/删除该目录；它不是公网发行包。官方 desktop Profile 必须通过 Electron 插件管理器安装，不可用 CLI 绕过 desktop guard。正式用户入口仍是下文 mvp.9，不以本机候选替换。

## 用户当前可用的升级入口

1. 从 [Gitee 发行站](https://gitee.com/flowing-shadows-like-scenes/deep-seek-harness-unity-mirror) 复制当前正式版本的固定安装包地址，在官方 DSH 的「插件 → 添加插件」中安装。当前正式版是单包 `0.1.0-mvp.9`，不需要独立 core。

固定下载地址（当前正式版 mvp.9）：

https://gitee.com/flowing-shadows-like-scenes/deep-seek-harness-unity-mirror/raw/dbeb4b7f0e655f7bdd299a8e40d59af83f0e7da0/artifacts/sha256/a8856180264fea4ba949ac6505c10a71bbf512cfa0dda253992994711904be7c/dsh-eac-market-0.1.0-mvp.9.tgz
2. 完整退出 DSH，再重新启动，让新的 Host、Client 和 Remote 描述符同时加载。
3. 打开 EAC，确认「发现 / 全部插件 / 我的插件」三个主导航可用。
4. 在「我的插件」确认市场版本与发行站公布的版本一致，且由官方插件管理器管理。

下面的双包流程面向维护者。`mvp.11` 只有在公网 core 依赖、隔离 Desktop 新装和旧版升级均验收并正式发布后，才能替换普通用户的安装入口。历史 Desktop 证据不代表新双包已通过。

双包实现保留当前 profile（DSH 的独立用户环境）的 `eac-market` 数据目录、任务记录、作者草稿、目录接受历史和持久化格式。实际整包升级仍待验收，不可据此推断任意旧版本都可无损升级或降级。

升级前停止旧执行器并备份数据。任务摘要 schema3 可读旧 schema1/2，首次写前保留旧摘要备份；旧程序不理解 schema3，不能直接降回旧程序继续写。旧计划缺少来源或连接绑定时重新预检；回执未知的任务不重放，不删除记录来解除写入阻断。目录接受历史用于防止旧源覆盖已知撤回，不得清空。

## 双包结构

| 包 | 当前版本 | 作用 |
| --- | --- | --- |
| `@dsh-eac/market` | `0.1.0-mvp.11` | 官方 DSH bundle、桌面 UI、Cordis/Typert 注册、连接协商和随包目录 |
| `@dsh-eac/market-core` | `0.1.1` | 目录、预检、任务、下载校验、作者资料、AI 提案和官方适配门面 |

正式双包发行采用只安装桌面适配器的方式，由官方包管理器取得 core；core 自身不是独立 DSH bundle，不能单独填入官方插件安装框。发布新 core 不会自动更新用户已有安装，adapter 依赖变化仍需发布匹配版本并重启验证。

core 的安全入口不会启动 Node、React 或 DSH 服务。需要官方运行时的调用只能通过 `@dsh-eac/market-core/dsh`，由桌面适配器传入当前 profile 身份、数据目录和 `data/index.json` 原始字节。禁止通过相对路径猜测目录。

## 接口和版本

- Core API 版本：`1.0.0`。
- 页面通信协议：`2.0.0`。
- npm 包版本与 Core API、通信协议分别管理，不能混用。
- 每个页面写操作都先执行 `hello → clientConnect → 实际调用`。
- Host 用官方传输连接的真实 peer 身份登记连接；协议不兼容、连接过期、断线重连或握手失败时禁止写入。
- 旧页面必须刷新或重启，不能继续使用旧 Remote 连接。

公开接口、目录结构、生命周期和 TUI 预留边界见 [Core / Adapter 底座指南](CORE-ADAPTER-GUIDE.md)。公开 API 只使用包 `exports` 中的入口，不直接导入 `lib` 或另一包的源码路径。

## 维护者升级

先读取当前工作树、官方 DSH 版本和 [当前接手入口](handoff/START-HERE.md)，再修改对应层：

- UI、导航、作者工具和皮肤中心：`packages/market/src/client`。
- DSH 服务注册和协议协商：`packages/market/src/index.ts`、`session-gate.ts`、`version.ts`。
- 业务规则和持久化：`packages/market-core/src/core`、`host`、`persistence`、`authoring`。
- 官方管理器和版本差异：`packages/market-core/src/adapters/dsh`。
- 公共合同：`packages/market-core/src/contracts`，改动后重新生成 Typert。
- 构建与发行：`scripts/build.mjs`、`scripts/pack-release.mjs`。

多人协作时先冻结合同和文件 owner；构建、打包、官方 Desktop 验收只能由主控串行执行。不要修改官方源码、EAC 组织仓或用户日常 profile。

## 构建和验证

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
pnpm pack:release --out-dir D:/eac-market-verify/release-candidate --core-url "https://发行主机/固定提交/artifacts/sha256/{sha256}/{filename}"
```

上面的 HTTPS 地址是参数示例，必须替换为实际固定地址。也可用 `--registry-core` 生成精确版本依赖候选，但该参数不检查公网包仓库是否已发布 core。发行脚本只准备候选，不上传文件、不修改 npm 配置，也不证明远端可用。官方 DSH 的 `workspace:*` peer 必须保留，只有本地 core 依赖会在隔离 staging 中转换。

双通道发行包位于 `releases/0.1.0-mvp.18-dual/`。A 通道使用 `--registry-core`，B 通道使用固定 GitHub commit 的 `--core-url`；用户始终只安装 adapter。实际官方安装可使用：

```powershell
node scripts/verify-split-install.mjs "D:/实际官方解包runtime目录" "D:/eac-market-verify/全新输出目录"
```

两个目录均需替换为实际路径。该脚本使用本地测试源、空缓存和独立 `DSH_HOME`，验证只安装桌面适配器时 core 会被自动取得。它不能替代公网下载、正式 Desktop 升级、跨平台或 TUI 验收。默认检查不依赖本机外部源码；可选协议测试的跳过必须单列，不计为通过。

## 内容、协议与存储维护

- 修改介绍只更新 Presentation 和内容摘要，不改技术 Manifest、既有制品摘要或历史 Evidence。新插件和新版本依照 [作者指南](contributing/AUTHOR-ONBOARDING.md)、[目录维护](contributing/CATALOG-CONTENT.md)、[镜像发行](contributing/DISTRIBUTION.md)；真实许可、源码提交、制品和宿主验证缺一不可。
- 新镜像必须是同一制品的相同字节，来源预先登记；同包同版不同摘要不得作为备用镜像。离线不能推断新的撤回。下载失败不等于插件不存在，不静默修改全局代理或 npm 源。
- 套餐 Pack 与锁定版本的 Lock 成对维护；市场私有执行依赖还要绑定 Lock 摘要。安装完成、启用配置和实际运行分别核验，需重启的依赖不得提前放行；升级、降级和启停意图要重新展示并确认。
- 只有已核实完整依赖图的套餐才允许一键执行；partial 或 unknown 依赖保持阻断。Lock 改变会使旧执行记录失效，不能把“包已在磁盘”当成依赖已满足。
- 官方 DSH 升级先核对接口与真实回执，再调整适配层和合同；版本准入测试不等于运行兼容。不得修改官方源码来消除不兼容。
- 公共 Mojobox/dsh-std 协议按原仓规则升级，不为市场便利重解释字段。内部格式变更要明确版本、迁移、旧样本和失败恢复；保留旧记录与历史计划，不清空坏数据。
- 本版作者工具仅本地编辑和导出，不等于线上投稿或上架；作者提交走 [Agent 投稿指南](contributing/AGENT-SUBMISSION.md)。扩展按 [公开扩展契约](../packages/market/src/client/extensions/README.md)，不能替换核心安装确认。在线平台、自动 Star 和完整 TUI 均不属于已交付功能。

## 发布与回退

先固定并验证 core 的真实来源，再生成精确依赖它的 adapter。最终源码提交、依赖、两包 SHA256 和安装证据逐一对应；README 等随包文件变更也会改变制品。不得覆盖已发布的同版本字节，不得把本地 test-only 包或 dirty 报告当干净发布证明。

保留已有不可变制品和验收记录供诊断；当前 README 和本指南只提供一套有效操作入口。回退必须走官方管理流程并核对存储格式，插件回退不等于配置或数据恢复。市场不在运行中卸载自己，不承诺任意降级或完整文件回滚。

## 发布前检查

- [ ] 两个包的版本和 core 依赖精确匹配。
- [ ] `pnpm check`、`pnpm typecheck`、`git diff --check` 通过。
- [ ] `verify-package.mjs` 确认 core 未被合进桌面 Host，Client 未引入 Node 后端。
- [ ] 最终 tgz、源码提交和 SHA256 已绑定；同版本不同字节不得覆盖。
- [ ] 官方隔离 Desktop 完成最终包新装、旧版升级、启动、完整重启和关键页面检查。
- [ ] 从公网实际获取 core 并校验字节摘要，验证来源失败时不会假成功。
- [ ] 同 profile 并发、用户停用状态、本地 fork、缓存引用均已检查，没有把局部状态误报成全局成功。
- [ ] 产物、日志和测试资料不含凭据、真实 profile、测试默认数据或无许可素材。
- [ ] 未验证的平台、第三方业务、公网 core 源和 TUI 如实标记 `partial`。
