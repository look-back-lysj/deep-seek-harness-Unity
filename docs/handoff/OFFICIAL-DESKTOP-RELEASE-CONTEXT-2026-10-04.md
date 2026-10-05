# 新版本选择与恢复 API 的官方 Desktop 安装复验

验收日期：2026-10-04 UTC；启动时间 `2026-10-04T16:40:47.625Z`（北京时间为 2026-10-05 00:40:47.625）。隔离批次及脚本标签为 `20261005`，下面的时间和结果以实际证据为准。分支 `refactor/market-core-adapter`，HEAD `9c6a1d22aa6b6e666172c81e1f1fbdd3517b059b`，带既有未提交源码修改；不是 HEAD 原始字节或正式发行验收。

## 结论

已将当前构建通过官方 Plugins / Add plugin / Custom Registry 安装并启用到**新的隔离官方 Desktop Profile**。本批新字节的正常退出后冷启动通过；新版 API、未知范围/过时目录的真实界面保护、作者本地操作、隔离 no-op 插件的官方管理与原回执恢复通过。**公网正向安装与适配升级/降级仍未验收，发布仍阻断。**

本机当前 DNS 将 Gitee / API GitHub / raw GitHub 解析到 `198.18.0.0/15` 和 `2001:2::/48` 保留地址；实际市场返回安全拒绝并继续保留 stale 缓存。因此目录刷新、README 预览以及需新鲜目录/公网制品的正向流程不能算通过。没有放行保留地址、绕过 SSRF、篡改目录 stale、改 hosts、改代理配置或降级官方供应链保护。已向用户请求网络配置调整许可；本报告记录时尚未获得答复。

这与上一批公网通过不矛盾：旧报告只代表当时环境与当时字节，不能覆盖现在的 DNS 或候选制品。当前系统 Node DNS 证据与实际市场拒绝相互印证，但本批没有向官方 Host 注入 DNS 诊断插件，因此不能冒充官方进程内 DNS 地址的独立采样。Fake-IP 代理为有依据的环境推断，未确认具体代理产品或其配置文件。

## 载体、Profile 与字节

- 官方可执行文件：`G:/Deepseek Harness Desktop/DeepSeek Harness.exe`。
- 实际 Desktop：`0.2.0-rc.2`，官方 build `04f392c9ddd144fa426da2045178797da6db6c11`，dirty=false。**不是原指定 rc.1**。
- 隔离 Profile：`D:/eac-market-verify/desktop-20261005-rc2-b1/harness/profiles/desktop`；独立 Electron userdata 和包存储；webserver / CDP / Registry 仅 loopback。
- Adapter：`@dsh-eac/market@0.1.0-mvp.17`，tgz SHA256 `1c59013b10e35630674d31ab6be219b0468723beec0904605cb019cb346b1624`。
- Core：`@dsh-eac/market-core@0.1.6`，tgz SHA256 `8841f38404d44a392559850added48e475c6d14fd360fcd6c6053322dd1d693f`。
- Test Registry：`http://127.0.0.1:63223`。仅新测试 Profile 的 `.npmrc` 设置 `@dsh-eac:registry` 到该地址，避免后续官方 pnpm 解析测试市场依赖时误用公网 Registry。它不是正式安装地址。
- Registry/制品留存目录：`C:/Users/metaone/.codex/visualizations/2026/10/03/01a0ffdb-e738-7783-922b-fab830004ed0/desktop-market-release-context-20261005`。使用 regular-file staging，没有退回 pnpm 硬链接直接打包。
- 从不可变 tgz 逐文件比对：Core **93/93**、Adapter **88/88** 已安装文件完全一致；两包全部已打包 `lib/` 文件与当前工作区构建一致。不能仅凭版本号相同推断字节相同。
- 原始 Desktop 启动日志可能含本地访问 token，仅留在隔离批次，不复制进报告或提交。

同版本的新字节仅供本地隔离试验，**不得覆盖公开发行的既有版本**。普通用户正式入口不变；本批没有 commit、push 或发布，也没有修改官方 asar、组织仓或日常 Profile。

## 本批实际检查

| 项目 | 实际结果 | 证据等级与限制 |
| --- | --- | --- |
| 官方安装与启用 | 通过，EAC 入口和真实 MarketPage 渲染 | 官方管理器真实 UI；不等于公网发行渠道通过 |
| 安装字节 | Core93/93、Adapter88/88 与 tgz 一致；lib 与当前构建一致 | 全包逐文件比对 |
| hello / 核心 / 新能力 / 目录 / 库存 / 恢复查询 | 首次与冷启动后均 11 passed / 0 failed / 9 unknown | 真实 namespace、API-only；9 unknown 是历史、范围与分页未触达，不计通过 |
| DSH 核心 | known，`0.2.0-rc.2`，source=`dsh-runtime-getter` | hello / hostCore / releaseOptions 一致；renderer 未独立调用 Host getter；Desktop 与核心号本次恰相同，不代表可以互换 |
| 目标包版本事实 | `dsh-settings-scroll-fix@2.0.2`，范围 unknown、历史 unknown、库存 absent、目录 stale | 没有声明被伪造为 compatible；没有全历史/全网最新断言 |
| 新版安装确认窗口 | 通过保护检查：显示实际核心、unknown 范围；stale 时无默认选择、select/确认禁用、零任务 | 真实 UI 与截图；不是默认适配升级、手选后绑定或成功安装验收 |
| 页面主路径 smoke | 纠正后 8 passed / 0 failed / 1 blocked | 真实官方 DOM：发现、搜索、计划取消、库存、任务抽屉、帮助/设置、持久草稿、返回；皮肤正向 blocked |
| 已安装市场挂载 / 作者缺失对象脱敏 / dirty 保留 / 列表刷新 | 4 组通过（市场挂载1组、作者3组），创建的隔离草稿冷启动后仍存在 | 真实 UI + API；旧脚本草稿标题中的20261004是固定测试标签，不代表跨批复用 Profile |
| 目录刷新 / 网络 README | 两组 blocked，真实安全拒绝 | 不能沿用旧报告通过，也不能用 UI 已显示缓存抵消公网失败 |
| 官方 no-op 插件安装 / 启用 | 通过，官方 Custom Registry UI | 明确是测试 fixture，不是目录公网目标包 |
| no-op 停用 / 启用 / 卸载 / 原键恢复 / 意图冲突 | 4 组通过，三项管理为 applied，库存符合；错误意图查询被拒绝 | 管理为 API-only，真实官方 pluginManager 执行；未替代 Client 管理恢复闭环 |
| 管理业务结果 | 恢复 receipt=applied，但 result=unknown | 正确保留 `management/business-result-unavailable`，不是完整业务恢复通过 |
| 正常退出后冷启动 | 本批一次通过；先确认原主进程和此 userdata 进程全部退出 | 同 Profile / 同安装字节；不是旧 inactive-context 根因已修或所有关闭方式通过 |
| 跨冷启动原管理回执 | 三项 found / settled / receipt applied / result unknown，卸载 fixture 未复活，零任务 | 只读原 request/key，没有重放写入 |
| 原安装开始恢复正向 | 未验 | 仅不存在身份的 not-found 安全检查；本批未产生真实安装 task，不能宣称 recovered task 通过 |

后端返回目录/范围/身份/库存事实与回执；默认选择、弹窗、loading、等待、取消和恢复提示仍在前端。实机探针没有把 UI 中间态注入后端结果，也没有修改产品协议。

## 验证命令与失败保留

安装前重新运行 `node scripts/build.mjs`、`node scripts/lint.mjs`、`node scripts/verify-package.mjs`、`git diff --check`，均通过。包检查为 Adapter88文件、41个Remote；这个数不是实机通过功能数。

本轮针对版本上下文、只读恢复、库存摘要和选择规则的八个测试文件：**144 passed / 0 failed / 0 skipped**，见 `focused-regression.json`。上一批完整 **1598 passed / 0 failed / 2 skipped** 和通用browser49/49是同一候选源码的既有证据，**本批没有重新运行整个全量测试，不混算为本次结果**。

新增三个验收脚本，均为测试工具、不接入正常 CI、不打入产品包：

- `tools/desktop-acceptance/release-api-checks-20261005.js`：子智能体独占开发，只读真实 namespace；不写、不选择默认版本。
- `tools/desktop-acceptance/management-recovery-checks-20261005.js`：主控串行写入已批准隔离 no-op 插件，只读查询原请求，保留业务 unknown。
- `tools/desktop-acceptance/release-ui-smoke-20261005.js`：真实 UI 导航及无执行写入的安装确认保护检查。

首轮 UI smoke 为7 passed / 1 failed / 1 blocked：脚本点击“更多”后未等待 React 导航完成便查找“设置”。手动实际导航可用，已把探针改为有界等待可见入口；未修改产品、降低断言或把失败删除。纠正报告另存8/0/1，原失败报告保留。一次 CDP 选择器误把 portal 弹窗当成市场子节点、一次表达式缺 async 以及 node_repl 的受限 process import 均为工具执行错误，已纠正；不能把它们当产品缺陷或整个工具通道故障。

## 证据位置

工作区 `G:/Code/fork/agent-market/.verify/desktop-20261005/`：

- `session-first-launch.json`、`session-cold-launch.json`、`first-exit-confirmed.json`：真实官方身份和正常退出。
- `installed-byte-comparison.json`：181个文件的长度、摘要、安装及构建比对。
- `release-api-initial.json`、`release-api-cold-start.json`：两阶段只读结果与 unknown 原因。
- `target-release-initial.json`、`ui-stale-catalog.json`：真实目标版本与禁用/未知文案保护。
- `official-regression.json`、`dns-shape-current.json`：4组通过、2组网络阻塞及系统 DNS 采样。
- `official-noop-install.json`、`management-original-recovery.json`：官方 fixture 安装和原管理请求/回执/后置库存。
- `cold-start-original-recovery.json`：冷启动后不重放的原管理回执、草稿和库存核对。
- `official-ui-smoke.json`、`official-ui-smoke-corrected.json`：首轮失败与纠正结果。
- `focused-regression.json`：144项源码回归，非实机。
- `final-cleanup.json`：本轮隔离Desktop正常退出code0、userdata对应进程清零、唯一对应Registry停止；Profile和制品保留。

截图留在新隔离批次根目录：`market-installed.png`、`install-dialog-stale.png`、`market-cold-start.png`。已人工查看首页和新版确认窗口截图，没有据此宣称读屏、DPI或全主题矩阵通过。

## 下一步与停止边界

1. **RW-14 / 网络环境，先取得授权。** 确认代理/DNS实际配置，在用户允许的范围为目录、README及制品域名提供真实公网解析；不要用关闭 SSRF、写死IP、任意代理或伪造 fresh 代替。恢复后重新采 DNS、真正 refresh 到 stale=false，再运行真实版本选择→预检绑定→确认→公网下载/摘要→官方安装→原键只读恢复。
2. **RW-03 / 数据前置。** 当前真实目标没有核心范围和完整历史；即使网络恢复也不能验证最高适配升级或降级。取得有可靠范围、版本历史和可安装制品的合法样本，不改官方版本或伪造上游事实。
3. **RW-13 / 管理完整闭环。** 在现有耐久记录内补维护结果，再由 Client 保存原意图/key并只读恢复；本批确认 API 会诚实返回业务 unknown，不能将它当最终交付。
4. **RW-08 / 原指定载体。** 可信rc.1仍未取得；本次rc.2正常退出冷启动通过不能关闭旧关闭竞态或替代原指定验收。
5. **RW-07、RW-09～RW-11。** 正式渠道、新发行号、整包升级/回退、组合/依赖、皮肤、AI正向、无障碍/DPI/真实图片和目录数据缺口继续待验。任何发布、日常Profile或网络配置变更仍需相应授权。

收尾已通过CDP正常关闭本轮隔离Desktop，确认退出code0、主PID及userdata对应进程清零；按完整命令行核验仅停止本轮唯一Registry，保留制品、Profile、失败和原回执。新增脚本语法、最终lint和diff检查通过。下一次复验用 Registry `--serve-existing`先核验摘要、Desktop `--resume`先确认原实例退出；**不要重新执行管理写探针复用旧键制造新操作**，跨重启只能查询保存的原请求。
