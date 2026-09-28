# 市场扩展合同 v1 与接线指南

本目录落实 E05/E06 及 E07 的扩展接缝。共同合同由主控维护的 `contract.ts` 冻结，本次 E 没有改动它。界面、Remote、Host 安装器、根 package/build 配置不属于 E 的写范围。

## 两种接法和五个位置

| 接法 | 调用 | 发布/生命周期 |
| --- | --- | --- |
| 团队内置 | `registerBuiltinExtension(host, owner, definition)` | 随市场构建；仍经完整合同校验；owner 销毁自动删除 |
| 独立官方插件 | `ctx.inject(['eacMarketExtensions'], scope => scope.eacMarketExtensions.register(scope, definition))` | 由官方标准 bundle 加载；市场出现时登记、消失时清理、恢复后重登记 |

共同注册表只接收首页补充、更多菜单、扩展二级页、市场详情补充、作者工具五位置。更多菜单是声明式标题与本扩展 pageId，由市场生成按钮；不得提交组件替代菜单。完整页面 key 为 `扩展ID:贡献ID`，传给 `openOwnPage` 的是自己的局部 pageId；包装层补前缀并核对归属。

详情贡献只在存在当前插件时渲染；`pluginIds` 可限定范围。核心三主导航、安装/确认流程、兼容状态不属于可注册的位置。忽略/冒充 `priority` 不被允许：未知字段拒绝，官方投影固定 priority=0；展示顺序为 order 升序、完整 key 字典序，官方投影据此生成排序序号。

`provider` 仅说明经过内置还是独立接入函数，不认证作者。ID、版本及提供方文字均为扩展自报；UI 明确标注。

## 主控接线（签名已冻结）

```ts
createMarketExtensionHost(options: MarketExtensionOptions): MarketExtensionController
attachDshService(ctx: Context, host: MarketExtensionController): () => Promise<void>
createDshExtensionRenderer(renderSlot: MarketExtensionSlotRenderer):
  (props: ExtensionSurfaceProps) => ReactNode
renderExtensionSurface(props: ExtensionSurfaceProps): ReactNode
```

`MarketExtensionOptions` 是真实 `marketVersion`、真实 `dshVersion`、市场实际提供的 `capabilities` 和可选 `onIssue`。`MarketExtensionController` 实现冻结的 `MarketExtensionHost`，额外提供内置登记、restricted `service` 与 `dispose`；独立插件拿不到整个控制器。

`ExtensionSurfaceProps` 为 `{ host, slot, context, pageId? }`，完全匹配 C 的 `MarketPage.renderExtensionSurface`。两种渲染函数用途如下：

| 渲染方法 | 作用与限制 |
| --- | --- |
| `createDshExtensionRenderer(props.renderSlot)` | 正式官方路径。使用父注册项真实传入的渲染能力，与官方 slots 声明/注入/销毁相连。主控当前采用此法 |
| `renderExtensionSurface` / `<ExtensionSurface>` | 直接订阅同一受检注册表，适合独立组件测试或非官方包装；不冒充官方 slot 渲染证据 |

主控应在其现有 `main` 注册项内使用 `children: EXTENSION_CHILDREN`，把该注册组件获得的 `props.renderSlot` 传给工厂，再把 `extensions={host}` 和返回的函数传给 `MarketPage`。**不能用 `ctx.slots.renderSlot` 替代**，官方服务的这个方法只渲染根槽位。

市场 Client 需要真实静态 `inject: ['remote', 'slots', 'locale', 'layout']`。创建 host 后调用 `attachDshService`；它使用 `ctx.effect` 管理服务发布、五位置投影和 host 销毁。既支持 activation 显式释放，也支持 Cordis fiber 卸载；重复清理无害。

2026-09-28 只读核对主控 activation：`remote.hello` 有界8秒，使用真实版本创建 host，失败不猜版本且不关闭普通页面；`children` 和实际 `props.renderSlot` 接线正确；反序清理先退出页面声明，再拆扩展服务。未发现这处接线的确证问题。该结论不等于官方 Desktop 最终包验收。

## 校验和版本范围

登记整组验证：API版本、标准 SemVer 版本、市场/DSH范围、必需能力、位置、ID、菜单与页面关系、组件/字段形状、有限排序、详情过滤项。全部通过才对订阅者发布；失效 owner 或初始化失败回滚。重复扩展 ID 跨两适配器拒绝；贡献 ID 在本扩展内唯一。解除登记同时终止信号，旧句柄不能删除后来同 ID 的实例。

必需能力缺失会拒绝这一扩展；可选能力取双方交集。某一扩展拒绝不影响其余已注册扩展。

范围支持精确完整版本、`^`/`~`完整版本、比较符与空格组成的 AND，以及 `||`。`*`、`1.x`、`1.2`、hyphen range 等未实现语法明确拒绝，不近似解释。版本比较复用现有严格 SemVer 比较器；预发行版本必须在同一比较组中明确出现同一主/次/补丁基数。

例如市场 `0.1.0-mvp.1` 使用 `>=0.1.0-mvp.1 <0.2.0`，DSH `0.1.7-rc.2` 使用 `>=0.1.7-rc.2 <0.1.8`。`^0.1.0` 不包含 mvp。升级到新的 rc 基数也应重新核对范围与官方源码。

这里采用有界表达式而不增加运行时依赖：好处是打包不依赖偶然存在的传递包，未知语法明确报错；替代方案是主控今后批准显式 `semver` 依赖，支持完整 npm 语法，但须同步 peer/产物与预发行测试。目前不要运行时引用工作区中碰巧安装的传递依赖。

## 上下文、异步和失败处理

包装层逐字段复制并冻结上下文、插件摘要、草稿快照与能力数组。不会展开整个传入对象，不暴露 raw ctx、Remote、核心状态 setter、任务创建、确认参数、密钥或个人路径。

`requestInstallReview` 只转交插件ID、确切版本、64位SHA256摘要；额外 `confirmed`、URL等字段拒绝。核心还须用当前目录核对这些字段并展示预检确认。`previewDraftChange` 必须匹配当前草稿和 revision，只打开差异预览；保存仍由作者工具确认执行。能力动态撤销、上下文信号终止、贡献移除后保留的回调不可继续请求。

每条贡献单独错误边界，渲染失败只显示该贡献的故障提示；不会带走整个市场。上下文的四个动作自动捕获同步异常及 Promise 拒绝。内部诊断仅上报代码和贡献标识，不默认显示可能包含秘密的原始异常文本。

团队内置组件可使用 `useExtensionRuntime()`：`guard(handler)` 包装事件，`run(work, accept, timeoutMs)` 管理 Promise，`effect(setup)` 登记清理。默认15秒超时，最大120秒，超时/销毁取消信号并忽略迟到结果；`accept` 自身的异常也会被接住。工作必须合作处理 AbortSignal，取消不能逆转已完成的副作用。React StrictMode 的清理/重挂和50次开关已单独覆盖。

独立示例只用自动受管的上下文动作，不运行任意额外异步任务。独立作者新增自有 async/event/effect 时，必须在自己的包里显式捕获异常、监听 context.signal 并移除监听/定时器；需要公共运行时 helper 时，由主控在真实 Client 主模块导出并核对加载声明。当前 `./extensions` 是 type-only SDK 用法，**不能假设其默认 contract.js 是一个已注册的浏览器子模块**。React 错误边界不会自动捕获作者所有事件和 detached Promise。

## 官方源码依据与信任边界

已读取本机官方0.1.7-rc.2归档（无git，不编造commit）：

- `packages/client/ui-slots/src/index.ts`：`SlotMap`、`ChildrenDecl`、`SlotCore.register`、list id / keyed key、priority、`releaseChildren`；只合并类型不会产生运行时声明。
- `packages/client/ui-renderer/src/client/registry.ts`：`SlotRegistry.inject` 等待声明并在撤销后清理/重建；`register` 用调用者 effect；`renderSlot` 的服务级入口仅供 root。
- `packages/client/ui-renderer/src/client/scoped-slots.tsx`：父 `renderSlot` 授权与 owner/inject/standard props 合成；E只把明确的 context 给扩展组件，其余框架 props 丢弃。
- `packages/client/modules/src/client/manifest.ts`、`system.ts` 与 Node `src/index.ts`：官方包图、`window.__ModuleLoader__.load({id, factory})`、平台 React、`./client`发现及包依赖和Cordis服务依赖的区别。
- 已安装 Cordis4.0.4 `src/reflect.ts`、`fiber.ts`、`registry.ts`：`reflect.provide`、effect幂等撤销、`ctx.inject` 的可等待子fiber。

这是同一 JavaScript 环境中受审插件的协作合同，**不是安全沙箱**。不能阻止恶意插件绕过合同访问宿主、修改DOM、死循环或执行自己已拥有权限的操作。目录里的URL不能注册脚本；独立包只能通过官方加载器按其安装状态加载。真正不可信代码执行需要另行设计隔离进程/worker/iframe及通信权限，不在本轮范围内。

## 示例、验证与升级

可执行源码位于 `examples/market-extension/`，独立包 `@dsh-eac/market-extension-example@0.1.0-test.1`。它含实际 Host 入口、实际 Client 组件、五位置、标准 bundle patch；只依赖宿主 React，市场类型导入编译后擦除。它的包 metadata 没把服务名错填成 npm包依赖，也不会为了 optional市场自动拉取市场。

扩展升级保持稳定 ID；旧 fiber 销毁后登记新定义。相同ID并存拒绝，不使用优先级覆盖。改变 API major 应先更新冻结合同、两适配器、主控 SDK、样例与兼容测试；不要通过类型断言悄悄跨版本。卸载无需迁移用户profile，本实现无扩展持久数据。

实际验证命令与证据分级见 `tests/extensions/README.md`。E交付的tgz、报告位于 `D:/eac-market-verify/implementation-20260928/E-extension/`。最终市场构建/打包、SDK配置以及官方Desktop安装由主控接管。正式Desktop中“不重打市场独立安装示例、启停、卸载”的最终验收仍待主控执行。
