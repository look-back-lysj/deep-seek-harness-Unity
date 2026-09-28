**单项补充审查：未勾选试装仍安装 unverified 制品｜2026-09-28｜P1**

结论：`tryUnverified` 没有在 UI→Host 的传递中丢失。执行许可失效的位置是规划器的两处条件：只对 `verification === 'unknown'` 检查试装同意，漏掉契约明确定义的另一种状态 `'unverified'`。单插件和套餐均受影响。

本次仅核查这一项；只新增本补充文档。没有修改工程、测试源码或 profile，没有联网、操作 UI、调用模型、执行安装或重跑测试。未勾选复选框的真实操作事实由主控提供；以下计划与任务字段已由 Reviewer 只读核对。

**传递链及精确位置**

| 环节 | 源码位置 | 当前行为与结论 |
| --- | --- | --- |
| 状态合法值 | [contracts/types.ts:30](../../../packages/market/src/contracts/types.ts#L30)；[catalog/validate.ts:177](../../../packages/market/src/catalog/validate.ts#L177) | `unverified` 与 `unknown` 是两个合法值；目录解析保留原值，不把 `unverified` 转成 `unknown`。 |
| 复选框 | [components.tsx:131](../../../packages/market/src/client/components.tsx#L131)；[重置:140](../../../packages/market/src/client/components.tsx#L140)；[绑定:214](../../../packages/market/src/client/components.tsx#L214) | 初始及重新打开时为 false；UI 为 `unverified` 和 `unknown` 都显示复选框；checked 绑定该值，变更读取实际勾选状态。 |
| 生成请求 | [planSelectionFor:110](../../../packages/market/src/client/components.tsx#L110)；[字段:119](../../../packages/market/src/client/components.tsx#L119)；[prepare:155](../../../packages/market/src/client/components.tsx#L155) | 每项 selection 保留传入的 `tryUnverified`；`selections` 在 165 行发出，同时 166 行设置顶层 `attemptUnknown`。没有强制改成 true。 |
| 客户端转发 | [activation.ts:30](../../../packages/market/src/client/activation.ts#L30)；[原参数转发:76](../../../packages/market/src/client/activation.ts#L76) | `createPlan` 映射 `planCreate`，参数原样转发；特判只针对目录刷新，不修改本请求。 |
| 契约与生成校验 | [types.ts:207](../../../packages/market/src/contracts/types.ts#L207)；typert.host.js:477（本机生成产物 `packages/market/lib/typert.host.js:477`，不入库）；typert.remote-client.js:477（本机生成产物 `packages/market/lib/typert.remote-client.js:477`，不入库） | selection 字段是 boolean；当前生成校验也保留 `tryUnverified`，没有默认置 true 或剔除此字段。生成文件证据仅指当前工程产物，未另核对已安装 A15 包内的生成文件。 |
| Host | [index.ts:111](../../../packages/market/src/index.ts#L111)；[market-runtime.ts:209](../../../packages/market/src/host/market-runtime.ts#L209)；[selections:245](../../../packages/market/src/host/market-runtime.ts#L245) | 服务直接转发请求；Host 保留目录 verification，并把 `request.selections` 原样交给 `createPlanBundle`。顶层 `attemptUnknown` 未被使用，但逐项 `tryUnverified` 已传递，因此它不是本例放行的根因。 |
| **缺陷：套餐分支** | **[planner.ts:174](../../../packages/market/src/core/planner.ts#L174)** | 只在状态为 `unknown` 且未同意时添加 blocker，`unverified` 被漏掉。 |
| **缺陷：单插件分支** | **[planner.ts:251](../../../packages/market/src/core/planner.ts#L251)** | 同样漏掉 `unverified`。本次真实计划没有套餐字段，直接命中这一分支。 |

两处当前条件相同：

```ts
if (fact?.verification === 'unknown' && !selection.tryUnverified)
  blockers.push('verification:unknown-not-confirmed')
```

当 `verification = 'unverified'` 时，第一个条件已经为 false，无论试装是否勾选，这条拦截都不会发生。无其他阻断原因的新装随后在 [planner.ts:261](../../../packages/market/src/core/planner.ts#L261) 得到 `add`，在 [planner.ts:266](../../../packages/market/src/core/planner.ts#L266) 保留该动作，并在 [planner.ts:285](../../../packages/market/src/core/planner.ts#L285) 创建执行步骤。

UI 的确认按钮只要求计划顶层为 ready：[components.tsx:260](../../../packages/market/src/client/components.tsx#L260)。任务执行器依据规划出的 action，而不重新判断试装许可：[task-manager.ts:145](../../../packages/market/src/core/task-manager.ts#L145)。本例没有 blocker，所以进入正式安装。`disabled` 只代表装好后处于停用状态，不代表没有写入。

**指定现场的只读核对**

- [计划 JSON](D:/eac-market-verify/review-next/desktop-home/profiles/desktop/eac-market/state/plans/plan-26820f1e864450e2b5c78854d1eec249241f9d56eea85ede0180a61496286deb.json)：`@dsh-eac/fixture-plugin-a@1.0.0`，`verification: unverified`，`action: add`，`blockers: []`，`requestedEnabled: false`，并有该插件的安装 step。计划摘要为 `d30f54e4270d5d35c9e3b7194bd73bf40915079897df136b2bbd9570b018f819`。
- [任务 summary.json](D:/eac-market-verify/review-next/desktop-home/profiles/desktop/eac-market/state/tasks/task-6a540423502704925ff35716d7dba38a/summary.json)：引用同一计划及计划摘要；任务 `completed`；组件 `disabled`、`changed: true`、`installOutcome: applied`、`packageResultCode: exit-0`；事件中记录官方安装调用与 `Host结果：applied`。
- 两份文件读取时 SHA-256 分别为 `00C692532106A568E2C3AB5F8E5AF3D3EEED0E8BED6D2A836F0D90BB95A12B9C`、`F8241676D5C1A877E55F82E9FB668112C1B6BD06B978BCEDB6380EDDCB8F33EE`。
- 持久计划保存规划结果，没有原始 `selections.tryUnverified`。因此不能仅凭文件反推当时 checkbox 状态；“未勾选”来自主控实测。当前源码则足以确定：即使输入明确为 false，`unverified` 仍不触发此项拦截。

影响：用户只同意安装，并未额外同意试装未验证内容，市场却仍创建可执行步骤。界面有复选框、字段传递正确，均不能证明后台已执行这项许可规则。

**最小修复候选（本次不实施）**

方案 A：在上述两个规划分支同时将条件覆盖 `unverified` 和 `unknown`，只有 `selection.tryUnverified === true` 才允许试装。修改最小，但保留两处重复规则，后续容易只改到一处。

方案 B：在规划器提取一个共同的试装许可判断，两分支调用同一规则。多一个小型重构，但能避免规则再次分叉。两种方案都应保留 `hard-incompatible` 的独立硬阻断，不能通过勾选解除；无需靠 UI 强制勾选或改变目录验证状态来修复。

**只建议一项最小合成回归，不运行真实安装**

增加一个参数化测试：“unverified 制品必须显式同意试装”，参数只有单插件／套餐两条规划路径；每条路径比较 false／true 两个输入。

共同输入：库存为空；一个身份、版本和摘要完全匹配的可安装 fixture；目录事实明确为 `verification: 'unverified'`；关闭其他阻断因素。套餐使用一个必需组件、空依赖边、complete 覆盖及正确 Lock 摘要。请求 selection 由当前 `planSelectionFor(plugin, [], false/true)` 生成，直接交给真实 `createPlanBundle`。

| 输入 | 必须断言 |
| --- | --- |
| `tryUnverified: false` | selection 仍为 false；对应计划项 `action === 'blocked'`；blockers 包含未同意试装原因；`bundle.steps` 不包含该插件。 |
| `tryUnverified: true` | 同一 fixture 的计划项 `action === 'add'`、`blockers: []`，且只有一个安装 step。 |

注意应断言具体计划项和执行步骤，不要求顶层一定是 `status: 'blocked'`：现有规划器允许返回 ready 的逐项受阻清单，套餐还有其他组件可能继续执行。此测试在当前漏判条件下会在 false 组失败，修复后应通过两条路径。

现有 [ui-audit.test.tsx:30](../../../tests/client/ui-audit.test.tsx#L30) 只验证 UI helper 输出 false／true，没有把 `unverified` 事实与该字段一起送进规划器；它的通过不能覆盖本例。本轮不新增或改写工程测试文件，不扩大其他审计。
