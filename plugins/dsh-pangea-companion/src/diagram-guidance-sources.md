# 绘图指导的固定来源与许可

本文件随 companion 源码分发，记录流程/时序图指导的方法来源；它不是 Agent 执行入口。产品规则按自身结构化合同重新编写，没有安装上游技能或整包复制其 references。

调研日期：**2026-10-20**。以下 stars 是当日 GitHub API 返回的**仓库级**数值，不是单个 skill 的安装量或稳定性保证。

| 来源 | 固定提交 | 仓库 stars | 许可 |
| --- | --- | ---: | --- |
| [softaworks/agent-toolkit：mermaid-diagrams](https://github.com/softaworks/agent-toolkit/tree/3027f20f3181758385a1bb8c022d4041dfb4de84/skills/mermaid-diagrams) | `3027f20f3181758385a1bb8c022d4041dfb4de84` | 2,571 | [MIT](https://github.com/softaworks/agent-toolkit/blob/3027f20f3181758385a1bb8c022d4041dfb4de84/LICENSE) |
| [WH-2099/mermaid-skill](https://github.com/WH-2099/mermaid-skill/tree/982d9035231312c527197501a882cf6c8f4394cc) | `982d9035231312c527197501a882cf6c8f4394cc` | 293 | [MIT](https://github.com/WH-2099/mermaid-skill/blob/982d9035231312c527197501a882cf6c8f4394cc/LICENSE) |

softaworks 仓库最近推送为 2026-03-05，技能目录最近修改为 2026-02-01；WH-2099 最近推送为 2026-08-11，并配置每周同步 Mermaid 官方文档的 workflow。这里记录维护证据，不保证未来维护或定时任务持续成功。

采纳的表达方法：判断与实际处理动作分开成节点；错误、恢复及出口明确；复杂过程按业务边界拆图；时序交互区分参与方、请求、响应、异步、互斥、循环、并发和中止。内容必须来自当前任务证据，不能为图形完整而补造业务行为。流程规则位于 pangea-agent 的 `scene_flow.md` / `scene_common_review.md`，时序规则位于本目录的 `sequence-guidance.md`；实际执行以任务冻结合同为准。

未采用上游安装器、`npx`、Docker 或联网渲染；产品不新增 Mermaid/beautiful-mermaid 运行依赖，内网运行不需要访问这些链接。渲染库不是 skill，不能把渲染库 stars 当作技能热度。路径引用校验、SVG 导出交互和悬停稳定性由产品代码承担，外部指南不获得补造路径、改写语义或扩展门禁的权限。

## 版权与许可

以下保留上游已核实的许可；方法适配不代表上游作者认可或维护本产品。

### softaworks/agent-toolkit

```text
MIT License

Copyright (c) 2026 Leonardo Flores

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### WH-2099/mermaid-skill

```text
Copyright 2026 WH-2099

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
