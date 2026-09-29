# 实际验收记录 · 2026-09-27

状态：**MVP 核心真实 Desktop 链路通过；扩展故障矩阵仍有未验证项，整体为 partial。** 本记录只写实际执行结果，不把单元测试或计划当运行证明。

## 1. 产物与环境

| 项目 | 实际值 |
|---|---|
| 市场包 | `D:\eac-market-verify\dsh-eac-market-0.1.0-mvp.0.tgz` |
| 市场包 SHA256 | `9CB4A76FE33460A10DA2EFB177EC733816D611F55C18D999D00BBAE8F7138603` |
| 官方 Desktop | `0.1.7-rc.2 / Windows x64` |
| 测试 DSH_HOME | `D:\eac-market-verify\m5-home` |
| 测试 profile | `profiles/desktop` |
| 测试插件 | `@dsh-eac/fixture-plugin-a@1.0.0` |
| 测试插件 SHA256 | `5598C2D01736DF5DB979FA8311A3328C79C1F90E5A7019DC9AD4D1CAE06BBC7D` |
| 实际文本证据 | `.verify/m5-my-plugins.txt`、`.verify/m8-final-package.txt` |

当前最终 tgz 已在全新隔离 profile（`m8-home`）通过官方插件页完整安装、启用并加载 EAC 页面；安装包包含 LICENSE。最终运行文件摘要：

- `index.js`：`A5666FE0...8BB31`
- `client.js`：`8711BACB...A0806`
- `typert.host.js`：`07CAE073...8A15D`
- `typert.remote-client.js`：`DD77B1C9...21489`

## 2. 自动检查

命令：`pnpm check`。

| 项目 | 结果 |
|---|---|
| TypeScript Host/Client | pass |
| lint（秘密、未完成标记、Client/core 文件系统边界） | pass |
| Vitest | 15 files / 74 tests pass |
| 目录/下载/作者专项 | 4 files / 27 tests pass |
| Typert 严格生成 | pass |
| `npm pack --dry-run` 与 exports/运行类型 | pass，最终包 102 files |
| `git diff --check` | 待最终提交前复核 |

这些测试包含纯逻辑、合成 HostPort 和隔离 fixture，不单独证明官方安装。

## 3. 真实官方 Desktop 已通过

1. 使用官方插件页安装市场 `.tgz`，官方依赖安装成功。
2. 启用市场后出现独立侧栏 `EAC`，Host/Client/Remote 均激活。
3. 三主导航、发现、帮助、任务、我的插件可打开；不出现 Star、GitHub 登录或在线投稿。
4. 在专用测试目录载入一个精确 fixture 目录；“全部插件”准确显示其名称、包名、版本、摘要、验证状态。
5. 打开安装方案，Host 生成不可变计划：`新增 / 启用 / 已验证`，没有伪造降级或风险。
6. 点击确认后，任务依次记录：排队、获取校验、摘要/身份校验、官方安装、Host `applied`、已完成。
7. 磁盘核验：官方 profile 的 `package.json` 增加精确 `file:` 制品依赖，`dsh.profile.bundles` 加入 fixture；`node_modules/@dsh-eac/fixture-plugin-a` 存在。
8. 缓存文件 SHA256 与目录制品完全相同；没有把 URL 重新下载成另一份字节。
9. “我的插件”刷新后显示 `Fixture Plugin A / 1.0.0 / 已启用`，与磁盘和任务一致。该完整单插件链在最终独立审查修复前的代码批次通过；最终批次另行通过同 tgz 的完整安装/激活，并以 72 个测试覆盖审查修复。

## 4. 真实测试中发现并修复

- Host 随包数据路径按 bundle 输出位置解析，避免读取到错误的 `@dsh-eac/data`。
- Client 必须先 mount generated Remote，再通过 `ctx.get('remote.eacMarket')` 读取动态命名空间；直接属性读取会被官方 Context 拒绝。
- Client JSX 使用 automatic runtime；修复真实页面 `React is not defined`。
- 官方 Remote 返回 `RemoteResult`，Client facade 统一解包错误/值，并把旧 UI 方法名映射到正式契约。
- `pluginManager` 必须在调用时解析，不能在市场服务构造时缓存为空。
- 测试本地来源环境变量按分号解析，不能把 Windows 盘符冒号当分隔符。
- 任务执行器异常必须落成 `needs-attention`，不能让队列吞掉错误后永远停在 queued。

## 5. 尚未验证 / 明确限制

以下项目没有真实 Desktop 全部跑完，不能写成通过：

- 真实 GitHub/Gitee/registry 下载与网络故障切换（当前验证本地受控同摘要来源）。
- 套餐多组件成功/失败/依赖暂停、升级、降级和用户 fork 保护的完整 Desktop 故障矩阵。
- 构建脚本批准、持久 allowBuilds、重启 resume、取消竞态和 Host 崩溃恢复的真实注入。
- 作者草稿、README 导入、资料 ZIP 往返的官方 Desktop 全流程（对应模块已有 10 个专项测试）。
- 卸载、更新、同 profile 多标签/多进程、文件锁、低磁盘和残留 pnpm 进程。
- 深浅主题/键盘/读屏的真实 Desktop 自动化；已有 Client React 测试与静态截图流程，但 Playwright Desktop 截图超时，故只保存文本证据。
- SSRF 连接级 DNS 固定、签名验证、第三方许可全量审计。
- 最终审查修复后的完整 fixture 安装链没有再重复一次；已通过同最终 tgz 的官方安装/激活、真实近最终批次的 fixture 安装链和针对性回归，故整体仍按 `partial` 记录。
- 其他操作系统/架构、正式在线目录、首批真实插件名单和生产 Evidence。

因此当前可以称：**市场核心已可运行，单插件精确下载—校验—官方安装—真实状态闭环已通过；完整 MVP 验收矩阵为 partial。**

## 6. DSH 核心宽泛兼容阶段一 · 2026-09-29

状态：**兼容准入与 0.2.0 真实 Desktop 加载通过；完整跨版本运行矩阵仍为 partial。**

| 项目 | 实际值 |
|---|---|
| 验证包 | `D:\eac-market-verify\official-compat-stage1-20260929\dsh-eac-market-0.1.0-mvp.8.tgz` |
| 包大小 | 839313 bytes |
| SHA256 | `14DFE071D6E3766163BFE237DF66074C193E99310F7DA81BA518283119B0B2FE` |
| 官方 Desktop | `0.2.0-rc.1 / Windows x64` |
| 隔离 DSH_HOME | `D:\eac-market-verify\official-compat-stage1-20260929\home-0.2.0-rc.1` |
| 隔离 Electron user-data | `D:\eac-market-verify\official-compat-stage1-20260929\electron-user-data-0.2.0-rc.1` |

实际结果：

- `pnpm check`：54 files / 392 tests passed / 2 skipped；`pnpm typecheck` 通过。
- `pnpm test:pack`：176 package files，Remote descriptors 30，运行 schema 通过。
- 官方 app-boot 0.1.7-rc.2 与 0.2.0-rc.1 的 `evaluatePluginCompatibility` 均通过；合成未来版本只记 peer gate。
- 0.2.0 隔离 Desktop 中市场真实加载：侧栏出现 EAC，发现页正常，“我的插件”由官方 pluginManager 返回 `@dsh-eac/market 0.1.0-mvp.8` 运行中，官方/系统组件 13 项可展开。
- 本次隔离 profile 通过官方 pnpm 安装最终 tgz；未把“官方添加插件 UI 点击安装”重复记为本轮通过。
- 0.1.7 当前机器缺少独立 Desktop 可执行包，真实 Desktop 项记 `not-run`，不能由 peer gate 替代。
- 未来 DSH 若改变 manager/ChangeResult/atomic-write API，只能保证不伪造成功，不保证免改直接运行。

详细根因、方案与边界见 [DSH 核心宽泛兼容阶段一](docs/handoff/DSH-CORE-COMPAT-2026-09-29.md)。
