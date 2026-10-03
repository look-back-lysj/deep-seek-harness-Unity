# EAC 插件市场：近期改动与协作总结

更新日期：2026-10-03
工作目录：`D:/eac-market`
协作分支：`refactor/market-core-adapter`
本文面向后续 Core、Host、Client、发行和测试协作者。它记录的是当前已经发生的工作、仍然存在的边界和下一位协作者应该先做什么。

> 本文是阶段性总结，不替代当前入口文档。新协作者仍应先读 `docs/handoff/START-HERE.md`，再读本文。旧报告只用于追溯，不能当作当前验收结果。

---

## 1. 先看结论

### 当前源码版本

| 部分 | 版本 | 说明 |
| --- | --- | --- |
| Desktop Adapter / 前端 | `@dsh-eac/market@0.1.0-mvp.17` | 当前源码、GitHub Registry 通道候选 |
| Core | `@dsh-eac/market-core@0.1.6` | 当前业务核心 |
| Core API | `1.0.0` | 公共业务接口版本 |
| Remote Protocol | `2.0.0` | Client 与 Host 页面协议 |
| 目标官方宿主 | DeepSeek Harness `0.2.0-rc.1` | Windows x64 |

### GitHub 当前提交

远端分支：`refactor/market-core-adapter`

当前远端 HEAD：

```text
9fc09a28b961e9cc857543b134fbc3e924e31b71
```

本轮三个核心提交：

```text
8f72127  fix(market): loosen install and management gates
c8d72a0  release(market): prepare registry and GitHub adapters
9fc09a2  docs(release): document dual registry and GitHub channels
```

### 用户目标

用户要求的重点不是“把接口和测试数量补满”，而是：

1. 普通用户只下载一个前端插件；
2. 前端插件安装后自动取得 Core；
3. 市场安装、卸载、启用、停用尽量像 DeepSeek Harness 原生安装器一样顺利；
4. 无关旧插件异常不能频繁阻断新插件；
5. 不要求用户手动清理旧皮肤；
6. 不关闭安全保护来制造安装成功；
7. 目标包必须安装正确，结果必须可核实；
8. 插件安装后是否能正常使用，交由官方安装器和上游插件负责；
9. 长错误报告可以保留，但必须折叠，不能直接吓用户。

---

## 2. 项目结构和责任边界

```text
D:/eac-market
├── packages/market
│   └── Desktop Adapter、DSH bundle、Client UI、Remote、随包目录
├── packages/market-core
│   ├── contracts       浏览器安全的公共类型
│   ├── core            计划、任务、恢复、锁、失败语义
│   ├── adapters/dsh    官方 pluginManager、库存、回执、缓存适配
│   ├── host            MarketRuntime、AI 边界、管理影响分析
│   ├── catalog         目录和版本事实
│   ├── delivery        制品下载、缓存、摘要
│   ├── persistence     JSON 状态、任务、事件、回执
│   └── authoring       作者草稿、README、媒体和导出
├── packages/market/src/client
│   └── 发现页、插件目录、安装弹窗、任务抽屉、设置、皮肤、作者工具
├── scripts
│   ├── build.mjs
│   ├── pack-release.mjs
│   └── verify-package.mjs
└── releases
    └── 0.1.0-mvp.17-dual
        ├── Registry 通道 adapter
        ├── GitHub 通道 adapter
        ├── release.json
        └── SHA256SUMS.txt
```

### 文件所有者

- Client：`packages/market/src/client/**`、`tests/client/**`
- Core：`packages/market-core/**`
- Host / DSH 接线：`packages/market/src/index.ts`、`session-gate.ts`、`version.ts`
- 公共合同、构建、锁文件、发行文档：主控串行处理
- 官方 DeepSeek Harness 源码、真实用户 Profile、凭据、模型和外部组织仓：不属于本工程写范围

---

## 3. 近几天的工作时间线

### 2026-09-28：保存 MVP 基线并验证真实安装

主要工作：

- 保存市场 MVP 实现和历史交接基线；
- 接通公开镜像、皮肤中心；
- 做真实安装验证；
- 补充插件作者、Agent 投稿和离线材料检查；
- 修复作者发行包拉取；
- 将可安装目录和普通介绍资料区分；
- 增加官方安装器可直接粘贴的地址；
- 建立公开协作和主分支 review 边界。

这一阶段的核心成果是：市场不再只是本地 UI Demo，而是已经走过一轮真实安装链路。

### 2026-09-29：UI、兼容性和双包拆分

主要工作：

- 优化市场导航、组件状态和安装确认；
- 发布历史 `mvp.7` / `mvp.9` 相关发行记录；
- 放宽部分 DSH 核心门禁并增强官方适配层；
- 将原来单包结构拆成：
  - Desktop Adapter；
  - Market Core。
- 固化两包职责、公开 API、Remote 协议和升级边界；
- 补充双包构建和发布指南。

这一阶段解决了“业务代码和 DSH 桌面入口混在一起”的问题，但双包拆分也带来依赖解析、安装回执和兼容性核对的新问题。

### 2026-09-30：发现页、交互和视觉系统

主要工作：

- 建立发现页布局合同；
- 完成大海报、全部插件、详情、皮肤中心和作者工具；
- 增加导航返回快照；
- 统一插件动作状态和异步反馈；
- 统一安装弹窗、任务弹窗、详情页；
- 完成视觉 token、排版、颜色和组件层级；
- 补充交互审查、UI 合同和无障碍检查。

Client 在这一阶段已经基本成型，但安装链路的真实稳定性还没有完全达到用户要求。

### 2026-10-01：官方宿主边界和能力修复

主要工作：

- 明确官方 Desktop 验收边界；
- 记录官方宿主、登录、安装根目录和兼容性限制；
- 增加官方根目录识别；
- 增加兼容性矩阵浏览器检查；
- 完成 Core capability repair 和 reliable delivery；
- 加入更新检查调度、Remote 方法映射和任务历史分页修复；
- 增加本地真实安装证据和回退资料。

### 2026-10-02：用户实机反馈，发现市场过于严格

用户在官方 Desktop 实机测试中反馈：

> 插件市场几乎无法实际使用，不要让旧插件问题频繁阻断新插件安装。

实机发现的核心现象：

- 四个旧皮肤包被标记为版本待核实；
- 新插件预检被 `inventory:unverified-state` 全局阻断；
- 没有真正开始写入的旧任务被错误标记成 `writeUncertain`；
- 后续安装被旧任务错误拦截；
- 官方安装器即使成功，市场仍可能显示 `receipt/postcondition`。

这一阶段最重要的产品决定是：

> 安装策略从“环境必须全部健康”改为“只检查本次目标和真实写入活动”。

### 2026-10-03：安装、卸载、错误展示和双通道发行

主要工作：

- 安装、更新、卸载、启用、停用改成目标范围检查；
- AI 安装/卸载建议也改成目标范围检查；
- 未开始写入的任务自动关闭，不再阻断后续安装；
- 已经成功的任务清除旧错误字段；
- 已经完成的任务不再显示旧的红色错误摘要；
- 兼容性错误改成简短结论，长日志放入折叠报告；
- 准备 Registry 和 GitHub 双通道安装包；
- 将 Core `0.1.6`、双通道 adapter 和最新源码推送到 GitHub。

---

## 4. 最重要的问题和修复

### 4.1 旧插件异常阻断所有安装

#### 原问题

只要库存里存在任意 `unknownItems`，`MarketRuntime.planCreate` 就返回：

```text
inventory:unverified-state
```

结果是：

- 旧皮肤版本未知；
- 新插件和旧皮肤完全无关；
- 仍然不能生成安装方案。

#### 修复

安装前不再要求整个环境完全健康，改成检查：

- 本次目标包；
- 本次依赖；
- 真正的活动写入；
- 目标包自己的版本、来源、摘要和库存事实。

无关库存异常只保留为提示。

#### 影响的路径

- `packages/market-core/src/host/market-runtime.ts`
- `packages/market-core/src/core/task-manager.ts`
- `packages/market-core/src/core/planner.ts`
- `packages/market/src/client/InstallPlanDialog.tsx`

---

### 4.2 未开始的任务被错误标记成“写入未知”

#### 原问题

任务在正式调用官方安装器之前，由于库存检查失败而暂停：

```text
official inventory or active request is not settled
```

但暂停时把 `writeUncertain` 设置成了 `true`。

于是任务记录看起来像：

```text
attempts: 0
activeRequestId: 空
writeUncertain: true
```

这会继续阻断后续任务：

```text
旧任务写入尚未核对：task-...
```

#### 修复

增加 `provenNoWrite` 和 `cancelUnstarted`：

- 没有官方安装请求；
- 没有 activeRequestId；
- 没有 dispatched/received 尝试；
- 项目仍是 pending 状态；

这种任务可以直接安全关闭为 `cancelled`，并允许后续安装继续。

真正的官方写入不明时，仍然保持严格核对，不自动重放。

---

### 4.3 官方安装成功但市场报 `receipt/postcondition`

#### 原问题

官方安装器返回：

```text
applied
changed: true
packageResultCode: exit-0
```

但 HostPort 的安装后检查写成：

```text
只要 inventory.unknownItems 非空，就判定目标安装失败
```

因此四个旧皮肤的未知状态被误判为目标插件安装失败。

#### 修复

HostPort 只检查本次目标：

- 目标包版本；
- 目标包来源；
- 目标包缓存摘要；
- 目标包启用状态；
- 目标包自己的 `unknownItems`。

无关插件异常不再导致 `receipt/postcondition`。

成功后清除旧的：

```text
error
errorCode
diagnostic
```

---

### 4.4 卸载和启停同样被全局库存状态阻断

#### 原问题

`InstallTaskManager.manage()` 对启用、停用、卸载统一使用全局 `stateStable()`。

所以旧皮肤状态未知时，卸载会返回：

```text
库存或活动写入状态无法核实
```

#### 修复

启用、停用、卸载改用目标范围检查：

```text
installStateSettled(state, [targetPackageName])
```

仍然保留：

- 目标自身未知；
- 官方 package run 仍在进行；
- 真正的旧写入没有核定；
- 目标版本漂移；
- 目标受保护；
- 目标不可卸载。

但不再被无关插件阻断。

---

### 4.5 上游兼容性错误太像市场内部崩溃

#### 实例

`dsh-soul-md@0.8.5` 被官方 DSH `0.2.0-rc.1` 拒绝：

```text
incompatible-version
```

原因是插件要求旧版：

```text
@dsh-eac/dsh-home-paths
@deepseek-ai/dsh-settings
@deepseek-ai/dsh-tools
```

这不是市场 Core 误报，而是官方安装器的真实拒绝。

#### UI 修复

以后主界面只显示：

```text
插件与当前 DeepSeek Harness 版本不兼容
```

下面显示一句建议：

```text
请安装适配当前 DeepSeek Harness 版本的插件版本；
继续使用当前版本前，需要明确接受兼容风险并申请精确版本豁免。
```

完整信息折叠到：

```text
查看详细报告
```

折叠内容包括：

- peerDependencies；
- 原始错误；
- 错误代码；
- 包管理器日志；
- 回滚结果；
- 诊断片段；
- 脚本许可变化。

---

## 5. 当前安装产品规则

### 5.1 用户只下载前端

用户只安装 Desktop Adapter：

```text
@dsh-eac/market
```

不要单独把 Core 填入官方插件安装框。

官方 DeepSeek Harness 负责：

1. 读取 adapter 包；
2. 解析 Core 依赖；
3. 自动下载 Core；
4. 校验包；
5. 安装 adapter；
6. 启用 adapter bundle；
7. 根据需要等待重启。

### 5.2 安装宽松程度

以下状态不再阻断无关安装：

- 旧皮肤版本未知；
- 旧插件兼容性未知；
- 无关插件存在库存异常；
- 插件安装后是否能运行尚未验证；
- 上游插件运行失败。

### 5.3 仍然阻断的情况

- 目标安装包缺失；
- 目标摘要或大小不一致；
- 目标版本和用户确认版本不同；
- 目标包自身身份无法核实；
- 官方安装器拒绝；
- 同一个目标正在安装或卸载；
- 真正的旧写入没有可靠回执；
- 官方写入活动仍在运行；
- 目标包不允许卸载；
- 目标包受市场/核心保护。

### 5.4 安装结果语义

| 结果 | 含义 |
| --- | --- |
| `applied` | 官方安装器成功，目标事实核实成功 |
| `restart-required` | 已写入，需要正常重启 DSH |
| `failed` | 官方或目标安装确实失败 |
| `unknown` | 官方结果或目标事实无法核实，不自动重放 |
| `cancelled` | 未开始或用户取消，未产生未知写入 |

安装成功后插件运行失败，属于上游插件问题，不应继续显示成市场安装失败。

---

## 6. Registry 与 GitHub 双通道

### A. Registry 通道

前端包：

```text
@dsh-eac/market@0.1.0-mvp.17
```

Core 依赖：

```text
@dsh-eac/market-core@0.1.6
```

生成命令：

```powershell
node scripts/pack-release.mjs --out-dir <目录> --registry-core
```

当前候选包已经生成，但 **Core 和 Adapter 尚未发布到 npm Registry**。因此 A 通道现在还不能作为普通用户的公网安装入口。

### B. GitHub 固定地址通道

前端包：

```text
@dsh-eac/market@0.1.0-mvp.17-github.1
```

Core 依赖指向 GitHub 固定提交中的内容寻址文件。

当前 GitHub Core 地址：

```text
https://raw.githubusercontent.com/look-back-lysj/deep-seek-harness-Unity/8f721279568c65c46e7aa4035728e4ea1f128117/artifacts/sha256/e2803c4d092c225d4cd8e203713634977d0b4d2f6675ee0e46704bba534f6c18/dsh-eac-market-core-0.1.6.tgz
```

当前 GitHub 前端包地址：

```text
https://raw.githubusercontent.com/look-back-lysj/deep-seek-harness-Unity/c8d72a0d803ddda713dcce481aa427ce3e0a898c/releases/0.1.0-mvp.17-dual/dsh-eac-market-0.1.0-mvp.17-github.1.tgz
```

两个 GitHub 文件均已在上传后返回 `200 OK`。

### 双通道发行文件

```text
releases/0.1.0-mvp.17-dual/
├── dsh-eac-market-0.1.0-mvp.17.tgz
├── dsh-eac-market-0.1.0-mvp.17-github.1.tgz
├── release.json
└── SHA256SUMS.txt
```

`release.json` 记录：

- 源码提交；
- Core 文件名、版本和 SHA256；
- Registry 通道 adapter 版本和 SHA256；
- GitHub 通道 adapter 版本和 SHA256；
- Core 的 Registry / GitHub 依赖；
- 用户只下载 adapter 的安装规则。

---

## 7. 当前验证状态

### 已通过

- `pnpm typecheck`：通过；
- `pnpm lint`：通过；
- `pnpm test:pack`：通过；
- 包边界：80 个包文件；
- Remote 描述：37 个；
- Registry / GitHub 双包合同验证通过；
- 合成 React/Edge browser-check：**49 / 49 通过**；
- 任务历史分页、旧 Host fallback、截断历史、无 taskEvents fallback 均通过；
- 无关库存异常不影响目标安装；
- 目标自身异常仍然阻止；
- 未开始任务自动关闭；
- 已成功任务不再显示旧错误摘要；
- 兼容性错误长报告默认折叠。

browser-check 证据：

```text
D:/eac-market-verify/implementation-20260928/C-UI/browser-results.json
```

### 已知测试波动

完整 `pnpm check` 在高并行执行时，`tests/core/update-check-scheduler.test.ts` 偶发出现两个 `Timed out waiting for scheduler continuation`。

单独运行：

```powershell
pnpm exec vitest run tests/core/update-check-scheduler.test.ts
```

结果：

```text
24 项通过
```

这是调度器测试在高并发下的等待超时，不是安装链路回归。后续协作者应优先检查 fake timer / event-loop wait，不要直接放宽断言或忽略失败。

### 尚未完成

- npm Registry 正式发布 Core `0.1.6` 和 Adapter `0.1.0-mvp.17`；
- 用 GitHub 通道做一次完整官方 Desktop 全新安装；
- 用 Registry 通道做一次完整官方 Desktop 全新安装；
- 官方 Desktop 读屏、forced-colors、120%–200% 缩放；
- 真实公网网络、代理、下载恢复；
- 旧版市场升级到当前双通道版本；
- `dsh-soul-md` 这类上游 `incompatible-version` 是否需要精确豁免由用户明确决定。

---

## 8. 本地真实环境事实

截至本文更新时，本地官方 Desktop Profile 中已安装：

```text
@dsh-eac/market       0.1.0-mvp.16
@dsh-eac/market-core  0.1.6
```

当前源码和 GitHub 候选已经是：

```text
market 0.1.0-mvp.17
core   0.1.6
```

因此本地 Desktop 还没有装入最新的 `mvp.17` UI 修正。

历史实机证据目录：

```text
D:/eac-market-user-trial/
```

其中记录了：

- 旧皮肤导致的全局库存阻断；
- 未开始任务错误占用；
- `dsh-dafeiyu` / `dsh-whale-widget` 的官方安装和回执；
- `receipt/postcondition` 误报；
- 备份和回退材料。

这些是证据，不是正式发布包。

---

## 9. 后续协作者的第一步

### 第一步：不要直接继续做新功能

先检查：

```powershell
git status --short --branch
git log --oneline --decorate -8
```

确认：

- 当前分支；
- 远端 HEAD；
- 是否存在未跟踪生成目录；
- 是否误把测试产物加入提交。

### 第二步：运行当前验证

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test:pack
pnpm exec vitest run tests/core/update-check-scheduler.test.ts
node tests/client/browser-check.mjs
```

完整 `pnpm check` 也要运行，但若只有 update-check-scheduler 的高并发等待超时，应单独重跑该文件并记录，不要掩盖。

### 第三步：先验收安装链路

优先验证：

1. 只下载 GitHub 通道 adapter；
2. 填入官方 DSH「插件 → 添加插件」；
3. 不手动下载 Core；
4. 不手动清理旧皮肤；
5. 确认官方安装器自动解析 Core；
6. 确认 adapter bundle 自动启用；
7. 正常退出并重启 DSH；
8. 检查市场首页、发现页和插件目录；
9. 尝试安装一个与旧皮肤无关的插件；
10. 尝试卸载一个安全可卸载插件；
11. 遇到 `incompatible-version` 时确认 UI 是否简短提示并折叠长报告。

### 第四步：再处理扩展能力

以下工作应晚于安装主流程验收：

- npm Registry 正式发布；
- 自动更新；
- 离线包；
- Bundle 选择；
- 多来源下载恢复；
- 更多 AI 建议；
- 更多视觉打磨；
- 跨平台和 TUI。

---

## 10. 不可破坏的规则

1. 不清空 `unknownItems` 来制造成功。
2. 不强设 `stable` 来绕过写入屏障。
3. 不自动授予版本兼容性豁免。
4. 不自动重放 `unknown` 写入。
5. 不把 `applied`、`failed`、`unknown`、`restart-required` 压成布尔值。
6. 不用合成 browser-check 代替官方 Desktop 验收。
7. 不把本地 `file:` Core 依赖作为普通用户发行依赖。
8. 不覆盖同版本不同字节的正式包。
9. 不把 `workspace:*` 写入公开 adapter。
10. 不直接修改官方 DSH 源码来消除上游兼容性问题。
11. 不要求用户手动删除旧皮肤来让市场“看起来能用”。
12. 成功任务不能继续显示旧的错误摘要。
13. 失败日志必须保留，但长报告必须可折叠。
14. 目标无关的库存异常不能阻断目标操作。
15. 目标自身的身份、摘要、版本和写入事实必须核实。

---

## 11. 推荐的协作交接格式

每次完成一轮工作，交接信息至少写：

```text
日期与分支：
本次修改范围：
不变边界：
用户目标：
已修改文件：
接口影响：
安装/卸载/启停语义变化：
已运行命令与结果：
官方 Desktop 是否验收：
未验收项目和原因：
下一位协作者第一步：
```

如果只完成代码但没有真实 Desktop 验收，必须写：

```text
代码级验证通过；官方 Desktop 尚未验收。
```

不能把合成测试写成真实安装成功。

---

## 12. 当前建议给下一位协作者的优先级

### P0：用户安装可用性

- 用 GitHub 通道完成一次真实官方 Desktop 安装；
- 验证 Core 自动拉取；
- 验证旧皮肤异常不阻断无关插件；
- 验证卸载、启用、停用不再报全局库存错误；
- 验证 `incompatible-version` 只显示短结论和折叠报告。

### P1：修正 update-check-scheduler 测试波动

- 分析完整测试高并行下的等待超时；
- 修复 fake timer / event-loop coordination；
- 不通过扩大超时或删除测试来掩盖问题。

### P2：完成 Registry 发布

- 发布 `@dsh-eac/market-core@0.1.6`；
- 发布 `@dsh-eac/market@0.1.0-mvp.17`；
- 验证公网 Registry 空缓存安装；
- 记录真实 SHA256 和发布时间。

### P3：体验和扩展功能

- 更新检查状态；
- 离线包；
- Bundle 选择；
- 自动下载/安装；
- 更多目录内容和真实推荐；
- 读屏、缩放、forced-colors；
- 跨平台和 TUI。

---

## 13. 一句话总结

最近几天的核心变化是：

> 市场从“环境必须全部健康才允许任何操作”，改成了“目标自身必须正确、真实写入必须核实、无关旧插件只提示不阻断”；同时用户只安装前端 adapter，Core 由官方安装器通过 Registry 或 GitHub 固定地址自动取得，并以短结论加折叠报告展示错误。
