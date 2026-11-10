# CONTRACTS — dsh-project-workbench v2

本文件固定 v2 的接口契约：目录模型、记录 schema、工具参数、HTTP 路由、错误码、派生规则。修改其中任何一条都需要同步改 `test/` 里的契约测试。

## 1. 目录契约（用户要求）

```
<workbenchRoot>/                          ← config.workbenchRoot，默认 ~/.dsh/workbench
  <projectDirName>/                        ← 自动创建；名称-slug + ID 后缀，或可选 folderName
    AGENTS.md
    .dsh-project-workbench/{board.json,AGENTS.md}
    tasks/<taskId>/                        ← 任务目录：任务唯一 ID，不能由调用方指定
      AGENTS.md                            ← 可选任务级增量指令
      goals/<goalId>/
        inputs/                            ← 输入产物
        outputs/                           ← 输出产物
```

不变量：

1. 所有项目目录都在 `<workbenchRoot>` 下；创建项目不接受任意 `rootPath`。
2. 任务目录名只由任务唯一 ID 决定；`workbench_create_task` 的 `taskDir`/`rootPath` 参数被忽略。
3. 工作台根可配置；根变更时自动迁移项目目录、任务目录、项目 AGENTS.md、便携副本，并更新记录 `rootPath`。
4. 历史外部 `rootPath` 首次初始化时复制到工作台根，保留原始目录，避免误删。
5. 工作台根目录默认注册为 DSH 工作区；Dashboard AI 助手与子目标「新建会话」复用该工作区，不按子目标创建新工作区。

## 2. 存储契约（ctx.storageDomain）

| 逻辑名 | 物理名 | 表 / global | key |
|---|---|---|---|
| `workbench.projects` | `workbench_projects` | `projects` + global `workbench_settings` | project.id |
| `workbench.tasks` | `workbench_tasks` | `tasks` | task.id |

### 2.1 工作台设置（projects domain global）

| 字段 | 类型 | 说明 |
|---|---|---|
| `rootPath` | string | 当前工作台根目录；空串表示尚未初始化 |
| `source` | `'config' \| 'user'` | `config` = 配置决定；`user` = UI 迁移设置 |

### 2.2 项目记录

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | `p-…` |
| `name` | string | 1–300 字符 |
| `description` | string | 目标/背景，可空 |
| `dirName` | string | 工作台根下的一级目录名（旧记录可空，首次启动自动补全） |
| `rootPath` | string | `workbenchRoot/dirName`；迁移时更新 |
| `status` | `'active' \| 'archived'` | 归档后只读、可恢复 |
| `createdAt` / `updatedAt` | ISO string | |
| `archivedAt` | ISO string \| null | |

### 2.3 子目标记录（`workbench_tasks.goals`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | `g-…` |
| `taskId` / `projectId` | string | 所属任务/项目 |
| `title` | string | 1–300 字符 |
| `description` | string | 子目标描述/验收标准 |
| `status` | `'open' \| 'doing' \| 'done'` | |
| `order` | integer | 排序 |
| `sessions[]` | `{id, sessionId, title, cwd, status, source, linkedAt}` | 关联的 DSH 会话，可多条；新建会话默认 cwd 为工作台根工作区 |
| `artifacts[]` | `{id, kind: input\|output, name, path, size, mime, note, createdAt}` | 输入/输出产物 |
| `createdAt` / `updatedAt` / `completedAt` | ISO string \| null | done 时写 completedAt |

### 2.4 任务记录

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | `t-…`；同时是任务目录名 |
| `projectId` | string | 恰属一个项目 |
| `parentId` | string \| null | 任务树父节点，同项目 |
| `title` | string | 1–500 字符 |
| `goal` | string | 任务目标（一句话） |
| `description` | string | |
| `status` | `'backlog' \| 'running' \| 'done'` | needs-you 不在其中 |
| `priority` | `'low' \| 'medium' \| 'high' \| 'urgent'` | 默认 medium |
| `dueAt` | ISO string \| null | 可清空 |
| `createdAt` / `updatedAt` / `completedAt` | ISO string \| null | done 时写 completedAt |
| `blocked` | boolean | true → needs-you |
| `waitingReview` | boolean | true → needs-you |
| `sessionId` / `sessionTitle` / `sessionCwd` / `sessionLinkedAt` | string \| null | 任务主会话绑定 |
| `artifacts[]` | `{id, kind: input\|output, name, path, size, mime, note, createdAt}` | 任务级输入/输出成果 |
| `comments[]` | `{id, createdAt, author, body, resolved, resolvedAt}` | 未解决评论 → needs-you |
| `activity[]` | `{id, at, actor, kind, detail, from, to}` | 最多保留 500 条 |

### 2.5 派生规则

```
needsYou(task) = task.blocked || task.waitingReview || task.comments.some(c => !c.resolved)
viewStatus(task) = needsYou ? 'needs-you' : task.status
```

统计按 `viewStatus` 计数；另给 `stored.{backlog,running,done}` 与 `blocked/waitingReview/unresolvedComments/overdue`。

## 3. 工具契约（@deepseek-ai/dsh-tools defineTool）

| 工具 | 必填 | 可选 |
|---|---|---|
| `workbench_list_projects` | — | `status: active\|archived\|all` |
| `workbench_get_project` | `projectId` | `taskStatus: all\|backlog\|running\|needs-you\|done` |
| `workbench_create_project` | `name` | `description`、`folderName`、`agentsMd`（**无 rootPath**） |
| `workbench_create_task` | `projectId`、`title` | `description`、`parentId`、`priority`、`dueAt`、`agentsMd` |
| `workbench_update_task` | `taskId` | `status`、`priority`、`dueAt`、`title`、`description`、`blocked`、`waitingReview`、`resolveComments` |
| `workbench_add_task_artifact` | `taskId`、`kind`、`path` | `name`、`note` |
| `workbench_sync_task_artifacts` | `taskId` | — |
| `workbench_create_goal` | `taskId`、`title` | `description`、`status` |
| `workbench_get_goal` | `goalId` | — |
| `workbench_update_goal` | `goalId` | `title`、`description`、`status`、`order` |
| `workbench_add_goal_artifact` | `goalId`、`kind`、`path` | `name`、`note` |
| `workbench_get_task` | `taskId` | — |
| `workbench_add_task_comment` | `taskId`、`body` | `author`、`resolved` |

- `workbench_get_task` 返回 `taskDir`（`tasks/<taskId>`）与 `workbenchRoot`。
- `workbench_list_projects` 返回 `workbenchRoot`。
- `workbench_create_task` 总是创建任务目录；`agentsMd` 只在该目录写 `AGENTS.md`。
- `status` 枚举不含 `needs-you`；传入会在参数校验阶段被拒绝。
- `resolveComments: true` 一次性解决全部未解决评论并写活动记录。

## 4. HTTP 契约

前缀 `/workbench-api`，JSON body，返回 `{ok:true,data}` / `{ok:false,error:{code,message}}`。非 GET 请求要求同源（`Origin.host === Host`），否则 403 `forbidden`。

| 方法 | 路径 | 成功状态 |
|---|---|---|
| GET | `/health` | 200 |
| GET | `/dashboard` | 200 |
| POST | `/assistant/chat` | 200 |
| POST | `/speech/prepare` | 200 |
| POST | `/speech/transcribe` | 200 |
| GET | `/settings` | 200 |
| POST | `/settings/root` | 200 |
| GET | `/projects?status=` | 200 |
| POST | `/projects` | 201 |
| GET | `/projects/:id?taskStatus=` | 200 |
| PATCH | `/projects/:id` | 200 |
| DELETE | `/projects/:id` | 200 |
| GET | `/projects/:id/tasks?taskStatus=` | 200 |
| POST | `/projects/:id/tasks` | 201 |
| GET | `/projects/:id/board` | 200 |
| GET | `/tasks/:id` | 200 |
| GET | `/context-by-session/:sessionId` | 200 |
| PATCH | `/tasks/:id` | 200 |
| POST | `/tasks/:id/comments` | 201 |
| POST | `/tasks/:id/comments/:cid/resolve` | 200 |
| POST | `/tasks/:id/move` | 200 |
| POST/DELETE | `/tasks/:id/session` | 201 / 200 |
| GET/POST | `/tasks/:id/artifacts` | 200 / 201 |
| POST | `/tasks/:id/artifacts/upload` | 201 |
| POST | `/tasks/:id/artifacts/sync` | 200 |
| DELETE | `/tasks/:id/artifacts/:artifactId` | 200 |
| GET/POST | `/tasks/:id/goals` | 200 / 201 |
| GET/PATCH/DELETE | `/goals/:id` | 200 |
| POST | `/goals/:id/sessions` | 201 |
| DELETE | `/goals/:id/sessions/:linkId` | 200 |
| GET/POST | `/goals/:id/artifacts` | 200 / 201 |
| POST | `/goals/:id/artifacts/upload?kind=&name=` | 201 |
| POST | `/goals/:id/artifacts/sync` | 200 |
| DELETE | `/goals/:id/artifacts/:artifactId?deleteFile=1` | 200 |
| GET | `/artifacts/:id/content` | 200（文件流） |

`POST /assistant/chat` body：`{ "message": "...", "history": [{ "role": "user\|assistant", "content": "..." }] }`；返回 `{reply, actions, provider, model}`，其中 `actions` 是本次执行的工具列表。工具面：查询首页/项目/任务，创建项目/任务/子目标，更新任务，添加评论，登记产物。客户端输入框的语音录入使用 DSH speech-to-text Remote（WAV/base64），不新增 host 接口。

`POST /settings/root` body：`{ "workbenchRoot": "/abs/new/root" }`；返回 `{workbenchRoot, source, projectCount, taskCount, migrated, from, movedProjects, warnings}`。

### 4.1 错误码 → HTTP

| code | status | 场景 |
|---|---|---|
| `bad-request` / `invalid-id` / `invalid-input` / `invalid-status` / `invalid-priority` / `invalid-due` | 400 | 参数非法 |
| `not-found` | 404 | 项目/任务/评论/路由不存在 |
| `forbidden` | 403 | 跨站写请求 |
| `project-archived` | 409 | 归档项目只读 |
| `project-not-empty` | 409 | 删除非空项目 |
| `needs-you-derived` | 409 | 尝试写入/拖入 needs-you |
| `root-migration-failed` | 409 | 根目录迁移非法/失败（含互相嵌套） |
| `storage-unavailable` | 409 | storageDomain 未就绪 |
| `internal` | 500 | 其他异常 |

## 5. 文件契约（辅助，不是主存储）

| 路径 | 内容 | 生成时机 |
|---|---|---|
| `<workbenchRoot>/<dirName>/AGENTS.md` | 项目级指令骨架 | 创建项目 / 根迁移后，且文件不存在 |
| `<workbenchRoot>/<dirName>/.dsh-project-workbench/board.json` | 项目/任务/统计/指令层快照 | 每次写操作后（可关闭） |
| `<workbenchRoot>/<dirName>/.dsh-project-workbench/AGENTS.md` | 任务清单 + 指令层清单 | 每次写操作后（可关闭） |
| `<workbenchRoot>/<dirName>/tasks/<taskId>/` | 任务目录 | 创建任务时，总是创建 |
| `<workbenchRoot>/<dirName>/tasks/<taskId>/AGENTS.md` | 任务级增量指令 | 创建任务时显式传 `agentsMd`，且文件不存在 |
| `<workbenchRoot>/<dirName>/tasks/<taskId>/inputs/*`、`outputs/*` | 任务级输入/输出成果 | 任务页上传或 `sync` 扫描登记 |
| `<workbenchRoot>/<dirName>/tasks/<taskId>/goals/<goalId>/` | 子目标目录 | 创建子目标时，总是创建 |
| `<goalDir>/inputs/*`、`<goalDir>/outputs/*` | 输入/输出产物文件 | 上传或 agent/会话直接写入；`sync` 会补登记 |

AGENTS.md 的**读取与注入**由 `@deepseek-ai/dsh-agent-instructions` 负责；插件只生成骨架并展示继承关系。任务级文件只有在会话 cwd 进入 `tasks/<taskId>` 时才会被该加载器纳入。

## 6. 不变量（测试覆盖）

1. 任务只能有一个 `projectId`；父任务必须同项目。
2. `needs-you` 不可作为存储状态写入；`POST /move` 的目标为 needs-you 时返回 409。
3. 从 needs-you 拖出会清 `blocked`/`waitingReview` 并解决所有未解决评论；活动记录留痕。
4. 归档项目拒绝创建/更新/评论/拖拽；但允许恢复与只读查看。
5. 删除项目仅当任务数为 0。
6. 项目级 AGENTS.md 已存在时绝不覆盖；任务级 AGENTS.md 同理。
7. 工作台根迁移后：项目目录、任务目录、goals 目录、AGENTS.md 与记录 `rootPath` 一致；旧根目录不再保留（外部历史目录除外）。
8. 子目标目录名只由 goal id 决定；会话关联只存引用，不删除 DSH 会话；产物删除托管文件时可选择是否删磁盘文件。
9. 便携导出失败不回滚 storageDomain 写操作，只返回 warnings / 日志。
