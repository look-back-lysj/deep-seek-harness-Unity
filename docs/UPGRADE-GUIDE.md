# EAC 市场当前升级指南

当前正式安装版是 0.1.0-mvp.9 单包。源码协作分支正在维护 Core / Desktop Adapter 双包候选：桌面适配器 @dsh-eac/market@0.1.0-mvp.10 与核心包 @dsh-eac/market-core@0.1.0，尚未正式发布。

## 普通用户

1. 从 Gitee 发行站根 README 复制固定的 mvp.9 tgz 地址，在官方 DSH 的「插件 → 添加插件」中安装。
固定下载地址：https://gitee.com/flowing-shadows-like-scenes/deep-seek-harness-unity-mirror/raw/dbeb4b7f0e655f7bdd299a8e40d59af83f0e7da0/artifacts/sha256/a8856180264fea4ba949ac6505c10a71bbf512cfa0dda253992994711904be7c/dsh-eac-market-0.1.0-mvp.9.tgz
2. 点击「立即启用」，完整退出并重新启动 DSH。
3. 打开 EAC，确认发现、全部插件、我的插件三个主导航可用。
4. 升级或降级时保留当前 profile 的 eac-market 数据；需要重启、部分完成或失败时按官方实际结果处理。

不要把源码候选、源码 ZIP、目录 JSON 或 core 包单独填入官方安装框。首次安装依赖仍可能需要联网。

## 双包协作状态

双包将把业务 core 与桌面 adapter 解耦。发现页的首推海报、推荐皮肤、高分插件和高分 skill 由 core 返回版本绑定的目录投影；adapter 负责海报轮播、无图文字卡和整齐网格。没有真实推荐、评分或图片时，前端隐藏对应分区或使用明确降级，不猜数据。

双包候选已在本地测试源空缓存和官方 Web 环境完成雏形验证。公网 core 下载、Desktop 新装、mvp.9 升级、跨平台和 TUI 仍需单独验收；完成前不要替换正式安装入口。

## 维护与发行

- 修改源码先读接手入口、Core / Adapter 接口指南和当前文档总目录。
- 新制品使用新版本和新 SHA256，禁止覆盖已发布的同版本字节。
- Core 与 adapter 必须绑定精确版本和真实来源；本地 workspace 或 test-only 地址不能对外发布。
- README、随包说明或发现页合同变更后重新构建、测试并记录源码提交；旧摘要只作历史证据。
- 缺少真实制品、许可证、来源或宿主回执时标记待补，不把目录记录或静态测试写成已安装。
- 不提交凭据、真实 profile、会话日志或无许可素材。