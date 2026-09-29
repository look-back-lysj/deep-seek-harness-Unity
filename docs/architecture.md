# 架构与模块边界

现行架构为同仓两包，详细合同见 [Core / Adapter 指南](CORE-ADAPTER-GUIDE.md)。

## 运行与依赖方向

桌面页面 → 官方 Remote → market 的 MarketService → core 的 MarketBackend → 官方 pluginManager。

- packages/market：DSH bundle 入口、Cordis/Typert 服务注册、连接协商、Client/扩展和随包目录。
- packages/market-core：不带图形界面的业务库；默认入口只有安全合同与版本，/dsh 入口才创建 Node/DSH 后台。
- core 内 adapters/dsh 集中吸收官方差异，业务规划经 ports 调用；核心算法不依赖 React、DOM、Cordis 服务实例。
- Client 只导入安全合同、兼容判断和纯版本比较；不能导入 core/dsh 或业务文件路径。

Core 公开接口见 src/api.ts；工厂见 src/dsh.ts。门面冻结且显式绑定函数，不暴露原始 Context、host、tasks、files。包的 exports 没有内部通配入口。

## 资源、身份与生命周期

Adapter 读取自身 data/index.json 原始字节交给 core，不让 core 根据搬迁后的目录猜资源位置。安装身份仍是 @dsh-eac/market，后台服务仍为 eacMarket，数据仍在当前 profile/eac-market。此拆分未迁移持久化格式。

Client 先 mount 生成的 Remote 描述，再读 remote.eacMarket。每次副作用先核对协议并调用 clientConnect；Host 用官方 invocation.peer.id 登记与核查连接。协议检查不替代用户审批或官方安全边界。

一个 profile 一份后台；UI 卸载只释放自己的 slot、locale、订阅。未来多个界面共用 Host，不各起一份后台并抢写。市场文件锁不保证所有外部工具协同；未知回执保持写入阻断，不自动重放。

## 构建边界

Core 独立编译，Host 产物保留 @dsh-eac/market-core/dsh 外部依赖。Client 只合入少量浏览器安全合同和版本辅助代码。verify-package 校验实际 esbuild 图、公开导出、两包版本和 Remote 描述符。

官方 Typert 生成器在聚合 tsconfig 上使用 source 映射读取两包的同一份合同，并显式选择 core + market 的 Host 图；普通包编译使用项目引用和公开声明，运行时不依赖这些 source 映射。core 无 DSH 服务，不生成或伪造自己的 Remote 入口；现有 market/remote、market/types 等入口保留。

## 后续维护

UI、业务、官方适配分工见底座指南。合同/版本/manifest/构建只由集成人员修改，writer 冻结后串行构建与打包。新增端先复用业务接口与确认规则；TUI 渲染、连接和生命周期仍待实现，不把拆包当成 TUI 已交付。
