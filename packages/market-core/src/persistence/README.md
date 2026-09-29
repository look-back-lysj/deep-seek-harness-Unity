# 市场持久记录

当前任务摘要 schemaVersion 为 3。v1/v2 可读取；首次保存先保留 `summary.v1-backup.json` 或 `summary.v2-backup.json`，再写新格式。新执行字段不被旧程序忽略：旧版读取器不认识 schema 3，应拒绝读取。请先停止旧版本执行器，再升级；不要将新版本的记录目录交给仍在运行的旧版程序。

每个任务按以下顺序提交：带 schema 和 SHA-256 的 `commit.json` → `summary.json` → 派生 `task-index.json`。事件在摘要提交后追加到独立 JSONL。摘要是状态依据；事件写入失败不提供新的执行许可，查询可合并摘要中的已提交事件，恢复会补写缺少的事件。

索引可重建：`NodePersistenceFiles.list('tasks/')` 递归枚举市场自有文件，拒绝遍历符号链接目录。摘要或提交记录未进入索引仍可找到；提交先成功而摘要写失败时从提交重建，覆盖前备份旧摘要。摘要孤立、索引损坏、引用缺失、未知 schema、校验不匹配分别处理；不能把损坏任务当空列表。`get()` 和恢复同用存储锁，避免以旧提交覆盖新的摘要。

安装来源回执由 OfficialHostPort 保存在 profile 的 `eac-market/official-receipts/requests`。普通启停和卸载的去重/屏障记录位于 Host 注入的 state 目录 `management`。这些都是市场私有资料；不要连同个人路径、profile 或诊断原文发布。

官方 atomic-write 提供原子替换和进程文件锁，源码明确未提供 fsync 的断电持久保证。本轮回归覆盖提交、摘要、索引和事件写入故障后的重建；不把它宣传为物理断电测试。清理只处理独立事件段，不删除摘要、提交记录、备份或仍被安装依赖/恢复使用的 tgz。
