# 市场接口与状态协议

公开 DTO 的事实源是 `packages/market/src/contracts/types.ts`；生成的 `/types`、`/typert`、`/remote` 是构建产物。主控独占契约变更。

## 1. 握手和环境

`hello` 返回 protocol/schema/market 版本、当前 profile 的不透明 environmentId、宿主版本和真实能力。Host 根据 `profileContext` 确定目标，Client 无权指定其他 profile 或绝对路径。

主版本不同禁止写操作。能力缺失只锁对应按钮，不整页失败。

## 2. 目录与计划

Catalog、Presentation、Delivery、Evidence 分层。PackExecution 是市场私有执行资料，绑定 Pack/Lock 原字节摘要，明确 `installed`/`active` 前置；公共 Pack `requires` 不是组件依赖图。

InstallPlan 固定目录 revision、环境、当前状态、精确版本/摘要、启停意图、兼容结论和 planDigest。出队、每个官方写操作前、批准后、重启继续前复查。同 environment+plan 只能有一个 task。

## 3. 任务状态

下载、校验、官方安装、待脚本授权、应用、核对、完成/部分完成/失败/取消/中断/unknown 分开。`application` 不等于业务可用，`waitForInstall=null` 不等于成功。

`task.approveBuilds` 和 `task.resume` 使用 Host 保存的挑战与幂等键。官方脚本授权写入当前 profile 的 allowBuilds，安装失败也不自动撤回，结果分 `permissionChanges` 与 `installOutcome`。

## 4. 错误

错误分为 `unsupported`、`blocked`、`failed`、`partial`、`needs-attention`、`unknown`。返回稳定 code、可读原因、是否可重试、下一步。日志和诊断默认脱敏，不包含 token、cookie、API Key 或用户绝对路径。

## 5. 作者资料

草稿按 revision 保存；公开 README 导入固定仓库和 commit。文件分块采用 base64 字符串（Typert 参数不支持 Uint8Array），Host 强制块/总量、序号和摘要。资料 ZIP 是内容归档，不是插件安装包，必须防路径穿越和解压膨胀。
