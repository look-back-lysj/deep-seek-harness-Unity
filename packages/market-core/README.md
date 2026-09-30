# @dsh-eac/market-core

EAC 市场的无图形界面业务包，Node 24+。普通用户安装 `@dsh-eac/market` 桌面入口，由包管理器取得本包；本包本身没有 DSH bundle，不应填入官方「添加插件」作为独立应用。

当前源码候选为 `0.1.0`，配套桌面适配器 `0.1.0-mvp.10`，尚未正式发布。自动取得依赖已在本地测试源验证，不能据此认定公网包仓库已有本包。正式安装状态以仓库 README 和发行站为准。

## 公开入口

| import 路径 | 用途 | 运行要求 |
| --- | --- | --- |
| `@dsh-eac/market-core` | 业务接口类型、通信类型、版本常量 | 浏览器安全；导入不创建运行时 |
| `@dsh-eac/market-core/contracts` | JSON 数据合同、通信协议版本 | 浏览器安全 |
| `@dsh-eac/market-core/compatibility` | Core API 版本和兼容判断 | 浏览器安全 |
| `@dsh-eac/market-core/semver` | 插件版本比较 | 浏览器安全 |
| `@dsh-eac/market-core/dsh` | `createDshMarketBackend`、启动参数类型 | Node + 官方 DSH 宿主 |

只使用 `exports` 中列出的入口。`lib/types` 的内部声明为编译器解析提供，不是允许跨包调用的内部实现 API。禁止导入源码相对路径，或把 UI/React 放回 core。

`MarketBackend` 是显式业务门面，包含目录、库存、预检、任务、管理、作者工作区和 AI 提案接口。不暴露 Cordis Context、任意文件路径操作、原始执行器或官方管理器。正式类型以 `src/api.ts` 为准。

## 创建与调用

DSH adapter 从当前宿主取得 Context、profile 身份、专属数据目录，读取自己随包目录的**原始字节**，再创建后端：

```ts
import { createDshMarketBackend } from '@dsh-eac/market-core/dsh'

const backend = createDshMarketBackend(ctx, identity, dataDirectory, {
  marketVersion: adapterVersion,
  embeddedCatalogBytes,
})
const inventory = await backend.inventory()
```

上述变量均由可信 Host adapter 提供；不是 Client 可以指定的参数。缺少目录字节时拒绝启动，不回读开发机路径。公开 `DshMarketBackendOptions` 强制要求字节；对象形式的 `embeddedCatalog` 只留在内部旧测试构造器，不属于公开工厂选项。

`planCreate`、`taskStart`、`aiAnalyze`、`aiConfirm` 必须传可信连接的 `callerId`。调用方不得用用户传入字段或固定 `local-operator` 代替身份。其他方法的审批和任务校验仍由既有业务链执行；工厂不是安全沙箱，不应向不可信脚本直接暴露。

一个 DSH profile 由一份 `eacMarket` 服务拥有后台。未来 TUI 应复用该服务，或在自己的明确 profile 中创建一份；不能让多个 UI 各自创建同 profile 后台。已有文件锁只协调市场任务，不代表能阻止所有外部工具写入。

## 版本与升级

- 包版本：`0.1.0`；公开 Core API：`1.0.0`；页面通信协议：`2.0.0`。三者用途不同。
- API 小版本只增加兼容能力；删除字段、重解释结果、改变失败意义须升主版本并增加迁移测试。
- 页面通信 v2 要求每个连接先协商再写；它不替代用户确认。旧 v1 页面需要刷新/重启。存储格式此次未变。
- Adapter 固定依赖经验证的 core 版本。仅发布新 core 不会自动升级用户已安装实例。
- DSH 的加载/安装规则仍由官方决定。本包不绕过官方兼容限制，不提供任意命令安装器。

## 维护入口

- [`src/api.ts`](src/api.ts)：后端接口清单。
- [`src/dsh.ts`](src/dsh.ts)：DSH 工厂与显式接线。
- `src/core/`：计划、执行协调、版本算法。
- `src/adapters/dsh/`：官方回执、存储与安装适配。
- `src/catalog/`、`delivery/`、`persistence/`、`authoring/`：各业务模块。
- `src/host/`：应用服务组织与 AI 规则；内部实现，不供 UI 直接引用。

仓库开发、发行、迁移及分工见 [拆包维护指南](../../docs/CORE-ADAPTER-GUIDE.md)。TUI 是后续接入目标，本次不交付 TUI 产品。
