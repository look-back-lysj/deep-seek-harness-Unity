# Deep Seek Harness Unity · EAC Market

官方 DeepSeek Harness Desktop 内的 EAC 插件市场标准 bundle。当前是独立私有开发工程，目标是让新手能看懂插件、确认版本变化并通过官方插件管理器安全安装。

私人协作仓：[look-back-lysj/deep-seek-harness-Unity](https://github.com/look-back-lysj/deep-seek-harness-Unity)。名称中的空格转换为 GitHub 合法连字符；未更改插件运行包名。

**继续工作先读 [下一模型接力入口](docs/handoff/START-HERE.md)。** 2026-09-28 第二轮独立复查已亲自通过官方安装页安装市场，并通过市场安装无害测试插件；同时复现试装确认失效、列表不刷新、刷新误报及安装恢复缺口。当前为 **partial 开发版本，不是完成可靠验收的发行版**。Git 实现基线为 `ea84b9f`，当前远端与上传状态以 Git/GitHub 实际记录为准。

本轮交付：[真实复查](docs/reviews/2026-09-28-independent-review.md)、[下一阶段实施计划](docs/NEXT-STAGE-PLAN.md)、[作者／分发／双扩展接口](docs/ECOSYSTEM-INTERFACES.md)、[多智能体提示词](docs/handoff/NEXT-AGENT-PLAYBOOK.md)。本轮整理文档与审查证据，没有提前实施这些修复。

## 功能目标与现有工程范围

- 发现、全部插件、我的插件三个主页面；
- 单插件/套餐计划、精确制品校验、官方安装、任务与真实结果；
- 手动更新、启停、官方允许的卸载；
- 作者本地 Markdown 编辑、公开 README 导入、资料包导入导出；
- 目录缓存、部分成功、脚本授权、等待重启和恢复核对。
- 混合商城、系统组件折叠及 AI 有实现骨架；AI 正常确认链和诊断材料尚未接通，不能当成可用功能。
- 下一轮同时支持作者标准发行包与授权团队构建，以及团队内置模块与独立合作 DSH 插件扩展；具体范围见接口计划。

不在 MVP：在线投稿/认领/发布、GitHub 登录、所有 Star 功能、静默自动更新、完整离线包、全系统恢复。

## 工程结构

真正发布物位于 `packages/market`。`docs/` 是产品、架构、协议、UI、测试和升级文档；`tests/` 包含单元、目录、作者资料、Client 和隔离 fixture。详细入口见 [docs/index.md](docs/index.md)。

## 开发检查

```powershell
pnpm.cmd build
if ($LASTEXITCODE -ne 0) { throw '构建失败，停止后续步骤' }
pnpm.cmd check
if ($LASTEXITCODE -ne 0) { throw '检查失败，停止交付' }
pnpm.cmd test:catalog
if ($LASTEXITCODE -ne 0) { throw '目录专项检查失败，停止交付' }
Push-Location -LiteralPath '.\packages\market' -ErrorAction Stop
try {
  npm.cmd pack --dry-run --json
  if ($LASTEXITCODE -ne 0) { throw '打包清单检查失败' }
} finally {
  Pop-Location
}
```

上述命令要求依赖已齐备；缺依赖先按本机下载约定准备，不自动拉取未知来源。生成入口和必需声明已入库，新 checkout 仍须自行验证重建，不能引用旧 lib 的通过。`check` 已包含 build/test/pack 检查，不要在 worker 仍改产物时重复运行。打包与真实测试由主控串行调度。

最终安装物是 `packages/market` 的 `.tgz`，不是工作区根目录的源码包。构建和安装必须在隔离测试环境验证，不能把浏览器 mock 当官方 Desktop 成功。

## 真实验收

当前实际批次、产物摘要、通过项和未验证边界见 [ACCEPTANCE.md](ACCEPTANCE.md)。发布前应重新生成最终包并更新对应 SHA256。

最新失败复现见 [第二轮独立复查](docs/reviews/2026-09-28-independent-review.md)，不能用历史通过记录覆盖它。新批次按 REV、旧 AUD/ACC 和新 E 接口登记。私人源码仓用于协作保存，不自动成为面向用户的插件下载源。
