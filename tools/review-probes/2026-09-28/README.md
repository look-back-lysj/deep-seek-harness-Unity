# 2026-09-28 审查探针

这些脚本复现 `ea84b9f` 当时的错误，**不接入产品 CI，不是正常回归测试**。输出 `reproduced` 表示缺陷被观察到；修复后旧断言失败是预期，应转换成正确行为的回归，不能改回有缺陷的实现。

原始探针在专用目录运行 P01–P14。本副本仅将工程引用和输出目录改为可迁移形式。使用已安装的 esbuild，禁止网络 fetch；官方服务是合成对象，部分场景使用生产文件锁和 JSON 存储。它们不写真实 profile、不调用模型、不安装真实插件。

迁移副本在本轮实际重放了 main/P04 与 boundary/P13，两者仍复现原缺陷；其余用例使用原始探针结果，未为路径改写重复跑全套。

```powershell
$env:MARKET_REVIEW_OUTPUT = 'D:\eac-market-verify\probe-replay-new'
node tools/review-probes/2026-09-28/run.mjs main P06
node tools/review-probes/2026-09-28/run.mjs boundary P14
```

在工程根执行；输出目录用新的专用目录。不传 P 编号会运行该组全部。脚本不会自动下载依赖、删除现场或提交代码。P13 包含当时证据有效期，跨日期重放必须解释到期影响，不能悄悄改历史证据。

P02 手动注入提案以检查被 P01 阻断遮住的后续分支，不代表当时正常 AI 路径可到达。P04 只观察下载层接到哪个地址，不联网，也没有证明摘要校验可绕过。P12 只证明索引可见性缺口。P14 首轮试验曾停滞，修正观测后复查三次一致；首轮原因未证实，不另算产品缺陷。

结果与问题映射见 [独立审查](../../../docs/reviews/2026-09-28-independent-review.md) 和 [证据目录](../../../docs/reviews/evidence/2026-09-28-review-next/README.md)。
