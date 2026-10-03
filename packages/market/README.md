# EAC 桌面市场适配器 0.1.0-mvp.17

这是运行在官方 DeepSeek Harness 内的 EAC 社区市场桌面适配器，当前源码候选为 `0.1.0-mvp.17`，尚未正式发布。它保留原包名 `@dsh-eac/market`，依赖独立业务包 `@dsh-eac/market-core@0.1.6`；双包正式发布后，用户安装桌面入口即可，由官方包管理器取得依赖。不要把 core 当作独立 DSH bundle 安装。

当前正式安装入口以 Gitee 发行站 README 为准。本地测试源和官方 Web 验证已完成；公网 core 下载、Desktop 新装与旧版升级尚未验收。

三个主导航仍是发现、全部插件、我的插件；皮肤在二级皮肤中心。作者工作区、插件目录、任务记录和受限 AI 提案继续使用共享后台，实际安装仍由官方 pluginManager 完成。

本版使用通信协议 v2：升级后完整退出并重启 DSH，刷新旧页面。未完成协议协商的连接不能写入。Core API 不兼容时明确失败，不自行绕过官方限制。数据仍保存在当前 profile 的 eac-market 目录，此次拆包没有重置历史或更换数据格式。

首次安装仍可能需要联网取得 core 和其他依赖；本地 tgz 不是完整离线包。市场可安装不代表所有第三方插件兼容当前 DSH，更不代表支持任意未来内核或已交付 TUI。

源码、接口与接力：https://github.com/look-back-lysj/deep-seek-harness-Unity
公开发行镜像：https://gitee.com/flowing-shadows-like-scenes/deep-seek-harness-unity-mirror

维护者从仓库 docs/CORE-ADAPTER-GUIDE.md 和 docs/handoff/START-HERE.md 开始。公开API包括根入口、/types、/remote、/typert、/client、/client/extensions；勿依赖 lib 内部路径。每包遵循各自许可。
