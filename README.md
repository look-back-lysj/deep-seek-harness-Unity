# EAC Market

官方 DeepSeek Harness Desktop 内的 EAC 插件市场标准 bundle。当前是独立私有开发工程，目标是让新手能看懂插件、确认版本变化并通过官方插件管理器安全安装。

**继续工作先读 [下一模型接力入口](docs/handoff/START-HERE.md)。** 2026-09-28 实际体验发现核心流程缺陷，当前实现为 partial；后续产品决定、修复清单、AI 守则和新验收要求由该入口统一指引。代码仍在本地，尚无 Git 提交或远端。

## 功能目标与现有工程范围

- 发现、全部插件、我的插件三个主页面；
- 单插件/套餐计划、精确制品校验、官方安装、任务与真实结果；
- 手动更新、启停、官方允许的卸载；
- 作者本地 Markdown 编辑、公开 README 导入、资料包导入导出；
- 目录缓存、部分成功、脚本授权、等待重启和恢复核对。
- 已确认的下一轮升级：混合商城、人工精选与规则排序、系统组件折叠，以及 DSH 默认模型无工具分析＋用户确认后有限执行；AI 尚未实现。

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

上述命令要求依赖已齐备；缺依赖先按本机下载约定准备，不自动拉取未知来源。当前干净目录的生成／检查顺序和必需声明的忽略规则仍需 S0 修复；已有 lib 下通过不能证明可重建。打包与真实测试须由主控串行调度。

最终安装物是 `packages/market` 的 `.tgz`，不是工作区根目录的源码包。构建和安装必须在隔离测试环境验证，不能把浏览器 mock 当官方 Desktop 成功。

## 真实验收

当前实际批次、产物摘要、通过项和未验证边界见 [ACCEPTANCE.md](ACCEPTANCE.md)。发布前应重新生成最终包并更新对应 SHA256。

最新失败复现见 [2026-09-28 体验审查](docs/reviews/2026-09-28-experience-audit.md)，不能用历史通过记录覆盖它。新批次按接力工作清单与 ACC 登记表逐项填证据。
