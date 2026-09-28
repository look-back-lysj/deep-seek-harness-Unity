# 待填写的私有模板

`author-submission.json` 是接收入口；`release.json` 登记冻结制品；`presentation.json` 登记图文与使用方式；`build-recipe.json` 只用于授权团队构建；`catalog-assembly.json` 列出各层文件。

模板不含伪造地址、授权或摘要。填完真实材料后运行 `scripts/catalog/validate.ts`；运行演示用 `create-sample.ts` 在独立输出目录创建明确 testOnly 样例，不能手工把模板缺项改成想象的值。
