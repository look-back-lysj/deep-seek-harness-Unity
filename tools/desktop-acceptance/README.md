# Desktop 验收工具交付说明

本目录供主控在**另行授权的隔离验收批次**使用，不是正常 CI、正式发布脚本或无人值守安装器。保存源码、离线测试通过、探针返回 `officialDesktop: true` 均不能证明官方验收通过；须另有载体身份、安装字节、真实 Profile、进程、原操作及结果证据。本说明不授权启动、联网、打包或写入 Profile。

## 前置条件与隔离约束

- 仓库依赖已按锁文件准备，使用项目要求的 Node >=24、pnpm；不要为本目录另装库。`trace-host.mjs` 和 `source-audit-20261005.mjs` 直接导入已跟踪的 Core TypeScript 源码，需要支持 TypeScript type stripping 的运行时。Node 离线通过不证明官方 Electron loader 支持这条源码导入链，Host 加载须主控单独确认。
- 官方 Windows Desktop 由主控核对安装来源、版本和构建标识；`session.mjs` 读取 `app.asar` 包名和元数据，不是签名认证器。rc.2 批次证据不能替代原指定 rc.1 验收，按当前目标分别记录。
- 每批使用新的 `D:/eac-market-verify/desktop-<批次>`。`DSH_HOME` 指向本批 `harness`，Electron `--user-data-dir` 指向本批 `electron`，store 指向本批 `store`。绝不连到真实用户 Profile、其他运行实例或共享缓存。
- CDP/Host inspector 只连本批 loopback 端口。执行前检查 `session.json` 的 batch、可执行文件、PID、实际进程命令行和 Profile；JSON 的 `testOnly` 不能替代这些核对。
- 候选 Registry 只在 `127.0.0.1` 提供本批制品，记录 name/version/SHA256/URL；主控单独核对 Core、Adapter 与安装字节。不得更改官方 packageManager 安全门、TLS 或用户 Registry。loopback Registry 仅供官方安装器隔离验收，不表示 Core 远端读取允许私网。
- 官方启动、候选安装、草稿/策略/任务/管理写入和网络取证须各自授权并串行运行。浏览器 `.js` 是 CDP `Runtime.evaluate` 表达式，不是 Node CLI，不得批量执行目录内全部文件。

## 工具用途与副作用

| 工具 | 用途、输入与边界 |
| --- | --- |
| `session.mjs` | `<batch> [--loopback]` 创建隔离环境、读取官方包元数据并启动 Desktop，输出 `session.json`、进程日志、`exit.json`。`--loopback` 写本批 webserver patch；`--resume` 仅复用已记录批次，不等于全新安装，也不保证没有现存进程。启动须另行授权。 |
| `registry.mjs` | `<output>` 调用现有 `prepareRelease` 准备 Core/Adapter，打包已安装的 zod、semver 和 noop fixture，启动 loopback 候选 Registry。会打包、写制品及请求日志，输出 `registry.json`。`--serve-existing` 按保存的摘要重供同批制品，不重新准备候选；端口、制品和进程仍须核对。 |
| `artifacts.mjs` | `<batch> [output]` 检查隔离 session 后调用 `prepareRelease`，启动 loopback tgz 服务，输出 `artifacts.json`。这是直接制品 URL 辅助路径，不是 Registry 元数据服务，也不是公开发布。 |
| `package-fixture.mjs` | 导出 `packPackageFixture` / `readFixtureArchive`，建立独立 staging、调用 npm pack 并核对归档；拒绝链接目录、越界路径、tar 链接及源/输出重叠。会写 staging/制品并启动 npm 子进程；不是纯只读测试。已有测试为 `tests/adapter/desktop-package-fixture.test.ts`。 |
| `fixture-plugin/` | `eac-market-acceptance-noop@1.0.0` 的空 `apply()` 插件及 bundle patch；只用于隔离安装和管理写探针，绝不发布，也不代表真实第三方插件。 |
| `cdp.mjs` | `<batch> <command> [input] [targetId]` 连接本批端口。`list` 列目标；`shot` 写截图；`call` 发任意 CDP method；`host` 在 Host inspector 执行表达式，`eval` 在页面执行，`@文件` 从源码读取。`call`/表达式可能写入、点击或关闭进程，不保证只读；先确认实际 target。 |
| `trace-host.mjs` | Host 插件入口 `inject` / `apply`，记录 loader、settings/market descriptor、生命周期并周期写 `<DSH_HOME>/acceptance-trace/registry.jsonl`；同时执行公网 DNS 与两处目录 GET。不是直接运行即挂载的 CLI。安装到本批 Host 须另行授权；不提交安装/管理写请求。 |
| `source-audit-20261005.mjs` | 有界公网来源/版本/media/制品取证，区分普通 fetch 与 Core 安全读取。默认及 `--direct-hints` 会联网，后者读取固定 sibling 路径作为未可信提示；`--follow-up <audit.json>`、`--artifacts <follow-up.json>` 继续保存的审计，会联网并写 `.verify/.../source-audit/`。`--self-test` 是内置合成测试，不是官方验收。 |
| `release-api-checks-20261005.js` | 用主控捕获的 `window.__marketAcceptanceRemote` 查询 hello/hostCore/catalog/inventory、版本分页与原操作恢复，报告 unknown/failed。不安装、不执行管理写入；随机 never-submitted key 的 not-found 不证明真实原写入从未发生。 |
| `release-ui-smoke-20261005.js` | 真实 MarketPage 导航、方案/版本控件及返回首页冒烟，不确认安装或管理操作，并核对没有新任务；需实际 Remote 和目录条件。缺授权正向夹具的分支只能 blocked，不能凭 DOM 渲染通过升级/降级链。 |
| `install-registry.js` | 官方 Registry 对话框安装辅助表达式。主控维护精确候选版本接线，调用者须先按下节设置 Registry/版本/fixture 开关。会改对话框并点击安装，不是只读，也无持久防重放门；不得因历史默认 mvp.17 而安装旧候选。 |
| `management-business-checks-20261005.js` | 当前完整业务结果探针：仅对已安装且启用的 noop 1.0.0 停用、启用、卸载；每次原意图生成随机 key，先只读核对 not-found、保存 originals，再提交一次写入并核对库存、维护事实及完整恢复。须实际 Remote 和新隔离批次。 |
| `management-business-recovery-20261005.js` | 只读恢复，需要 `window.__marketAcceptanceBusinessBaseline` 的原请求/完整结果及同一 environmentId；按原 key 查询，不写入、不重放、不重新安装 fixture。没有原 baseline 就停止，不伪造。 |
| `management-client-checks-20261005.js` | 真实 UI 对 noop fixture 停用、启用、双重确认卸载，读取 Client 原操作指针并只读核对结果；依赖 DOM/React Fiber/Remote。`__marketAcceptanceClientResume` 只接受保存的确切停用身份，之后仍继续新的启用/卸载写入，不是只读恢复脚本。 |

## 当前候选 Registry 与精确版本

主控已告知当前 `install-registry.js` 支持 `window.__marketAcceptanceAdapterVersion`，该接线由主控维护；本补丁未执行 installer 或官方安装验证。未设置变量时保留的历史默认 `0.1.0-mvp.17` 只作兼容历史调用，**不是当前候选版本的依据**。mvp.18 新隔离安装须显式传入当前候选 Registry 中实际的精确版本。

调用者从**合并后、本批当前候选** `registry.json` 读取 `base`，在 `packages` 中唯一匹配 `name === "@dsh-eac/market"` 并读取精确 `version`、`sha256` 和 `url`。缺项、多项、非本批 Registry 或制品不匹配即停止，不能猜 mvp.18、使用 latest 或沿用旧安装 URL。先在同一已核实的隔离页面 target 设置：

```javascript
window.__marketAcceptanceRegistry = "<本批 registry.json 的 base>";
window.__marketAcceptanceAdapterVersion = "<本批 packages 中 @dsh-eac/market 的精确 version>";
window.__marketAcceptanceNoopInstall = false;
```

以上是取值占位说明，不要原样执行；变量须通过本批 CDP 在实际安装对话框所属 target 中设置，再调用安装表达式。安装 noop fixture 时明确设 `window.__marketAcceptanceNoopInstall = true`，其目标仍为 `eac-market-acceptance-noop@1.0.0`，不要把候选版本变量当 fixture 版本。

mvp.18 或任何合并后新候选须重新生成本批 Registry/制品映射、核对安装回执与实际字节、保存新证据；**禁止复用 mvp.17 的 Core/Adapter 字节一致性、旧摘要、旧 URL 或旧官方验收结论**。`--serve-existing` 只重供既有制品，不能把旧批次升级成新候选证明。

## 只归历史的探针

以下文件保留用于原批次追溯，不是当前默认执行清单或当前合同成功断言。真实写目标、旧 API、固定 key、旧版本/目录数量等已写在脚本里；本次只读检查，没有使其重新适配。

| 历史文件 | 原用途与禁止误用的原因 |
| --- | --- |
| `api-checks.js` | 旧综合 API 验收，含策略保存、草稿/媒体传输/导入/删除、计划和管理保护请求，不是只读；固定 runtime/目录数量、旧方法名不适合当前自动验收。 |
| `ui-checks.js` | 旧综合页面/任务/作者操作，含控件点击及目录检查，不是纯截图或只读，依赖原页面布局和状态。 |
| `author-task-ui.js` | 原草稿重开/保存及失败任务历史检查，会写草稿，依赖已保存的原批次数据。 |
| `install-market.js` | 点击官方 Add plugin/Install，硬编码 `127.0.0.1:61000`、tgz 摘要与 mvp.17；不能用作新候选入口，无通用防重放门。 |
| `install-network-check.js` | 原真实 scroll-fix 安装任务/重复提交检查，有固定默认 key 和二次 `taskStart`，目标不是 noop，禁止纳入本交付 fixture 写清单。 |
| `fix-checks.js` | 原库存、维护、方案及 UI 修复回归，旧 API/页面断言与原装包条件仅供追溯。 |
| `fix-management-check.js` | 原 scroll-fix 停用/重复停用/启用；真实目标、固定 key、重复写请求不符合当前 fixture-only、零重放要求。 |
| `management-checks.js` | 旧 noop 管理/重复写检查，使用旧 API、固定 key 并重复停用/卸载，不适用于当前防重放流程。 |
| `management-recovery-checks-20261005.js` | 早期 noop 停用/启用/卸载及恢复，固定 key，并期待缺完整业务记录的 `management/business-result-unavailable`；该历史缺陷不能当作当前正确结果或接入正常 CI。 |

## 写探针与防重放纪律

1. 新管理写验收只允许 `eac-market-acceptance-noop@1.0.0`；先用官方安装器核实版本、安装和初始启用状态，不对真实目录插件或用户插件做写探针。候选市场安装是另行授权的环境准备，不是 fixture 管理验收。
2. 写前保存 environmentId、目标/版本、action、原 idempotencyKey、提交时间、库存及维护事实；提交后立即把 originals/结果持久保存到本批证据文件。浏览器 `window` 标记重开会丢失，不是持久化防重放保护。
3. `management-business-checks` 同页拒绝重跑，提交前查询新 key、提交后只查询原 key，结束时已卸载 fixture。超时、unknown、失败或证据不全立即停止，不换 key、再点击、重新安装 fixture 或重跑脚本来求成功。not-found 不能单独证明原写未发生。
4. 冷启动只用已保存 originals/baseline 和同一 environmentId，优先 `management-business-recovery` 或 `release-api-checks` 的原操作只读查询；没有原始身份就报 unknown/blocked。Client resume 的后续写须另行明确授权。
5. 幂等测试中的再次调用写 API 也属于重放尝试，不能混入当前零重放证据；旧 duplicate 探针只归历史。新写验收须新批次、新原请求及授权，不在原失败批次补写。

## Core security 实际语义与离线交接

`trace-host.mjs` 直接复用已跟踪的 `packages/market-core/src/delivery/security.ts`，不再依赖被忽略的 `.verify/desktop-rc2/security-probe.mjs`：

- `assertSafeRemoteUrl(input, options?)` 是异步安全门，成功返回 `URL`，失败抛含 `code` 的 `DeliverySecurityError`；默认 DNS 处理 Node address records，注入 `options.lookup` 合同则为 `string[]`。trace 不注入私网放行或替代 resolver。
- `safeFetch(input, options?)` 返回 `Response`，执行 HTTPS GET、逐跳 URL/DNS 检查、manual redirect 和请求/正文总时限；默认经 Core reader 调用 global fetch，不把非 2xx 当成功，也不自动读取代理环境变量。trace 保留 15 秒预算，不关闭安全检查。
- `readLimitedResponse(response, maxBytes, signal?, bodyIdleTimeoutMs?)` 返回 `Uint8Array`；trace 保留 8 MiB 限制，用 `.length` 记录字节。无效长度、超限、长度不一致会抛错，不记成成功读取。GET 成功只证明该次读取，不证明目录/制品验证或插件安装。

新增 `tests/adapter/desktop-acceptance-tools.test.ts` 导入实际 trace/Core 链，mock DNS、global fetch、文件写入并用 fake timers，覆盖导入无副作用、现有 home 标记拒绝、正文读取/采样释放、私网 DNS/重定向及 HTTP/体积/长度失败；不启动 Host、不联网、不写 Profile、不打包。2026-10-05冻结后主控已在合并后的源码上串行执行，9/9通过；本机日志为`.verify/github-delivery-20261005/tools-focused.log`，不随Git交付。复验命令：

```powershell
pnpm test -- tests/adapter/desktop-acceptance-tools.test.ts
```

这不是完整测试、构建或官方验收。trace 的隔离检查目前仅为 `DSH_HOME` 包含 `eac-market-verify`，不是规范路径/真实 Profile 认证；离线用例只验证已有标记行为，主控仍须实际隔离核对。

## 交付与证据风险

- `session.mjs` 硬编码 `G:/Deepseek Harness Desktop/DeepSeek Harness.exe` 和 Windows 批次路径规则；`cdp.mjs` 截图目录检查也用 Windows 分隔符。这些是机器前置条件，不是跨平台保证；迁移由 owner 另行限定修复，不能宣称干净检出开箱即用。
- `source-audit --direct-hints` 读取 `G:/Code/sourcerepo/agent-forge`；缺 sibling 数据时不得造来源或沿用旧 revision。公网审计也不证明正式渠道可安装或官方 Profile 可用。
- trace 仍依赖 `tools/review-probes/dns-shape-20261004.mjs`，须随工具交付；它记录 DNS 形状，不把旧问题 reproduced 当产品通过。Git 主控须核对所有本地 import 的跟踪状态及候选依赖，本说明不执行 Git add/commit/push。
- 原始 `.verify/`、`D:/eac-market-verify/...`、session/process/Registry 日志、截图和 baseline 不随源码检出提供。报告提及但当前不可用的原始证据只能标注历史记录、未重新核实，不能填补当前官方验收、正常退出、冷启动或字节一致性结果。
- 日志可能含本机路径、stack、URL、错误正文及页面数据，公开交付前须主控脱敏审查；不得提交真实 Profile、凭据或用户日志。脚本自报 `testOnly` / `officialDesktop`、CDP 正常返回或离线通过都不是发行许可。
