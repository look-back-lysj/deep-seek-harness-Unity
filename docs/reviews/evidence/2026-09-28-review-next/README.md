# 本轮可共享证据

均来自专用测试环境；未上传用户真实会话、profile、API Key、完整运行日志、node_modules 或安装包。截图是本次亲自操控官方 Desktop 的结果，不是浏览器仿真图。

| 文件 | 证明什么 |
| --- | --- |
| official-install.jpg | 官方插件页完成市场包安装；还要结合原始入口摘要确认被测字节 |
| market-empty-home.jpg | 真实空目录首页及原有信息层级 |
| refresh-false-success.jpg | 无目录来源时 UI 显示刷新成功；后台 failed 依据当前源码 |
| market-fixture-installed.jpg | fixture 实际安装完成，任务显示已停用与内部动作枚举；复现步骤始终未勾试装 |
| installed-missing-from-my-plugins.jpg | 完成任务后，市场我的插件仍缺新条目 |
| official-confirms-fixture.jpg | 同一环境的官方插件页已能看到 fixture |
| market-fixture-enabled.jpg | 重进市场后，通过市场启用 fixture 的实际页面 |
| probe-observations.json | 合成服务的 P01–P14 观察；P04 采用修正为合法 kind 的复查，P14 采用复查结果 |
| desktop-results.json | 关键现场、哈希、步骤与真实结果的精简记录 |

原始现场在 `D:/eac-market-verify/review-next`，包括测试 profile、单次计划与任务、49项测试输出、探针原始脚本及失败调试记录。这里只收取审查需要的精简材料。原始错误记录没有删除。

详细推理：[安装专项](../../details/2026-09-28-installation-review.md)、[试装确认专项](../../details/2026-09-28-unverified-confirmation.md)。可迁移探针在 [tools/review-probes](../../../../tools/review-probes/2026-09-28/README.md)。正式报告是 [独立复查](../../2026-09-28-independent-review.md)。
