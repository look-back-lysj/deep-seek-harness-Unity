# 协议、源码与事实依据

核对日期：2026-09-27。本文件记录本轮规划依据，**不等于市场实现或验收报告**。未来实施每阶段都重新核对影响该阶段的基线；历史任务数量、审批和人员权限不自动延续。

## 1. 资料优先级

1. 用户本轮已确认的产品要求，见 [PRODUCT.md](PRODUCT.md)。在线作者工作流与 Star 后置是最新决定。
2. 实际目标官方 DSH 的公开类型、实现及真实打包运行结果；公开协议以所属仓库的定义为准。
3. 团队当前协作规则、固定版本的 Mojobox Schema、fixtures、生产样本、来源记录。
4. 团队交接、旧 EAC ADR 和历史代码提供背景；其中机器路径、版本和待办必须重新核实。
5. 本计划新增的数据结构仅属于市场内部，不能被宣传成官方 DSH 或全生态新标准。

《AI协作教训与团队规范备忘.md》位于 `D:/DSH-EAC/AI协作教训与团队规范备忘.md`。它的流程教训仍适用；2026-09-19 的看板/PR/权限状态不是今天的事实，旧 Rust/NSIS 检查项也不直接套用到本次纯插件交付。

## 2. 本轮基线

| 对象 | 本轮实际核对的状态 | 如何复核 |
|---|---|---|
| EAC 本地源码 | `D:/DSH-EAC/DSH-Desktop-EAC`，dev 工作树干净 | `git status --short --branch` |
| EAC dev | `2a3b6f10364be6e702fbf2e86b5671f288a9fc4e` | 本轮远端 API 与本地 refs 核对；[提交](https://github.com/DSH-EAC/DSH-Desktop-EAC/commit/2a3b6f10364be6e702fbf2e86b5671f288a9fc4e) |
| EAC beta | `7adb1cdb368aafbf04fcaa737d25f2e720a6fa80` | [交接总览](https://github.com/DSH-EAC/DSH-Desktop-EAC/blob/7adb1cdb368aafbf04fcaa737d25f2e720a6fa80/handover/TEAM-TAKEOVER-2026-09-27.md) |
| EAC beta-pack | `44178ab1360dcb8221a666e782391a11f5716074` | [源码快照](https://github.com/DSH-EAC/DSH-Desktop-EAC/tree/44178ab1360dcb8221a666e782391a11f5716074)；根为 pack-installer，含 mojobox 和 free-model 快照 |
| 官方源码 | `D:/deepseek-harness-source/deepseek-harness-master`，根版本 `0.1.7-rc.2` | 无 `.git`，不能写成已核实某个 master commit |
| 官方源码 ZIP | `D:/deepseek-harness-source/deepseek-harness-master.zip` | SHA256：`62D8E482D6C847B0948C26006B1776F3A41CF56E4249CE48B280A03E15D295D2` |
| 官方 Desktop | `C:/Users/刘沛伦/AppData/Local/Programs/DeepSeek Harness/DeepSeek Harness.exe` | 注册表 DisplayVersion 为 `0.1.7-rc.2`；本轮检查安装文件，未启动操作 |

`beta-pack/dsh-our-free-model` 是作者个人仓快照；不得把它的所有权、发布权限或许可证当然转成 EAC 组织所有。当前市场任务不接管 beta 交接中的 T1–T5，不代替别人承诺修复或发布。

本轮没有以看板状态推断市场实现已经被维护者批准，也没有发布 GitHub 评论。正式组织协作前再核对 Issue、指派、开放 PR 及 review，避免与 pack-installer 维护者重复修改。

## 3. 官方 DSH 必读索引

以下路径相对于上述官方源码目录。行号仅帮助定位，更新后按符号重新查找。

| 资料 | 已核实的结论 | 设计影响 |
|---|---|---|
| `packages/client/ui-plugin-manager/src/client/index.ts` | 通过 `main` keyed slot 与 `sidebar.panellist` 建立全局插件页；`ctx.layout.selectPanel` 选择面板，`pluginNavigation.openBundle` 打开官方插件详情 | 市场加一个独立 EAC 页面，复用官方导航，不能硬写 DOM 或旧 `settings.section` 假定 |
| 同文件的 `inject`、`ctx.effect`、`ctx.remote.$on` | 有依赖声明、语言注册、事件订阅与销毁 | 页面重复打开/卸载不得累计监听器或重复注册服务 |
| `packages/boot/plugin-manager/src/types.ts` | `ChangeResult.application` 区分 applied/restart-required/overridden/failed/cancelled；有 `pendingBuilds`、错误种类、取消结果 | 保留真实状态与脚本授权，不把缺字段默认当成功 |
| `packages/boot/plugin-manager/src/index.ts`：inspect / installBundle / waitForInstall / cancelInstall / removeBundle / change | inspect 可能拒绝 already-installed；替换已有依赖会要求重启；完成安装从活动 Map 删除；修改由官方锁保护 | 更新有独立规划；市场自己留持久任务；不能根据 waitForInstall 返回 null 判成功；不能嵌套拿官方同一锁 |
| `apps/desktop/src/host-process.ts`、`apps/desktop-host/src/index.ts`、plugin-manager 的 runPnpm | Desktop 给 profile 注入 bundled Node/pnpm 的 packageManager，官方 manager 使用它 | 不自行拼接额外 Desktop IPC，不依赖用户全局 npm/pnpm |
| `packages/storage/storage-domain/src/index.ts`、`packages/bundle/base/cordis.patch.yml`、`packages/storage/storage-json/src/single-unit.ts` | 默认 storage domain 写到 DSH_HOME 下共享 storages，不自动按 profile 隔离 | 本版市场数据使用 `ctx.profileContext.dir/eac-market`，不能只用一个全局 storage key |
| `packages/util/atomic-write/src/index.ts` 及包名 `@deepseek-ai/dsh-atomic-write` | 官方提供 `writeFileAtomic`、`withFileLock`；具体导入路径实施时核对 exports | 只锁市场自有数据；复用而非另造全局 profile 锁 |
| `apps/desktop/src/fatal-recovery.ts`、`apps/desktop/src/main.ts` | 源码有退出/重启/停用第三方插件的 fatal recovery 路径 | 可研究市场故障退出路径，但必须真实验证，不能承诺官方管理页永远可用 |

官方 Desktop 使用 `profiles/desktop`。此事实用于排错，**不可硬编码成市场的目标路径**；真实 profile 来自当前宿主 `profileContext`。旧 EAC 的 `web-desktop`、全局 `.dsh` 或扫描出来的同名程序均不是可靠目标。

### 安装格式与CLI边界（追加核实）

- `plugin-manager/src/index.ts`约543行以及`operations.ts`的bundleManifest：缺少`dsh.bundle.patch`报not-bundle，即使pnpm exitCode=0也不成功；enabled:false同样受检。
- patch文件名不是固定`cordis.patch.yml`；可声明其他有效文件。声明存在但文件无效是另一类解析失败，不能统一当无bundle。
- 当前`installBundle`约560行仅在enabled不为false时selectBundle(true)，false并不撤销之前的选择。显式禁用走setBundleEnabled；行级启停另走setPluginEnabled。listBundles不等于整个node_modules清单。
- `apps/cli/src/args.ts`的rejectElectronProfile拒绝desktop（含大小写变体）。CLI的普通依赖安装不等于被profile装载，不能用来替代Desktop官方manager。
- 因此MVP接受有效bundle tgz。非bundle的官方普通插件可以展示；作者补标准声明或独立wrapper发布后再开放安装，禁止现场偷偷生成用户层insert。

### Typert公开生成器（追加核实）

`packages/typert/generator/src/index.ts`导出WorkspaceTypertGenerator；`workspace.ts`的generate返回带packageRoot、face及代码内容的结果。`analyzer.ts`约476行仅从根聚合tsconfig直接references、且位于packages下的项目发现包。`workspace.ts`的validateExport逐条核对`./typert`、可用的`./client/typert`、Remote文件的exports与files。

`tsdown-plugin.ts`的emitArtifacts仅生成Typert/Remote产物，`lib/types/types.js`仍由TypeScript构建输出。`packages/api/gateway/src/index.ts`的resolveDescriptor优先严格描述，未见过该端点时可能尝试SRC回退；必须在测试确认严格描述存在，不能只看HTTP成功。

`apps/desktop/src/single-instance.ts`显示后启动进程可退出并聚焦已有实例，启动第二进程不能证明测试环境隔离。

## 4. 三套协议各自负责什么

| 协议/约定 | 负责 | 本市场怎么用 |
|---|---|---|
| 官方 `package.json.dsh` | 插件包、Host/Client/bundle 等运行加载声明 | 必须尊重实际目标版本公开类型；标准官方插件可以被收录 |
| 社区 `dsh-std` | Manifest、facet、权限、运行时协商等生态约定 | 目录宣称遵循时按该版本验证；不是所有官方插件都必须额外实现它 |
| Mojobox | Catalog、Pack、Lock、Evidence、离线运输 | 读取/校验固定版本的公共对象，不能往其中塞用户路径或本机安装日志 |
| 市场 Host adapter | 当前 profile 能力、安装计划、用户确认、任务记录、官方服务调用 | 只在这一层访问本机状态；不宣称达成未经验证的全量事务回滚 |

`beta-pack/mojobox/AGENTS.md`、`CONTRIBUTING.md`、`docs/architecture.md`、`schemas/`、`fixtures/`、`spec-revisions.json` 是协议必读集合。

本轮进一步读`schemas/pack.schema.json`：components为id/version/required，requires只含hostCapabilities/platforms，**没有组件间依赖图**。因此安装顺序和“失败后哪个组件可继续”必须有市场私有、绑定Lock的执行资料；不能假称公共Pack已经提供了关系。

Mojobox 快照中记录的上游坐标包括：dshStd `0.15 / 3df054302468d2091859db4b3bd079042d33f100`，官方 metadata 投影 `c291e7961a515f6d7af9304e7fd1d257929aef26`，ecosystem `84a305dfebdc3d90f738bac859fe404656a82d24`。这些是其固定输入，**不是本机官方 ZIP 对应提交的证明**。

实施前每种输入至少读一个合法 fixture、非法 fixture、真实生产样本。不能仅根据文件名臆造 JSON Schema。

## 5. 摘要、内容与来源

- `manifestDigest` 是 Manifest 原文件字节的 SHA-256；重新排版 JSON 也会变化。
- `artifactDigest` 是具体插件包的字节摘要。同名同版本不代表字节相同。
- 内容介绍采用独立 Presentation 文件，多镜像采用独立 Delivery 记录；**不改公共 Lock 字段定义**。用插件 ID、版本、artifactDigest 做对应关系。
- 技术 Manifest、Presentation、Delivery、Evidence 各自版本化。修改介绍不应让既有安装证据和制品摘要失效。
- SHA256 说明文件与预期一致，不证明作者身份或绝对安全。没有签名验证过程就不显示「已验签」；没有当前环境运行证据就不显示「当前版本验证通过」。
- 官方包安装过程中仍可能获取传递依赖（插件依赖的其他包）。本市场固定顶层插件包摘要，不冒充离线闭包完整签名或供应链整体认证。

## 6. 现有安装器可以参考，不能直接复制的行为

下列定位来自 `beta-pack@44178ab`，是本轮计划已发现的风险：

| 定位 | 风险 | MVP 要求 |
|---|---|---|
| `src/client/typert-remote.ts` 引用 `/types#...`；package exports 缺 `./types` | Host 可能成功而 Client schema 解析失败，甚至触发整屏失败 | M0 先打包 smoke；检查所有运行时 schema 模块与 exports 的闭环 |
| `src/core/installer.ts` 首失败就返回，测试也锁此行为 | 不符合已确认的「保留成功、继续无关项」 | 重写任务汇总与依赖暂停规则，不能直接复用旧测试期待 |
| `src/core/catalog.ts` 读 digest，但安装调用未形成强制验证链 | 目录写了摘要却安装另一份字节 | 下载到本地、验证、安装同一文件并验证实际包身份 |
| `src/adapter/ports.ts` CLI fallback 忽略 enabled | 用户选关闭仍被启用 | MVP 优先官方 manager；不可证明同语义的 fallback 不开启写入 |
| `src/protocol.ts` 安装请求没有绑定确认时套餐版本与计划 | 确认后目录变化可能改变实际安装内容 | 使用 Host 保存的不可变计划与 planDigest |
| adapter 对缺 application 使用 applied 默认 | 把不认识的结果显示成成功 | 未知字段、响应丢失进入核对/未知，不能绿灯 |

团队交接已纠正过两类误诊：bundle 自带 `cordis.patch.yml` 的 insert **必须保留**；重复注册来自另写用户层同名 insert。旧 EAC 附带的插件管理 stub 也不等于官方完整版。禁止把旧 stub、手工 junction 或私桥当官方端普遍必需安装步骤。

两种历史 `.dshpack` 不是自动互通协议；完整离线包后续须先识别格式与版本。本次作者介绍资料包另用独立标识，不能复用这个后缀。

官方`plugin-manager/src/index.ts`约473行会先approveBuilds，`src/build-approval.ts`写profile的allowBuilds。`tests/manager.spec.ts`约522–528行明确验证“之后安装失败，已批准权限仍保留”。官方`tests/operations-process.spec.ts`还覆盖残留包管理进程记录，但本次没有在Windows复现Host退出后的进程行为；计划将它列为恢复写入的验收条件。

## 7. 仍必须用实验确认的事项

| 事项 | 在哪里解除不确定性 | 未通过时 |
|---|---|---|
| 新市场包的 Typert 生成、Client-only imports、官方 peer 解析 | M0 最小打包插件 + 官方 Desktop 隔离实例 | 不进入大规模 UI 开发，不用官方源码补丁假装兼容 |
| 本地 `.tgz` 安装后的 dependency 记录、锁文件与卸载清理 | M1 Host adapter 合约实验 | 若保存 file 路径则必须保留引用缓存；不能先定可清理策略 |
| Desktop 第二实例是否隔离 userData/profile、是否被单例逻辑转发 | M0 启动证据核对 | 不操作真实用户环境，改用专用 Windows 账号/隔离环境 |
| 第三方发布源是否确有可下载且一致的 GitHub/Gitee 文件 | M3 来源登记与真实下载 | 标无制品/源不可用，不造地址、不跳过哈希 |
| 官方原生恢复对市场 Host/Client 故障是否可用 | M5 故障演练 | 写明限制，修市场加载问题；不能声称全部可恢复 |

## 8. 许可证与署名

安装器和 Mojobox 快照已读许可证为 MIT，但版权署名主体不同。参考或复制时保留实际 LICENSE/NOTICE 及来源提交。第三方插件、截图、图标、README 内容逐项记录来源和许可；市场代码许可证不能覆盖它们。

公共接口/API 兼容不等于获得第三方代码重新打包许可。首版只收录演示所需的真实授权样本或自建测试插件，正式名单以后跟进；测试 fixture 不得混入生产推荐。

## 9. 实施证据记录模板

```text
对象/问题：
查阅时间：
源码目录、提交或归档摘要：
文件、符号及相关协议版本：
直接观察到的事实：
仍属推断/尚未执行的事项：
复核命令或真实操作步骤：
脱敏证据文件位置：
对方案的影响：
```

涉及 GitHub 的事实应保存来源 URL、时间及必要响应字段，不保存 cookies/token。资料失效时更新事实记录；不要修改旧报告，把未跑的验证事后写成通过。
