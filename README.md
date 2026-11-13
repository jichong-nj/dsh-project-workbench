# dsh-project-workbench

DeepSeek Harness（DSH）Web 插件：以 **项目 → 任务** 两级结构组织的个人工作台，替代 DSH 默认以工作区目录组织工作的方式。插件形态是 Cordis 插件 bundle（`package.json` + `cordis.patch.yml` + host 入口 + client 入口）。

## 工作台首页（Dashboard）

打开「工作台」首先进入 Dashboard，布局对齐“个人工作驾驶舱”：

- 顶部欢迎区 + 日期；
- 快速操作：新建项目、今日待办、查看进度、上周回顾、帮我写周报；
- 今日待办 / 已逾期：按截止时间与优先级列出待处理任务；
- 进行中项目：进度条、完成/总任务数、最近更新时间，点击进入项目；
- 本周统计：任务完成、产物生成、会话关联、活动记录；
- AI 洞察：根据逾期、needs-you、项目进度、本周产出自动生成建议；
- 关注事项：needs-you / 逾期任务；
- 最近活动：跨项目的任务状态、评论、子目标、会话、产物活动；
- 右栏「全局 AI 助手」：**在页面内直接对话**，由 host 调用 `ctx.llm` 并执行工作台工具；可以直接查询项目/任务、创建项目/任务/子目标、添加评论、登记产物，不需要跳转会话。输入框支持 **语音录入**（复用 DSH speechController/speechToText：先 prepare 再录音，再转写，与标准聊天同一服务）；录音时显示红点、计时和随音量变化的 14 段音量条，并在「准备语音 / 录音 / 转写」之间显示状态。、Enter 发送 / Shift+Enter 换行、快捷提示词与多轮历史；右上角「标准聊天」可把当前对话带到标准 DSH 会话，继续使用附件、命令、完整聊天能力。

数据来自 `GET /workbench-api/dashboard`，由 host 侧的 `WorkbenchService.getDashboard()` 聚合项目、任务、子目标与活动记录；不引入额外存储。AI 助手走 `POST /workbench-api/assistant/chat`，使用 native function calling（工具复用 WorkbenchService），最多 4 轮工具调用。

## 目录模型（v2）

工作台有自己的**可配置根目录**；所有项目目录、任务目录都由插件在根目录下自动创建，用户不需要（也不允许）为任务指定目录。

```
<workbenchRoot>/                          ← 插件配置 workbenchRoot，默认 ~/.dsh/workbench
  <projectDirName>/                        ← 项目目录：名称-slug + ID 后缀，或创建时指定的 folderName
    AGENTS.md                              ← 项目级 AGENTS.md 骨架（已存在不覆盖）
    .dsh-project-workbench/
      board.json                           ← 便携副本（辅助，可提交 git）
      AGENTS.md                            ← 便携任务清单 + 指令层清单
    tasks/
      <taskId>/                            ← 任务目录：由任务唯一 ID 自动创建，不能手动指定
        AGENTS.md                          ← 任务级增量指令（仅在需要局部规则时生成）
        goals/
          <goalId>/                        ← 子目标目录（自动创建）
            inputs/                        ← 输入产物
            outputs/                       ← 输出产物
```

- 项目创建参数里没有任意 `rootPath`；唯一的目录控制项是可选 `folderName`，它仍只是 `<workbenchRoot>` 下的一级目录名。
- 任务目录名固定为任务唯一 ID：`tasks/<taskId>`；`workbench_create_task` 的 `taskDir`/`rootPath` 之类参数会被忽略。
- 任务级 `AGENTS.md` 写在任务目录内（`tasks/<taskId>/AGENTS.md`），不再放在 `.dsh-project-workbench` 下。
- 任务级成果目录：`tasks/<taskId>/inputs`、`tasks/<taskId>/outputs`；任务详情可以直接上传、刷新、下载、删除成果，不依赖子目标。
- 工作台根目录默认就是一个 DSH 工作区（标题通常为「工作台」/「workbench」）；插件启动时确保注册，Dashboard AI 助手与子目标会话都复用它。
- 任务有显式「任务目标」，其下可拆多个「子目标」；每个子目标有自己的目录、多个关联会话、以及输入/输出产物。

## 工作台根目录：可配置 + 自动迁移

配置项 `workbenchRoot`（默认 `~/.dsh/workbench`）：

```yaml
- id: project-workbench
  name: '@jichong/dsh-project-workbench'
  config:
    workbenchRoot: /home/you/workbench
```

- **启动时自动迁移**：如果 profile 里显式配置了新的 `workbenchRoot`，插件启动后会把旧根目录下的所有项目目录搬迁到新根，并更新 storage 里的 `rootPath`；任务目录、项目 AGENTS.md、便携副本一起搬。
- **UI 迁移**：项目列表页右上角「工作台根目录」→ 输入新路径 →「迁移到新根目录」。迁移通过 `POST /workbench-api/settings/root` 完成，立即生效。
- **来源判定**：显式配置的 `workbenchRoot` 优先；没有显式配置时，使用上次保存的根目录（来自 UI 迁移）。UI 设置的根目录会在下次启动继续生效。
- **历史外部目录**：v1 记录里指向工作台外部的 `rootPath`，首次初始化时会**复制**到新根目录（保留原始目录，不误删用户数据）。
- 迁移写入 `workbench_settings` 全局槽：`{ rootPath, source: 'config' | 'user' }`。

## 它解决什么

DSH 默认按「工作区目录」组织会话。但领导交办的往往是「一件事」：有目标、有截止时间、有若干个任务、有需要你确认的问题。`dsh-project-workbench` 把这件事建模成：

- **Project（项目）**：一等分组容器，对应“领导交办的一件事”。有 id、名称、目标/背景、工作台下的目录名、根路径、状态（active/archived）、创建时间。
- **Task（任务）**：恰属一个 Project。有 id、projectId、parentId（任务树）、标题、任务目标、描述、底层状态（backlog/running/done）、优先级、截止时间、创建/完成时间、评论、活动记录；每个任务自动拥有 `tasks/<taskId>/` 目录。
- **首页列表视觉**：最近任务、关注任务、项目进度、最近活动都带状态色图标、边框色、渐变卡片和 hover 浮起效果。
- **全部任务页**：最近任务卡片右上角「全部任务」进入跨项目任务列表，支持全部/进行中/待处理/已完成过滤；面包屑可返回工作台首页。
- **左侧最近任务**：侧边栏工作台入口下方展示最近 5 个任务，直接点击进入任务会话，并带 7 天 token 热力条。
- **任务近 7 天 token 热力**：首页最近任务、项目任务卡片、全部任务页都显示 7 格热力条；按天聚合 assistant 消息的 token 总量，颜色与用量统计一致，悬停显示当天 token 总量。
- **活动索引**：启动时一次性补齐会话日志快照；之后通过 DSH `session/event` 增量更新，打开任务时补齐当前会话；请求路径只读内存索引，不扫描日志。
- **项目统计默认收起**：项目顶部的 Backlog/Running/Needs you 等统计默认隐藏，点右上角「📊 统计」才展开。
- **任务会话预设**：工作台创建任务会话时显式使用 `standard`（不可用时回退 `minimal`），不跟随全局默认 preset，避免默认 preset 插件未启动导致 `agent-preset/invalid`。
- **助手模型选择**：首页右侧 AI 助手复用 DSH 的 provider/model 配置，可从下拉框选择现有模型，选择结果随助手会话持久化。
- **首页最近任务**：替换原「今日待办 / 已逾期」，只展示 5 条，按会话中最后一次用户提问/助手回答的时间排序，并显示任务、项目、最近交互时间和状态。
- **首页用量统计**：工作台自带 Host 端会话日志扫描器（不依赖 dsh-usage-stats 插件），顶部支持「按天 / 按月 / 自定义」筛选、日期范围和模型筛选；下方展示 26 周（近 6 个月）GitHub 风格热力图并居中显示，点击任意日期立即切换该日用量，显示总 token、未缓存输入、输出、缓存读取、命中率、调用次数和按模型明细。
- **只保留项目/任务概念**：客户端会隐藏 DSH 原生的「工作区 / 会话列表」浏览器和「新会话」按钮，导航统一走「工作台」的项目与任务；任务会话仍由 DSH 原生会话承载，只是不再在侧边栏暴露工作区概念。新建会话默认落到当前/最近工作区（任务点击则落到项目工作区），不再手动选择工作区。
- **任务 = 主会话**：每个任务绑定一个主 DSH 会话（`sessionId`）；**点击任务行直接进入该会话（DSH 原生 agent loop）**，右侧自动打开「任务工作台」面板，显示任务目标、主要过程、输入/输出成果与统计。成果带文件图标和文件名，点击直接在右侧栏打开 DSH 文件预览（不是下载）；右侧每个栏目都是可折叠卡片，含进度环、输入/输出占比条和近 7 天活动柱状图。任务详情页已移除：任务目标、属性（状态/优先级/截止时间）、描述、输入/输出成果、子目标和活动全部在任务会话右侧面板中编辑/查看；点击任务行（项目页/看板/首页）直接进入会话，一个任务只对应一个主会话；打开前会自动取消会话归档，避免归档会话被 DSH 当作不可打开而显示空白；新建任务的会话 cwd 落在任务目录 `tasks/<taskId>`，已有迁移任务仍复用原会话目录；若任务还没有任务级会话，会优先复用子目标已关联的旧会话、或按任务标题/任务目录匹配已有 DSH 会话，最后才新建；右侧面板提供「历史会话」选择器，可按标题/目录/工作区搜索并手动把任意已有会话绑定到任务；右侧面板顶部提供「← 工作台」「← 项目」返回入口。会话产生的文件可直接上传/同步到 `tasks/<taskId>/{inputs,outputs}`。
- **Goal（子目标）**：属于一个 Task，有标题、描述、状态（open/doing/done）、排序、多个关联会话与输入/输出产物；目录为 `tasks/<taskId>/goals/<goalId>/{inputs,outputs}`。
- **needs-you**：**派生列**，不是存储状态。任务有未解决评论、被标记阻塞、或等待审核时自动进入该列，底层 workflow 状态不变；条件消失后自动回到原列。

v1 做四件事：**项目-任务-子目标**、**任务/子目标会话挂接**、**输入/输出产物管理**、**AGENTS.md 继承展示与看板拖拽**。Gantt、Dashboard、Jira/云同步等不做。

## 快速开始

```bash
# 在 DSH profile 里安装（本地开发用绝对路径）
dsh plugin --profile web add /absolute/path/to/dsh-project-workbench

# 重启 DSH Web（首次安装 host 插件行需要重新加载；已挂载的插件会走 HMR 热更新）
dsh web --no-open
```

安装后刷新页面，侧边栏会出现「工作台」入口。创建项目时只填名称/描述/可选文件夹名，其余目录由插件生成。

> **关于挂载**：host 行由 `cordis.patch.yml` 插入；浏览器端无需额外 patch 行——DSH 的 `dsh-client-modules` 会从 `package.json` 的 `dsh.client` 自动发现并服务 `/plugins/??@jichong/dsh-project-workbench/client.js&rev=<rev>`（与 `dsh-session-admin` / `dsh-crm-profile` 一致）。

## 数据持久化

主读写全部走 `ctx.storageDomain`（`@deepseek-ai/dsh-storage-domain`），**不是** JSON 文件、localStorage 或独立 SQLite。

| 逻辑 domain | 物理 domain（storageDomain） | 表 / global | 说明 |
|---|---|---|---|
| `workbench.projects` | `workbench_projects` | `projects` + global `workbench_settings` | 项目记录 + 当前工作台根目录 |
| `workbench.tasks` | `workbench_tasks` | `tasks` | 任务记录（含 comments / activity） |

> 为什么域名不是字面量 `workbench.projects`：`@deepseek-ai/dsh-storage` 用 `UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/` 校验域名，点号不合法。`lib/domain.js` 保留 `LOGICAL_DOMAIN_NAMES` 映射，文档与 UI 使用产品口径，存储层使用合法物理名。

项目根 `.dsh-project-workbench/` 下仍可选导出人类可读的便携副本：`board.json`（含 `workbenchRoot`、项目目录、任务目录、指令层）与 `AGENTS.md` 清单。导出失败只记日志、不回滚主存储；可用 `exportPortableFiles: false` 关闭。

## AGENTS.md 继承机制

插件**不接管** `dsh-agent-instructions` 的读取与注入，只做三件事：

1. **项目创建时**：在 `<workbenchRoot>/<projectDirName>/AGENTS.md` 生成/确认项目级 AGENTS.md（已存在则完全不改），模板包含项目目标、通用规则、任务目录约定；用户可以在创建弹窗里编辑模板。
2. **任务创建时**：先创建 `tasks/<taskId>/` 目录；只有显式提供局部指令时，才写 `tasks/<taskId>/AGENTS.md`，内容是增量补充，不重复项目级内容。
3. **UI 展示**：任务详情页展示“当前生效的指令层”——工作台根、任务目录、项目级 AGENTS.md 路径、任务级 AGENTS.md 路径（如有）+ 加载器名。

实际加载链路由 `dsh-agent-instructions` 按“项目根 → 会话工作目录”完成：项目级文件在会话 cwd 位于项目根之下时生效；任务级文件只有在会话 cwd 进入 `tasks/<taskId>` 时才会被加载。由于会话默认使用工作台工作区，任务级 AGENTS.md 通常需要把会话工作目录切到任务目录后才会生效——插件只展示继承关系，不伪造“已注入”。

## Agent 工具

使用 `@deepseek-ai/dsh-tools` 的 `defineTool` 注册，所有写操作都落到 storageDomain。

| 工具 | 作用 | 主要参数 |
|---|---|---|
| `workbench_list_projects` | 列出项目 + 任务统计 + 工作台根 | `status` |
| `workbench_get_project` | 项目详情 + 任务列表 + 指令层 | `projectId`、`taskStatus` |
| `workbench_create_project` | 在工作台根下创建项目并生成 AGENTS.md | `name`、`description`、`folderName`、`agentsMd` |
| `workbench_create_task` | 建任务，自动建 `tasks/<taskId>/`，可写任务级 AGENTS.md | `projectId`、`title`、`description`、`parentId`、`priority`、`dueAt`、`agentsMd` |
| `workbench_update_task` | 更新状态/优先级/截止/描述/任务目标/阻塞/审核；`resolveComments` 解决全部评论 | `taskId`、… |
| `workbench_create_goal` | 在任务下创建子目标并建目录 | `taskId`、`title`、`description`、`status` |
| `workbench_get_goal` | 子目标详情（目录、会话、产物） | `goalId` |
| `workbench_update_goal` | 更新子目标标题/描述/状态/排序 | `goalId`、… |
| `workbench_add_goal_artifact` | 把已有本地文件登记为输入/输出产物 | `goalId`、`kind`、`path`、`name`、`note` |
| `workbench_add_task_artifact` | 把会话产生的文件登记为任务输入/输出成果 | `taskId`、`kind`、`path` |
| `workbench_sync_task_artifacts` | 扫描任务 `inputs/outputs` 补登记成果 | `taskId` |
| `workbench_get_task` | 任务详情（任务目标、任务会话、任务成果、子目标、父/子任务、`taskDir`、评论、活动、needs-you 原因、指令层） | `taskId` |
| `workbench_add_task_comment` | 添加评论（默认未解决 → needs-you） | `taskId`、`body`、`author`、`resolved` |

工具返回结构化 JSON；错误抛出可读的 `[code] message`。`workbench_create_project` **不接受** `rootPath`，项目目录只能由工作台根 + `folderName` 决定。

## HTTP API

浏览器端只通过同源路由 `/workbench-api/*` 与 host 通信，不读写文件系统、不引入独立 Node 进程或 iframe。非 GET 请求做同源 Origin 校验。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/workbench-api/health` | 健康检查 / 路由清单 |
| GET | `/workbench-api/dashboard` | 首页聚合：今日待办、项目进度、本周统计、洞察、最近活动 |
| POST | `/workbench-api/assistant/chat` | 首页 AI 助手对话（查询/创建项目、任务、子目标等） |
| POST | `/workbench-api/speech/prepare` | 准备 DSH 语音 provider（本地 SenseVoice 等），等待 ready |
| POST | `/workbench-api/speech/transcribe` | 语音转写（复用 DSH speechController） |
| GET | `/workbench-api/settings` | 工作台根目录、来源、项目/任务统计 |
| POST | `/workbench-api/settings/root` | 修改工作台根目录并自动迁移 |
| GET | `/workbench-api/projects?status=` | 项目列表（含统计、工作台根） |
| POST | `/workbench-api/projects` | 创建项目（`name`/`description`/`folderName`/`agentsMd`） |
| GET | `/workbench-api/projects/:id?taskStatus=` | 项目详情 + 任务列表 |
| PATCH | `/workbench-api/projects/:id` | 改名/描述/归档/恢复 |
| DELETE | `/workbench-api/projects/:id` | 仅允许空项目 |
| GET | `/workbench-api/projects/:id/tasks?taskStatus=` | 任务列表 |
| POST | `/workbench-api/projects/:id/tasks` | 创建任务（自动建任务目录） |
| GET | `/workbench-api/projects/:id/board` | 四列看板（needs-you 派生） |
| GET | `/workbench-api/tasks/:id` | 任务详情（含 `taskDir`） |
| GET | `/workbench-api/context-by-session/:sessionId` | 按 DSH 会话反查任务上下文（右侧任务面板） |
| PATCH | `/workbench-api/tasks/:id` | 更新任务 |
| POST | `/workbench-api/tasks/:id/comments` | 添加评论 |
| POST | `/workbench-api/tasks/:id/comments/:cid/resolve` | 解决/重新打开评论 |
| POST | `/workbench-api/tasks/:id/move` | 看板拖拽写入（拒绝 needs-you） |
| POST/DELETE | `/workbench-api/tasks/:id/session` | 绑定 / 解除任务主会话 |
| GET/POST | `/workbench-api/tasks/:id/artifacts` | 任务成果列表 / 登记已有文件 |
| POST | `/workbench-api/tasks/:id/artifacts/upload?kind=&name=` | 上传任务输入/输出成果 |
| POST | `/workbench-api/tasks/:id/artifacts/sync` | 扫描任务 inputs/outputs 补登记 |
| DELETE | `/workbench-api/tasks/:id/artifacts/:artifactId` | 删除任务成果 |
| GET/POST | `/workbench-api/tasks/:id/goals` | 子目标列表 / 创建子目标 |
| GET/PATCH/DELETE | `/workbench-api/goals/:id` | 子目标详情 / 更新 / 删除记录 |
| POST/DELETE | `/workbench-api/goals/:id/sessions[/:linkId]` | 关联 / 取消关联 DSH 会话 |
| GET/POST/DELETE | `/workbench-api/goals/:id/artifacts[/:artifactId]` | 产物列表 / 登记已有文件 / 删除 |
| POST | `/workbench-api/goals/:id/artifacts/upload?kind=&name=` | 上传输入/输出产物 |
| POST | `/workbench-api/goals/:id/artifacts/sync` | 扫描 inputs/outputs 补登记产物 |
| GET | `/workbench-api/artifacts/:id/content` | 下载产物 |

返回约定：`{ ok: true, data }` / `{ ok: false, error: { code, message } }`。

## 任务目标 / 子目标 / 会话 / 产物

打开任务后，页面结构是：

1. **任务目标**：任务级的一句话目标和验收口径，可随时编辑。
2. **子目标**：把任务目标拆成多个可独立推进的子目标；每个子目标自动获得 `goals/<goalId>/{inputs,outputs}` 目录。
3. **会话**：每个子目标可以关联多个 DSH 会话：
   - 「关联已有会话」从当前 DSH 会话目录里挑选；
   - 「在工作台工作区新建会话」复用工作台根目录对应的 DSH 默认工作区（插件启动时确保存在），创建后自动关联到当前子目标；不再为每个子目标新建工作区。
4. **产物**：每个子目标分为输入产物 / 输出产物：
   - 上传文件到 `inputs/` 或 `outputs/`；
   - 「刷新产物」扫描目录，把 agent/会话直接写进目录、但尚未登记的文件补成产物记录；
   - 产物可下载、可删除；删除托管文件时会同时移除磁盘文件。
   - Agent 也可用 `workbench_add_goal_artifact` 把已生成的文件登记为产物。

## 配置

```yaml
- id: project-workbench
  name: '@jichong/dsh-project-workbench'
  config:
    workbenchRoot: ~/.dsh/workbench   # 工作台根；所有项目目录都在其下创建
    enableBoardView: true             # 是否显示看板页签
    exportPortableFiles: true         # 是否导出 .dsh-project-workbench/board.json + AGENTS.md
```

- `workbenchRoot`：缺省 `~/.dsh/workbench`；显式配置后启动时自动迁移旧根目录。
- `enableBoardView`：缺省 `true`；关掉后仅保留列表视图。
- `exportPortableFiles`：缺省 `true`；便携副本只是辅助，主存储始终是 storageDomain。

## 产品规则

- 一个任务只属于一个项目；跨项目引用/复制不在 v1。
- 项目归档后只读（新增/修改任务、评论、拖拽均被拒绝），可恢复；非空项目不可删除。
- `needs-you` 不能直接写入：`workbench_update_task` 的 `status` 不包含它；`POST /move` 拖入会返回 `needs-you-derived`。
- 从 needs-you 拖出时，宿主会解除阻塞/审核标记并解决未解决评论（记录活动），否则派生条件仍成立、卡片会立刻回到 needs-you。这是 v1 的明确取舍。
- 任务底层状态只有 `backlog / running / done`；`needs-you` 是视图。
- 任务目录名 = 任务唯一 ID，永不由调用方指定；项目目录名 = 名称-slug + ID 后缀（或可选 folderName）。

## 项目结构

```
dsh-project-workbench/
├── package.json          # dsh.bundle.patch + dsh.client + peerDependencies
├── cordis.patch.yml      # 插入 host 行
├── index.js              # host 入口：apply(ctx, config)，effect/inject 管理生命周期
├── client.js             # 浏览器 bundle（纯 ES2020 + React.createElement，无 JSX）
├── lib/
│   ├── domain.js         # defineDomain + storageDomain 句柄 + 工作台设置 global
│   ├── service.js        # 项目/任务/子目标/会话/产物业务、needs-you 派生、根目录迁移、看板
│   ├── agents.js         # 工作台根/项目/任务目录、AGENTS.md 骨架、便携导出
│   ├── api.js            # /workbench-api 路由（含 dashboard / settings/root 迁移）
│   ├── tools.js          # 13 个 defineTool 工具
│   ├── assistant.js      # 首页 AI 助手（LLM + 工作台工具调用）
│   └── errors.js         # 稳定错误码
└── test/                 # 离线契约测试 + 真浏览器冒烟脚本
```

## 测试与验证

本环境安装的 DSH（0.2.1-rc.5）**没有 `dsh-dev` CLI**，因此用等价的原生 Node 测试与真浏览器冒烟替代：

```bash
cd dsh-project-workbench
npm test          # = node test/run-all.mjs，52/52 通过
node --check index.js && node --check client.js
```

真实 storageDomain + HTTP + 目录迁移 + AGENTS.md 文件验证（隔离 `DSH_HOME`，不碰生产 profile）见 `test/ui-verify.mjs`；冒烟覆盖：侧边栏入口 → 新建项目 → 自动项目目录 → 新建任务 → 自动任务目录/任务级 AGENTS.md → 任务详情 → 看板拖拽 → 归档只读 → 工作台根目录迁移。

## 本地开发说明

`dsh plugin add <path>` 使用 pnpm `link:`；Node 会按插件的**真实路径**解析依赖，因此本地开发目录需要能解析 `@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-storage-domain`、`zod`、`react`。仓库里的 `node_modules` 是开发用的符号链接（指向 DSH 安装目录），发布为 npm 包时由 `peerDependencies` / `dependencies` 正常解析。

## 已知边界（v1）

- 任务级 AGENTS.md 只有在会话 cwd 进入 `tasks/<taskId>` 时才被 `dsh-agent-instructions` 加载；插件不替它做注入。
- storageDomain 的 `domain/changed` 是进程内事件；多进程/重新连接不会实时推送。
- 看板不支持列内排序持久化；拖拽只改变底层状态。
- 归档项目不级联归档任务；任务随项目恢复而恢复可写。
- 项目目录名创建后不随项目改名自动重命名（保持路径稳定）；只有工作台根迁移会移动目录。
- 没有删除非空项目、跨项目引用、批量操作、搜索的 UI（HTTP/服务层预留了扩展点）。
