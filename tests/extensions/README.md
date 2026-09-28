# E扩展定向验证

测试全部使用明确合成数据，不使用真实profile、用户密钥、正式作者或下载地址。写入产物在 `D:/eac-market-verify/implementation-20260928/E-extension/`。

按顺序从工程根运行：

```powershell
node node_modules/typescript/bin/tsc -p tests/extensions/tsconfig.json
node examples/market-extension/build.mjs
node node_modules/vitest/vitest.mjs run --config tests/extensions/vitest.config.ts
node tests/extensions/browser-check.mjs
```

没有workspace build、市场pack、下载或官方Desktop动作。示例build使用现有esbuild与tar，只生成独立示例包。

`registry.test.ts`、`managed.test.ts` 是普通定向单元测试，也能随主控根Vitest收集。`dsh.check.ts`、`example.check.ts` 需要专属配置定位只读官方归档，特意不用根Vitest默认 `.test.ts` 后缀，避免根测试被本机源码路径绑定。主控应另外执行上述专属配置一次；未装本机源码的环境不能把该部分报通过。

| 证据 | 覆盖 | 边界 |
| --- | --- | --- |
| 单元41项 | 两适配器五位置、整组校验、稳定顺序、50次开关、版本/能力/重复ID、只读投影、受管同步/异步/超时/清理 | 合成数据 |
| 官方生命周期5项 | 实际Cordis4.0.4与官方SlotRegistry源码；先后加载、声明撤销重建、市场重启、外部重复ID、50次开关后effect树无增长 | 没有安装进Desktop |
| 示例包2项 | tar实际清单/字节；运行包内实际Client JS，经官方ClientModuleSystem源码加载并由真实Cordis登记/释放 | 不经过官方installBundle或写profile |
| 浏览器10项 | 真实React、StrictMode50次开关、渲染/事件/Promise失败隔离、菜单/预检/草稿动作、迟到忽略、已卸载页面；最后使用已安装官方0.1.7-rc.2 renderer实际bundle验证五位置投影 | 隔离headless Edge，合成三导航/核心标记；不冒充C完整页面或Desktop证据 |

浏览器首轮确实发现StrictMode重挂时被旧清理阻断；已将管理生命周期绑定到layout阶段，使被管理组件的普通effect重挂前恢复有效状态。修后50次回归通过。官方renderer测试需明确提供合成的“无会话”适配器，因为其root包装固定经过session-maybe；不读取真实会话。

示例包报告 `example-package.json` 保存实际路径、字节数、SHA256和外部导入；`browser-results.json` 保存浏览器结果。最终证据以本轮工具退出码与这些文件为准。

主控下一步：冻结writer后构建最终mvp.1市场包，安装市场与此独立tgz；前后核对市场SHA不变，在真实官方Desktop验证五位置、先后安装、启停/卸载/重载与50次开关。未完成这些真实动作前，E06最终Desktop项仍是待验，不写verified。
