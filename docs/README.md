# EAC 市场文档入口

当前文档只保留一套可执行入口。任何带日期的旧报告、旧计划和旧验收登记都在 [历史接力归档](handoff/archive/2026-09-legacy/README.md)，只能追溯，不能覆盖当前状态。

## 协作者阅读顺序

2026-10-03 已确认的宿主核心版本规则和前后端职责，见[实施方案](handoff/HOST-CORE-COMPATIBILITY-PLAN-2026-10-03.md)与[数据审计](handoff/HOST-COMPATIBILITY-DATA-AUDIT-2026-10-03.md)。本轮只整理规划，旧报告不能代替新能力的实现或验收。

1. [当前接手入口](handoff/START-HERE.md)：分支、版本、范围、禁止事项和验证顺序。
2. [最新版升级指南](UPGRADE-GUIDE.md)：用户升级、维护者构建、发布和回退。
3. [Core / Desktop Adapter 底座指南](CORE-ADAPTER-GUIDE.md)：两包职责、公开 API、协议和发现页合同。
4. [后端协作者指南](handoff/BACKEND-CONTRIBUTOR-GUIDE-2026-09-30.md)：Core、Host、目录、适配器和失败语义。
5. [当前交互审查](handoff/INTERACTION-AUDIT-2026-09-30.md)：Client 动作状态、导航、任务、皮肤和作者工具。
6. [UI 重构合同](handoff/UI-REBUILD-CONTRACT-2026-09-30.md)：发现页、全部插件、视觉和兼容性边界。
7. [Client 维护边界](../packages/market/src/client/README.md)：前端文件职责和 Remote 使用规则。

## 当前事实

- 源码候选：`@dsh-eac/market@0.1.0-mvp.17` + `@dsh-eac/market-core@0.1.6`；协议仍为 Core API `1.0.0` / Remote `2.0.0`，新方案尚未接线。
- 当前正式可安装发行版：`0.1.0-mvp.9` 单包。
- 双包已经通过本地测试源空缓存安装、官方 Web 加载和作者草稿保存验证。
- 双包公网 Core 来源、官方 Desktop 全新安装和旧版升级仍需独立验收。
- 发现页和全部插件页消费同一目录投影；没有真实推荐、评分或媒体时自动隐藏或降级。

## 专题入口

- [Core 新增能力补齐计划（方案 A v1.2）](handoff/CORE-NEW-CAPABILITIES-PLAN-2026-10-01.md)：按网络调研选择轻量 Node/Undici 单一路径，明确代理能力边界、动态超时、重试/续传、首次空缓存链路和跨环境验收；P0 后端代码修补已完成并通过回归；官方宿主及真实网络验收尚未完成。

- [产品要求](PRODUCT.md)
- [测试与证据](testing.md)
- [协议](protocol.md)
- [官方能力](host-capabilities.md)
- [作者投稿指南](contributing/AGENT-SUBMISSION.md)
- [目录内容维护](contributing/CATALOG-CONTENT.md)
- [发行维护](contributing/DISTRIBUTION.md)
- [AI 辅助操作守则](AI-ASSIST-RULES.md)
- [多智能体协作约定](handoff/NEXT-AGENT-PLAYBOOK.md)

`PRODUCT.md` 是需求事实源，`ACCEPTANCE.md` 是实际验证记录，`UPGRADE-GUIDE.md` 是当前操作指南。三者职责不同，不能互相替代。
