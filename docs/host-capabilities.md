# 官方 Host 能力与已知边界

目标基线：官方 Desktop `0.1.7-rc.2 / win32 x64`。源码目录不含 `.git`，不能写成某个 master commit。以下行为来自源码核对；真实安装结果另见 `ACCEPTANCE.md`。

## 已复用的官方能力

| 能力 | 官方入口 | 市场规则 |
|---|---|---|
| 当前 profile | `ctx.profileContext` | 只读绑定，不接受 Client 路径 |
| 包清单/加载行 | `pluginManager.listBundles/listPlugins` | Bundle 与插件行分开展示 |
| 安装 | `installBundle` | 只传本地已核验 tgz 与明确 enabled |
| 启停 | `setBundleEnabled/setPluginEnabled` | 保持 bundle 和行级原状态 |
| 卸载 | `removeBundle` | 服从 protected/in-use/stop-profile |
| 取消/等待 | `cancelInstall/waitForInstall` | 取消需真实回执；null 需核对 |
| 元数据/兼容 | `inspect`、manifest peer 检查 | already-installed 用于更新规划，不当最终拒绝 |
| 页面 | `main` + `sidebar.panellist` | 一个全局 EAC 页面，不占会话 |

## 关键事实

- `installBundle` 只接受有效 `dsh.bundle.patch`。普通 Host/Client 源码包不会自动变成 bundle。
- `installBundle(...,{enabled:false})` 只避免新增启用，不会把已经选中的 bundle 关闭。
- 官方安装成功不等于 Client 渲染成功或业务功能可用。
- `waitForInstall` 只看活动请求，完成后可能返回 null。
- 官方脚本授权写入 profile 的 `allowBuilds`，后续安装失败不自动撤回。
- 共享 storageDomain 默认不按 profile 隔离；市场自有数据放在当前 profile 的 `eac-market`。
- Desktop 有单实例锁。启动第二个进程可能只是聚焦已有实例，不能证明环境隔离。

## 能力降级

| 缺失 | 行为 |
|---|---|
| pluginManager 不存在 | 目录与介绍仍可读；安装/启停/卸载禁用 |
| 官方导航不可公开打开 | 给准确指引，不手写 DOM/私有 IPC |
| 前置插件待重启 | 相关 active 依赖暂停，用户重启核对后继续 |
| 活动/残留包管理进程无法确认 | 保持 needs-attention，不启动新的写操作 |
| 环境未验证 | 可由用户明确尝试；不绕过硬兼容与摘要检查 |
| Desktop 真实验收缺失 | 报告 partial，不把 CLI/Web 当完整通过 |

## 不做

不修改 `@deepseek-ai/*`，不手写用户层 bundle insert，不接管官方账号/API Key，不承诺任意第三方卸载数据保留，不执行用户 URL 源码。
