# 官方 Desktop 全功能验收矩阵（2026-10-03）

## 0. 范围、事实与使用规则

本矩阵草稿由只读协作者准备，因配额中断未完成逐项表格，不作为完整验收记录。主控后续已实际安装并操作官方Desktop，逐组结果与39个Remote覆盖账本见[官方Desktop实机报告](OFFICIAL-DESKTOP-ACCEPTANCE-2026-10-03.md)。以下内容仅保留准备阶段的边界，不表示全部实机通过。

- 读取基线：分支 `refactor/market-core-adapter`，HEAD `9c6a1d22aa6b6e666172c81e1f1fbdd3517b059b`；已有大量他人未提交改动。本文描述读取时源码，不代表 HEAD 制品或已安装版本；执行前重新核对源码与产物摘要。
- 接力入口指定载体：官方 DeepSeek Harness Desktop `0.2.0-rc.1` / Windows x64。该发行号仅标记载体；核心范围必须对照官方 `getDshRuntimeVersion()` 返回的 DSH 运行时版本，不拿 Desktop 发行号、market-core 包版本、Core API 或 `hostVersion` 代替。
- 源码候选 Adapter `0.1.0-mvp.17` / Core `0.1.6`；Provider Remote `2.1.0` / Core API `1.1.0`；Client 最低仍为 Remote `2.0.0` / Core API `1.0.0`。入口记录正式单包为 `0.1.0-mvp.9`，不是本轮安装/联网发行核验。
- Host 实际声明 **39 个 @Remote**。39 不是插件数量或通过数量，不代表每项有页面按钮。
- 本轮直接解析 `packages/market/data/index.json`：revision `eac-published-20260928-6`；plugins 61、listings 21、presentations 61、deliveries 39；packs/recommendations/collections 均为 0；unverified 51、hard-incompatible 10、verified 0；bundle-installable 29、hard-blocked 22、missing-bundle 8、missing-artifact 2。静态计数不是联网最新目录或运行通过。

### 0.1 前置与证据等级

每行默认 `not-run`，主控填写 `pass / fail / blocked / not-run / not-implemented`。未实现不计通过率；正向能力与安全拒绝分别记，不能用“无模型正确拒绝”抵消“模型链路未验”。

| 标记 | 前置 | 无凭据隔离实例边界 |
| --- | --- | --- |
| L | 官方隔离实例、授权测试目录、本地资料/制品 | 浏览、草稿/ZIP、库存、本地安装管理；仍需真实服务，mock 不算 D |
| N | 外网/DNS/TLS、已登记公开目录/制品 | 公网刷新、镜像、网络图、公开 GitHub README、正式 Core 获取需联网，通常不需 GitHub 账户 |
| M | 官方 llm + agentDefaultModel、有效默认模型及必要授权 | 无凭据只能验 unavailable/blocked/零写；真实分析、提案与模型驱动执行不能验 |
| A | 上游插件/私有内容所需账户、权限或模型 | 登录后业务、大资源、私有来源缺前置；不得借真实用户凭据，市场没有私有 README 登录功能 |
| F | 合法测试资料/故障场景 | 多版本、组合、脚本授权、重启、坏摘要等；缺资料写 blocked，不篡改官方实现 |
| O | 独立旧 Host/旧市场服务 | 缺方法/旧协议/旧记录；删 mock 方法只是合成 fallback，不是旧 Desktop 实测 |
| V | 可见官方窗口、主题/缩放/辅助技术 | 读屏、高对比度、Modal、真实输入视觉须实测，不由 DOM 属性/fixture 截图代替 |

`U` 单元/组件/契约，`P` 制品，`I` 真实官方隔离服务，`D` 真实官方 Desktop。本文 tests 是覆盖入口，本轮未重跑。`tests/client/browser-check.mjs` 使用独立无头 Edge、合成 Remote，不启动官方 DSH；49/49 也不是 D。`tools/review-probes/2026-09-28` 用合成服务复现历史缺陷，`reproduced` 不代表正确行为通过。

### 0.2 统一采证与不变边界

逐行记录 ID、日期、层次、前置、步骤、期望、实际、状态、证据文件。D 至少关联官方安装身份、隔离实例身份、Adapter/Core 版本与 tgz SHA256、源码/dirty 状态、去敏 Remote 请求与原始领域结果、taskId/planId/revision/幂等键、官方库存和屏幕结果。仅调 API 未触达 UI 的项标 `API-only`。

写入、重启、故障注入由主控取得对应许可；本文不是新增授权。仅官方 pluginManager 写插件，不改官方源码、真实 Profile、凭据或未知文件。注入限批准的资料/隔离环境，不可执行分支保留 blocked。

各组共同检查：成功有真实后置事实；失败保留 error/errorCode/diagnostic/permissionChanges 语义并去敏；取消/关页不是回滚；超时不是取消或重写许可；重开/恢复读原记录而非自动重放；旧 Host 缺能力明确降级，不伪造成功。

## 1. 39 个 Remote 逐项对照

源码：`packages/market/src/index.ts:192` 起的 MarketService；`client/model.ts:84` 合同；`client/activation.ts:68` 别名/facade；`packages/market-core/src/api.ts` 与 `contracts/types.ts`。下表按 Host 声明顺序编号。

`W`：Host 要求有效 clientConnect，预览/导出/AI 分析也可能分配状态；`R`：Host 不要求写协商，不意味着可跨环境读取；`C`：仅 refreshFirst=true 要求 W。缺方法必须探测。

| ID | Host Remote → Client 名（同名不重复） | 用户路径/状态 | 可观察事实与边界 | 前置/门禁 |
| --- | --- | --- | --- | --- |
