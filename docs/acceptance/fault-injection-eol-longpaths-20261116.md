# 打桩长路径与换行符差异修复

## 现场证据与范围

依据用户回传的内网只读调查：副本路径前缀过长且 Git 未启用 core.longpaths，导致 checkout 失败；212 个快照文件均为 CRLF/LF 差异，两问题独立。当前源码已经改用 detached 副本和固定个人分支 A，现场旧版 checkout -b 的任务分支验收条件不再适用。

## 修改

- injectionGit 和 sourceGit 均追加进程级 `-c core.longpaths=true`，不改全局或仓库配置。
- 快照按原始字节比较；不一致时，仅对无 NUL 的有效 UTF-8 检查 CRLF 转 LF 后是否与 Git blob 完全一致。命中者单列 eol_only_count/eol_only_files，真实变化和缺失仍计入 changed_count。保留 BOM，不执行 clean filter，不改现场快照。不把其他过滤器或编码差异判为换行符噪声。
- 高级设置单列换行符差异；当前仓库状态区分未跟踪文件与已跟踪文件的未提交修改。
- 长错误保留首尾并明确省略中段，不再仅截取末尾。

## 已执行验证

- Git/打桩/HTTP 相关测试 45 项通过；随后新增当前状态分类测试，仓库测试 8 项通过。
- 新测试验证长路径配置覆盖仅作用于调用、仓库配置仍为 false；超过 260 字符的副本 clone/detached checkout 成功，不创建任务分支。
- 换行符测试覆盖 CRLF、UTF-8 BOM、真实内容修改、文件缺失、含 NUL 的二进制和无效 UTF-8，确认原始快照未被改写。
- 注册页面 React DOM 完整交互回归通过；生成后的客户端语法和 diff 格式检查通过。

## 待内网 Windows 验收

在隔离测试数据根保留现场同等路径深度，Git 仓库显式配置 core.longpaths=false 后，用新版提交同一用例。检查 preparing 完成、生成正常产出、临时副本为 detached HEAD、最终仅提交推送到已配置的个人分支 A，远端不新增 A_xx 分支。确认原分析快照不变。

使用现场快照副本重算，预期 changed_count=0、eol_only_count=212；在副本注入一处真实修改后，changed_count=1、eol_only_count=211。不得修改现场 inputs。

当前执行环境为 Linux，以上自动化不代表 Windows MAX_PATH 实测通过，也不代表视觉截图验收通过。未清理现场失败副本。
