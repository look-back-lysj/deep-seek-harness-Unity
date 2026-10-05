# 安装执行与管理协调

本目录只规划和协调，真正修改 profile 的动作仍由官方 pluginManager 执行。`planner.ts` 冻结计划、基线和所选 delivery；`semver.ts` 按 SemVer 2.0 比较，非法版本拒绝判断。不同 build 元数据具有相同优先级，但不代表相同制品，规划器不猜作降级。

`host-compatibility.ts` 在已绑定宿主身份/版本域下用直接依赖 semver 解释完整范围；多声明按交集判断，不以 minVersion 或字段缺省猜兼容。`release-facts.ts` 分别保留 installed / latestPublished / latestCompatible、制品、verification、历史覆盖和 build 身份歧义；只读 Remote 版本列表和更新摘要复用它们，不实现默认选择、弹窗、等待或轮询，不授权写入。

`execution-state.ts` 是 Host 私有实现记录，不是 Remote 合同。每次尝试保存 prepared、dispatched、received、verified；没有回执的 dispatched 不重放。`needs-attention` 本身不等于释放写入权，`writeUncertain` 会在服务重建后继续阻断后续写入。只有旧写入已停止、可靠回执及当前库存核对完成才清除此屏障。等待脚本批准则有明确已结束的官方回执；用户批准后的调用使用新 requestId，并保留同一 attempt 的审批资料。

执行占用使用 `execution:<environmentId>` 文件锁，短时控制和每个任务记录使用不同锁。下载通过 AbortSignal 取消，取消意图先持久保存，每次官方写前再读。正在调用的官方安装必须等待安装回执，取消接口返回 cancelled/not-running 都不能代替该回执。

## 主控接线

```ts
new InstallTaskManager({ host, artifacts, store, locks, events, coordinationFiles: files,
  validateWrite: async (bundle, pluginId) => { /* Host 按冻结身份检查当前撤回/硬不兼容状态 */ },
})

tasks.manage({
  environmentId, packageName, expectedVersion, idempotencyKey,
  action: 'enable', // 或 disable / remove
}, () => host.setEnabled(packageName, true))

tasks.manage({ environmentId, packageName, expectedVersion, idempotencyKey, action: 'remove' },
  async () => mapOfficialChange(await host.remove(packageName)))
```

返回 `Promise<HostInstallOutcome>`；协调校验失败抛出带 code 的 MarketCoreError。回调是 Host 内部封闭动作，不能作为 Remote 参数暴露。调用者身份、卸载影响及二次确认归 Host/Client 确认链；核心仍核对版本、官方保护标记、写占用、防重记录和写后状态。

启停允许官方安装树提供的可选 bundle（installed:false）；卸载另外要求 installed:true 和 removable:true。市场自身与官方 readOnlyReason 目标拒绝。管理记录保存在 `coordinationFiles/management`，相同键相同请求返回原结果，相同键不同请求拒绝。收到实际回执后库存读取暂时失败，可由 `reconcileInterrupted()` 补核；未知/缺失回执不能重放回调。

`OfficialHostPort(ctx, environmentId, { hostVersion, profileName })` 返回包含版本、profile 和实际能力的 hostFingerprint，主控规划时直接使用 `state.hostFingerprint`。每次下载结束、批准返回、恢复继续前复核它及版本、启停、来源、关键库存完整性。冻结 delivery 必须由 Host 保存并交给 ArtifactPort；旧的无冻结来源计划由生产 ArtifactPort 拒绝，需要重新预检。

## 重启及边界

官方 restart-required 持久绑定 Node Host 的 pid 与 performance.timeOrigin。服务重建不改变它。新 Host 进程启动后，依赖 active 仍要求目标版本、来源、配置和全部声明成员实际 active；空成员、缺失成员和 load-error 不通过。只需 installed 的依赖与无关组件可按各自事实继续。

文件锁只协调市场调用，不能阻止官方页面或其他工具同时操作。最后一次读取与官方写入之间没有官方比较并写入事务；写后核验能发现部分冲突，但不提供全局原子性。缓存仅证明当前依赖引用指向原摘要文件，不证明第三方插件无恶意、传递依赖全部锁定或已安装目录所有内容未被人为修改。

回归入口：`tests/core/reliability.test.ts`、`tests/adapter/receipt-recovery.test.ts`。真实文件锁、JSON、缓存字节和子进程身份属于 F 层；官方服务是合成对象，不等于 Desktop 验收。
