# Core / Adapter 接口修改 HANDOFF

日期：2026-10-01。状态：接口请求，**本阶段只由 Core 定义和验证；不在 Core 工作中修改 Adapter、Client 或官方 DSH 接线**。

关联计划：[下一阶段 Core 计划](../NEXT-STAGE-PLAN.md)。本文件供 Adapter 维护者接手；其中的接口请求不是当前源码已完成事实。

## 1. 边界

Core 负责：

- Agent Forge source/index/package records、revision、镜像和缓存；
- 本地 `.tgz`、离线包和制品摘要；
- Bundle/嵌套 Bundle 选择图、dependency、conflict、provides、replaces；
- 安装/更新/启用/禁用/卸载意图和任务状态；
- `Sync Explicit`、`Sync Dependency` 及最终 `effective` 状态；
- 取消、Force 取消、保护项和失败/未知语义。

Adapter 负责：

- 提供当前宿主读取事实；
- 提供受控的本地文件/制品输入边界；
- 执行 Core 已核定的官方宿主动作；
- 原样返回 `applied`、`restart-required`、`failed`、`cancelled`、`unknown` 等结果；
- 将 Core 的只读状态和任务结果转发给 Client。

Adapter 不负责重新解析 Agent Forge dependency，不维护第二份 Bundle 图，也不自行决定某个包是否属于 Explicit 或 Dependency。

## 2. 已确认的当前接口问题

### 2.1 `HostPort` 缺少 `remove`

当前 `packages/market-core/src/core/ports.ts` 的 `HostPort` 声明了 `readState`、`install`、`cancel` 和可选 `setEnabled`，没有 `remove`；但 `packages/market-core/src/adapters/dsh/host-port.ts` 的 `OfficialHostPort` 已实现 `remove(packageName)`。

Adapter 维护者需要：

1. 将卸载能力加入稳定 Host port 合同；
2. 保留官方单参数签名和真实 ChangeResult 映射；
3. 缺能力时返回明确的 unavailable/unknown，不用空实现冒充成功；
4. 让 Core 只依赖抽象 `remove`，不依赖 `OfficialHostPort` 具体类。

### 2.2 `MarketRuntime` 当前直接构造 DSH adapter

当前 `packages/market-core/src/host/market-runtime.ts` 直接导入并构造 `OfficialHostPort`，同时直接构造 DSH persistence/artifact adapter。这使 Core 业务运行时无法由其他宿主或测试实现注入，也让 Core 与 DSH adapter 的生命周期绑定在一起。

Adapter 维护者需要与 Core 维护者协商后改为依赖注入：

- Core runtime 接收抽象的 `HostPort`、`ArtifactPort`、持久化和锁能力；
- DSH adapter 在入口层组装 `OfficialHostPort`、官方 atomic-write 和制品来源；
- Core 不再通过 `new OfficialHostPort(...)` 猜测宿主身份或自行创建 DSH 连接；
- 合成测试可以注入 fake ports，但 fake 不得成为生产默认值。

这属于边界修正，不要求本阶段为了适配旧入口继续扩大 Core 对 DSH 具体类的依赖。

### 2.2 Adapter 不应生成 Explicit/Dependency 状态

当前 `InventoryItem` 的 `source/provenance` 是宿主事实或安装归属材料，不足以表达用户 Explicit 选择和 dependency 反向引用。Core 将根据用户意图、冻结计划、任务结果和 dependency 图生成这两套状态。

Adapter 不应在 `InventorySnapshot` 中猜测或覆盖：

- `explicit`；
- `dependencyOf`；
- `effectiveRetention`；
- `canCancel`。

这些字段由 Core 输出。Adapter 只需继续提供真实库存、启停、重启、来源和未知项。

本轮 Core 已在 `MarketRuntime.maintenanceStatus()` 生成 `CoreMaintenanceSnapshot`，其中包含
`explicitState`、`dependencyState`、`effectiveState`、任务和待重启事实。当前 DSH Adapter 尚未转发该入口，
仍需按本 HANDOFF 接入；这不代表 Desktop 已经消费或验收该状态。

## 3. Core 完成合同后需要 Adapter 转发的接口

以下是待 Core 合同冻结后需要转发的最小只读/写入入口。名称可由 Adapter 维护者按现有 Remote 风格调整，但语义不能删减：

### 3.1 Core 状态

```ts
maintenanceStatus(): Promise<CoreMaintenanceSnapshot>
```

快照至少包含：

- 当前环境和 Core 状态 revision；
- 每个 package 的安装/启用/更新状态；
- `explicitState`；
- `dependencyState`；
- `effectiveState`；
- 直接/传递依赖者；
- 不能取消或不能更新的原因；
- 当前任务和待重启信息。

Adapter 只转发和展示，不重新计算这些字段。

Core 另提供只读 `MarketRuntime.checkUpdates()`，只比较当前库存与已接受目录，不下载、不安装；Adapter
后续可按“手动检查”或默认开启的自动检查策略转发该结果。自动下载/安装仍必须先创建并确认冻结计划。

### 3.2 Agent Forge 源和离线包

Core 需要能消费 Adapter 提供的受控输入，而不是接收 Client 任意绝对路径。Adapter 后续至少需要支持以下一种边界：

- 将用户选择的本地文件以受控字节流交给 Core；或
- 提供受控的 source/artifact handle，由 Core 校验 handle 指向的固定摘要；或
- 在 Host 侧导入 `.eacpack` 后把已核验字节和 manifest 传给 Core。

不能把任意 `file:` 路径直接透传到 Client，也不能让 Core 绕过 Adapter 读取用户 profile 外的文件。

### 3.3 目录刷新

现有 `CatalogRefreshRequest` 只有可选 `sourceUrl`，不足以表达 Agent Forge source、local-file 和 offline-pack 三种来源。后续转发接口必须以已登记的 `sourceId`、本地导入句柄或离线包 revision 为键，不能接受 Client 临时指定任意公网 URL 作为安装来源。

### 3.4 取消结果

Core 会返回 dependency 影响、级联取消项和保留项原因。Adapter 只需：

- 转发 Core 的取消请求和 Force 二次确认；
- 对正在执行的官方请求调用现有 `cancel(requestId)`；
- 原样返回 `cancelled`、`too-late`、`not-running`、`unknown`；
- 不自行级联删除包。

## 4. 不要求 Adapter 新增的能力

- 不新增 Adapter 侧 dependency solver；
- 不新增 Adapter 侧 Bundle/整合包数据库；
- 不新增 Adapter 侧 Explicit/Dependency 持久化；
- 不新增绕过 Core 计划的直接安装按钮；
- 不把官方 inventory 的“已启用”直接解释为用户 Explicit；
- 不把取消请求返回当作官方写入已经撤销。

## 5. 接手验收

Adapter 维护者接手后，至少需要验证：

1. `HostPort.remove` 抽象和官方实现一致，缺能力时不会假成功；
2. Adapter 能转发 Core 的 `maintenanceStatus`，不丢失 Explicit/Dependency/保护原因；
3. 本地文件和 `.eacpack` 通过受控输入进入 Core，不暴露任意路径；
4. Agent Forge source refresh 不再接受未登记的任意 URL；
5. Force 取消只调用官方取消，不在 Adapter 内自行删除依赖包；
6. 官方失败、需重启、未知和取消过晚等结果全部保留。

本 HANDOFF 完成前，Core 可以用内存/合成 Host port 和定向合同测试验证业务语义；这些测试不替代 Adapter 或官方 Desktop 验收。
