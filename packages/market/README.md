# EAC 插件市场 0.1.0-mvp.9

官方 DeepSeek Harness Desktop 内的标准 bundle。0.1.0-mvp.9 已完成 DSH 核心宽泛准入改造；官方 0.1.7-rc.2 与 0.2.0-rc.1 兼容门禁通过，0.2.0 隔离 Desktop 真实加载通过。安装并启用后，从侧边栏 EAC 打开。

三个主导航：发现、全部插件、我的插件。皮肤集中到二级皮肤中心；先装管理器、再装皮肤、最后主动应用。切换使用真实 uiSkinLoader，缺服务时给引导，不假报成功。

随包目录可直接浏览。默认只展示可安装功能，待适配内容放在“全部记录”。刷新目录在Gitee失败时转到已登记的GitHub公开来源；新增作者包使用Gitee镜像及作者原始下载源，不需要发布令牌或本机预热缓存。未验证的插件需要明确选择尝试；缺包、旧私桥及官方同名冲突不开放安装。下载成功不等于安装成功，请查看任务和官方库存。

已有市场升级后，请完整退出并重新启动DSH，使后台和界面同步到同一版本。

市场提供确认后的官方安装与管理、作者本地图文/资料包、受限AI提案和协作扩展接口。没有在线投稿、GitHub登录、自动Star或任意命令执行。AI真实模型、所有第三方业务和其他平台未统一验收，不能视为保证。未来 DSH 若更改官方管理器、ChangeResult 或 atomic-write API，市场会安全报告未知状态；“宽泛准入”不等于任意未来 API 免改运行。

公开发行镜像：https://gitee.com/flowing-shadows-like-scenes/deep-seek-harness-unity-mirror

源码和维护文档：https://github.com/look-back-lysj/deep-seek-harness-Unity （私人协作仓需访问权）。每包遵循各自许可，部分皮肤仅可非商业使用。
