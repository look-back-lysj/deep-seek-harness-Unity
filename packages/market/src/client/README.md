# Client 维护边界

本目录将页面组装、读取状态、安装确认、任务确认和作者编辑分开；通过 `MarketRemote` 消费 JSON 服务，不直接导入 Host 服务。`core/semver.ts` 是共享的无副作用版本比较函数。

- `MarketPage` 保留发现／全部插件／我的插件三个主导航；次级页面和扩展位置不能覆盖核心操作。
- `data-controller` 控制读取代次、环境、轮询和库存同步。任务终态刷新不能写在每次 render 都会销毁的 effect 内。
- `InstallPlanDialog` 只消费 Host 计划；每个目标有独立会话；试装变更使旧计划失效。
- `plan-review` 只投影 Host 已封存计划的可执行／跳过／依赖暂停范围，不更改计划或替核心重排执行。私有组合使用 collection 身份，不能伪装公共 Pack。
- `TaskDrawer` 每任务保存 AI 提案。风险第二次确认必须使用 Host challenge，不能按 action.kind 自动填同意。
- `AuthorWorkspace` 的已保存状态只来自 Host revision；README 差异确认消费后台候选；媒体使用受控读取，ZIP 使用真实出站字节。
- `extensions/` 合同归主控，实现归 E；主页面只提供受限快照和预检／差异入口。

本轮证据、完整接线请求和未验证项见 `docs/UI-IMPLEMENTATION-2026-09-28.md`。测试产物写 `D:/eac-market-verify/implementation-20260928/C-UI`。全局构建、打包和官方 Desktop 留给主控。
