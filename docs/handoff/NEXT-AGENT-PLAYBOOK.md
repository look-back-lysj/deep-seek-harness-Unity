# EAC 市场协作约定

更新时间：2026-09-30。本文只描述当前协作方式；旧 REV/AUD/ACC 工作编号和旧阶段分工已经随历史报告归档，不再作为新任务清单。

## 开始前

1. 读 [当前接手入口](START-HERE.md)。
2. 核对 `git status --short --branch`、两个远端和当前实际 HEAD。
3. 读与你改动对应的合同：Client 读 [UI 重构合同](UI-REBUILD-CONTRACT-2026-09-30.md)，后端读 [后端协作者指南](BACKEND-CONTRIBUTOR-GUIDE-2026-09-30.md)，跨包改动读 [Core / Adapter 底座指南](../CORE-ADAPTER-GUIDE.md)。
4. 先写清本轮范围、允许修改的文件和不变边界，再开始编辑。

## 文件所有权

- Client：`packages/market/src/client/**` 及 `tests/client/**`。
- Core：`packages/market-core/**`，只由负责 Core 的协作者修改。
- Host / DSH 适配：`packages/market/src/index.ts`、`session-gate.ts`、`version.ts` 及对应 Host 文件。
- 公共合同、构建、发布、锁文件和正式文档由主控串行处理。

不要同时让两个人改同一个公共合同、锁文件、发布脚本或总文档。需要跨边界时先提交接线说明，不要直接绕过 owner。

## 必须遵守的边界

- Client 消费现有 Remote/Core 结果，不重复实现目录、安装计划、任务执行或官方 pluginManager。
- Core 不依赖 React、DOM、桌面 UI 或用户 profile 猜测。
- 未验证的公网、Desktop、第三方作者制品和未来版本必须标记为待验，不能从本地 fixture 推断成功。
- `failed`、`unknown`、`restart-required`、`partial`、revision 冲突等真实结果不能被压成成功。
- 不提交凭据、真实 profile、用户日志、模型文件或测试密钥。
- 不强推覆盖他人分支；推送前先 `git fetch --all --prune`，检查分叉后再合并。

## 验证顺序

Client 改动至少运行：

```powershell
pnpm typecheck
pnpm lint
pnpm test -- tests/client
node tests/client/browser-check.mjs
```

跨包或合同改动再运行完整 `pnpm check`、包边界检查和必要的隔离发行验证。真实官方 Desktop 验收必须使用新的 `D:/eac-market-verify` 批次；合成 browser-check 不能替代读屏、缩放、forced-colors、真实网络和官方管理器验收。

## 分支同步

```powershell
git fetch --all --prune
git status --short --branch
git log --oneline --decorate -8
```

如果远端已有新提交：

1. 先查看 `git log HEAD..origin/<branch>`；
2. 确认不是发布入口或他人未完成工作；
3. 正常 merge 或 rebase，并解决冲突；
4. 重新运行受影响的测试；
5. 使用普通 `git push`，禁止 `--force` 覆盖协作者提交。

GitHub 和 Gitee 是不同远端；同步一个不代表另一个已经同步。推送失败必须在交接中写明远端、错误和本地保留的提交。

## 交接格式

每次完成后写清：

```text
日期与当前分支：
修改范围：
不变边界：
后端/Client 接口影响：
已运行的命令与结果：
真实宿主是否验收：
未验证项目与阻塞原因：
下一位协作者的第一步：
```

新的当前状态只能写入 `START-HERE.md`、最新版升级指南、对应协作者指南和当前审查记录。阶段报告写完后如果不再作为入口，应移入 `archive/2026-09-legacy/`。
