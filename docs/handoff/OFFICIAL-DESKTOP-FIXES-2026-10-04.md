# 官方 Desktop 问题修复与复验

日期：2026-10-04（Asia/Shanghai）。分支 `refactor/market-core-adapter`，HEAD `9c6a1d22aa6b6e666172c81e1f1fbdd3517b059b`，保留未提交修改；未 commit、push 或发布。本报告更新 2026-10-03 的问题结论，不覆盖原始失败证据。

## 结论

本轮发现并修复的冷启动、作者错误泄露、隐藏作者页列表不刷新、README 网络读取问题，已在实际官方 Desktop **0.2.0-rc.2** 的全新隔离批次完成对应复验。公网目录刷新、登记制品下载/校验/官方安装、启用/停用/卸载和同键返回原结果均有实机证据。**仍不宣称全部功能通过或允许正式发布**：原指定 rc.1、正式公网 Core 分发/整包升级、AI 正向、真实皮肤切换、读屏/DPI 等尚未完成。

官方程序及 asar 未修改，日常 Profile 未修改；未关闭 SSRF、供应链限制、摘要验证、幂等或前端确认门槛。后端仍提供 API 与真实业务事实，列表加载/离开确认/本地 dirty 内容保留归 Client。

## 根因与修复

### 1. 冷启动：验收 Registry 依赖包损坏，不是 settings 接口冲突

Host 内注册器订阅捕获 settings/describe 注册后撤回；继续捕获 Fiber 错误，明确为 typert-loader 启动 AggregateError：市场 `./typert` 导入遇到隔离 `node_modules/zod/v4/package.json` 的 Invalid package config。此前缺少此聚合错误，不能用旧报告中的猜测归因。

实际 Zod 840 文件中 176 个为零字节。测试 Registry 直接在 pnpm 安装目录 npm pack；相同内容的文件使用 tar type1 硬链接，官方安装现场将相应条目落为零字节，v4/package.json 因此不可解析。并非 Zod 版本不匹配，也无需修改官方 Typert fallback。

修复只在验收工具：`package-fixture.mjs` 将 regular 文件逐个读取字节、独占写入 staging，断开 inode 共享再打包；拒绝符号链接/越界/覆盖，核验归档文件集合与源字节、禁止链接条目。zod、semver、noop 使用同一路径。14 项定向测试通过，最终官方安装的 v4/package.json 为有效 127 字节，完整冷启动后工作区与 EAC 页面正常。

### 2. 作者错误：原生 fs/JSON/URL 异常穿过业务边界

draft/media/package 的存储与解析操作转换为安全的领域错误，保留 not-found、validation、revision conflict、媒体归属和损坏事实；业务异常与其他程序异常不被吞并。领域错误不携带实现栈。44 项脱敏测试覆盖缺失、损坏、目录异常、写入失败和异常身份；实际 Remote 缺失草稿/媒体请求不再出现 Profile 路径、ENOENT 或 node:fs。

### 3. 作者列表：挂载读取不等于显示时刷新

MarketPage 向长期挂载的 AuthorWorkspace 传 visible；Client 在再次显示时请求草稿列表，用独立代次丢弃迟到回包，区分加载、失败、不支持和真正空列表。显示切换不重新初始化编辑表单，不覆盖 dirty 内容；Remote 更换才重置。保存/导入更新列表同时失效旧请求。16 项实际 React/隔离 Edge 竞态测试和最终官方界面验证通过：隐藏时后台新增草稿，返回后列表出现，未保存标题仍保留。

### 4. 网络：分别验证安全分类、实际来源和 Registry

2026-10-04 的实际官方 Host DNS 返回 Gitee/API GitHub 的公网 record 数组，使用同源码安全 gate 可通过；raw.githubusercontent.com 则 DNS 失败。旧批次 private-address 的当时 DNS 地址未采集，**无法确定其历史根因**，不能把现在公网通过写成旧错误一定来自某个解析形状。本轮未改 private-address 判定，也未放行私网。一次诊断请求超时保留为失败；后续实际市场目录刷新成功并 stale=false。

README 原先固定 commit 后从 raw 域读取；该域在本机不可解析。默认 transport 改为严格校验内部固定 SHA raw 坐标后，从同仓库/路径/完整 SHA 的 GitHub Contents API raw media 读取。继续执行 safeFetch DNS/HTTPS/重定向/时限/体积门槛，不引入浮动分支、token 或任意代理；注入 RemoteBytesReader 的合同保持。71 项 transport 测试与最终实际 README 预览成功。API 的 403/429 等真实失败不伪报成功。

隔离 Registry 的 Custom address 只用于一次安装，没有为后续官方 pnpm 解析顶层市场依赖持久设置。实机已证明制品下载与摘要通过，但官方安装因市场 Registry 404 在写入前失败。仅经审批在新测试 Profile 新建 `@dsh-eac:registry` 指向其 loopback Registry，再重新预检确认新操作；原失败记录和原幂等键保留。最终 completed、官方 installed/enabled 及摘要一致。管理卸载 applied 后库存不存在；重复同键返回原回执，不再次发起写入。旧 b1 unknown 卸载未重放。

## 最终载体与制品

- 官方 Desktop：`G:/Deepseek Harness Desktop/DeepSeek Harness.exe`，0.2.0-rc.2，build `04f392c9ddd144fa426da2045178797da6db6c11`，dirty=false；DSH 核心仍读取官方 getter，不用 Desktop 号作 fallback。
- 原失败现场保留 `D:/eac-market-verify/desktop-20261003-rc2-b1`。中间复验 `desktop-20261004-rc2-b2`；最终新 Profile 为 `D:/eac-market-verify/desktop-20261004-rc2-b3`。
- b3 未注入诊断插件；通过官方 Plugins/Add plugin/Custom Registry 安装。测试 Registry 输出在既定可写 visualizations 下 `desktop-market-registry-readme-fixed-20261004`，不是正式发行地址。
- 最终 Core0.1.6 tgz SHA256：`bb06648a4f40ece13be52725673c755bd06784ba1b3abaa55314ae20b5d52160`。
- 最终 Adapter mvp.17 tgz SHA256：`81e6b579e9f2aa18fca7a2d08e6e8f40748652dacd4fdcf0c9a9f764c359e6e1`。
- Zod4.6.5 tgz SHA256：`8015321552bb45f46999a161ae91317b6a46c54f42e92effae74f1db6aabbc04`；SemVer7.8.5 SHA256：`33f452926467176e4833ea0b720be730fe42c15b7cd143aa6397a56d19add34b`。
- 最终实际安装的 8 个 Host/Client/Typert/Core/目录文件与 workspace build 字节吻合。同版本测试制品仅用于隔离本机，不改已发布内容；正式交付需新版本与完整发布手续。

## 验证账本

- `node scripts/build.mjs`、`node scripts/lint.mjs`、`node scripts/verify-package.mjs`、`git diff --check` 通过。产品 Host/Client 类型检查随串行 build 通过。
- 最终完整 `vitest run --maxWorkers=2`：**1404 passed / 0 failed / 2 skipped**，统一 JSON 为 `.verify/desktop-rc2/fix-final-full-tests-corrected-20261004.json`。测试是源码/合成合同证据，不替代实机。
- 中途 sandbox 全量曾受 D: 写权限及 scheduler 资源争用影响；后续审批完整运行通过，不删除失败记录。Edge launcher 后来以0退出但隔离子进程已生成 DevToolsActivePort；测试改为等待实际 CDP、非0立即拒绝，原16项断言不变。首次启动失败与纠正报告分别保留。
- 额外 `tsc -p tests/client/tsconfig.json` 仍有5项既有测试夹具/模块解析报错：action-state、activation、browser-fixture、data-controller、protocol-guard。本轮未越界修复，不宣称该额外测试配置通过。
- 最终实机 JSON：`fix-final-official-checks-20261004.json` 的6组对应检查通过；`fix-final-artifact-install-20261004.json` 记录公网下载10083字节、摘要/官方安装 completed、重复同 taskId、库存enabled；`fix-final-management-20261004.json` 记录停用/启用/卸载与幂等；`fix-final-task-ui-20261004.json` 为真实 TaskDrawer 的已完成1/1与8条历史；`fix-final-installed-byte-comparison-20261004.json` 为字节比对。均位于工作区 `.verify/desktop-rc2`，不提交带 token 的原始启动日志。
- b3 第一次紧接关闭后重开曾退出，官方日志出现 inactive context；待该实例退出后同制品再次冷启动通过。此失败记录保留，未修改官方或添加任意延迟补丁；其确切关闭竞态根因尚未确认，不称所有重启方式均已通过。

## 剩余工作与第一步

发布仍需正式 Core 来源、完整升级/回退和原指定载体验收；AI、皮肤、原生缩放/读屏/forced-colors 继续按功能矩阵列待验。releaseContext、原操作恢复查询与前端版本选择流程仍未完成，不与本次缺陷修复混称交付。

下一位先读本报告并核对工作区；不要复用失败 b1 的损坏 Zod、不要关闭官方 blockExoticSubdeps。先补正式发行渠道与既有未知操作的只读恢复，再推进剩余版本选择合同/Client。测试 Registry 包与 Profile 仅本地验收资料，不能发布或作为用户下载入口。

收尾：仅按 session/命令行核验停止本轮 b2/b3 Desktop 与两处 loopback Registry，保留 Profile/制品/失败记录。复用制品可用 Registry 的 `--serve-existing`，先核验所有摘要，不重新覆盖打包。诊断 `trace-host.mjs` 使用本轮生成的 `.verify/desktop-rc2/security-probe.mjs`（从 security.ts 用现有 esbuild 独立构建）；它不属于正常产品或 CI，也未进入 b3 Profile。
