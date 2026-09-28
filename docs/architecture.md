# 架构与模块边界

## 1. 运行形态

市场是一个标准 DSH bundle：Host 服务运行在当前 profile 的 DSH 进程中，Client 注册官方 `main` 与 `sidebar.panellist`。它不另起端口、不创建桌面壳，不读取 Client 传来的任意文件路径。

```text
EAC页面 -> 官方Remote -> eacMarket Host -> 计划/任务 -> 官方 pluginManager
                                      ├-> Catalog/Delivery -> 已核验本地tgz
                                      ├-> Persistence -> <profile>/eac-market
                                      └-> Authoring -> 草稿/媒体/资料包
```

## 2. 目录位置

真正的插件包是 `packages/market`。根 `packages/typert-protocol-shim`、`packages/cordis-shim` 只用于解决独立工程的源码分析，不进入发布包；最终运行仍使用官方包。构建脚本必须确认这些 shim 不在 `npm pack` 文件清单。

`src/index.ts` 是公开 Host/Typert 根；`src/contracts` 是 Host/Client 共享 wire 类型；`src/adapters/dsh` 是唯一接触官方管理器的层。Client 不能直接读取 Node 文件系统、本机路径或私有 HTTP 端口。

## 3. 依赖方向

```text
client -> contracts
host   -> contracts -> core
host   -> adapters/dsh -> official pluginManager
host   -> catalog/delivery/persistence/authoring
core   -X-> React/Cordis/Node fs/network
```

core 保持纯函数，adapter 只翻译官方事实，UI 只消费契约。任何跨层捷径都要在决策记录说明并补测试。

## 4. 生命周期

bundle 自带 `cordis.patch.yml` 只有一个自插入行；禁止再写用户层同名 insert。Client 先 mount 生成的 `TYPERT_REMOTE`，之后才读取 `remote.eacMarket`。所有 slot、locale、事件订阅、传输任务必须可释放。

Host 写操作进入每 profile 队列。官方调用前后分别记录意图和事实，不把 `undefined` 当成功。进程退出后先核对残留包管理进程和磁盘状态，不自动重放不确定步骤。
