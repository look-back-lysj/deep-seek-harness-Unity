# 排错与限制

## 页面一直显示 Loading plugins

1. 查看 Desktop 的 `logs/crash-*-web-boot.log`，确认失败的是 Host 还是 Client。
2. 在隔离 profile 检查 `package.json.dsh.bundle.patch` 与 bundle 自带 patch 是否有效。
3. 检查最终 tgz 是否包含 `/types` 运行 JS、`typert.host`、`typert.remote-client` 及其 exports。
4. Client 必须先 `ctx.remote.$mount(TYPERT_REMOTE)`，之后才能读 `remote.eacMarket`。
5. 只在隔离测试 profile 诊断；不要向用户真实 profile 播种 node_modules 或用户层 insert。

## 安装显示成功但不能使用

分别核对官方 `application`、inventory 版本、bundle enabled、成员行状态、Client 渲染和业务入口。需要重启就明确等待重启，不把磁盘新版本当运行新版本。

## 脚本安装卡在授权

只展示官方 `pendingBuilds` 的精确包名。授权会持久写入当前 profile；不要绕过 `allowBuilds` 或全局批准。安装失败时仍要显示权限已保存。

## 断线或 DSH 重启

页面先显示“正在核对”。Host 读取持久任务、实际 inventory、官方活动/残留进程。无法证明稳定时保留 needs-attention，不自动重放写入。

## 目录离线/来源失败

继续使用最近有效缓存并显示时间。镜像只有同 ID/版本/artifactDigest 才可替代；摘要不符不学习新摘要。没有制品只展示介绍。

## 不能承诺

市场不是全系统恢复工具；第三方卸载脚本、用户自有 file/link 包和外部工具并发写入无法仅靠市场保证完整回滚。未在真实 Desktop/系统验证的平台如实标未验证。
