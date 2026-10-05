# Core / Desktop Adapter 底座与升级指南

状态：方案 B 实现；当前接手顺序、真实测试结果与发行状态以 [当前接手入口](handoff/START-HERE.md) 和 [最新版升级指南](UPGRADE-GUIDE.md) 为准。本文件只描述合同，不把设计当验收。

2026-10-04媒体合同为兼容性扩展：`CatalogPlugin.media?`和`CatalogListing.media?`保留图标、有序完整预览及声明theme，图片使用既有id/alt/sourceUrl；旧字段screenshots/presentation.media仍提供完整预览。Core负责严格元数据校验、公开投影和原字节身份；Adapter只转发API；Client负责图片加载、失败、重试、放大和展开。不下载/缓存/代理图片，不把media/theme当适配或安装授权，未新增业务Remote或提高最低协议。详见[接线计划](handoff/AGENT-FORGE-MEDIA-PLAN-2026-10-05.md)与[实施实录](handoff/AGENT-FORGE-MEDIA-IMPLEMENTATION-2026-10-04.md)。

## 1. 决策与替代方案

用户选择同仓两个包。`@dsh-eac/market` 保留旧安装身份和桌面入口；`@dsh-eac/market-core` 是新增依赖库。暂不增加第三个宿主包、不开发 TUI、不变更市场导航或第三方插件目录。

只拆源码仍合成一个包更省发行工作，但不能独立复用发行产物；把宿主再拆第三包边界更细，但当前维护成本过高。因此保留 core 内独立 `dsh` 入口，业务模块与官方接线仍分目录。

## 2. 总目录和所有权

```text
packages/market-core/
  src/index.ts              安全根入口，只暴露合同和版本
  src/api.ts                MarketBackend 公共业务接口
  src/dsh.ts                DSH 托管工厂，唯一公开的运行时入口
  src/contracts/            页面数据合同、版本兼容规则
  src/core/                 规划与任务协调
  src/adapters/dsh/         官方管理器及原子写适配
  src/host/                 业务组装、AI 分析/确认规则
  src/catalog/ delivery/ persistence/ authoring/
packages/market/
  src/index.ts              官方 Cordis/Typert 服务，连接身份及写入协商
  src/session-gate.ts       有界、会过期的连接协议登记
  src/types.ts              旧 /types 入口的兼容转发
  src/client/               桌面界面与扩展、Remote 调用保护
  data/index.json           随包目录，原字节交给 core
  cordis.patch.yml          仍仅注册一个市场服务
scripts/build.mjs           core → 类型/Remote生成 → adapter，串行
scripts/verify-package.mjs  包导出、实际构建边界、生成接口检查
scripts/pack-release.mjs    固定 core 来源，准备两个不可变 tgz
```

UI 人员只改 `market/src/client`。业务人员只改 core 对应模块；DSH 升级优先查 core/adapters 与 market 的官方入口。公共合同、manifest、构建、发布锁与总文档由一个集成人员负责。接口先评审再并行，不让两个人同时修改锁文件或运行构建。

## 3. 依赖和公开接口

桌面页面经官方 Remote 调用 `MarketService`，服务经 `MarketBackend` 调用 core，最终由官方 pluginManager 执行安装。Client 不能导入 `./dsh`、Node 文件系统或 Host 内部实现。

公开 API 类型见 [MarketBackend](../packages/market-core/src/api.ts)，每个入口保留原始领域结果：`failed`、`unknown`、`restart-required` 等不能压成一个布尔值。

| 方法组 | 责任与约束 |
| --- | --- |
| catalog / inventory / capabilities | 返回当前目录、官方事实及实际可用能力；未知不推定成功 |
| planCreate / taskStart | 冻结目标、来源、摘要、环境；可信 callerId 绑定预检与确认 |
| taskGet/List/Events/Cancel/Resume/ApproveBuilds | 同一任务生命周期；取消不等于官方写入已撤销 |
| pluginSetEnabled / pluginRemove | 沿统一写协调；不允许市场自己管理 core/adapter |
| pluginActionRecover | 原身份只读查询，区分官方receipt与完整result；缺维护/业务凭证保持unknown |
| author* | 本地资料与受限传输；导出不等于上架，不接受任意本机路径 |
| aiAnalyze / aiConfirm | 仅提案，业务层校验后按既有确认执行；卸载/降级保留额外确认 |

调用者身份由官方 `invocation.peer.id` 提供。握手中的 adapterVersion 仅用于诊断，不能授权用户，也不能代表用户已同意操作。生产代码不使用隐式 `local-operator`；底层旧实现默认值仅为已有测试兼容保留，公开工厂拒绝缺少身份的调用。

原 `@dsh-eac/market`、`/types`、`/remote`、`/typert`、`/client`、`/client/extensions` 继续可用。合作作者不用因这次拆分改包名。core 的源码和内部编译路径不是公共 API。

## 4. 三种版本分别管理

1. npm 包版本表示发布文件，任何字节变化都需要新版本/新摘要。
2. Core API 版本表示 adapter 与业务库的约定；adapter 有编译时最低版本，启动先核对。
3. Remote 协议版本表示页面与后台的约定，本轮升至 v2，因新增写前强制协商属于不兼容行为变化。

协议 v2 的 `clientConnect` 以官方连接为键登记。失败、过期、重连或不兼容后不得沿用旧许可；每次副作用调用前重新协商。Host 同时拒绝未协商连接，不能只禁用一个按钮。连接记录上限 512、有效期 5 分钟；被淘汰或过期的页面重新协商即可。旧缓存页面可读取 hello，但写入会提示刷新。

同主版本的新增方法可通过小版本增加；要求较新小版本的消费者不能连接旧提供者。主版本不匹配、非法或未知版本拒绝。协议协商不是恶意插件的安全隔离。

## 5. 存储与生命周期

继续使用 `<profile>/eac-market`，environmentId 算法、任务 schema3、作者草稿、目录接受历史保持原语义；不因拆包创建另一份空历史或清空坏记录。保持未知执行的写入阻断，不重放没有官方回执的操作。

管理schema1兼容增加私有completion：在现有execution锁内保存维护提交revision及完整业务结果，摘要绑定原fingerprint与官方回执。已完成原操作按原记录恢复，不从新库存或not-found猜结果；旧记录无completion仍unknown，损坏凭证拒绝。查询不写维护状态，显式原管理调用补提交也必须核实原目标且不再次执行官方动作。此扩展不增加公开Remote、不提高最低协议；前端原请求指针与交互中间态仍由Client维护。

Adapter 从自己的 `data/index.json` 读取原始字节传给 core，避免移动文件夹后目录丢失或摘要变动。Core 不根据工作目录或旧路径猜测资源。UI 关闭只释放自身订阅；Host 仍拥有业务任务。

一个 profile 一份 `eacMarket` 后台。多个界面共用服务；不要因安装了两个 adapter 就启动两套后台。未来 TUI 的进程/连接/生命周期必须先做最小验证，不能把同名 npm 依赖当作跨进程单例。

## 6. 构建、打包和发布

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
```

在 workspace 中用精确 `workspace:0.1.0`；发布时必须转换为精确版本或已核验的固定 URL，不能把 workspace/file/link 开发路径泄漏给用户。使用仓库发行脚本：先在隔离 staging 中转换本地 core 依赖，再运行 npm pack。官方 DSH peers 的 `workspace:*` 是跟随宿主的特殊合同，必须原样保留；不可直接 pnpm pack 把它固化为开发机旧版本。

发行有两条路线：标准 registry 精确版本更便于依赖管理，但须先发布 core；固定 HTTPS core 制品适合现有 Gitee/GitHub 文件镜像，但固定地址不可达会影响首次安装，市场自己的多源下载不能替尚未启动的自己兜底。当前底座保留两者，由发布者明确选择。

```sh
pnpm pack:release --out-dir D:/eac-market-verify/release-candidate --registry-core
pnpm pack:release --out-dir D:/eac-market-verify/release-candidate --core-url "https://实际发行主机/固定提交/artifacts/sha256/{sha256}/{filename}"
```

第二行是语法示例，不是可下载地址。先准备并上传 core，再核验远端字节摘要；最后发布固定依赖该 core 的 adapter。只有文件存在或 HEAD 200 不算摘要验证。`--registry-core` 只生成候选包，不证明 registry 已有对应版本。

禁止覆盖同版本旧 tgz。输出 `release.json` 记录两个包摘要、依赖来源、源码提交和 dirty 状态；test-only 产物不能公开当正式包。固定版本更新时可只改 adapter 依赖声明、不改 UI 源码，但仍需新 adapter 版本和完整重启验收。

## 7A. 发现页与全部插件的最小合同

发现页不自己猜推荐。Core 目录返回同一份版本绑定的插件、Presentation、媒体和推荐投影；Desktop adapter 只负责把投影排成页面。推荐投影至少包含：

| 用途 | core 返回的条件 | adapter 展示 |
| --- | --- | --- |
| 首推海报 | placement=featured、有效期限内、引用精确插件版本、理由非空 | 海报轮播；媒体可用就显示图片，缺图或图片加载失败就降级为插件名＋简介文字卡 |
| 推荐皮肤 | `placement=recommended-skin` 且插件 `kind=skin`、可安装或明确研究状态 | 推荐皮肤横向卡；无条目时隐藏整块，入口仍指向皮肤中心 |
| 高分插件 | `placement=top-plugin`、有来源的 `score`、非 skill/skin | 按 score 降序展示；未知分数、硬不兼容或撤回条目不进入 |
| 高分 skill | `placement=top-skill`、有来源的 `score`、条目标记为 skill | 按 score 降序展示；没有有效条目时隐藏整块 |

评分是维护者目录事实，不是用户评价系统。score 只用于排序和说明，不能改变安装验证、依赖检查或用户确认。所有推荐仍受 catalog 的撤回、生效/过期、版本和来源校验；来源失败时保留旧缓存并标 stale，不能把旧推荐伪装成最新。

全部插件页消费同一 CatalogSnapshot.plugins 投影：默认网格展示可安装条目，用户可以切换到全部记录查看缺制品或未验证条目；任何不可安装条目必须显示原因并禁用安装动作。adapter 不维护第二份插件列表，也不复制 core 的排序算法，只把筛选条件传给本地纯函数并保留结果解释。

## 7. 后续扩展与最小验收

- 新业务：先改合同/失败分支与测试，再接 core，最后接 UI；保持各端相同确认规则。
- 新官方版本：查元数据、管理器结果、原子文件、Remote/slots，不改官方源码绕过限制。
- TUI：先做目录/库存/预检，确认宿主、连接身份和 profile 归属；再接相同确认与任务接口。React 图文扩展不等于终端扩展。
- 新皮肤/作者插件：继续既有 Catalog/Delivery/作者协议，不因为 core 分包重新定义第三方标准。

必须验证：两包独立导入与单向依赖、只安装 adapter 自动取得 core、缺 core/来源不可达不假成功、API/协议错配零写、旧记录读取、核心与入口受保护、冷启动与重启、最终 tgz 对应源码。真实 Desktop 未完成时明确记 partial；本地/合成测试不替代正式源网络或全部第三方业务。
