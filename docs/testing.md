# 测试与证据

## 层次

1. **U（纯逻辑/组件）**：计划、状态、Schema、内容净化、UI状态。可快速重复。
2. **P（打包）**：最终 tgz 的文件、exports、Typert 描述、依赖和秘密扫描。
3. **I（隔离服务）**：专用 DSH_HOME/profile 中调用真实官方服务，核对磁盘。
4. **D（真实 Desktop）**：最终 tgz 的安装、页面、启停、任务、重启与 UI。

U/P/I 不能替代 D。跑不了的项写 `blocked/not-run` 和原因，不能静默 skip 成全绿。

## 工程脚本

| 脚本 | 责任 |
|---|---|
| `pnpm typecheck` | Host/Client 项目引用类型检查 |
| `pnpm test` | Vitest 单元与契约测试 |
| `pnpm build` | Typert 严格生成、tsc、Host/Client bundle |
| `pnpm test:pack` | `npm pack --dry-run` 与包内容核验 |
| `pnpm test:catalog` | 目录、Delivery、作者资料测试 |
| `pnpm check` | 可自动检查汇总 |

最终应补 `pnpm test:integration` 和 `pnpm test:desktop`；当前真实批次状态写入 `ACCEPTANCE.md`，未实现的脚本不得提前声称可用。

## 必测重点

- 最终 tgz -> Host -> generated Remote -> Client -> main/sidebar 真实链。
- 同 plan 唯一 task、出队漂移、批准/恢复幂等、Host 中止不盲重放。
- 套餐依赖来自 PackExecution；前置 installed/active 区分。
- 字节摘要贯穿实际安装；镜像不一致拒绝；缓存引用不清除。
- 新装启用分级、原有 disabled 保留、脚本授权持续影响。
- README/Markdown/ZIP 的 XSS、路径穿越、大小写碰撞、解压膨胀。
- 深浅主题、窄面板、键盘、错误/部分完成/等待重启。

## 报告

每条记录用例ID、U/P/I/D、pass/fail/blocked/not-run、操作、真实结果、证据。测试 fixture 不是生产 Evidence。产物与源码版本一一对应，修改后旧截图/摘要不能复用为新证据。
