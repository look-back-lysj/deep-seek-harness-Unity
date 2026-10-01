# 下一阶段实施计划：Core 数据源与状态同步

版本：review-next v2，2026-10-01。本文是待执行计划，不是完成报告。当前源码、双包状态和真实验收以 [接力入口](handoff/START-HERE.md) 为准；公共产品约束以 [PRODUCT.md](PRODUCT.md) 为准。

## 1. 目标与边界

本阶段**只实现 `packages/market-core`**，不修改 Desktop Adapter、Client、官方 DSH 接线或组织仓。Core 通过既有抽象接收宿主事实、保存安装维护状态并输出给 Adapter 消费；Adapter 接口缺失或需要调整的内容统一记录在 [Core/Adapter 接口修改 HANDOFF](handoff/CORE-ADAPTER-INTERFACE-CHANGES-2026-10-01.md) 中，交由 Adapter 维护者处理。

Core 阶段补齐四类能力：

1. 读取 Agent Forge v2 元数据源，并保留源 revision、镜像、版本、依赖和 advisory 信息。
2. 支持本地 `.tgz`、本地 Agent Forge 源和可携带的离线整合包。
3. 支持插件启用、禁用、安装、更新、卸载，以及自动/手动检查更新。
4. 支持整合包和嵌套整合包的逐项选择、依赖关系校验、取消保护和级联取消，并输出 Adapter 可消费的状态。

Core 不调用官方 DSH 管理器，不执行任意脚本，不读取任意用户路径，不把 Agent Forge 的元数据声明解释成安全认证。Agent Forge 是元数据合同，不是安装器；市场增加的安装语义属于 Core 自己的运行时合同。

Core/Adapter 边界：

- Core 拥有目录、发行候选、离线包、Bundle 选择图、依赖关系、任务状态、Explicit/Dependency 同步状态和失败语义。
- Adapter 只提供宿主读取事实、受控文件/制品能力和官方写入回执，并消费 Core 生成的维护状态；不复制依赖图、不自行决定 Explicit/Dependency 归属。
- Client 只消费 Core/Adapter 暴露的稳定合同，本阶段不修改 Client。

## 2. 已冻结的产品决定

| 主题 | 决定 |
| --- | --- |
| 自动更新 | 自动检查默认开启；自动下载和自动安装提供设置但默认关闭。自动流程遇到用户确认、脚本授权、降级、卸载、重启或未知回执时暂停。 |
| 选择与安装 | 先完成整合包展开、选择、依赖解析和预检，再冻结安装计划；冻结后才能进入下载和安装，执行阶段不再修改选择清单。 |
| Bundle 成员 | Agent Forge Bundle 直接列出的所有成员都是可选项；嵌套 Bundle 可展开，内部成员仍逐项可选。dependency 只表示运行依赖，不把成员变成强制安装项。 |
| 取消 dependency | 依赖项的取消按钮禁用，直到所有依赖它的已选/已安装项目都取消或移除；调用取消接口返回直接/传递依赖包列表及原因，不产生写入。 |
| Force 取消 | 只级联取消当前冻结计划中尚未完成且可安全取消的项目。已被仍保留的本地插件依赖、explicit 安装、其他并行任务/整合包选中或已完成的项目保留，并返回结构化原因。 |
| 已完成项目 | 取消不自动卸载已完成安装；如需清理，生成独立的级联卸载计划并再次确认。 |
| 离线包 | 以单文件 `.eacpack` 为主，包内携带 Agent Forge 元数据、固定 revision 和按 SHA256 存储的制品；无网络时禁止回退网络源。 |

## 3. 数据合同

### 3.1 Agent Forge 源适配

直接消费 Agent Forge v2 的 `source.json`、`index.json`、package records 和可选 advisory。不得修改 Agent Forge 公共 schema；市场专属字段使用 `_meta` 下的 `org.eac.market/*` 命名空间，未知扩展原样保留。

市场源配置增加：

```ts
interface MarketCatalogSource {
  id: string
  kind: 'agent-forge'
  location: { mode: 'https' | 'local-file' | 'offline-pack'; value: string }
  expectedRevision?: string
  enabled: boolean
  priority: number
  refreshPolicy: 'manual' | 'on-open' | 'periodic'
}
```

适配器必须校验 schema 版本、source/index 身份、revision、相对路径、latest/version 关系、Agent target 和记录类型。checksum/signature 只作为完整性材料展示，不能写成安全审查结论。来源刷新失败保留上一次合法缓存并标记 stale。

### 3.2 本地来源与离线包

- 本地单插件：文件选择器取得 `.tgz`，通过受控分块传输写入 Host 缓存，再统一做包名、版本、`dsh.bundle.patch` 和 SHA256 校验。
- 本地目录：读取包含 `source.json`、`index.json` 和 package records 的目录，只允许 Host 明确授权的目录。
- 离线包：

```text
manifest.json
agent-forge/source.json
agent-forge/index.json
agent-forge/packages/**/*.json
artifacts/sha256/<digest>/<filename>.tgz
advisories/                 # 可选
```

manifest 固定源 revision、目标 Agent、包版本、制品摘要、文件大小和相对路径。禁止绝对路径、路径越界、符号链接逃逸、摘要不一致和依赖关系不完整的安装包进入可执行状态。

### 3.3 选择图与任务合同

把 Bundle 解析为节点和边：`bundle-member`、`dependency`、`conflict`、`provides`、`replaces`。所有 Bundle 成员和所有 dependency 都是可选选择项；dependency 只记录“被选中的项目运行时依赖什么”，不自动把依赖项加入安装清单。用户选择依赖它的项目时，预检必须提示该依赖关系；若依赖项未被选择或不可用，相关项目不能进入可执行安装计划。旧 `MarketCollection.required` 只作为迁移兼容字段，新 Agent Forge Bundle 不从成员关系推导必选。

Core 对已安装插件维护两套同步事实：

- **Sync Explicit**：记录用户或已冻结计划明确选择保留/安装/更新/启用的包；Explicit 状态由用户意图和 Core 任务结果产生，不由 Adapter 猜测。
- **Sync Dependency**：根据当前仍被选择或已安装项目的 dependency 边，记录某包为何仍被依赖、依赖者列表和可否取消；Dependency 状态只在所有依赖者取消或移除后释放。

两套状态合并为 Adapter 可消费的 `effective` 维护状态。Adapter 不需要知道 Core 如何计算图，只需提供宿主当前事实并执行 Core 已核定的动作。

安装计划保存完整选择图、目标版本/摘要、来源 revision、依赖原因、外部保护事实和计划摘要。计划冻结后，下载、校验、安装、重启和恢复均使用同一份图。

取消返回至少包含：

```ts
{ status, dependentPackages, cascadedCancelled, preservedPackages, reasons }
```

`preservedPackages` 必须标明 `has-selected-dependent`、`has-installed-dependent`、`explicitly-installed`、`selected-in-parallel-task`、`selected-in-other-bundle`、`completed-outside-current-task`、`unknown-state` 或 `official-protected` 等原因。

## 4. 用户流程

### 4.1 目录与更新

```text
自动/手动检查源
→ 更新 Agent Forge 目录与本地缓存
→ 比较已安装库存
→ 显示可更新、最新、不可达、缺制品、未知或硬不兼容
```

自动检查只读目录和库存，默认不下载、不安装。用户手动点击更新，或明确开启自动下载/安装后，才进入统一计划流程。自动任务仍必须保留幂等键、来源摘要、重启状态和失败记录。

“刷新目录”和“检查更新”分开：前者更新可发现内容，后者比较当前已安装插件。

### 4.2 Bundle 选择

```text
选择 Bundle
→ 展开嵌套 Bundle
→ 选择普通成员
→ 显示 dependency 关系并检查依赖可用性
→ 检查冲突/平台/制品/来源
→ 冻结计划
```

dependency 项的取消按钮只有在所有依赖它的已选/已安装项目都取消或移除后才可用，并显示直接/传递依赖列表。选择完成后不允许边下载边改清单；依赖不可用、循环依赖、冲突或缺制品在冻结前阻断。依赖关系不会自动扩大用户选择范围。

### 4.3 生命周期

Core 为启用、禁用、安装、更新、卸载生成意图、计划和维护状态；实际宿主写入由 Adapter 后续消费这些合同完成。Core 必须区分：文件已安装、配置已启用、进程已运行、业务可用和等待重启。更新保留用户原启用状态；卸载不额外清理未核实的用户数据。

### 4.4 取消

普通取消先返回依赖影响并阻断写入。Force 需要二次确认，只取消当前计划中尚未完成的安全项；正在官方写入的项必须等待真实取消/终态回执。已完成项、外部依赖项、explicit 项和其他任务已选项不删除，结果中逐项报告保留原因。

## 5. 阶段计划

| 阶段 | 交付内容 | 放行条件 |
| --- | --- | --- |
| G0 合同冻结 | Agent Forge v2 映射、源配置、本地来源、`.eacpack` manifest、选择图、取消返回、旧 Collection 迁移 | 公共 schema 不被修改；未知 `_meta` 不丢失；共享 DTO 和文件 owner 已登记 |
| G1 数据源 | HTTPS/local/offline source reader、revision/mirror/stale、Agent projection、advisory、自动/手动检查 | 源身份和 revision 错误会阻断；失败保留旧缓存；检查不会产生插件写入 |
| G2 离线制品 | 本地 `.tgz`、离线包生成/导入、内容寻址缓存、无网络安装 | 摘要、包身份、路径和依赖关系全部核验；无网络不访问远端 |
| G3 选择与依赖 | Bundle/嵌套 Bundle 展开、全成员可选、dependency 关系、冲突和保护图 | 选择完成后计划不可变；依赖项在仍有依赖者时不可取消；依赖不可用和循环依赖预检阻断 |
| G4 Core 生命周期状态 | 启用、禁用、安装、更新、卸载的 Core 意图、任务、结果和 Sync Explicit/Dependency 状态；手动/自动检查；默认关闭自动下载/安装 | 状态、重启、未知回执、部分完成和失败可被 Adapter 消费；Core 不直接调用官方 DSH |
| G5 取消保护 | 依赖列表、普通取消、Force 级联取消、外部/explicit/并行/已完成保护 | Force 只取消可安全的未完成项；所有保留项带原因；不把取消请求当成功 |
| G6 既有能力回归 | 可靠安装修复、AI 提案、作者资料、扩展注册表和首页结构继续按原计划接线 | 不回退现有 REV/E 已通过部分；AI 写入仍依赖稳定任务；作者和扩展不绕过核心确认 |
| G7 Core 验收与交接 | Core 构建、Agent Forge 源、离线包、自动更新策略、Bundle 选择、依赖取消、Sync Explicit/Dependency 和 Adapter 接口 HANDOFF | Core 测试、类型和包边界通过；接口变更逐项交给 Adapter 维护者；Desktop/公网/官方回执不在本阶段冒充通过 |

G0 后，G1/G2 的纯数据工作与 G6 的只读准备可并行；G3 必须在 G1 的目录合同后进行；G4/G5 依赖 G3 的冻结计划。Core 构建和包检查由主控串行执行；Adapter 构建、打包和 Desktop 验收由另一位维护者按 HANDOFF 处理。

## 6. 验收重点

1. Agent Forge v2 在线源、本地源和离线包可以转换成同一套市场目录合同。
2. 单插件 `.tgz` 和 `.eacpack` 均可在无网络环境中安装，且摘要/包身份不一致时阻断。
3. Bundle 的所有成员和所有 dependency 都可选；选择 dependency 的使用者时，依赖可用性和取消顺序得到明确提示。
4. 选择结束后才能下载和安装，执行阶段不改变冻结清单。
5. 自动检查默认开启；自动下载和自动安装默认关闭，开启后仍受任务、授权、重启和未知回执保护。
6. 普通取消返回依赖列表；只要仍有依赖它的已选/已安装项目，dependency 就不能取消。
7. Force 只级联取消安全的未完成项；仍有依赖者、explicit 安装、其他并行任务/Bundle 选择或已完成的包不会被删除，并逐项报告原因。
8. Core 为启用、禁用、安装、更新、卸载输出稳定意图、任务和 Sync Explicit/Dependency 状态，并保留失败/未知语义。
9. Core 交付包含接口修改 HANDOFF；官方 DSH、Desktop、新装、升级和真实回执由 Adapter 维护者另行验收，本阶段不宣称通过。

## 7. 不在本阶段范围

- 修改 Agent Forge 公共 schema 或把市场安装字段写入非命名空间字段；
- 任意路径安装器、客户端执行脚本、市场私有替代官方 pluginManager；
- Desktop Adapter、Client、官方 DSH 接线、Remote 转发和最终 tgz/官方 Desktop 验收；
- 默认静默下载、静默安装、静默启用、静默降级或自动卸载依赖；
- 把取消已完成任务解释成自动回滚；
- 在线作者账号、认领、自动发布、Star、TUI；
- 未经真实来源和许可材料核对的正式第三方作者收录。

每阶段报告必须列出源码提交、实际改动、命令结果、证据等级、未验证项和下一阶段依赖。本文只定义开发顺序和验收门槛，不把计划文字当作已完成事实。
