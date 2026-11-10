// dsh-project-workbench — 浏览器端：侧边栏「工作台」面板。
//
// 项目列表 → 项目详情（任务列表 / 看板）→ 任务详情，全部数据来自宿主插件
// 的同源 HTTP 路由 /workbench-api/*；浏览器端不读写文件系统，也不直接碰
// storageDomain。看板四列中 needs-you 是派生列：只能由宿主按“未解决评论 /
// 阻塞 / 等待审核”自动放入，拖拽接口会拒绝把卡片拖进该列。
//
// 纯 ES2020 + React.createElement（无 JSX、无打包器）；唯一 require 是 react。
window.__ModuleLoader__.load({
	id: "@jichong/dsh-project-workbench",
	factory(require) {
		const React = require("react");
		const { useState, useEffect, useMemo, useCallback, useRef } = React;
		const h = React.createElement;

		const PKG = "@jichong/dsh-project-workbench";
		const NS = "project-workbench";
		const API = "/workbench-api";
		const CSS_ID = "@jichong/dsh-project-workbench/pw.css";
		const PANEL_ID = "project-workbench";
		const TASK_TAB_ID = "@jichong/dsh-project-workbench/task-context";
		const TASK_TAB_KIND = "workbench-task";

		/* ───────────────────────── 文案（zh / en） ───────────────────────── */

		const ZH = {
			"panel.title": "工作台",
			"panel.subtitle": "项目 → 任务，按事组织而不是按目录组织",
			"settings.title": "工作台根目录",
			"settings.current": "当前根目录",
			"settings.newRoot": "新的根目录",
			"settings.newRootPh": "例如：/home/you/workbench 或 ~/workbench",
			"settings.hint": "所有项目目录都在工作台根下创建；修改后会立即自动迁移现有项目目录与记录。",
			"settings.warning": "迁移会移动项目目录；迁移完成前请勿关闭 DSH。",
			"settings.migrate": "迁移到新根目录",
			"settings.migrating": "迁移中…",
			"settings.projects": "项目",
			"settings.tasks": "任务",
			"settings.source.config": "由插件配置决定",
			"settings.source.user": "由 UI 设置",
			"settings.button": "工作台根目录",
			"settings.migrated": "工作台根目录已迁移",
			"dashboard.home": "工作台首页",
			"dashboard.welcome": "欢迎回来",
			"dashboard.subtitle": "右栏 AI 助手随时可用；也可以直接进入项目继续推进。",
			"dashboard.today.date": "今日 {date}",
			"dashboard.quick.newProject": "新建项目",
			"dashboard.quick.today": "今日待办",
			"dashboard.quick.recent": "最近任务",
			"dashboard.recentTasks.title": "最近任务",
			"dashboard.recentTasks.empty": "近期还没有操作过任务。",
			"dashboard.quick.progress": "查看进度",
			"dashboard.quick.review": "上周回顾",
			"dashboard.quick.weekly": "帮我写周报",
			"dashboard.today.title": "今日待办 / 已逾期",
			"dashboard.today.empty": "太棒了！没有待办 🎉",
			"dashboard.today.overdue": "已逾期",
			"dashboard.today.due": "截止 {time}",
			"dashboard.projects.title": "进行中项目",
			"dashboard.projects.empty": "还没有进行中的项目。",
			"dashboard.projects.all": "全部项目",
			"dashboard.projects.tasks": "{done}/{total} 任务",
			"dashboard.projects.updated": "{time}更新",
			"dashboard.weekly.title": "本周统计",
			"dashboard.weekly.completed": "任务完成",
			"dashboard.weekly.artifacts": "产物生成",
			"dashboard.weekly.sessions": "会话关联",
			"dashboard.weekly.activity": "活动记录",
			"dashboard.insights.title": "AI 洞察",
			"dashboard.focus.title": "关注事项",
			"dashboard.focus.empty": "没有需要特别关注的事项。",
			"dashboard.focus.all": "全部",
			"dashboard.focus.overdue": "已逾期",
			"dashboard.focus.needsYou": "Needs you",
			"dashboard.recent.title": "最近活动",
			"dashboard.recent.empty": "还没有活动记录。",
			"dashboard.assistant.title": "全局 AI 助手",
			"dashboard.assistant.subtitle": "自动注入所有项目概况和今日待办",
			"dashboard.assistant.welcome": "你好！我是工作台 AI 助手。可以帮你汇总项目进展、拆解任务或起草周报。",
			"dashboard.assistant.placeholder": "说点什么，或直接输入你的问题…",
			"dashboard.assistant.send": "发送",
			"dashboard.voice.record": "语音输入",
			"dashboard.voice.stop": "停止录音并转写",
			"dashboard.voice.transcribing": "语音转写中…",
			"dashboard.voice.failed": "语音输入失败",
			"dashboard.voice.unsupported": "当前浏览器不支持录音",
			"dashboard.voice.empty": "没有识别到语音内容",
			"dashboard.voice.recording": "正在录音",
			"dashboard.voice.preparing": "正在准备语音…",
			"dashboard.voice.transcribing": "正在转写…",
			"dashboard.assistant.fullChat": "标准聊天",
			"dashboard.assistant.fullChatHint": "在标准会话中继续（附件/命令/完整聊天能力）",
			"dashboard.assistant.fullChatOpened": "已在标准会话中打开",
			"dashboard.assistant.suggest1": "今天做了什么？",
			"dashboard.assistant.suggest2": "帮我拆解任务",
			"dashboard.assistant.suggest3": "生成本周周报",
			"dashboard.assistant.opened": "已带着提示词打开新会话",
			"dashboard.assistant.failed": "无法创建 AI 会话",
			"dashboard.loading": "正在加载工作台…",
			"dashboard.assistant.reviewPrompt": "请回顾上周工作台的进展：完成的任务、进行中的项目、遇到的问题，并给出下周建议。",
			"dashboard.assistant.weeklyPrompt": "请根据当前工作台数据帮我写一份本周周报，包含项目进展、完成任务、产物和风险。",
			"projects.workbenchRoot": "工作台根",
			"createProject.folder": "项目文件夹名",
			"createProject.folderPh": "可选；留空自动生成（名称-slug + ID 后缀）",
			"project.folder": "项目目录",
			"task.taskDir": "任务目录",
			"task.taskDirHint": "任务目录由任务唯一 ID 自动创建（tasks/<taskId>），不能手动指定。",
			"task.session.title": "任务会话",
			"task.session.none": "这个任务还没有专属会话。一个任务对应一个主会话，创建后任务产生的输入/输出都会记录在这里。",
			"task.session.create": "创建任务会话",
			"task.session.open": "打开会话",
			"task.session.unlink": "解除绑定",
			"task.session.cwd": "会话工作区",
			"task.session.busy": "正在创建会话…",
			"task.session.created": "已创建并绑定任务会话",
			"task.openSession": "任务会话",
			"task.detail": "详情",
			"task.artifacts.title": "任务成果",
			"task.artifacts.inputs": "输入成果",
			"task.artifacts.outputs": "输出成果",
			"task.artifacts.none": "还没有成果。",
			"task.artifacts.upload": "上传",
			"task.artifacts.sync": "刷新成果",
			"task.artifacts.uploading": "上传中…",
			"task.artifacts.synced": "已同步 {n} 个成果",
			"task.artifacts.uploaded": "成果已记录",
			"task.artifacts.deleteConfirm": "删除这条成果（托管文件也删除）？",
			"common.refresh": "刷新",
			"common.loading": "加载中…",
			"common.retry": "重试",
			"common.cancel": "取消",
			"common.save": "保存",
			"common.saving": "保存中…",
			"common.create": "创建",
			"common.creating": "创建中…",
			"common.close": "关闭",
			"common.delete": "删除",
			"common.back": "返回",
			"common.open": "打开",
			"common.copy": "复制",
			"common.copied": "已复制",
			"common.none": "无",
			"common.optional": "可选",
			"common.required": "必填",
			"common.unknown": "未知",
			"common.beta": "v1",
			"projects.title": "项目",
			"projects.new": "新建项目",
			"projects.empty": "还没有活跃项目。新建一个项目，把“领导交办的一件事”放进来。",
			"projects.emptyArchived": "没有已归档项目。",
			"projects.filter.active": "活跃",
			"projects.filter.archived": "已归档",
			"projects.filter.all": "全部",
			"projects.archivedBadge": "已归档",
			"projects.open": "打开项目",
			"projects.archive": "归档",
			"projects.restore": "恢复",
			"projects.deleteEmpty": "删除空项目",
			"projects.deleteConfirm": "确定删除这个空项目？项目记录会被移除，项目目录里的 AGENTS.md 不会被删除。",
			"projects.archiveConfirm": "归档后项目只读，但可以随时恢复。继续？",
			"projects.archivedHint": "已归档项目只读；恢复后才能新增任务或修改状态。",
			"projects.rootPath": "项目根",
			"projects.agentsMd": "项目 AGENTS.md",
			"projects.createdAt": "创建于",
			"projects.updatedAt": "更新于",
			"projects.markerDegraded": "未找到项目根 marker，按“项目路径即根”处理",
			"projects.taskCount": "{n} 个任务",
			"createProject.title": "新建项目",
			"createProject.name": "项目名称",
			"createProject.namePh": "例如：2026 年度供应商评审",
			"createProject.desc": "目标 / 背景",
			"createProject.descPh": "这件事要达成什么？有哪些背景、约束和验收口径？",
			"createProject.root": "项目根目录",
			"createProject.rootPh": "留空 = 使用 DSH 当前工作目录",
			"createProject.template": "项目 AGENTS.md 模板",
			"createProject.templateHint": "创建项目时会在项目根生成 AGENTS.md（已存在则不覆盖）。可编辑默认模板。",
			"createProject.useDefault": "使用内置模板",
			"createProject.custom": "自定义模板内容",
			"createProject.submit": "创建项目",
			"project.title": "项目",
			"project.list": "任务列表",
			"project.board": "看板",
			"project.newTask": "新建任务",
			"project.noTasks": "这个项目还没有任务。新建第一个任务，或让 agent 用 workbench_create_task 创建。",
			"project.noTasksFiltered": "当前筛选下没有任务。",
			"project.archivedReadonly": "项目已归档，当前为只读视图；恢复项目后才能修改。",
			"project.stats.backlog": "Backlog",
			"project.stats.running": "Running",
			"project.stats.needsYou": "Needs you",
			"project.stats.done": "Done",
			"project.stats.blocked": "阻塞",
			"project.stats.unresolved": "未解决评论",
			"project.stats.overdue": "已逾期",
			"project.filter.all": "全部",
			"project.filter.backlog": "Backlog",
			"project.filter.running": "Running",
			"project.filter.needs-you": "Needs you",
			"project.filter.done": "Done",
			"project.children": "子任务 {n}",
			"project.comments": "{n} 条评论",
			"createTask.title": "新建任务",
			"createTask.titleField": "任务标题",
			"createTask.titlePh": "例如：整理验收材料目录",
			"createTask.desc": "任务描述",
			"createTask.descPh": "这个任务具体要做什么？",
			"createTask.priority": "优先级",
			"createTask.due": "截止时间",
			"createTask.parent": "父任务",
			"createTask.parentNone": "无（顶层任务）",
			"createTask.agentsMd": "任务级 AGENTS.md（增量局部指令）",
			"createTask.agentsMdHint": "只在需要局部规则时填写。项目级内容不要重复；文件会写到 .dsh-project-workbench/tasks/<taskId>/AGENTS.md。",
			"createTask.addAgentsMd": "为这个任务生成任务级 AGENTS.md",
			"createTask.submit": "创建任务",
			"task.backToProject": "返回项目",
			"task.title": "任务标题",
			"task.description": "描述",
			"task.noDescription": "（没有描述）",
			"task.status": "状态",
			"task.viewStatus": "看板列",
			"task.priority": "优先级",
			"task.due": "截止时间",
			"task.dueEmpty": "未设置截止时间",
			"task.blocked": "标记阻塞",
			"task.waitingReview": "等待审核",
			"task.needsYouReasons": "Needs you 原因",
			"task.comments": "评论 / 备注",
			"task.noComments": "还没有评论。",
			"task.commentPh": "写一条评论；默认未解决，会让任务进入 needs-you。",
			"task.addComment": "添加评论",
			"task.resolve": "解决",
			"task.reopen": "重新打开",
			"task.resolved": "已解决",
			"task.unresolved": "未解决",
			"task.activity": "活动记录",
			"task.noActivity": "暂无活动记录。",
			"task.instructions": "当前生效的指令层",
			"task.goal": "任务目标",
			"task.goalPh": "一句话说清这个任务要达成什么；下面再拆成多个子目标。",
			"task.saveGoal": "保存任务目标",
			"goals.title": "子目标",
			"goals.add": "新增子目标",
			"goals.empty": "还没有子目标。把任务目拆成几个可独立推进的子目标。",
			"goals.edit": "编辑",
			"goals.delete": "删除",
			"goals.deleteConfirm": "删除这个子目标记录？目录和产物文件会保留。",
			"goals.dir": "子目标目录",
			"goals.status.open": "待开始",
			"goals.status.doing": "进行中",
			"goals.status.done": "已完成",
			"goals.descriptionPh": "子目标要达成什么？验收标准？",
			"goals.createTitle": "新增子目标",
			"goals.editTitle": "编辑子目标",
			"goals.sessions": "会话",
			"goals.noSessions": "还没有关联会话。",
			"goals.linkSession": "关联已有会话",
			"goals.newSession": "在工作台工作区新建会话",
			"goals.openSession": "打开会话",
			"goals.unlink": "取消关联",
			"goals.artifacts": "产物",
			"goals.inputs": "输入产物",
			"goals.outputs": "输出产物",
			"goals.noArtifacts": "还没有产物。",
			"goals.upload": "上传",
			"goals.uploading": "上传中…",
			"goals.sync": "刷新产物",
			"goals.synced": "已同步 {n} 个文件",
			"goals.deleteArtifact": "删除",
			"goals.deleteArtifactConfirm": "删除这条产物记录（托管文件也删除）？",
			"goals.openArtifact": "下载",
			"goals.size": "{size}",
			"goals.linkPath": "登记已有文件",
			"goals.pathPh": "文件绝对路径",
			"goals.notePh": "备注（可选）",
			"sessionPicker.title": "关联已有会话",
			"sessionPicker.search": "搜索标题 / 工作区…",
			"sessionPicker.empty": "没有可关联的会话。",
			"sessionPicker.link": "关联",
			"sessionPicker.cwd": "工作区",
			"sessionPicker.status": "状态",
			"sessionPicker.create": "在工作台工作区新建并关联",
			"sessionPicker.newHint": "工作台根目录默认就是一个 DSH 工作区；新建会话会复用它，并把会话关联到当前子目标。",
			"goalSession.created": "已在工作台工作区创建并关联会话",
			"goalSession.linked": "已关联会话",
			"goalSession.unlinked": "已取消关联",
			"goalSession.openFailed": "无法打开该会话（可能已被删除）",
			"error.goal": "子目标操作失败",
			"error.session": "会话操作失败",
			"error.artifact": "产物操作失败",
			"task.parent": "父任务",
			"task.children": "子任务",
			"task.project": "所属项目",
			"task.openProject": "打开项目",
			"task.completedAt": "完成于",
			"task.createdAt": "创建于",
			"task.updatedAt": "更新于",
			"task.editTitle": "编辑标题",
			"task.saveTitle": "保存标题",
			"task.saveDescription": "保存描述",
			"task.archivedReadonly": "项目已归档，任务只读；恢复项目后才能修改。",
			"instructions.title": "当前生效的指令层",
			"instructions.projectLayer": "项目级 AGENTS.md",
			"instructions.taskLayer": "任务级 AGENTS.md",
			"instructions.exists": "已存在",
			"instructions.missing": "不存在",
			"instructions.noTaskLayer": "该任务没有任务级 AGENTS.md。需要局部指令时，在创建任务时勾选生成，或手动放到任务目录。",
			"instructions.hint": "插件只生成骨架并展示继承关系，不接管读取/注入。实际加载由 dsh-agent-instructions 按“项目根 → 会话工作目录”完成；任务级文件只有在会话工作目录进入任务目录时才生效。",
			"instructions.loader": "加载器",
			"board.backlog": "Backlog",
			"board.running": "Running",
			"board.needs-you": "Needs you",
			"board.done": "Done",
			"board.needsYouLocked": "needs-you 是派生列，只能由系统自动放入，不能拖入",
			"board.empty": "暂无任务",
			"board.dragHint": "拖拽卡片改变状态；needs-you 列只能自动进入",
			"board.moveFailed": "移动失败",
			"activity.task.created": "创建任务",
			"activity.task.updated": "更新任务",
			"activity.task.status": "状态变更",
			"activity.task.priority": "优先级变更",
			"activity.task.due": "截止时间变更",
			"activity.task.blocked": "阻塞标记",
			"activity.task.review": "审核标记",
			"activity.task.agents-md": "任务级 AGENTS.md",
			"activity.comment.added": "添加评论",
			"activity.comment.resolved": "解决评论",
			"activity.comment.reopened": "重新打开评论",
			"activity.task.moved": "看板移动",
			"priority.low": "低",
			"priority.medium": "中",
			"priority.high": "高",
			"priority.urgent": "紧急",
			"status.backlog": "Backlog",
			"status.running": "Running",
			"status.needs-you": "Needs you",
			"status.done": "Done",
			"toast.projectCreated": "项目已创建，AGENTS.md 已就绪",
			"toast.taskCreated": "任务已创建",
			"toast.saved": "已保存",
			"toast.commentAdded": "评论已添加",
			"toast.resolved": "评论状态已更新",
			"toast.deleted": "项目已删除",
			"toast.archived": "项目已归档",
			"toast.restored": "项目已恢复",
			"error.load": "加载失败",
			"error.createProject": "创建项目失败",
			"error.createTask": "创建任务失败",
			"error.update": "更新失败",
			"error.comment": "添加评论失败",
			"error.resolve": "更新评论失败",
			"error.delete": "删除失败",
			"error.archive": "归档失败",
			"error.restore": "恢复失败",
			"time.justNow": "刚刚",
			"time.minutesAgo": "{n} 分钟前",
			"time.hoursAgo": "{n} 小时前",
			"time.daysAgo": "{n} 天前",
			"time.overdue": "已逾期",
		};

		const EN = {
			"panel.title": "Workbench",
			"panel.subtitle": "Projects → tasks, organized by work rather than folders",
			"settings.title": "Workbench root",
			"settings.current": "Current root",
			"settings.newRoot": "New root",
			"settings.newRootPh": "e.g. /home/you/workbench or ~/workbench",
			"settings.hint": "Every project directory is created under the workbench root; changing it migrates existing project directories and records immediately.",
			"settings.warning": "Migration moves project directories; keep DSH running until it finishes.",
			"settings.migrate": "Migrate to new root",
			"settings.migrating": "Migrating…",
			"settings.projects": "Projects",
			"settings.tasks": "Tasks",
			"settings.source.config": "from plugin config",
			"settings.source.user": "set in UI",
			"settings.button": "Workbench root",
			"settings.migrated": "Workbench root migrated",
			"dashboard.home": "Workbench home",
			"dashboard.welcome": "Welcome back",
			"dashboard.subtitle": "The AI assistant on the right is always available; or jump straight into a project.",
			"dashboard.today.date": "Today {date}",
			"dashboard.quick.newProject": "New project",
			"dashboard.quick.today": "Today's todos",
			"dashboard.quick.progress": "View progress",
			"dashboard.quick.review": "Last-week review",
			"dashboard.quick.weekly": "Write weekly report",
			"dashboard.today.title": "Today / Overdue",
			"dashboard.today.empty": "Nothing due. Nice! 🎉",
			"dashboard.today.overdue": "Overdue",
			"dashboard.today.due": "Due {time}",
			"dashboard.projects.title": "Projects in progress",
			"dashboard.projects.empty": "No active projects yet.",
			"dashboard.projects.all": "All projects",
			"dashboard.projects.tasks": "{done}/{total} tasks",
			"dashboard.projects.updated": "updated {time}",
			"dashboard.weekly.title": "This week",
			"dashboard.weekly.completed": "Tasks completed",
			"dashboard.weekly.artifacts": "Artifacts created",
			"dashboard.weekly.sessions": "Sessions linked",
			"dashboard.weekly.activity": "Activity entries",
			"dashboard.insights.title": "AI insights",
			"dashboard.focus.title": "Needs attention",
			"dashboard.focus.empty": "Nothing needs special attention.",
			"dashboard.focus.all": "All",
			"dashboard.focus.overdue": "Overdue",
			"dashboard.focus.needsYou": "Needs you",
			"dashboard.recent.title": "Recent activity",
			"dashboard.recent.empty": "No activity yet.",
			"dashboard.assistant.title": "Global AI assistant",
			"dashboard.assistant.subtitle": "Injects all project context and today's todos",
			"dashboard.assistant.welcome": "Hi! I'm the workbench AI assistant. I can summarize progress, split tasks, or draft your weekly report.",
			"dashboard.assistant.placeholder": "Say something, or type your question…",
			"dashboard.assistant.send": "Send",
			"dashboard.voice.record": "Voice input",
			"dashboard.voice.stop": "Stop recording and transcribe",
			"dashboard.voice.transcribing": "Transcribing…",
			"dashboard.voice.failed": "Voice input failed",
			"dashboard.voice.unsupported": "This browser cannot record audio",
			"dashboard.voice.empty": "No speech detected",
			"dashboard.voice.recording": "Recording",
			"dashboard.voice.preparing": "Preparing voice…",
			"dashboard.voice.transcribing": "Transcribing…",
			"dashboard.assistant.fullChat": "Full chat",
			"dashboard.assistant.fullChatHint": "Continue in a standard session (attachments, commands, full chat capabilities)",
			"dashboard.assistant.fullChatOpened": "Opened in a standard session",
			"dashboard.assistant.suggest1": "What did I do today?",
			"dashboard.assistant.suggest2": "Split a task for me",
			"dashboard.assistant.suggest3": "Generate weekly report",
			"dashboard.assistant.opened": "Opened a new session with the prompt",
			"dashboard.assistant.failed": "Failed to create the AI session",
			"dashboard.loading": "Loading workbench…",
			"dashboard.assistant.reviewPrompt": "Review my workbench progress from last week: completed tasks, active projects, blockers, and suggestions for next week.",
			"dashboard.assistant.weeklyPrompt": "Write my weekly report from the current workbench data: project progress, completed tasks, artifacts, and risks.",
			"projects.workbenchRoot": "Workbench root",
			"createProject.folder": "Project folder name",
			"createProject.folderPh": "optional; empty = auto (name-slug + ID suffix)",
			"project.folder": "Project directory",
			"task.taskDir": "Task directory",
			"task.taskDirHint": "The task directory is created from the task's unique ID (tasks/<taskId>) and cannot be chosen manually.",
			"task.session.title": "Task session",
			"task.session.none": "This task has no dedicated session yet. One task maps to one primary session; inputs and outputs produced in the task are recorded here.",
			"task.session.create": "Create task session",
			"task.session.open": "Open session",
			"task.session.unlink": "Unlink",
			"task.session.cwd": "Session workspace",
			"task.session.busy": "Creating session…",
			"task.session.created": "Task session created and linked",
			"task.openSession": "Task session",
			"task.detail": "Details",
			"task.artifacts.title": "Task artifacts",
			"task.artifacts.inputs": "Inputs",
			"task.artifacts.outputs": "Outputs",
			"task.artifacts.none": "No artifacts yet.",
			"task.artifacts.upload": "Upload",
			"task.artifacts.sync": "Refresh artifacts",
			"task.artifacts.uploading": "Uploading…",
			"task.artifacts.synced": "Synced {n} artifact(s)",
			"task.artifacts.uploaded": "Artifact recorded",
			"task.artifacts.deleteConfirm": "Delete this artifact (managed file is removed too)?",
			"common.refresh": "Refresh",
			"common.loading": "Loading…",
			"common.retry": "Retry",
			"common.cancel": "Cancel",
			"common.save": "Save",
			"common.saving": "Saving…",
			"common.create": "Create",
			"common.creating": "Creating…",
			"common.close": "Close",
			"common.delete": "Delete",
			"common.back": "Back",
			"common.open": "Open",
			"common.copy": "Copy",
			"common.copied": "Copied",
			"common.none": "None",
			"common.optional": "optional",
			"common.required": "required",
			"common.unknown": "Unknown",
			"projects.title": "Projects",
			"projects.new": "New project",
			"projects.empty": "No active projects yet. Create one to hold the thing you were asked to deliver.",
			"projects.emptyArchived": "No archived projects.",
			"projects.filter.active": "Active",
			"projects.filter.archived": "Archived",
			"projects.filter.all": "All",
			"projects.archivedBadge": "Archived",
			"projects.open": "Open project",
			"projects.archive": "Archive",
			"projects.restore": "Restore",
			"projects.deleteEmpty": "Delete empty project",
			"projects.deleteConfirm": "Delete this empty project? The record is removed; AGENTS.md on disk stays.",
			"projects.archiveConfirm": "Archiving makes the project read-only but recoverable. Continue?",
			"projects.archivedHint": "Archived projects are read-only; restore to add tasks or change status.",
			"projects.rootPath": "Project root",
			"projects.agentsMd": "Project AGENTS.md",
			"projects.createdAt": "Created",
			"projects.updatedAt": "Updated",
			"projects.markerDegraded": "No project-root marker found; treating the project path itself as the root",
			"projects.taskCount": "{n} task(s)",
			"createProject.title": "New project",
			"createProject.name": "Project name",
			"createProject.namePh": "e.g. 2026 supplier review",
			"createProject.desc": "Goal / background",
			"createProject.descPh": "What should this project achieve? Background, constraints, acceptance criteria?",
			"createProject.root": "Project root directory",
			"createProject.rootPh": "Empty = DSH current working directory",
			"createProject.template": "Project AGENTS.md template",
			"createProject.templateHint": "A project AGENTS.md is generated at the project root (existing files are never overwritten). Edit the default template here.",
			"createProject.useDefault": "Use built-in template",
			"createProject.custom": "Custom template",
			"createProject.submit": "Create project",
			"project.title": "Project",
			"project.list": "Task list",
			"project.board": "Board",
			"project.newTask": "New task",
			"project.noTasks": "No tasks yet. Create the first one, or let the agent call workbench_create_task.",
			"project.noTasksFiltered": "No tasks under this filter.",
			"project.archivedReadonly": "This project is archived and read-only; restore it to make changes.",
			"project.stats.backlog": "Backlog",
			"project.stats.running": "Running",
			"project.stats.needsYou": "Needs you",
			"project.stats.done": "Done",
			"project.stats.blocked": "Blocked",
			"project.stats.unresolved": "Unresolved comments",
			"project.stats.overdue": "Overdue",
			"project.filter.all": "All",
			"project.filter.backlog": "Backlog",
			"project.filter.running": "Running",
			"project.filter.needs-you": "Needs you",
			"project.filter.done": "Done",
			"project.children": "{n} child task(s)",
			"project.comments": "{n} comment(s)",
			"createTask.title": "New task",
			"createTask.titleField": "Task title",
			"createTask.titlePh": "e.g. Assemble acceptance evidence",
			"createTask.desc": "Description",
			"createTask.descPh": "What exactly needs to happen?",
			"createTask.priority": "Priority",
			"createTask.due": "Due",
			"createTask.parent": "Parent task",
			"createTask.parentNone": "None (top-level)",
			"createTask.agentsMd": "Task-level AGENTS.md (incremental instructions)",
			"createTask.agentsMdHint": "Only for local rules. Do not repeat project-level content; written to .dsh-project-workbench/tasks/<taskId>/AGENTS.md.",
			"createTask.addAgentsMd": "Generate a task-level AGENTS.md",
			"createTask.submit": "Create task",
			"task.backToProject": "Back to project",
			"task.title": "Task title",
			"task.description": "Description",
			"task.noDescription": "(no description)",
			"task.status": "Status",
			"task.viewStatus": "Board column",
			"task.priority": "Priority",
			"task.due": "Due",
			"task.dueEmpty": "No due date",
			"task.blocked": "Blocked",
			"task.waitingReview": "Waiting review",
			"task.needsYouReasons": "Needs-you reasons",
			"task.comments": "Comments",
			"task.noComments": "No comments yet.",
			"task.commentPh": "Write a comment; unresolved comments put the task in needs-you.",
			"task.addComment": "Add comment",
			"task.resolve": "Resolve",
			"task.reopen": "Reopen",
			"task.resolved": "Resolved",
			"task.unresolved": "Unresolved",
			"task.activity": "Activity",
			"task.noActivity": "No activity yet.",
			"task.instructions": "Effective instruction layers",
			"task.goal": "Task goal",
			"task.goalPh": "One sentence for what this task must achieve; split it into sub-goals below.",
			"task.saveGoal": "Save task goal",
			"goals.title": "Sub-goals",
			"goals.add": "Add sub-goal",
			"goals.empty": "No sub-goals yet. Split the task goal into independently actionable goals.",
			"goals.edit": "Edit",
			"goals.delete": "Delete",
			"goals.deleteConfirm": "Delete this sub-goal record? Its directory and artifact files are kept.",
			"goals.dir": "Goal directory",
			"goals.status.open": "Open",
			"goals.status.doing": "Doing",
			"goals.status.done": "Done",
			"goals.descriptionPh": "What should this sub-goal achieve? Acceptance criteria?",
			"goals.createTitle": "Add sub-goal",
			"goals.editTitle": "Edit sub-goal",
			"goals.sessions": "Sessions",
			"goals.noSessions": "No linked sessions yet.",
			"goals.linkSession": "Link existing session",
			"goals.newSession": "New session in workbench workspace",
			"goals.openSession": "Open session",
			"goals.unlink": "Unlink",
			"goals.artifacts": "Artifacts",
			"goals.inputs": "Inputs",
			"goals.outputs": "Outputs",
			"goals.noArtifacts": "No artifacts yet.",
			"goals.upload": "Upload",
			"goals.uploading": "Uploading…",
			"goals.sync": "Refresh artifacts",
			"goals.synced": "Synced {n} file(s)",
			"goals.deleteArtifact": "Delete",
			"goals.deleteArtifactConfirm": "Delete this artifact record (managed file is removed too)?",
			"goals.openArtifact": "Download",
			"goals.size": "{size}",
			"goals.linkPath": "Register existing file",
			"goals.pathPh": "Absolute file path",
			"goals.notePh": "Note (optional)",
			"sessionPicker.title": "Link existing session",
			"sessionPicker.search": "Search title / workspace…",
			"sessionPicker.empty": "No sessions available.",
			"sessionPicker.link": "Link",
			"sessionPicker.cwd": "Workspace",
			"sessionPicker.status": "Status",
			"sessionPicker.create": "Create in workbench workspace and link",
			"sessionPicker.newHint": "The workbench root is already a DSH workspace by default; creating a session reuses it and links the session to this sub-goal.",
			"goalSession.created": "Created and linked a session in the workbench workspace",
			"goalSession.linked": "Session linked",
			"goalSession.unlinked": "Session unlinked",
			"goalSession.openFailed": "Cannot open that session (it may have been deleted)",
			"error.goal": "Sub-goal operation failed",
			"error.session": "Session operation failed",
			"error.artifact": "Artifact operation failed",
			"task.parent": "Parent",
			"task.children": "Children",
			"task.project": "Project",
			"task.openProject": "Open project",
			"task.completedAt": "Completed",
			"task.createdAt": "Created",
			"task.updatedAt": "Updated",
			"task.editTitle": "Edit title",
			"task.saveTitle": "Save title",
			"task.saveDescription": "Save description",
			"task.archivedReadonly": "The project is archived, so this task is read-only; restore the project to make changes.",
			"instructions.title": "Effective instruction layers",
			"instructions.projectLayer": "Project AGENTS.md",
			"instructions.taskLayer": "Task AGENTS.md",
			"instructions.exists": "present",
			"instructions.missing": "missing",
			"instructions.noTaskLayer": "This task has no task-level AGENTS.md. Generate one when creating a task, or place it in the task directory manually.",
			"instructions.hint": "The plugin only generates skeletons and shows inheritance; it does not load or inject instructions. Loading is done by dsh-agent-instructions from project root down to the session working directory; a task-level file applies only when the session cwd enters the task directory.",
			"instructions.loader": "Loader",
			"board.backlog": "Backlog",
			"board.running": "Running",
			"board.needs-you": "Needs you",
			"board.done": "Done",
			"board.needsYouLocked": "needs-you is derived: only the system places cards here, dropping is disabled",
			"board.empty": "No tasks",
			"board.dragHint": "Drag cards to change status; the needs-you column is automatic",
			"board.moveFailed": "Move failed",
			"activity.task.created": "Task created",
			"activity.task.updated": "Task updated",
			"activity.task.status": "Status changed",
			"activity.task.priority": "Priority changed",
			"activity.task.due": "Due changed",
			"activity.task.blocked": "Blocked flag",
			"activity.task.review": "Review flag",
			"activity.task.agents-md": "Task AGENTS.md",
			"activity.comment.added": "Comment added",
			"activity.comment.resolved": "Comment resolved",
			"activity.comment.reopened": "Comment reopened",
			"activity.task.moved": "Board move",
			"priority.low": "Low",
			"priority.medium": "Medium",
			"priority.high": "High",
			"priority.urgent": "Urgent",
			"status.backlog": "Backlog",
			"status.running": "Running",
			"status.needs-you": "Needs you",
			"status.done": "Done",
			"toast.projectCreated": "Project created; AGENTS.md is ready",
			"toast.taskCreated": "Task created",
			"toast.saved": "Saved",
			"toast.commentAdded": "Comment added",
			"toast.resolved": "Comment updated",
			"toast.deleted": "Project deleted",
			"toast.archived": "Project archived",
			"toast.restored": "Project restored",
			"error.load": "Failed to load",
			"error.createProject": "Failed to create project",
			"error.createTask": "Failed to create task",
			"error.update": "Failed to update",
			"error.comment": "Failed to add comment",
			"error.resolve": "Failed to update comment",
			"error.delete": "Failed to delete",
			"error.archive": "Failed to archive",
			"error.restore": "Failed to restore",
			"time.justNow": "just now",
			"time.minutesAgo": "{n} min ago",
			"time.hoursAgo": "{n} h ago",
			"time.daysAgo": "{n} d ago",
			"time.overdue": "Overdue",
		};

		let translate = null;
		let currentLocale = null;
		let rootClientCtx = null;

		/** DSH 客户端会话目录（用于“关联已有会话”）。 */
		function dshSessionList() {
			try {
				const sessions = rootClientCtx?.get?.("sessions");
				const snapshot = sessions?.list?.getSnapshot?.();
				if (snapshot === undefined || snapshot === null || snapshot.byId === undefined) return [];
				const ids = Array.isArray(snapshot.ids) ? snapshot.ids : Object.keys(snapshot.byId);
				return ids
					.map((id) => snapshot.byId[id])
					.filter((row) => row !== undefined && row !== null)
					.map((row) => ({
						sessionId: row.sessionId ?? row.id,
						title: row.displayTitle ?? row.title ?? row.sessionId ?? row.id,
						cwd: row.cwd ?? "",
						status: row.status ?? "unknown",
					}));
			} catch {
				return [];
			}
		}

		let pendingWorkbenchRoute = null;

		/** 从右侧面板 / 会话返回工作台主面板。 */
		function navigateWorkbench(route) {
			pendingWorkbenchRoute = route;
			try {
				rootClientCtx?.layout?.selectPanel?.(PANEL_ID);
			} catch {
				/* ignore */
			}
			try {
				window.dispatchEvent(new CustomEvent("workbench:navigate"));
			} catch {
				/* ignore */
			}
		}

		/** 在右侧栏打开任务工作台面板（会话 → 任务上下文）。 */
		function openTaskContextTab(sessionId) {
			const sidebarRight = rootClientCtx?.sidebarRight;
			if (sidebarRight === undefined || sidebarRight === null) return false;
			const attempt = () => {
				try {
					if (typeof sidebarRight.openTabIn === "function") sidebarRight.openTabIn(sessionId, TASK_TAB_KIND);
					else sidebarRight.openTab?.(TASK_TAB_KIND);
				} catch {
					try {
						sidebarRight.openTab?.(TASK_TAB_KIND);
					} catch {
						/* ignore */
					}
				}
			};
			attempt();
			// 会话切换后右侧栏可能尚未 mounted；稍后重试一次。
			setTimeout(attempt, 600);
			return true;
		}

		/** 构造 DSH 右侧栏文件预览地址。 */
		function sidebarFileAddress(sessionId, filePath, cwd = "") {
			const normalized = String(filePath ?? "").replace(/\\/g, "/");
			const root = String(cwd ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
			let relative = normalized;
			if (root !== "" && normalized === root) relative = "";
			else if (root !== "" && normalized.startsWith(`${root}/`)) relative = normalized.slice(root.length + 1);
			const encoded = relative.split("/").map((segment) => encodeURIComponent(segment).replace(/%3A/gi, ":")).join("/");
			return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${encoded}`;
		}

		/** 在右侧栏打开产物文件（预览），失败时退回新窗口打开。 */
		function openArtifactInSidebar(sessionId, cwd, artifact) {
			const sidebar = rootClientCtx?.sidebarRight;
			if (sidebar?.openResource !== undefined) {
				try {
					sidebar.openResource(sidebarFileAddress(sessionId, artifact.path, cwd));
					return true;
				} catch {
					/* fall through */
				}
			}
			if (typeof window !== "undefined" && typeof window.open === "function") {
				window.open(artifact.downloadPath, "_blank", "noopener");
				return true;
			}
			return false;
		}

		/** 产物文件图标（按扩展名）。 */
		function artifactIcon(name) {
			const ext = String(name ?? "").toLowerCase().split(".").pop();
			if (["md", "markdown", "txt", "log"].includes(ext)) return "📄";
			if (["pdf"].includes(ext)) return "📕";
			if (["doc", "docx"].includes(ext)) return "📘";
			if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
			if (["ppt", "pptx"].includes(ext)) return "📈";
			if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "🖼️";
			if (["zip", "tar", "gz", "7z", "rar"].includes(ext)) return "📦";
			if (["json", "yaml", "yml", "xml"].includes(ext)) return "🧾";
			return "📎";
		}

		/** 打开一个 DSH 会话。 */
		function openDshSession(sessionId) {
			try {
				const uiWorkspace = rootClientCtx?.get?.("uiWorkspace");
				if (uiWorkspace?.openSession === undefined) return false;
				uiWorkspace.openSession(sessionId);
				return true;
			} catch {
				return false;
			}
		}

		/** 在工作台默认工作区创建 DSH 会话；返回 sessionId。 */
		async function createDshSessionInWorkspace(workspacePath, title = "") {
			const uiWorkspace = rootClientCtx?.get?.("uiWorkspace");
			if (uiWorkspace === undefined || uiWorkspace === null) throw new Error("当前界面不支持创建会话");
			const list = uiWorkspace.workspaces?.list?.getSnapshot?.();
			let workspace = Array.isArray(list?.items) ? list.items.find((item) => item.path === workspacePath) : undefined;
			if (workspace === undefined) {
				if (typeof uiWorkspace.workspaces?.create !== "function") throw new Error("当前界面不支持创建工作区");
				let result;
				try {
					result = await uiWorkspace.workspaces.create({ path: workspacePath });
				} catch (error) {
					throw new Error(`创建工作区失败：${errorText(error)}`);
				}
				if (result !== null && typeof result === "object" && result.ok === true && result.value !== undefined) {
					workspace = result.value.workspace ?? result.value;
				} else if (result !== null && typeof result === "object" && result.ok === false) {
					throw new Error(`创建工作区失败：${result.error?.message ?? "unknown"}`);
				} else {
					throw new Error("创建工作区失败：返回结果无法识别");
				}
			}
			const workspaceId = workspace?.workspaceId;
			if (workspaceId === undefined) throw new Error("工作区缺少 workspaceId");
			if (title !== "" && typeof uiWorkspace.workspaces?.rename === "function") {
				await uiWorkspace.workspaces.rename(workspaceId, title).catch(() => undefined);
			}
			if (typeof uiWorkspace.createNamed !== "function") throw new Error("当前界面不支持直接在工作区创建会话");
			const sessionId = await uiWorkspace.createNamed({ workspaceId });
			if (typeof sessionId !== "string" || sessionId === "") throw new Error("创建会话未返回 sessionId");
			return { sessionId, cwd: workspacePath };
		}

		/** PCM16 mono WAV 编码（与 DSH voice input 的 Host 契约一致）。 */
		function encodeWave(samples) {
			const bytes = new Uint8Array(44 + samples.length * 2);
			const view = new DataView(bytes.buffer);
			const text = (at, value) => {
				for (let i = 0; i < value.length; i += 1) bytes[at + i] = value.charCodeAt(i);
			};
			text(0, "RIFF");
			view.setUint32(4, bytes.length - 8, true);
			text(8, "WAVE");
			text(12, "fmt ");
			view.setUint32(16, 16, true);
			view.setUint16(20, 1, true);
			view.setUint16(22, 1, true);
			view.setUint32(24, 16000, true);
			view.setUint32(28, 32000, true);
			view.setUint16(32, 2, true);
			view.setUint16(34, 16, true);
			text(36, "data");
			view.setUint32(40, samples.length * 2, true);
			for (let i = 0; i < samples.length; i += 1) {
				const value = Math.max(-1, Math.min(1, samples[i]));
				view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
			}
			return bytes;
		}

		function bytesToBase64(bytes) {
			let text = "";
			for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
			return btoa(text);
		}

		/** 浏览器录音 + 重采样为 16k 单声道 WAV，交给 DSH speech-to-text Remote。 */
		function createVoiceCapture() {
			let stream = null;
			let context = null;
			let recorder = null;
			let analyser = null;
			let chunks = [];
			const samples = new Float32Array(256);
			return {
				async start() {
					if (typeof MediaRecorder === "undefined" || navigator?.mediaDevices === undefined) throw new Error("unsupported");
					stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
					context = new AudioContext();
					analyser = context.createAnalyser();
					analyser.fftSize = samples.length;
					context.createMediaStreamSource(stream).connect(analyser);
					recorder = new MediaRecorder(stream);
					chunks = [];
					recorder.ondataavailable = (event) => {
						if (event.data.size > 0) chunks.push(event.data);
					};
					recorder.start();
				},
				async stop() {
					const currentRecorder = recorder;
					const currentContext = context;
					if (currentRecorder === null || currentContext === null) throw new Error("empty");
					await new Promise((resolve, reject) => {
						currentRecorder.onstop = () => resolve();
						currentRecorder.onerror = () => reject(new Error("empty"));
						currentRecorder.stop();
					});
					for (const track of stream?.getTracks?.() ?? []) track.stop();
					const blob = new Blob(chunks, { type: currentRecorder.mimeType });
					if (blob.size === 0) throw new Error("empty");
					const decoded = await currentContext.decodeAudioData(await blob.arrayBuffer());
					const length = Math.max(1, Math.floor(Math.min(decoded.duration, 60) * 16000));
					const offline = new OfflineAudioContext(1, length, 16000);
					const source = offline.createBufferSource();
					source.buffer = decoded;
					source.connect(offline.destination);
					source.start();
					const rendered = await offline.startRendering();
					const wav = encodeWave(rendered.getChannelData(0));
					await currentContext.close().catch(() => undefined);
					stream = null;
					context = null;
					recorder = null;
					return bytesToBase64(wav);
				},
				amplitude() {
					if (analyser === null) return 0;
					analyser.getFloatTimeDomainData(samples);
					let sum = 0;
					for (const sample of samples) sum += sample * sample;
					const rms = Math.sqrt(sum / samples.length);
					return Math.min(1, Math.max(0, (rms - 0.006) * 10));
				},
				dispose() {
					try {
						for (const track of stream?.getTracks?.() ?? []) track.stop();
						recorder?.stop?.();
						context?.close?.();
					} catch {
						/* ignore */
					}
					stream = null;
					context = null;
					recorder = null;
					analyser = null;
				},
			};
		}

		function fmtSize(bytes) {
			const value = Number(bytes);
			if (!Number.isFinite(value) || value < 0) return "";
			if (value < 1024) return `${value} B`;
			if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
			return `${(value / 1024 / 1024).toFixed(1)} MB`;
		}

		function detectLanguage() {
			try {
				const lang = String(navigator?.language ?? "").toLowerCase();
				if (lang.startsWith("zh")) return "zh";
				if (lang.startsWith("en")) return "en";
			} catch {
				/* ignore */
			}
			return "zh";
		}

		function t(key, vars) {
			if (translate !== null) {
				try {
					const value = translate(key, vars);
					if (typeof value === "string" && value !== key) return value;
				} catch {
					/* fall through */
				}
			}
			const dict = currentLocale === "en" ? EN : ZH;
			const template = dict[key] ?? ZH[key] ?? key;
			if (vars === undefined || vars === null) return template;
			return String(template).replace(/\{(\w+)\}/g, (match, name) =>
				Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
			);
		}

		/* ───────────────────────── 纯函数 ───────────────────────── */

		function errorText(error) {
			if (error === null || error === undefined) return t("common.unknown");
			const message = typeof error?.message === "string" ? error.message : String(error);
			return message;
		}

		function statusLabel(status) {
			return t(`status.${status}`);
		}

		function priorityLabel(priority) {
			return t(`priority.${priority}`);
		}

		function fmtDate(iso) {
			if (typeof iso !== "string" || iso === "") return "";
			const time = Date.parse(iso);
			if (!Number.isFinite(time)) return iso;
			try {
				return new Intl.DateTimeFormat(currentLocale === "en" ? "en-US" : "zh-CN", { dateStyle: "medium" }).format(time);
			} catch {
				return new Date(time).toISOString().slice(0, 10);
			}
		}

		function fmtDateTime(iso) {
			if (typeof iso !== "string" || iso === "") return "";
			const time = Date.parse(iso);
			if (!Number.isFinite(time)) return iso;
			try {
				return new Intl.DateTimeFormat(currentLocale === "en" ? "en-US" : "zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(time);
			} catch {
				return new Date(time).toISOString().replace("T", " ").slice(0, 16);
			}
		}

		function relativeTime(iso) {
			const time = Date.parse(iso);
			if (!Number.isFinite(time)) return "";
			const delta = Date.now() - time;
			if (delta < 60_000) return t("time.justNow");
			if (delta < 3_600_000) return t("time.minutesAgo", { n: Math.floor(delta / 60_000) });
			if (delta < 86_400_000) return t("time.hoursAgo", { n: Math.floor(delta / 3_600_000) });
			return t("time.daysAgo", { n: Math.floor(delta / 86_400_000) });
		}

		function isOverdue(task) {
			if (typeof task?.dueAt !== "string" || task.dueAt === "") return false;
			if (task.status === "done") return false;
			const time = Date.parse(task.dueAt);
			return Number.isFinite(time) && time < Date.now();
		}

		/** ISO → datetime-local 输入值（本地时区）。 */
		function toLocalInput(iso) {
			if (typeof iso !== "string" || iso === "") return "";
			const time = Date.parse(iso);
			if (!Number.isFinite(time)) return "";
			const date = new Date(time);
			const pad = (value) => String(value).padStart(2, "0");
			return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
		}

		/** datetime-local 值 → ISO；空串 → ""。 */
		function fromLocalInput(value) {
			if (typeof value !== "string" || value === "") return "";
			const time = Date.parse(value);
			if (!Number.isFinite(time)) return "";
			return new Date(time).toISOString();
		}

		function activityKindLabel(kind) {
			const key = `activity.${kind}`;
			const label = t(key);
			return label === key ? kind : label;
		}

		function needsYouReasonText(reason) {
			if (reason.code === "unresolved-comments") return t("project.stats.unresolved") + ` × ${reason.count}`;
			if (reason.code === "blocked") return t("task.blocked");
			if (reason.code === "waiting-review") return t("task.waitingReview");
			return reason.label ?? reason.code;
		}

		/** 本地生成项目 AGENTS.md 模板预览（与服务端模板保持一致的口径）。 */
		function buildProjectTemplate(name, description) {
			const desc = typeof description === "string" && description.trim() !== "" ? description.trim() : "（在这里补充项目目标、验收标准与背景。）";
			return [
				`# 项目：${name || "（未命名项目）"}`,
				"",
				"<!-- 由 dsh-project-workbench 生成；这是项目级 AGENTS.md，可自由编辑，插件不会覆盖已有内容。 -->",
				"",
				"## 目标 / 背景",
				"",
				desc,
				"",
				"## 通用规则",
				"",
				"- 项目内所有任务共享本文件的背景、约束与验收口径；任务级 AGENTS.md 只写增量补充，不重复本节。",
				"- 开始工作前先确认任务状态与当前生效的指令层；完成后更新任务状态、评论与活动记录。",
				"- 需求不明确或存在阻塞时，在任务上留下未解决评论，让任务进入 needs-you 视图等待人工确认。",
				"",
				"## 工作台",
				"",
				"- 项目目录：工作台根下由插件创建",
				"- 任务目录：`tasks/<taskId>/`（由任务唯一 ID 自动创建）",
				"- 看板便携副本：`.dsh-project-workbench/board.json`",
				"",
			].join("\n");
		}

		/** 同源 HTTP 请求。 */
		async function api(route, options = {}) {
			const method = options.method ?? "GET";
			const init = { method, headers: {} };
			if (options.body !== undefined) {
				init.headers["content-type"] = "application/json";
				init.body = JSON.stringify(options.body);
			}
			let response;
			try {
				response = await fetch(`${API}${route}`, init);
			} catch (error) {
				throw new Error(`${t("error.load")}：${errorText(error)}`);
			}
			let payload = null;
			try {
				payload = await response.json();
			} catch {
				payload = null;
			}
			if (payload === null || typeof payload !== "object") throw new Error(`HTTP ${response.status}`);
			if (payload.ok !== true) {
				const message = payload?.error?.message ?? `HTTP ${response.status}`;
				const code = payload?.error?.code ?? "error";
				const wrapped = new Error(message);
				wrapped.code = code;
				wrapped.status = response.status;
				throw wrapped;
			}
			return payload.data;
		}

		/* ───────────────────────── 样式 ───────────────────────── */

		const CSS = `
.pw-root { --pw-bg: var(--dsw-alias-bg-base,#fff); --pw-bg1: var(--dsw-alias-bg-layer-1,#f7f8fa);
  --pw-bg2: var(--dsw-alias-bg-layer-2,#f0f2f5); --pw-bg3: var(--dsw-alias-bg-layer-3,#fff);
  --pw-bd: var(--dsw-alias-border-l2,#d8dce3); --pw-bd3: var(--dsw-alias-border-l3,#e6e9ef);
  --pw-fg: var(--dsw-alias-label-primary,#1f2328); --pw-mut: var(--dsw-alias-label-secondary,#5b6470);
  --pw-dim: var(--dsw-alias-label-tertiary,#8a929e); --pw-acc: var(--dsw-alias-state-business-primary,#2f6fed);
  --pw-green: var(--dsw-alias-state-success-primary,#1a7f37); --pw-red: var(--dsw-alias-state-error-primary,#cf222e);
  --pw-amber: var(--dsw-alias-state-warn-primary,#b26a00); --pw-radius: 10px;
  height:100%; overflow:auto; padding:20px 16px 48px; color:var(--pw-fg); background:var(--pw-bg); font-size:13px; line-height:1.5; }
.pw-root * { box-sizing:border-box; }
.pw-page { width:100%; max-width:none; margin:0; }
.pw-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:18px; }
.pw-head h1 { margin:0; font-size:20px; font-weight:650; letter-spacing:.2px; }
.pw-head p { margin:4px 0 0; color:var(--pw-mut); font-size:12.5px; }
.pw-head-right { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.pw-toolbar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
.pw-spacer { flex:1 1 auto; }
.pw-btn { appearance:none; border:1px solid var(--pw-bd); background:var(--pw-bg3); color:var(--pw-fg);
  border-radius:8px; padding:6px 12px; font-size:12.5px; cursor:pointer; display:inline-flex; align-items:center; gap:6px;
  transition:background .12s ease,border-color .12s ease; white-space:nowrap; }
.pw-btn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover,var(--pw-bg2)); }
.pw-btn:disabled { opacity:.55; cursor:not-allowed; }
.pw-btn.primary { background:var(--pw-acc); border-color:var(--pw-acc); color:var(--dsw-alias-label-primary-inverted,#fff); }
.pw-btn.primary:hover:not(:disabled) { filter:brightness(1.06); }
.pw-btn.danger { color:var(--pw-red); border-color:var(--pw-red); }
.pw-btn.ghost { border-color:transparent; background:transparent; color:var(--pw-mut); }
.pw-btn.small { padding:3px 8px; font-size:11.5px; border-radius:6px; }
.pw-icon-btn { border:none; background:transparent; color:var(--pw-mut); cursor:pointer; font-size:18px;
  line-height:1; width:28px; height:28px; border-radius:6px; display:inline-flex; align-items:center; justify-content:center; }
.pw-icon-btn:hover { background:var(--kw-hover,var(--pw-bg2)); }
.pw-seg { display:inline-flex; border:1px solid var(--pw-bd); border-radius:8px; overflow:hidden; background:var(--pw-bg3); }
.pw-seg button { appearance:none; border:none; background:transparent; color:var(--pw-mut); padding:5px 10px; font-size:12px; cursor:pointer; }
.pw-seg button.active { background:var(--pw-acc); color:var(--dsw-alias-label-primary-inverted,#fff); }
.pw-seg button + button { border-left:1px solid var(--pw-bd3); }
.pw-card { background:var(--pw-bg3); border:1px solid var(--pw-bd); border-radius:var(--pw-radius); padding:14px 16px; }
.pw-card + .pw-card { margin-top:12px; }
.pw-card h3 { margin:0 0 8px; font-size:13px; font-weight:650; display:flex; align-items:center; gap:8px; }
.pw-hint { margin:0 0 8px; color:var(--pw-mut); font-size:12px; line-height:1.55; }
.pw-mono { font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace); font-size:11.5px; word-break:break-all; }
.pw-code { font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace); font-size:11.5px;
  background:var(--pw-bg2); border:1px solid var(--pw-bd3); border-radius:5px; padding:1px 5px; word-break:break-all; }
.pw-badge { display:inline-flex; align-items:center; gap:4px; border-radius:999px; padding:1px 8px; font-size:11px;
  border:1px solid var(--pw-bd3); background:var(--pw-bg2); color:var(--pw-mut); white-space:nowrap; }
.pw-badge.info { color:var(--pw-acc); border-color:color-mix(in srgb,var(--pw-acc) 35%,transparent); background:color-mix(in srgb,var(--pw-acc) 10%,transparent); }
.pw-badge.warn { color:var(--pw-amber); border-color:color-mix(in srgb,var(--pw-amber) 35%,transparent); background:color-mix(in srgb,var(--pw-amber) 10%,transparent); }
.pw-badge.success { color:var(--pw-green); border-color:color-mix(in srgb,var(--pw-green) 35%,transparent); background:color-mix(in srgb,var(--pw-green) 10%,transparent); }
.pw-badge.danger { color:var(--pw-red); border-color:color-mix(in srgb,var(--pw-red) 35%,transparent); background:color-mix(in srgb,var(--pw-red) 10%,transparent); }
.pw-stats { display:flex; gap:8px; flex-wrap:wrap; }
.pw-stat { display:flex; flex-direction:column; gap:1px; min-width:74px; padding:6px 10px; border:1px solid var(--pw-bd3);
  border-radius:8px; background:var(--pw-bg1); }
.pw-stat b { font-size:15px; font-weight:650; }
.pw-stat span { color:var(--pw-dim); font-size:10.5px; text-transform:uppercase; letter-spacing:.4px; }
.pw-stat.warn b { color:var(--pw-amber); } .pw-stat.info b { color:var(--pw-acc); } .pw-stat.success b { color:var(--pw-green); }
.pw-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:12px; }
.pw-project-card { background:var(--pw-bg3); border:1px solid var(--pw-bd); border-radius:var(--pw-radius);
  padding:14px 16px; cursor:pointer; transition:border-color .12s ease,box-shadow .12s ease; display:flex; flex-direction:column; gap:10px; }
.pw-project-card:hover { border-color:var(--pw-acc); box-shadow:0 4px 18px rgba(0,0,0,.06); }
.pw-project-card.archived { opacity:.82; }
.pw-project-card-top { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
.pw-project-name { font-size:14.5px; font-weight:650; line-height:1.35; word-break:break-word; }
.pw-project-desc { color:var(--pw-mut); font-size:12px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; min-height:1.5em; }
.pw-project-meta { color:var(--pw-dim); font-size:11px; display:flex; flex-direction:column; gap:2px; }
.pw-project-foot { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
.pw-actions { display:flex; gap:6px; flex-wrap:wrap; }
.pw-empty { padding:48px 16px; text-align:center; color:var(--pw-mut); border:1px dashed var(--pw-bd); border-radius:var(--pw-radius); background:var(--pw-bg1); }
.pw-empty .big { font-size:15px; font-weight:600; color:var(--pw-fg); margin-bottom:6px; }
.pw-error { padding:10px 12px; border:1px solid color-mix(in srgb,var(--pw-red) 40%,transparent);
  background:color-mix(in srgb,var(--pw-red) 8%,transparent); color:var(--pw-red); border-radius:8px; margin-bottom:12px; font-size:12px; }
.pw-toast { padding:8px 12px; border-radius:8px; margin-bottom:12px; font-size:12px;
  border:1px solid color-mix(in srgb,var(--pw-green) 40%,transparent); background:color-mix(in srgb,var(--pw-green) 8%,transparent); color:var(--pw-green); }
.pw-toast.warn { border-color:color-mix(in srgb,var(--pw-amber) 40%,transparent); background:color-mix(in srgb,var(--pw-amber) 8%,transparent); color:var(--pw-amber); }
.pw-breadcrumb { display:flex; align-items:center; gap:6px; color:var(--pw-dim); font-size:12px; margin-bottom:10px; flex-wrap:wrap; }
.pw-breadcrumb button { appearance:none; border:none; background:transparent; color:var(--pw-acc); cursor:pointer; padding:0; font-size:12px; }
.pw-breadcrumb .sep { color:var(--pw-bd); }
.pw-project-head { background:var(--pw-bg3); border:1px solid var(--pw-bd); border-radius:var(--pw-radius); padding:16px 18px; margin-bottom:14px; }
.pw-project-head-top { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.pw-project-head h2 { margin:0; font-size:17px; font-weight:650; }
.pw-project-head .desc { margin:6px 0 10px; color:var(--pw-mut); font-size:12.5px; white-space:pre-wrap; }
.pw-info-line { display:flex; align-items:center; gap:6px; color:var(--pw-dim); font-size:11.5px; flex-wrap:wrap; margin-top:4px; }
.pw-tabs { display:flex; align-items:center; gap:2px; border-bottom:1px solid var(--pw-bd); margin-bottom:14px; }
.pw-tab { appearance:none; border:none; border-bottom:2px solid transparent; background:transparent; color:var(--pw-mut);
  padding:7px 12px; font-size:12.5px; cursor:pointer; margin-bottom:-1px; }
.pw-tab.active { color:var(--pw-fg); border-bottom-color:var(--pw-acc); font-weight:600; }
.pw-task-list { display:flex; flex-direction:column; gap:8px; }
.pw-task-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; align-items:center;
  background:var(--pw-bg3); border:1px solid var(--pw-bd); border-radius:8px; padding:9px 12px; cursor:pointer; }
.pw-task-row:hover { border-color:var(--pw-acc); }
.pw-task-row-main { min-width:0; display:flex; flex-direction:column; gap:3px; }
.pw-task-title { font-size:13px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pw-task-sub { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.pw-task-reasons { color:var(--pw-amber); font-size:11px; }
.pw-task-open-hint { color:var(--pw-dim); font-size:10.5px; }
.pw-task-side { display:flex; align-items:center; gap:6px; }
.pw-board { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; align-items:start; }
@media (max-width: 980px) { .pw-board { grid-template-columns:repeat(2,minmax(0,1fr)); } }
.pw-col { background:var(--pw-bg1); border:1px solid var(--pw-bd3); border-radius:var(--pw-radius); min-height:180px; display:flex; flex-direction:column; }
.pw-col.drag-over { border-color:var(--pw-acc); background:color-mix(in srgb,var(--pw-acc) 6%,var(--pw-bg1)); }
.pw-col.locked { border-style:dashed; }
.pw-col-head { display:flex; align-items:center; gap:6px; padding:9px 11px; border-bottom:1px solid var(--pw-bd3); font-size:12px; font-weight:650; }
.pw-col-head .dot { width:7px; height:7px; border-radius:50%; background:var(--pw-dim); }
.pw-col-head .count { color:var(--pw-dim); font-weight:500; margin-left:auto; }
.pw-col-body { display:flex; flex-direction:column; gap:7px; padding:9px; min-height:120px; }
.pw-col.needs-you { background:color-mix(in srgb,var(--pw-amber) 6%,var(--pw-bg1)); border-color:color-mix(in srgb,var(--pw-amber) 30%,var(--pw-bd3)); }
.pw-col.running .dot { background:var(--pw-acc); } .pw-col.needs-you .dot { background:var(--pw-amber); }
.pw-col.done .dot { background:var(--pw-green); }
.pw-kanban-card { background:var(--pw-bg3); border:1px solid var(--pw-bd); border-radius:8px; padding:8px 10px;
  cursor:grab; display:flex; flex-direction:column; gap:5px; transition:border-color .12s,box-shadow .12s; }
.pw-kanban-card:hover { border-color:var(--pw-acc); box-shadow:0 3px 12px rgba(0,0,0,.07); }
.pw-kanban-card.dragging { opacity:.45; }
.pw-kanban-card .title { font-size:12.5px; font-weight:600; line-height:1.4; word-break:break-word; }
.pw-kanban-card .meta { display:flex; align-items:center; gap:5px; flex-wrap:wrap; color:var(--pw-dim); font-size:10.5px; }
.pw-col-empty { color:var(--pw-dim); text-align:center; font-size:11.5px; padding:16px 4px; }
.pw-task-layout { display:grid; grid-template-columns:minmax(0,1fr) 330px; gap:14px; align-items:start; }
@media (max-width: 1000px) { .pw-task-layout { grid-template-columns:1fr; } }
.pw-task-main, .pw-task-open-hint { color:var(--pw-dim); font-size:10.5px; }
.pw-task-side { display:flex; flex-direction:column; gap:12px; }
.pw-task-head { background:var(--pw-bg3); border:1px solid var(--pw-bd); border-radius:var(--pw-radius); padding:16px 18px; }
.pw-task-head h2 { margin:0 0 6px; font-size:17px; font-weight:650; line-height:1.4; word-break:break-word; }
.pw-task-head .sub { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.pw-form { display:flex; flex-direction:column; gap:10px; }
.pw-field { display:flex; flex-direction:column; gap:4px; }
.pw-field > label { font-size:11.5px; color:var(--pw-mut); font-weight:600; }
.pw-field .req { color:var(--pw-red); margin-left:2px; }
.pw-input, .pw-textarea, .pw-select { width:100%; border:1px solid var(--pw-bd); background:var(--pw-bg3); color:var(--pw-fg);
  border-radius:7px; padding:6px 9px; font-size:12.5px; font-family:inherit; outline:none; }
.pw-input:focus, .pw-textarea:focus, .pw-select:focus { border-color:var(--pw-acc); box-shadow:0 0 0 2px color-mix(in srgb,var(--pw-acc) 18%,transparent); }
.pw-textarea { resize:vertical; min-height:72px; line-height:1.55; }
.pw-textarea.mono { font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace); font-size:11.5px; }
.pw-check { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--pw-mut); cursor:pointer; }
.pw-check input { accent-color:var(--pw-acc); }
.pw-modal { position:fixed; inset:0; z-index:80; background:rgba(0,0,0,.42); display:flex; align-items:center; justify-content:center; padding:24px; }
.pw-dialog { width:min(560px,100%); max-height:86vh; overflow:auto; background:var(--pw-bg3); color:var(--pw-fg);
  border:1px solid var(--pw-bd); border-radius:12px; box-shadow:0 20px 56px rgba(0,0,0,.32); }
.pw-dialog-head { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:13px 16px; border-bottom:1px solid var(--pw-bd3); }
.pw-dialog-head h3 { margin:0; font-size:14px; font-weight:650; }
.pw-dialog-body { padding:14px 16px; }
.pw-dialog-foot { display:flex; justify-content:flex-end; gap:8px; padding:12px 16px; border-top:1px solid var(--pw-bd3); }
.pw-layer { display:flex; align-items:center; gap:8px; padding:7px 9px; border:1px solid var(--pw-bd3); border-radius:7px; background:var(--pw-bg1); margin-bottom:7px; flex-wrap:wrap; }
.pw-layer .ok { color:var(--pw-green); font-size:11px; } .pw-layer .miss { color:var(--pw-dim); font-size:11px; }
.pw-comment { border:1px solid var(--pw-bd3); border-radius:8px; padding:8px 10px; background:var(--pw-bg1); margin-bottom:8px; }
.pw-comment.resolved { opacity:.68; }
.pw-comment-head { display:flex; align-items:center; gap:6px; flex-wrap:wrap; color:var(--pw-dim); font-size:11px; margin-bottom:4px; }
.pw-comment-body { font-size:12.5px; white-space:pre-wrap; word-break:break-word; }
.pw-timeline { display:flex; flex-direction:column; gap:0; }
.pw-timeline-item { display:grid; grid-template-columns:14px minmax(0,1fr); gap:8px; position:relative; padding-bottom:10px; }
.pw-timeline-item:not(:last-child)::before { content:""; position:absolute; left:6px; top:14px; bottom:0; width:1px; background:var(--pw-bd3); }
.pw-timeline-dot { width:7px; height:7px; border-radius:50%; background:var(--pw-bd); margin-top:6px; justify-self:center; }
.pw-timeline-item.status .pw-timeline-dot { background:var(--pw-acc); } .pw-timeline-item.comment .pw-timeline-dot { background:var(--pw-amber); }
.pw-timeline-body { font-size:11.8px; color:var(--pw-mut); }
.pw-timeline-body b { color:var(--pw-fg); font-weight:600; }
.pw-timeline-time { color:var(--pw-dim); font-size:10.5px; margin-left:4px; }
.pw-kv { display:flex; flex-direction:column; gap:8px; }
.pw-kv-row { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:12px; }
.pw-kv-row.block { flex-direction:column; align-items:flex-start; gap:2px; }
.pw-kv-row.block code { max-width:100%; }
.pw-kv-row > span:first-child { color:var(--pw-mut); }
.pw-section-title { margin:0 0 8px; font-size:12.5px; font-weight:650; display:flex; align-items:center; justify-content:space-between; gap:8px; }
.pw-split { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.pw-skeleton { padding:36px 16px; text-align:center; color:var(--pw-mut); }
.pw-goal { border-left:3px solid color-mix(in srgb,var(--pw-acc) 55%,transparent); }
.pw-goal-head { display:flex; align-items:flex-start; gap:8px; justify-content:space-between; flex-wrap:wrap; }
.pw-goal-head h3 { margin:0; font-size:13.5px; display:flex; align-items:center; gap:8px; }
.pw-goal-dir { margin:6px 0 8px; }
.pw-goal-section { margin-top:10px; padding-top:9px; border-top:1px dashed var(--pw-bd3); }
.pw-goal-section-head { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; margin-bottom:6px; font-size:12px; font-weight:600; }
.pw-session-row, .pw-artifact-row { display:flex; align-items:center; gap:8px; padding:5px 8px; border:1px solid var(--pw-bd3); border-radius:6px; background:var(--pw-bg1); margin-bottom:5px; font-size:12px; }
.pw-session-row .name, .pw-artifact-row .name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pw-session-row .cwd { color:var(--pw-dim); font-size:10.5px; max-width:38%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pw-artifact-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
@media (max-width: 900px) { .pw-artifact-grid { grid-template-columns:1fr; } }
.pw-artifact-col h4 { margin:0 0 5px; font-size:11.5px; color:var(--pw-mut); font-weight:600; display:flex; align-items:center; justify-content:space-between; gap:6px; }
.pw-artifact-row .meta { color:var(--pw-dim); font-size:10.5px; }
.pw-file-input { display:none; }
.pw-goal-add { display:flex; justify-content:center; padding:4px 0; }
.pw-session-list { max-height:340px; overflow:auto; }
.pw-session-pick { display:flex; align-items:center; gap:8px; padding:7px 8px; border:1px solid var(--pw-bd3); border-radius:6px; margin-bottom:6px; cursor:pointer; }
.pw-session-pick:hover { border-color:var(--pw-acc); background:var(--pw-bg1); }
.pw-session-pick .name { flex:1; min-width:0; }
.pw-session-pick .name b { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pw-session-pick .name span { color:var(--pw-dim); font-size:10.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block; }
.pw-dash { display:flex; flex-direction:column; gap:14px; }
.pw-welcome { display:flex; align-items:center; justify-content:space-between; gap:14px; background:linear-gradient(135deg,color-mix(in srgb,var(--pw-acc) 8%,var(--pw-bg3)),var(--pw-bg3)); border:1px solid var(--pw-bd3); border-radius:14px; padding:16px 20px; }
.pw-welcome-main { display:flex; align-items:center; gap:14px; }
.pw-welcome-icon { width:42px; height:42px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:color-mix(in srgb,var(--pw-acc) 16%,var(--pw-bg3)); font-size:21px; }
.pw-welcome h2 { margin:0; font-size:18px; font-weight:650; }
.pw-welcome p { margin:4px 0 0; color:var(--pw-mut); font-size:12px; }
.pw-welcome-date { color:var(--pw-dim); font-size:12px; white-space:nowrap; }
.pw-quick { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.pw-quick .label { color:var(--pw-dim); font-size:12px; margin-right:2px; }
.pw-chip { appearance:none; border:1px solid var(--pw-bd); background:var(--pw-bg3); color:var(--pw-fg); border-radius:999px; padding:5px 12px; font-size:12px; cursor:pointer; display:inline-flex; align-items:center; gap:5px; }
.pw-chip:hover { border-color:var(--pw-acc); color:var(--pw-acc); }
.pw-usage-card { overflow:hidden; }
.pw-usage-body { display:flex; flex-direction:column; gap:10px; }
.pw-usage-toolbar { display:flex; align-items:center; gap:6px; flex-wrap:wrap; padding:7px 9px; border:1px solid var(--pw-bd3); border-radius:9px; background:var(--pw-bg1); }
.pw-usage-tabs { display:flex; gap:3px; }
.pw-usage-tab { appearance:none; border:1px solid var(--pw-bd3); background:var(--pw-bg3); color:var(--pw-mut); border-radius:6px; padding:4px 10px; font-size:11px; cursor:pointer; }
.pw-usage-tab:hover { border-color:var(--pw-acc); color:var(--pw-acc); }
.pw-usage-tab.active { border-color:var(--pw-acc); background:color-mix(in srgb,var(--pw-acc) 9%,var(--pw-bg3)); color:var(--pw-acc); font-weight:600; }
.pw-usage-input { height:27px; border:1px solid var(--pw-bd3); border-radius:6px; background:var(--pw-bg3); color:var(--pw-fg); font-size:11px; padding:0 7px; }
.pw-usage-input:focus { outline:none; border-color:var(--pw-acc); }
.pw-usage-select { max-width:230px; }
.pw-usage-arrow { color:var(--pw-dim); font-size:11px; }
.pw-usage-heat-panel { border:1px solid var(--pw-bd3); border-radius:10px; padding:12px; background:var(--pw-bg1); overflow:hidden; display:flex; flex-direction:column; align-items:center; gap:10px; }
.pw-usage-heat { display:inline-flex; flex-direction:column; gap:4px; min-width:max-content; margin:0 auto; }
.pw-usage-months { display:grid; grid-auto-flow:column; grid-auto-columns:11px; column-gap:3px; margin-left:28px; height:14px; color:var(--pw-dim); font-size:10px; }
.pw-usage-months span { white-space:nowrap; overflow:visible; }
.pw-usage-heat-row { display:flex; align-items:flex-start; gap:6px; }
.pw-usage-weekdays { display:grid; grid-template-rows:repeat(7,11px); gap:3px; width:22px; flex:none; color:var(--pw-dim); font-size:9.5px; line-height:11px; }
.pw-usage-grid { display:grid; grid-template-rows:repeat(7,11px); grid-auto-flow:column; grid-auto-columns:11px; gap:3px; }
.pw-usage-cell { width:11px; height:11px; border-radius:2px; border:1px solid color-mix(in srgb,var(--pw-bd3) 65%,transparent); background:var(--pw-bg2); padding:0; }
button.pw-usage-cell { cursor:pointer; }
button.pw-usage-cell:hover { outline:1px solid var(--pw-acc); }
.pw-usage-cell.l1 { background:#9be9a8; } .pw-usage-cell.l2 { background:#40c463; }
.pw-usage-cell.l3 { background:#30a14e; } .pw-usage-cell.l4 { background:#216e39; }
.pw-usage-cell.selected { outline:2px solid var(--pw-acc); outline-offset:1px; }
.pw-usage-cell.in-range { outline:1px solid color-mix(in srgb,var(--pw-acc) 55%,transparent); outline-offset:1px; }
.pw-usage-cell.blank { visibility:hidden; }
.pw-usage-legend { display:flex; align-items:center; justify-content:center; gap:4px; color:var(--pw-dim); font-size:10.5px; flex-wrap:wrap; width:100%; }
.pw-usage-legend .pw-usage-cell { cursor:default; }
.pw-usage-note { color:var(--pw-dim); font-size:10.5px; margin-left:10px; }
.pw-usage-detail { border:1px solid var(--pw-bd3); border-radius:10px; padding:10px 12px; background:var(--pw-bg3); display:flex; flex-direction:column; gap:9px; }
.pw-usage-detail-head { display:flex; align-items:center; gap:8px; font-size:12.5px; }
.pw-usage-detail-head b { font-size:13px; }
.pw-usage-summary { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:8px; }
.pw-usage-stat { border:1px solid var(--pw-bd3); border-radius:8px; padding:7px 9px; background:var(--pw-bg1); }
.pw-usage-stat span { display:block; color:var(--pw-dim); font-size:10.5px; margin-bottom:3px; }
.pw-usage-stat b { font-size:15px; font-variant-numeric:tabular-nums; }
.pw-usage-stat b.green { color:var(--pw-green); }
.pw-usage-models { display:flex; flex-direction:column; gap:4px; border-top:1px solid var(--pw-bd3); padding-top:8px; }
.pw-usage-model { display:flex; align-items:center; gap:10px; font-size:11.5px; }
.pw-usage-model .name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--pw-mut); }
.pw-usage-model .calls { color:var(--pw-dim); font-size:10.5px; flex:none; }
.pw-usage-model .total { min-width:64px; text-align:right; font-weight:600; font-variant-numeric:tabular-nums; }
@media (max-width: 900px) { .pw-usage-summary { grid-template-columns:repeat(3,minmax(0,1fr)); } .pw-usage-heat-panel { padding:8px; } }
.pw-insight-marquee { display:flex; align-items:center; gap:10px; height:34px; padding:0 12px; border:1px solid color-mix(in srgb,var(--pw-acc) 18%,var(--pw-bd3)); border-radius:9px; background:linear-gradient(90deg,color-mix(in srgb,var(--pw-acc) 7%,var(--pw-bg3)),var(--pw-bg3)); overflow:hidden; }
.pw-insight-marquee-label { flex:none; color:var(--pw-acc); font-size:11px; font-weight:650; white-space:nowrap; }
.pw-marquee-track { flex:1; min-width:0; height:100%; overflow:hidden; position:relative; }
.pw-marquee-item { position:absolute; left:0; top:50%; min-width:100%; white-space:nowrap; color:var(--pw-mut); font-size:11.5px; animation-name:pw-marquee-scroll; animation-timing-function:linear; animation-iteration-count:infinite; transform:translate(100%, -50%); }
.pw-insight-marquee:hover .pw-marquee-item { animation-play-state:paused; }
@keyframes pw-marquee-scroll { from { transform:translate(100%, -50%); } to { transform:translate(-100%, -50%); } }
@media (prefers-reduced-motion: reduce) { .pw-marquee-item { animation:none; transform:translate(0, -50%); } }
.pw-dash-layout { display:grid; grid-template-columns:minmax(0,1fr) 340px; gap:14px; align-items:start; }
@media (max-width: 1040px) { .pw-dash-layout { grid-template-columns:1fr; } .pw-assistant { position:static; height:min(720px, 72vh); max-height:none; } }
.pw-dash-main { min-width:0; }
.pw-dash-grid { display:grid; grid-template-columns:1.05fr .95fr; gap:12px; align-items:stretch; }
@media (max-width: 820px) { .pw-dash-grid { grid-template-columns:1fr; } }
.pw-dash-card { background:var(--pw-bg3); border:1px solid var(--pw-bd); border-radius:12px; padding:13px 15px; min-height:120px; height:100%; display:flex; flex-direction:column; }
.pw-dash-card > .pw-dash-list, .pw-dash-card > .pw-project-progress { flex:1; }
.pw-dash-card.wide { grid-column:1 / -1; }
.pw-dash-card-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px; }
.pw-dash-card-head h3 { margin:0; font-size:13px; font-weight:650; display:flex; align-items:center; gap:7px; }
.pw-dash-card-head-right { display:flex; align-items:center; gap:8px; }
.pw-dash-card-head .link { appearance:none; border:none; background:transparent; color:var(--pw-acc); cursor:pointer; font-size:11.5px; padding:0; }
.pw-dash-empty { color:var(--pw-dim); font-size:12px; padding:18px 4px; text-align:center; }
.pw-dash-list { display:flex; flex-direction:column; gap:7px; }
.pw-dash-item { display:flex; align-items:center; gap:8px; padding:8px 9px; border:1px solid var(--pw-bd3); border-left:3px solid transparent; border-radius:9px; background:linear-gradient(90deg,var(--pw-bg1),var(--pw-bg3)); cursor:pointer; transition:transform .12s ease, box-shadow .12s ease, border-color .12s ease; }
.pw-dash-item:hover { transform:translateY(-1px); border-color:var(--pw-acc); box-shadow:0 4px 12px rgba(0,0,0,.06); }
.pw-dash-item.pw-tone-success { border-left-color:var(--pw-green); }
.pw-dash-item.pw-tone-warn { border-left-color:var(--pw-amber); }
.pw-dash-item.pw-tone-info { border-left-color:var(--pw-acc); }
.pw-dash-icon { width:30px; height:30px; border-radius:9px; display:flex; align-items:center; justify-content:center; flex:none; font-size:14px; font-weight:700; }
.pw-dash-icon.success { background:color-mix(in srgb,var(--pw-green) 15%,var(--pw-bg3)); color:var(--pw-green); }
.pw-dash-icon.warn { background:color-mix(in srgb,var(--pw-amber) 16%,var(--pw-bg3)); color:var(--pw-amber); }
.pw-dash-icon.info { background:color-mix(in srgb,var(--pw-acc) 14%,var(--pw-bg3)); color:var(--pw-acc); }
.pw-dash-icon.neutral { background:var(--pw-bg2); color:var(--pw-mut); }
.pw-dash-item .main { flex:1; min-width:0; }
.pw-dash-item .main b { display:block; font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pw-dash-item .main span { display:block; color:var(--pw-dim); font-size:10.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pw-dash-item .badge-warn { color:var(--pw-amber); border-color:color-mix(in srgb,var(--pw-amber) 35%,transparent); background:color-mix(in srgb,var(--pw-amber) 10%,transparent); }
.pw-dash-item .badge-danger { color:var(--pw-red); border-color:color-mix(in srgb,var(--pw-red) 35%,transparent); background:color-mix(in srgb,var(--pw-red) 10%,transparent); }
.pw-progress { height:6px; border-radius:999px; background:var(--pw-bg2); overflow:hidden; margin:4px 0 2px; }
.pw-progress > span { display:block; height:100%; border-radius:999px; background:linear-gradient(90deg,var(--pw-acc),color-mix(in srgb,var(--pw-acc) 55%,white)); }
.pw-project-progress { display:flex; flex-direction:column; gap:8px; }
.pw-project-row { display:flex; align-items:flex-start; gap:9px; padding:8px; border:1px solid var(--pw-bd3); border-radius:9px; background:linear-gradient(90deg,var(--pw-bg1),var(--pw-bg3)); transition:transform .12s ease, box-shadow .12s ease; }
.pw-project-row:hover { transform:translateY(-1px); box-shadow:0 4px 12px rgba(0,0,0,.06); }
.pw-dash-item, .pw-project-row { height:62px; min-height:62px; box-sizing:border-box; }
.pw-project-row { align-items:center; }
.pw-project-icon { width:30px; height:30px; border-radius:9px; display:flex; align-items:center; justify-content:center; flex:none; background:color-mix(in srgb,var(--pw-acc) 13%,var(--pw-bg3)); font-size:15px; }
.pw-project-body { flex:1; min-width:0; }
.pw-project-row.pw-progress-success .pw-project-icon { background:color-mix(in srgb,var(--pw-green) 15%,var(--pw-bg3)); }
.pw-project-row.pw-progress-success .pw-progress span { background:linear-gradient(90deg,var(--pw-green),color-mix(in srgb,var(--pw-green) 60%,white)); }
.pw-project-row.pw-progress-warn .pw-project-icon { background:color-mix(in srgb,var(--pw-amber) 15%,var(--pw-bg3)); }
.pw-project-row.pw-progress-warn .pw-progress span { background:linear-gradient(90deg,var(--pw-amber),color-mix(in srgb,var(--pw-amber) 60%,white)); }
.pw-project-progress .top { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:12px; }
.pw-project-progress .top b { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pw-project-progress .top span { color:var(--pw-dim); font-size:10.5px; white-space:nowrap; }
.pw-week-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.pw-week-stat { border:1px solid var(--pw-bd3); border-radius:8px; background:var(--pw-bg1); padding:8px 10px; }
.pw-week-stat b { display:block; font-size:19px; line-height:1.2; }
.pw-week-stat span { color:var(--pw-dim); font-size:10.5px; }
.pw-week-stat.info b { color:var(--pw-acc); } .pw-week-stat.success b { color:var(--pw-green); } .pw-week-stat.warn b { color:var(--pw-amber); }
.pw-insights { display:flex; flex-direction:column; gap:8px; }
.pw-insight { display:flex; gap:7px; font-size:12px; color:var(--pw-mut); line-height:1.55; padding:7px 9px; border-radius:8px; background:color-mix(in srgb,var(--pw-acc) 5%,var(--pw-bg1)); border:1px solid color-mix(in srgb,var(--pw-acc) 12%,var(--pw-bd3)); }
.pw-insight .ico { color:var(--pw-acc); }
.pw-recent-item { display:flex; align-items:center; gap:9px; padding:8px; border:1px solid transparent; border-bottom-color:var(--pw-bd3); border-radius:8px; cursor:pointer; transition:background .12s ease; }
.pw-recent-item:hover { background:var(--pw-bg1); }
.pw-activity-icon { width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; flex:none; font-size:13px; background:var(--pw-bg2); }
.pw-activity-icon.success { background:color-mix(in srgb,var(--pw-green) 14%,var(--pw-bg3)); }
.pw-activity-icon.warn { background:color-mix(in srgb,var(--pw-amber) 15%,var(--pw-bg3)); }
.pw-activity-icon.info { background:color-mix(in srgb,var(--pw-acc) 13%,var(--pw-bg3)); }
.pw-activity-icon.goal { background:color-mix(in srgb,#8b5cf6 14%,var(--pw-bg3)); }
.pw-recent-item:last-child { border-bottom:none; }
.pw-recent-item .main { flex:1; min-width:0; }
.pw-recent-item .main b { font-size:12px; font-weight:600; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pw-recent-item .main span { color:var(--pw-dim); font-size:10.5px; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pw-assistant { position:sticky; top:14px; height:calc(100vh - 250px); min-height:420px; max-height:820px; display:flex; flex-direction:column; background:var(--pw-bg3); border:1px solid var(--pw-bd); border-radius:14px; overflow:hidden; }
.pw-assistant-head { padding:13px 15px; border-bottom:1px solid var(--pw-bd3); display:flex; gap:9px; align-items:center; }
.pw-assistant-avatar { width:30px; height:30px; border-radius:50%; background:color-mix(in srgb,var(--pw-acc) 16%,var(--pw-bg3)); color:var(--pw-acc); display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; }
.pw-assistant-head b { display:block; font-size:12.5px; }
.pw-assistant-head span { display:block; color:var(--pw-dim); font-size:10.5px; }
.pw-assistant-body { flex:1; min-height:0; overflow:auto; padding:12px 14px; display:flex; flex-direction:column; gap:10px; }
.pw-assistant-bubble { background:color-mix(in srgb,var(--pw-acc) 7%,var(--pw-bg1)); border:1px solid color-mix(in srgb,var(--pw-acc) 12%,var(--pw-bd3)); border-radius:10px; padding:10px 11px; font-size:12px; line-height:1.6; color:var(--pw-mut); white-space:pre-wrap; }
.pw-assistant-suggest { display:flex; flex-wrap:wrap; gap:6px; }
.pw-assistant-msg { display:flex; flex-direction:column; gap:3px; max-width:94%; }
.pw-assistant-msg.user { align-self:flex-end; align-items:flex-end; }
.pw-assistant-msg.user .pw-assistant-bubble { background:var(--pw-acc); border-color:var(--pw-acc); color:var(--dsw-alias-label-primary-inverted,#fff); }
.pw-assistant-msg.error .pw-assistant-bubble { background:color-mix(in srgb,var(--pw-red) 8%,var(--pw-bg1)); border-color:color-mix(in srgb,var(--pw-red) 30%,transparent); color:var(--pw-red); }
.pw-assistant-msg .pw-assistant-bubble.thinking { color:var(--pw-dim); font-style:italic; }
.pw-assistant-actions { display:flex; flex-wrap:wrap; gap:4px; }
.pw-assistant-foot { flex:0 0 auto; border-top:1px solid var(--pw-bd3); padding:10px 12px; display:flex; flex-direction:column; gap:7px; }
.pw-side { height:100%; overflow:auto; padding:14px; color:var(--pw-fg); font-size:12px; }
.pw-side-head { display:flex; align-items:center; gap:6px; flex-wrap:wrap; font-size:13px; margin-bottom:6px; }
.pw-side-section { margin-top:12px; padding-top:10px; border-top:1px solid var(--pw-bd3); }
.pw-side-section h4 { margin:0 0 7px; font-size:12px; color:var(--pw-mut); }
.pw-side-artifact { display:flex; align-items:center; gap:7px; padding:6px 8px; border:1px solid var(--pw-bd3); border-radius:7px; background:var(--pw-bg1); margin-bottom:6px; cursor:pointer; }
.pw-side-artifact:hover { border-color:var(--pw-acc); background:var(--pw-bg2); }
.pw-side-artifact .ico { font-size:15px; line-height:1; flex:none; }
.pw-side-artifact .name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
.pw-side-artifact .size { color:var(--pw-dim); font-size:10.5px; flex:none; }
.pw-side-artifact .open-hint { color:var(--pw-acc); font-size:10.5px; flex:none; }
.pw-side-artifact-del { appearance:none; border:none; background:transparent; color:var(--pw-dim); cursor:pointer; font-size:14px; line-height:1; padding:0 2px; flex:none; }
.pw-side-artifact-del:hover { color:var(--pw-red); }
.pw-side-edit .pw-textarea { font-size:12px; }
.pw-side-actions { display:flex; justify-content:flex-end; margin-top:7px; }
.pw-side-controls { display:flex; flex-direction:column; gap:7px; }
.pw-side-controls label { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:11.5px; color:var(--pw-mut); }
.pw-side-controls label > span { flex:none; }
.pw-side-controls select, .pw-side-controls input[type="date"] { flex:1; min-width:0; height:26px; border:1px solid var(--pw-bd3); border-radius:6px; background:var(--pw-bg3); color:var(--pw-fg); font-size:11.5px; padding:0 6px; }
.pw-side-art-actions { display:flex; gap:5px; flex-wrap:wrap; margin-bottom:8px; }
.pw-side-goals { display:flex; flex-direction:column; gap:5px; }
.pw-side-goal-row { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 8px; border:1px solid var(--pw-bd3); border-radius:7px; font-size:11.5px; }
.pw-side-goal-row .title { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pw-side-goal-row .meta { color:var(--pw-dim); font-size:10px; flex:none; }
.pw-side-nav { display:flex; gap:6px; margin-bottom:9px; }
.pw-side-nav button { appearance:none; border:1px solid var(--pw-bd3); background:var(--pw-bg3); color:var(--pw-mut); border-radius:7px; padding:5px 9px; font-size:11px; cursor:pointer; }
.pw-side-nav button:hover { color:var(--pw-acc); border-color:var(--pw-acc); }
.pw-session-picker-list { max-height:52vh; overflow:auto; display:flex; flex-direction:column; gap:6px; margin-top:4px; }
.pw-session-picker-row { display:flex; flex-direction:column; gap:3px; text-align:left; padding:8px 10px; border:1px solid var(--pw-bd3); border-radius:8px; background:var(--pw-bg3); color:var(--pw-fg); cursor:pointer; }
.pw-session-picker-row:hover { border-color:var(--pw-acc); }
.pw-session-picker-row.current { border-color:var(--pw-acc); background:color-mix(in srgb,var(--pw-acc) 7%,var(--pw-bg3)); }
.pw-session-picker-row .title { font-size:12.5px; font-weight:600; display:flex; align-items:center; gap:6px; }
.pw-session-picker-row .meta { font-size:10.5px; color:var(--pw-dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pw-session-picker-row .time { font-size:10px; color:var(--pw-dim); }
.pw-session-back { appearance:none; border:1px solid var(--dsw-alias-border-l3,#e6e9ef); background:var(--dsw-alias-bg-layer-1,#f7f8fa); color:var(--dsw-alias-label-secondary,#5b6470); border-radius:7px; padding:4px 9px; font-size:12px; cursor:pointer; }
.pw-session-back:hover { color:var(--dsw-alias-state-business-primary,#2f6fed); border-color:var(--dsw-alias-state-business-primary,#2f6fed); }
.pw-side { --pw-bg:var(--dsw-alias-bg-base,#fff); --pw-bg1:var(--dsw-alias-bg-layer-1,#f7f8fa); --pw-bg2:var(--dsw-alias-bg-layer-2,#f0f2f5); --pw-bg3:var(--dsw-alias-bg-layer-3,#fff); --pw-bd3:var(--dsw-alias-border-l3,#e6e9ef); --pw-fg:var(--dsw-alias-label-primary,#1f2328); --pw-mut:var(--dsw-alias-label-secondary,#5b6470); --pw-dim:var(--dsw-alias-label-tertiary,#8a929e); --pw-acc:var(--dsw-alias-state-business-primary,#2f6fed); --pw-green:var(--dsw-alias-state-success-primary,#1a7f37); padding:12px; background:var(--pw-bg1); color:var(--pw-fg); }
.pw-side-hero { display:flex; align-items:center; gap:10px; padding:12px; border-radius:12px; background:linear-gradient(135deg,color-mix(in srgb,var(--pw-acc) 12%,var(--pw-bg3)),var(--pw-bg3)); border:1px solid color-mix(in srgb,var(--pw-acc) 18%,var(--pw-bd3)); margin-bottom:10px; }
.pw-side-hero-icon { width:38px; height:38px; border-radius:10px; background:color-mix(in srgb,var(--pw-acc) 15%,var(--pw-bg3)); display:flex; align-items:center; justify-content:center; font-size:18px; flex:none; }
.pw-side-hero-main { min-width:0; }
.pw-side-hero-title { font-size:13.5px; font-weight:650; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pw-side-hero-meta { display:flex; align-items:center; gap:5px; flex-wrap:wrap; margin-top:4px; }
.pw-side-id { color:var(--pw-dim); font-size:9.5px; font-family:var(--dsw-font-mono,monospace); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:120px; }
.pw-side-card { background:var(--pw-bg3); border:1px solid var(--pw-bd3); border-radius:12px; padding:11px 12px; margin-bottom:10px; box-shadow:0 1px 2px rgba(0,0,0,.03); }
.pw-side-card + .pw-side-card { position:relative; }
.pw-side-card.closed { padding-bottom:11px; }
.pw-side-card-head { display:flex; align-items:center; gap:6px; width:100%; background:none; border:none; padding:0; margin:0; color:inherit; font:inherit; cursor:pointer; text-align:left; }
.pw-side-card-head:hover h4 { color:var(--pw-acc); }
.pw-side-card-head .chev { color:var(--pw-dim); font-size:12px; line-height:1; flex:none; transition:transform .15s ease; }
.pw-side-card-head[aria-expanded="true"] .chev { transform:rotate(90deg); }
.pw-side-card-body { margin-top:9px; }
.pw-side-card-head .ico { font-size:13px; }
.pw-side-card-head h4 { margin:0; font-size:12px; font-weight:650; color:var(--pw-fg); flex:1; }
.pw-side-card-head .extra { color:var(--pw-dim); font-size:10.5px; background:var(--pw-bg1); border:1px solid var(--pw-bd3); border-radius:999px; padding:1px 7px; }
.pw-side-goal { font-size:12px; color:var(--pw-mut); line-height:1.6; white-space:pre-wrap; }
.pw-side-progress { display:flex; gap:12px; align-items:center; }
.pw-side-ring { position:relative; width:62px; height:62px; flex:none; }
.pw-side-ring svg { width:62px; height:62px; }
.pw-side-ring .ring-bg { fill:none; stroke:var(--pw-bg2); stroke-width:4; }
.pw-side-ring .ring-fg { fill:none; stroke:var(--pw-acc); stroke-width:4; stroke-linecap:round; transition:stroke-dashoffset .3s ease; }
.pw-side-ring .ring-label { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:650; color:var(--pw-acc); }
.pw-side-progress-main { flex:1; min-width:0; }
.pw-side-kv { display:flex; flex-direction:column; gap:3px; }
.pw-side-kv-row { display:flex; justify-content:space-between; font-size:11.5px; color:var(--pw-mut); }
.pw-side-kv-row b { color:var(--pw-fg); font-weight:600; }
.pw-side-split { margin-top:8px; }
.pw-side-split-bar { height:7px; border-radius:999px; overflow:hidden; display:flex; background:var(--pw-bg2); }
.pw-side-split-bar .input { background:var(--pw-acc); }
.pw-side-split-bar .output { background:var(--pw-green); }
.pw-side-legend { display:flex; gap:10px; margin-top:5px; font-size:10px; color:var(--pw-dim); }
.pw-side-legend .dot { display:inline-flex; align-items:center; gap:4px; }
.pw-side-legend .dot::before { content:""; width:6px; height:6px; border-radius:50%; background:var(--pw-acc); }
.pw-side-legend .dot.output::before { background:var(--pw-green); }
.pw-side-empty { color:var(--pw-dim); font-size:11px; padding:4px 0; }
.pw-side-timeline { display:flex; flex-direction:column; gap:7px; }
.pw-side-timeline-item { display:flex; gap:7px; position:relative; }
.pw-side-timeline-item .dot { width:6px; height:6px; border-radius:50%; background:var(--pw-acc); margin-top:5px; flex:none; }
.pw-side-timeline-item .body { font-size:11px; color:var(--pw-mut); line-height:1.45; min-width:0; }
.pw-side-timeline-item .body b { color:var(--pw-fg); font-weight:600; }
.pw-side-timeline-item .time { color:var(--pw-dim); font-size:9.5px; margin-left:4px; white-space:nowrap; }
.pw-side-artifacts-group + .pw-side-artifacts-group { margin-top:9px; }
.pw-side-group-title { font-size:10.5px; color:var(--pw-dim); margin-bottom:5px; }
.pw-side-chart { display:flex; align-items:flex-end; gap:5px; height:96px; padding-top:4px; }
.pw-side-chart-col { flex:1; min-width:0; display:flex; flex-direction:column; align-items:center; gap:5px; height:100%; justify-content:flex-end; }
.pw-side-chart-track { flex:none; height:62px; width:100%; display:flex; align-items:flex-end; background:var(--pw-bg1); border-radius:4px; overflow:hidden; }
.pw-side-chart-bar { width:100%; background:linear-gradient(180deg,var(--pw-acc),color-mix(in srgb,var(--pw-acc) 55%,white)); border-radius:4px 4px 0 0; min-height:3px; transition:height .2s ease; }
.pw-side-chart-col span { font-size:9px; color:var(--pw-dim); white-space:nowrap; }
.pw-assistant-body.pw-assistant-embed { padding:0; overflow:hidden; }
.pw-embedded-chat { flex:1; min-width:0; min-height:0; display:flex; overflow:hidden; }
.pw-embedded-chat > * { flex:1; min-width:0; min-height:0; }
.pw-assistant-input { display:flex; gap:7px; align-items:flex-end; }
.pw-assistant-input textarea { flex:1; min-height:38px; max-height:110px; resize:vertical; }
.pw-voice-status { display:flex; align-items:center; gap:8px; color:var(--pw-red); font-size:11.5px; min-height:18px; }
.pw-voice-dot { width:8px; height:8px; border-radius:50%; background:var(--pw-dim); flex:none; }
.pw-voice-dot.recording { background:var(--pw-red); animation:pw-mic-pulse 1.2s infinite; }
.pw-voice-meter { display:flex; align-items:flex-end; gap:2px; height:26px; }
.pw-voice-meter span { width:3px; border-radius:2px; background:var(--pw-red); transition:height .08s linear; opacity:.85; }
.pw-mic-btn { appearance:none; border:1px solid var(--pw-bd); background:var(--pw-bg3); color:var(--pw-fg); border-radius:8px; width:34px; height:34px; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; font-size:15px; }
.pw-mic-btn:hover:not(:disabled) { border-color:var(--pw-acc); color:var(--pw-acc); }
.pw-mic-btn.recording { color:#fff; background:var(--pw-red); border-color:var(--pw-red); animation:pw-mic-pulse 1.2s infinite; }
@keyframes pw-mic-pulse { 0%,100% { box-shadow:0 0 0 0 color-mix(in srgb,var(--pw-red) 45%,transparent); } 50% { box-shadow:0 0 0 5px color-mix(in srgb,var(--pw-red) 0%,transparent); } }
.pw-assistant-note { color:var(--pw-dim); font-size:10.5px; display:flex; justify-content:space-between; gap:8px; }
@media (max-width: 640px) { .pw-root { padding:14px; } .pw-task-row { grid-template-columns:1fr; } .pw-task-open-hint { color:var(--pw-dim); font-size:10.5px; }
.pw-task-side { justify-content:flex-start; } }
`;

		function ensureCss() {
			if (typeof document === "undefined" || document.head === undefined) return;
			try {
				if (typeof document.querySelector === "function" && document.querySelector(`style[data-plugin-css="${CSS_ID}"]`) !== null) return;
			} catch {
				/* ignore */
			}
			const tag = document.createElement("style");
			tag.id = CSS_ID;
			if (tag.dataset !== undefined) {
				tag.dataset.plugin = PKG;
				tag.dataset.pluginCss = CSS_ID;
			}
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		ensureCss();

		/* ───────────────────────── 基础组件 ───────────────────────── */

		function Spinner({ text }) {
			return h("div", { className: "pw-skeleton" }, text ?? t("common.loading"));
		}

		function ErrorBanner({ error, onRetry }) {
			if (error === null || error === undefined) return null;
			return h(
				"div",
				{ className: "pw-error", role: "alert" },
				h("span", null, errorText(error)),
				onRetry === undefined ? null : h("button", { type: "button", className: "pw-btn small", style: { marginLeft: 8 }, onClick: onRetry }, t("common.retry")),
			);
		}

		function Badge({ tone, children, title }) {
			return h("span", { className: `pw-badge${tone === undefined ? "" : ` ${tone}`}`, title }, children);
		}

		function StatusBadge({ status }) {
			const tone = status === "needs-you" ? "warn" : status === "running" ? "info" : status === "done" ? "success" : undefined;
			return h(Badge, { tone }, statusLabel(status));
		}

		function PriorityBadge({ priority }) {
			const tone = priority === "urgent" ? "danger" : priority === "high" ? "warn" : undefined;
			return h(Badge, { tone }, priorityLabel(priority));
		}

		function Stat({ value, label, tone }) {
			return h("div", { className: `pw-stat${tone === undefined ? "" : ` ${tone}`}` }, h("b", null, value), h("span", null, label));
		}

		function Button({ children, kind, onClick, disabled, title, type = "button", small }) {
			const className = `pw-btn${kind === undefined ? "" : ` ${kind}`}${small === true ? " small" : ""}`;
			return h("button", { type, className, onClick, disabled, title }, children);
		}

		function Field({ label, required, hint, children }) {
			return h(
				"div",
				{ className: "pw-field" },
				h("label", null, label, required === true ? h("span", { className: "req" }, "*") : null),
				children,
				hint === undefined || hint === null || hint === "" ? null : h("div", { className: "pw-hint", style: { margin: 0 } }, hint),
			);
		}

		function TextInput({ value, onChange, placeholder, onKeyDown, autoFocus, disabled }) {
			return h("input", {
				className: "pw-input",
				value,
				placeholder,
				autoFocus,
				disabled,
				onChange: (event) => onChange(event.target.value),
				onKeyDown,
			});
		}

		function TextArea({ value, onChange, placeholder, rows = 4, mono, disabled, onKeyDown }) {
			return h("textarea", {
				className: `pw-textarea${mono === true ? " mono" : ""}`,
				value,
				placeholder,
				rows,
				disabled,
				onChange: (event) => onChange(event.target.value),
				onKeyDown,
			});
		}

		function Select({ value, onChange, options, disabled }) {
			return h(
				"select",
				{ className: "pw-select", value, disabled, onChange: (event) => onChange(event.target.value) },
				options.map((option) => h("option", { key: option.value, value: option.value }, option.label)),
			);
		}

		function Modal({ title, children, footer, onClose }) {
			return h(
				"div",
				{
					className: "pw-modal",
					role: "presentation",
					onMouseDown: (event) => {
						if (event.target === event.currentTarget) onClose();
					},
				},
				h(
					"div",
					{ className: "pw-dialog", role: "dialog", "aria-modal": "true", "aria-label": title },
					h("div", { className: "pw-dialog-head" }, h("h3", null, title), h("button", { type: "button", className: "pw-icon-btn", onClick: onClose, "aria-label": t("common.close") }, "×")),
					h("div", { className: "pw-dialog-body" }, children),
					footer === undefined || footer === null ? null : h("div", { className: "pw-dialog-foot" }, footer),
				),
			);
		}

		function CopyChip({ text, label }) {
			const [copied, setCopied] = useState(false);
			const copy = useCallback(async () => {
				try {
					await navigator.clipboard.writeText(text);
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				} catch {
					/* ignore */
				}
			}, [text]);
			return h(
				"span",
				{ className: "pw-info-line" },
				label === undefined ? null : h("span", null, label),
				h("code", { className: "pw-code" }, text),
				h("button", { type: "button", className: "pw-btn small ghost", onClick: copy }, copied ? t("common.copied") : t("common.copy")),
			);
		}

		function Empty({ big, hint, action }) {
			return h("div", { className: "pw-empty" }, big === undefined ? null : h("div", { className: "big" }, big), hint === undefined ? null : h("div", null, hint), action ?? null);
		}

		function PanelIcon({ size = 18 }) {
			return h(
				"svg",
				{
					width: size,
					height: size,
					viewBox: "0 0 24 24",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 1.7,
					strokeLinecap: "round",
					strokeLinejoin: "round",
					"aria-hidden": "true",
				},
				h("path", { d: "M3.5 7.5A2.5 2.5 0 0 1 6 5h3l1.8 2H18a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z" }),
				h("path", { d: "M7.5 11.5h4M7.5 14.5h6.5" }),
				h("path", { d: "M15.5 10.5v5" }),
			);
		}

		/* ───────────────────────── 项目列表 ───────────────────────── */

		function UsageStatsCard() {
			const HEAT_WEEKS = 26;
			const [stats, setStats] = useState({ loading: true, data: null, error: null });
			const [mode, setMode] = useState("day");
			const [day, setDay] = useState("");
			const [month, setMonth] = useState("");
			const [from, setFrom] = useState("");
			const [to, setTo] = useState("");
			const [modelFilter, setModelFilter] = useState("all");
			const load = useCallback(async () => {
				setStats((previous) => ({ ...previous, loading: true, error: null }));
				try {
					const data = await api("/usage");
					setStats({ loading: false, data, error: null });
				} catch (error) {
					setStats({ loading: false, data: null, error });
				}
			}, []);
			useEffect(() => {
				void load();
			}, [load]);
			const days = stats.data?.days ?? [];
			const fmt = (value) => {
				const number = Number(value) || 0;
				if (number >= 1e9) return `${(number / 1e9).toFixed(2)}B`;
				if (number >= 1e6) return `${(number / 1e6).toFixed(2)}M`;
				if (number >= 1e3) return `${(number / 1e3).toFixed(1)}K`;
				return String(Math.round(number));
			};
			const keyOf = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const todayKey = keyOf(today);
			const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
			const fromDefault = (() => {
				const date = new Date(today);
				date.setDate(date.getDate() - 29);
				return keyOf(date);
			})();
			useEffect(() => {
				if (days.length === 0) return;
				const latest = days[days.length - 1].date;
				if (day === "") setDay(days.some((item) => item.date === todayKey) ? todayKey : latest);
				if (month === "") setMonth(monthKey);
				if (from === "") setFrom(fromDefault);
				if (to === "") setTo(todayKey);
			}, [days.length, day, month, from, to]);
			const allModels = [...new Set(days.flatMap((item) => Object.keys(item.models ?? {})))].sort();
			const filterModels = (models) => {
				if (modelFilter === "all") return models;
				return Object.prototype.hasOwnProperty.call(models, modelFilter) ? { [modelFilter]: models[modelFilter] } : {};
			};
			const filteredDays = days
				.map((item) => ({ date: item.date, models: filterModels(item.models ?? {}) }))
				.filter((item) => Object.keys(item.models).length > 0);
			const valueOfDay = (models) => Object.values(models).reduce((total, record) => total + (record.total ?? 0), 0);
			const callsOfDay = (models) => Object.values(models).reduce((total, record) => total + (record.calls ?? 0), 0);
			const dayMap = new Map(filteredDays.map((item) => [item.date, item]));
			const inRange = (date) => (mode === "day" ? date === day : mode === "month" ? date.startsWith(`${month}-`) : date >= from && date <= to);
			const selectedDays = filteredDays.filter((item) => inRange(item.date));
			const modelTotals = new Map();
			const totals = { calls: 0, inp: 0, out: 0, cacheR: 0, total: 0 };
			for (const item of selectedDays) {
				for (const [model, record] of Object.entries(item.models)) {
					const target = modelTotals.get(model) ?? { calls: 0, inp: 0, out: 0, cacheR: 0, cacheW: 0, total: 0 };
					for (const key of Object.keys(target)) {
						target[key] += record[key] ?? 0;
						totals[key] += record[key] ?? 0;
					}
					modelTotals.set(model, target);
				}
			}
			const rows = [...modelTotals.entries()].sort((left, right) => right[1].total - left[1].total);
			const hitRate = totals.inp + totals.cacheR > 0 ? `${((totals.cacheR / (totals.inp + totals.cacheR)) * 100).toFixed(1)}%` : "—";
			const heatStart = new Date(today);
			heatStart.setDate(heatStart.getDate() - (HEAT_WEEKS * 7 - 1));
			heatStart.setDate(heatStart.getDate() - heatStart.getDay());
			const weeks = [];
			const months = [];
			let lastMonth = -1;
			const cursor = new Date(heatStart);
			while (cursor <= today) {
				const column = [];
				const first = new Date(cursor);
				for (let offset = 0; offset < 7; offset += 1) {
					const date = new Date(cursor);
					date.setDate(date.getDate() + offset);
					if (date > today) {
						column.push(null);
						continue;
					}
					const key = keyOf(date);
					const item = dayMap.get(key);
					column.push({ key, value: item === undefined ? 0 : valueOfDay(item.models), calls: item === undefined ? 0 : callsOfDay(item.models) });
				}
				weeks.push(column);
				if (first.getMonth() !== lastMonth) {
					months.push({ column: weeks.length - 1, label: `${first.getMonth() + 1}月` });
					lastMonth = first.getMonth();
				}
				cursor.setDate(cursor.getDate() + 7);
			}
			const heatMax = Math.max(1, ...weeks.flat().filter(Boolean).map((cell) => cell.value));
			const level = (value) => (value <= 0 ? 0 : value <= heatMax * 0.25 ? 1 : value <= heatMax * 0.5 ? 2 : value <= heatMax * 0.75 ? 3 : 4);
			const peak = Math.max(0, ...weeks.flat().filter(Boolean).map((cell) => cell.value));
			const rangeLabel = mode === "day" ? day : mode === "month" ? `${month} 月` : `${from} ~ ${to}`;
			const jumpToday = () => {
				setMode("day");
				setDay(todayKey);
			};
			const pickDay = (key) => {
				setMode("day");
				setDay(key);
			};
			const input = (value, onChange, props) => h("input", { className: "pw-usage-input", value, onChange: (event) => onChange(event.target.value), ...props });
			return h(
				"section",
				{ className: "pw-dash-card wide pw-usage-card" },
				h(
					"div",
					{ className: "pw-dash-card-head" },
					h("h3", null, "📈 用量统计"),
					h("span", { className: "pw-badge" }, `${stats.data?.files ?? 0} 个会话`),
					h("span", { className: "pw-spacer" }),
					h("button", { type: "button", className: "link", onClick: jumpToday }, "回到今天"),
					h("button", { type: "button", className: "link", disabled: stats.loading, onClick: () => void load() }, stats.loading ? "统计中…" : "刷新"),
				),
				stats.error === null ? null : h("div", { className: "pw-dash-empty" }, `用量统计不可用：${errorText(stats.error)}`),
				stats.data === null
					? stats.loading
						? h("div", { className: "pw-dash-empty" }, "正在扫描全部会话日志…")
						: null
					: h(
							"div",
							{ className: "pw-usage-body" },
							h(
								"div",
								{ className: "pw-usage-toolbar" },
								h(
									"div",
									{ className: "pw-usage-tabs" },
									[
										["day", "按天"],
										["month", "按月"],
										["range", "自定义"],
									].map(([value, label]) => h("button", { key: value, type: "button", className: `pw-usage-tab${mode === value ? " active" : ""}`, onClick: () => setMode(value) }, label)),
								),
								mode === "day" ? input(day, setDay, { type: "date" }) : null,
								mode === "month" ? input(month, setMonth, { type: "month" }) : null,
								mode === "range"
									? h(
											React.Fragment,
											null,
											input(from, setFrom, { type: "date", max: to }),
											h("span", { className: "pw-usage-arrow" }, "→"),
											input(to, setTo, { type: "date", min: from }),
										)
									: null,
								h(
									"select",
									{ className: "pw-usage-input pw-usage-select", value: modelFilter, onChange: (event) => setModelFilter(event.target.value) },
									h("option", { value: "all" }, "全部模型"),
									allModels.map((model) => h("option", { key: model, value: model }, model)),
								),
								h("span", { className: "pw-spacer" }),
								h("span", { className: "pw-badge" }, rangeLabel),
							),
							h(
								"div",
								{ className: "pw-usage-heat-panel" },
								h(
									"div",
									{ className: "pw-usage-heat" },
									h(
										"div",
										{ className: "pw-usage-months" },
										months.map((item) => h("span", { key: `${item.column}-${item.label}`, style: { gridColumnStart: item.column + 2 } }, item.label)),
									),
									h(
										"div",
										{ className: "pw-usage-heat-row" },
										h("div", { className: "pw-usage-weekdays" }, h("span", null, ""), h("span", null, "一"), h("span", null, ""), h("span", null, "三"), h("span", null, ""), h("span", null, "五"), h("span", null, "")),
										h(
											"div",
											{ className: "pw-usage-grid" },
											weeks.flatMap((column, columnIndex) =>
												column.map((cell, rowIndex) =>
													cell === null
														? h("span", { key: `blank-${columnIndex}-${rowIndex}`, className: "pw-usage-cell blank" })
														: h("button", {
																key: cell.key,
																type: "button",
																className: `pw-usage-cell l${level(cell.value)}${cell.key === day && mode === "day" ? " selected" : inRange(cell.key) ? " in-range" : ""}`,
																title: `${cell.key} · ${fmt(cell.value)} tokens · ${cell.calls} 次调用`,
																onClick: () => pickDay(cell.key),
															}),
												),
											),
										),
									),
								),
								h(
									"div",
									{ className: "pw-usage-legend" },
									h("span", null, "少"),
									[0, 1, 2, 3, 4].map((value) => h("span", { key: value, className: `pw-usage-cell l${value}` })),
									h("span", null, "多"),
									h("span", { className: "pw-usage-note" }, `近 6 个月每日 token · 单日峰值 ${fmt(peak)}`),
								),
							),
							h(
								"div",
								{ className: "pw-usage-detail" },
								h(
									"div",
									{ className: "pw-usage-detail-head" },
									h("b", null, rangeLabel),
									selectedDays.length === 0 ? h("span", { className: "pw-badge" }, "无数据") : h("span", { className: "pw-badge" }, `${totals.calls} 次调用 · ${fmt(totals.total)} tokens`),
								),
								h(
									"div",
									{ className: "pw-usage-summary" },
									h("div", { className: "pw-usage-stat" }, h("span", null, "总 token"), h("b", null, fmt(totals.total))),
									h("div", { className: "pw-usage-stat" }, h("span", null, "未缓存输入"), h("b", null, fmt(totals.inp))),
									h("div", { className: "pw-usage-stat" }, h("span", null, "输出"), h("b", null, fmt(totals.out))),
									h("div", { className: "pw-usage-stat" }, h("span", null, "缓存读取"), h("b", null, fmt(totals.cacheR))),
									h("div", { className: "pw-usage-stat" }, h("span", null, "命中率"), h("b", { className: "green" }, hitRate)),
									h("div", { className: "pw-usage-stat" }, h("span", null, "调用次数"), h("b", null, String(totals.calls))),
								),
								rows.length === 0
									? h("div", { className: "pw-dash-empty" }, "该时间段没有用量数据。")
									: h(
											"div",
											{ className: "pw-usage-models" },
											rows.map(([model, record]) =>
												h(
													"div",
													{ key: model, className: "pw-usage-model" },
													h("span", { className: "name", title: model }, model),
													h("span", { className: "calls" }, `${record.calls ?? 0} 次`),
													h("span", { className: "total" }, fmt(record.total)),
												),
											),
										),
							),
						),
			);
		}

		function DashboardView({ onOpenProject, onOpenTask, onOpenProjects, onOpenTasks, renderSlot }) {
			const [state, setState] = useState({ loading: true, data: null, error: null });
			const [createOpen, setCreateOpen] = useState(false);
			const [notice, setNotice] = useState(null);
			const [assistantText, setAssistantText] = useState("");
			const [assistantBusy, setAssistantBusy] = useState(false);
			const [assistantMessages, setAssistantMessages] = useState([{ role: "assistant", content: t("dashboard.assistant.welcome") }]);
			const [recording, setRecording] = useState(false);
			const [voiceBusy, setVoiceBusy] = useState(false);
			const [voiceLevel, setVoiceLevel] = useState(0);
			const [voiceSeconds, setVoiceSeconds] = useState(0);
			const [voicePhase, setVoicePhase] = useState("idle");
			const voiceRef = useRef(null);

			const load = useCallback(async () => {
				setState((previous) => ({ ...previous, loading: true, error: null }));
				try {
					const data = await api("/dashboard");
					setState({ loading: false, data, error: null });
				} catch (error) {
					setState({ loading: false, data: null, error });
				}
			}, []);

			useEffect(() => {
				void load();
			}, [load]);

			const showNotice = useCallback((text, kind) => {
				setNotice({ text, kind });
				setTimeout(() => setNotice(null), 3200);
			}, []);

			const dashboard = state.data;
			const canEmbedChat = typeof renderSlot === "function";

			const sendAssistant = useCallback(
				async (prompt) => {
					const message = String(prompt ?? assistantText).trim();
					if (message === "" || assistantBusy) return;
					const history = assistantMessages.map((item) => ({ role: item.role, content: item.content }));
					const nextMessages = [...assistantMessages, { role: "user", content: message }];
					setAssistantMessages(nextMessages);
					setAssistantText("");
					setAssistantBusy(true);
					try {
						const data = await api("/assistant/chat", { method: "POST", body: { message, history } });
						setAssistantMessages([
							...nextMessages,
							{ role: "assistant", content: data?.reply ?? "", actions: Array.isArray(data?.actions) ? data.actions : [] },
						]);
						if (Array.isArray(data?.actions) && data.actions.length > 0) void load();
					} catch (error) {
						setAssistantMessages([
							...nextMessages,
							{ role: "assistant", content: `${t("dashboard.assistant.failed")}：${errorText(error)}`, error: true },
						]);
					} finally {
						setAssistantBusy(false);
					}
				},
				[assistantText, assistantMessages, assistantBusy, load],
			);

			const toggleVoice = useCallback(async () => {
				if (voiceBusy) return;
				if (!recording) {
					setVoiceBusy(true);
					setVoicePhase("preparing");
					try {
						await api("/speech/prepare", { method: "POST", body: {} });
						const capture = createVoiceCapture();
						await capture.start();
						voiceRef.current = capture;
						setVoiceLevel(0);
						setVoiceSeconds(0);
						setVoicePhase("recording");
						setRecording(true);
					} catch (error) {
						setVoicePhase("idle");
						showNotice(`${t("dashboard.voice.failed")}：${errorText(error)}`, "warn");
					} finally {
						setVoiceBusy(false);
					}
					return;
				}
				setRecording(false);
				setVoiceBusy(true);
				setVoicePhase("transcribing");
				try {
					const capture = voiceRef.current;
					voiceRef.current = null;
					if (capture === null) throw new Error("empty");
					const audioBase64 = await capture.stop();
					const result = await api("/speech/transcribe", { method: "POST", body: { audioBase64 } });
					const text = String(result?.text ?? "");
					if (text.trim() === "") {
						showNotice(t("dashboard.voice.empty"), "warn");
						return;
					}
					setAssistantText((previous) => (previous.trim() === "" ? text : `${previous} ${text}`));
				} catch (error) {
					showNotice(`${t("dashboard.voice.failed")}：${errorText(error)}`, "warn");
				} finally {
					setVoiceBusy(false);
					setVoicePhase("idle");
				}
			}, [recording, voiceBusy, showNotice]);

			useEffect(() => () => {
				voiceRef.current?.dispose?.();
			}, []);

			useEffect(() => {
				if (!recording) {
					setVoiceLevel(0);
					return undefined;
				}
				let raf = 0;
				let last = 0;
				const started = Date.now();
				const tick = (time) => {
					if (time - last > 50) {
						last = time;
						const capture = voiceRef.current;
						let level = 0;
						try {
							level = capture?.amplitude?.() ?? 0;
						} catch {
							level = 0;
						}
						setVoiceLevel(level);
						setVoiceSeconds(Math.floor((Date.now() - started) / 1000));
					}
					raf = requestAnimationFrame(tick);
				};
				raf = requestAnimationFrame(tick);
				return () => cancelAnimationFrame(raf);
			}, [recording]);

			const openFullChat = useCallback(async () => {
				try {
					const uiWorkspace = rootClientCtx?.get?.("uiWorkspace");
					if (uiWorkspace === undefined || uiWorkspace === null || typeof uiWorkspace.startSession !== "function") {
						throw new Error("当前界面不支持打开标准会话");
					}
					const root = dashboard?.workbenchRoot ?? "";
					const list = uiWorkspace.workspaces?.list?.getSnapshot?.();
					let workspace = Array.isArray(list?.items) ? list.items.find((item) => item.path === root) : undefined;
					if (workspace === undefined && root !== "" && typeof uiWorkspace.workspaces?.create === "function") {
						const result = await uiWorkspace.workspaces.create({ path: root });
						if (result !== null && typeof result === "object" && result.ok === true && result.value !== undefined) {
							workspace = result.value.workspace ?? result.value;
						}
					}
					const workspaceId = workspace?.workspaceId;
					if (workspaceId === undefined) throw new Error("没有可用工作区");
					const lastUser = [...assistantMessages].reverse().find((item) => item.role === "user");
					uiWorkspace.startSession(workspaceId, lastUser === undefined ? {} : { prompt: lastUser.content });
					showNotice(t("dashboard.assistant.fullChatOpened"));
				} catch (error) {
					showNotice(`${t("dashboard.assistant.fullChatHint")}：${errorText(error)}`, "warn");
				}
			}, [dashboard, assistantMessages, showNotice]);

			if (state.loading && dashboard === null) {
				return h("div", { className: "pw-page" }, h(Spinner, { text: t("dashboard.loading") }));
			}
			if (state.error !== null || dashboard === null) {
				return h(
					"div",
					{ className: "pw-page" },
					h(ErrorBanner, { error: state.error ?? new Error(t("error.load")), onRetry: load }),
				);
			}

			const quick = [
				h("button", { key: "new", type: "button", className: "pw-chip", onClick: () => setCreateOpen(true) }, `＋ ${t("dashboard.quick.newProject")}`),
				h(
					"button",
					{
						key: "today",
						type: "button",
						className: "pw-chip",
						onClick: () => {
							const target = typeof document === "undefined" ? null : document.getElementById("pw-dash-recent");
							if (target !== null) target.scrollIntoView({ behavior: "smooth", block: "center" });
						},
					},
					`🕒 ${t("dashboard.quick.recent")}`,
				),
				h("button", { key: "progress", type: "button", className: "pw-chip", onClick: onOpenProjects }, `📈 ${t("dashboard.quick.progress")}`),
				h("button", { key: "review", type: "button", className: "pw-chip", onClick: () => void sendAssistant(t("dashboard.assistant.reviewPrompt")) }, `🗓 ${t("dashboard.quick.review")}`),
				h("button", { key: "weekly", type: "button", className: "pw-chip", onClick: () => void sendAssistant(t("dashboard.assistant.weeklyPrompt")) }, `✍ ${t("dashboard.quick.weekly")}`),
			];

			const taskRow = (task, tone) =>
				h(
					"div",
					{ key: task.id, className: "pw-dash-item", onClick: () => onOpenTask(task.projectId, task.id) },
					h(
						"div",
						{ className: "main" },
						h("b", null, task.title),
						h("span", null, `${task.projectName}${task.dueAt ? ` · ${t("dashboard.today.due", { time: fmtDateTime(task.dueAt) })}` : ""}`),
					),
					tone === "overdue"
						? h("span", { className: "pw-badge badge-danger" }, t("dashboard.focus.overdue"))
						: task.viewStatus === "needs-you"
							? h("span", { className: "pw-badge badge-warn" }, t("dashboard.focus.needsYou"))
							: h(PriorityBadge, { priority: task.priority }),
				);

			const taskTone = (status) => (status === "done" ? "success" : status === "running" ? "info" : status === "needs-you" ? "warn" : "neutral");
			const taskIcon = (status) => (status === "done" ? "✓" : status === "running" ? "▶" : status === "needs-you" ? "!" : "○");
			const activityTone = (kind) => {
				const text = String(kind ?? "");
				if (text.includes("comment")) return "warn";
				if (text.includes("artifact")) return "success";
				if (text.includes("session")) return "info";
				if (text.includes("status") || text.includes("move")) return "info";
				if (text.includes("goal")) return "goal";
				return "neutral";
			};
			const activityIcon = (kind) => {
				const text = String(kind ?? "");
				if (text.includes("comment")) return "💬";
				if (text.includes("artifact")) return "📎";
				if (text.includes("session")) return "🔗";
				if (text.includes("status") || text.includes("move")) return "🔄";
				if (text.includes("goal")) return "🎯";
				if (text.includes("task")) return "📋";
				return "✨";
			};
			const progressTone = (progress) => (progress >= 80 ? "success" : progress >= 40 ? "info" : "warn");

			const recentTaskRow = (task) =>
				h(
					"div",
					{ key: task.id, className: `pw-dash-item pw-tone-${taskTone(task.viewStatus)}`, onClick: () => onOpenTask(task.projectId, task.id) },
					h("span", { className: `pw-dash-icon ${taskTone(task.viewStatus)}` }, taskIcon(task.viewStatus)),
					h(
						"div",
						{ className: "main" },
						h("b", null, task.title),
						h("span", null, `${task.projectName} · 最近交互 ${relativeTime(task.lastInteractionAt ?? task.lastActivityAt)}`),
					),
					h(StatusBadge, { status: task.viewStatus }),
				);

			const recentRow = (entry) =>
				h(
					"div",
					{ key: `${entry.taskId}-${entry.id}`, className: "pw-recent-item", onClick: () => onOpenTask(entry.projectId, entry.taskId) },
					h("span", { className: `pw-activity-icon ${activityTone(entry.kind)}` }, activityIcon(entry.kind)),
					h(
						"div",
						{ className: "main" },
						h("b", null, entry.taskTitle),
						h("span", null, `${activityKindLabel(entry.kind)} · ${entry.projectName}`),
					),
					h("span", { className: "pw-info-line", style: { whiteSpace: "nowrap" } }, relativeTime(entry.at)),
				);

			return h(
				"div",
				{ className: "pw-page pw-dash" },
				notice === null ? null : h("div", { className: `pw-toast${notice.kind === "warn" ? " warn" : ""}` }, notice.text),
				h("div", { className: "pw-quick" }, h("span", { className: "label" }, "快速："), ...quick),
				dashboard.insights.length === 0
					? null
					: h(
							"div",
							{ className: "pw-insight-marquee", title: dashboard.insights.join(" · ") },
							h("span", { className: "pw-insight-marquee-label" }, "✦ AI 洞察"),
							h(
								"div",
								{ className: "pw-marquee-track" },
								h(
									"span",
									{
										className: "pw-marquee-item",
										style: { animationDuration: `${Math.max(12, Math.min(46, dashboard.insights.join("　·　").length * 0.18))}s` },
									},
									dashboard.insights.join("　·　"),
								),
							),
						),
				h(
					"div",
					{ className: "pw-dash-layout" },
					h(
						"div",
						{ className: "pw-dash-main" },
						h(
							"div",
							{ className: "pw-dash-grid" },
							h(
								"section",
								{ id: "pw-dash-recent", className: "pw-dash-card" },
								h(
									"div",
									{ className: "pw-dash-card-head" },
									h("h3", null, `🕒 ${t("dashboard.recentTasks.title")}`),
									h(
										"div",
										{ className: "pw-dash-card-head-right" },
										h("span", { className: "pw-badge" }, String((dashboard.recentTasks ?? []).length)),
										h("button", { type: "button", className: "link", onClick: onOpenTasks }, "全部任务"),
									),
								),
								(dashboard.recentTasks ?? []).length === 0
									? h("div", { className: "pw-dash-empty" }, t("dashboard.recentTasks.empty"))
									: h("div", { className: "pw-dash-list" }, dashboard.recentTasks.map(recentTaskRow)),
							),
							h(
								"section",
								{ className: "pw-dash-card" },
								h(
									"div",
									{ className: "pw-dash-card-head" },
									h("h3", null, `📁 ${t("dashboard.projects.title")}`),
									h("button", { type: "button", className: "link", onClick: onOpenProjects }, t("dashboard.projects.all")),
								),
								dashboard.projects.length === 0
									? h("div", { className: "pw-dash-empty" }, t("dashboard.projects.empty"))
									: h(
											"div",
											{ className: "pw-project-progress" },
											dashboard.projects.map((project) =>
												h(
													"div",
													{ key: project.id, className: `pw-project-row pw-progress-${progressTone(project.progress)}`, style: { cursor: "pointer" }, onClick: () => onOpenProject(project.id) },
													h("span", { className: "pw-project-icon" }, "📁"),
													h(
														"div",
														{ className: "pw-project-body" },
														h("div", { className: "top" }, h("b", null, project.name), h("span", null, `${project.progress}%`)),
														h("div", { className: "pw-progress" }, h("span", { style: { width: `${project.progress}%` } })),
														h(
															"div",
															{ className: "pw-info-line" },
															h("span", null, t("dashboard.projects.tasks", { done: project.stats.done, total: project.stats.total })),
															h("span", null, " · "),
															h("span", null, t("dashboard.projects.updated", { time: relativeTime(project.lastUpdated) })),
														),
													),
												),
											),
										),
							),
							h(UsageStatsCard),
							h(
								"section",
								{ className: "pw-dash-card wide" },
								h(
									"div",
									{ className: "pw-dash-card-head" },
									h("h3", null, `⚠ ${t("dashboard.focus.title")}`),
									h("button", { type: "button", className: "link", onClick: onOpenProjects }, t("dashboard.focus.all")),
								),
								dashboard.focusItems.length === 0
									? h("div", { className: "pw-dash-empty" }, t("dashboard.focus.empty"))
									: h(
											"div",
											{ className: "pw-dash-grid" },
											dashboard.focusItems.map((task) =>
												h(
													"div",
													{ key: task.id, className: "pw-dash-item pw-tone-warn", onClick: () => onOpenTask(task.projectId, task.id) },
													h("span", { className: "pw-dash-icon warn" }, task.overdue ? "⏰" : "!"),
													h(
														"div",
														{ className: "main" },
														h("b", null, task.title),
														h("span", null, `${task.projectName} · ${statusLabel(task.viewStatus)}`),
													),
													task.overdue
														? h("span", { className: "pw-badge badge-danger" }, t("dashboard.focus.overdue"))
														: h("span", { className: "pw-badge badge-warn" }, t("dashboard.focus.needsYou")),
												),
											),
										),
							),
							h(
								"section",
								{ className: "pw-dash-card wide" },
								h("div", { className: "pw-dash-card-head" }, h("h3", null, `🕘 ${t("dashboard.recent.title")}`)),
								dashboard.recentActivity.length === 0
									? h("div", { className: "pw-dash-empty" }, t("dashboard.recent.empty"))
									: h("div", null, dashboard.recentActivity.map(recentRow)),
							),
						),
					),
					h(
						"aside",
						{ className: "pw-assistant" },
						h(
							"div",
							{ className: "pw-assistant-head" },
							h("div", { className: "pw-assistant-avatar" }, "AI"),
							h("div", null, h("b", null, t("dashboard.assistant.title")), h("span", null, t("dashboard.assistant.subtitle"))),
							h("span", { className: "pw-spacer" }),
							h("button", { type: "button", className: "pw-btn small ghost", title: t("dashboard.assistant.fullChatHint"), onClick: () => void openFullChat() }, t("dashboard.assistant.fullChat")),
						),
						canEmbedChat
							? h(
									"div",
									{ className: "pw-assistant-body pw-assistant-embed" },
									h("div", { className: "pw-embedded-chat" }, renderSlot("main", {}, { entryKey: "conversation" })),
								)
							: 						h(
							"div",
							{ className: "pw-assistant-body" },
							assistantMessages.map((item, index) =>
								h(
									"div",
									{ key: index, className: `pw-assistant-msg ${item.role}${item.error === true ? " error" : ""}` },
									h("div", { className: "pw-assistant-bubble" }, item.content),
									Array.isArray(item.actions) && item.actions.length > 0
										? h(
												"div",
												{ className: "pw-assistant-actions" },
												item.actions.map((action, actionIndex) =>
													h("span", { key: actionIndex, className: "pw-badge" }, `${action.tool}${action.ok === true ? " ✓" : " ✗"}`),
												),
											)
										: null,
								),
							),
							assistantBusy ? h("div", { className: "pw-assistant-msg assistant" }, h("div", { className: "pw-assistant-bubble thinking" }, "正在思考…")) : null,
							h(
								"div",
								{ className: "pw-assistant-suggest" },
								[t("dashboard.assistant.suggest1"), t("dashboard.assistant.suggest2"), t("dashboard.assistant.suggest3")].map((suggestion) =>
									h("button", { key: suggestion, type: "button", className: "pw-chip", disabled: assistantBusy, onClick: () => void sendAssistant(suggestion) }, suggestion),
								),
							),
						),
						canEmbedChat
							? null
							: h(
							"div",
							{ className: "pw-assistant-foot" },
							voicePhase !== "idle"
								? h(
										"div",
										{ className: "pw-voice-status" },
										h("span", { className: `pw-voice-dot${recording ? " recording" : ""}` }),
										h(
											"span",
											null,
											voicePhase === "recording"
												? `${t("dashboard.voice.recording")} ${String(voiceSeconds).padStart(2, "0")}s`
												: voicePhase === "transcribing"
													? t("dashboard.voice.transcribing")
													: t("dashboard.voice.preparing"),
										),
										recording
											? h(
													"div",
													{ className: "pw-voice-meter", "aria-hidden": "true" },
													Array.from({ length: 14 }, (_, index) => {
														const shape = 0.35 + 0.65 * Math.abs(Math.sin(((index + 1) / 15) * Math.PI));
														const height = 4 + Math.round(voiceLevel * 22 * shape);
														return h("span", { key: index, style: { height: `${height}px` } });
													}),
												)
											: null,
									)
								: null,
							h(
								"div",
								{ className: "pw-assistant-input" },
								h(TextArea, {
									value: assistantText,
									onChange: setAssistantText,
									rows: 2,
									placeholder: t("dashboard.assistant.placeholder"),
									onKeyDown: (event) => {
										if (event.key === "Enter" && !event.shiftKey) {
											event.preventDefault();
											void sendAssistant();
										}
									},
								}),
								h(
									"button",
									{
										type: "button",
										className: `pw-mic-btn${recording ? " recording" : ""}`,
										title: recording ? t("dashboard.voice.stop") : t("dashboard.voice.record"),
										disabled: assistantBusy || voiceBusy,
										onClick: () => void toggleVoice(),
									},
									voiceBusy ? "…" : recording ? "■" : "🎙",
								),
								h(Button, { kind: "primary", disabled: assistantBusy || assistantText.trim() === "", onClick: () => void sendAssistant() }, assistantBusy ? t("common.saving") : t("dashboard.assistant.send")),
							),
							h(
								"div",
								{ className: "pw-assistant-note" },
								h("span", null, "Enter 发送 · Shift+Enter 换行"),
								h("span", null, t("dashboard.assistant.subtitle")),
							),
						),
					),
				),
				createOpen
					? h(CreateProjectModal, {
							onClose: () => setCreateOpen(false),
							workbenchRoot: dashboard.workbenchRoot,
							onCreated: (project) => {
								setCreateOpen(false);
								void load();
								if (project?.id) onOpenProject(project.id);
							},
						})
					: null,
			);
		}

		function TasksView({ onHome, onOpenTask }) {
			const [filter, setFilter] = useState("all");
			const [state, setState] = useState({ loading: true, data: null, error: null });
			const load = useCallback(async () => {
				setState((previous) => ({ ...previous, loading: true, error: null }));
				try {
					const data = await api(`/tasks?status=${encodeURIComponent(filter)}`);
					setState({ loading: false, data, error: null });
				} catch (error) {
					setState({ loading: false, data: null, error });
				}
			}, [filter]);
			useEffect(() => {
				void load();
			}, [load]);
			const tasks = state.data?.tasks ?? [];
			const taskTone = (status) => (status === "done" ? "success" : status === "running" ? "info" : status === "needs-you" ? "warn" : "neutral");
			const taskIcon = (status) => (status === "done" ? "✓" : status === "running" ? "▶" : status === "needs-you" ? "!" : "○");
			const filters = [
				["all", "全部"],
				["active", "进行中"],
				["needs-you", "待处理"],
				["done", "已完成"],
			];
			return h(
				"div",
				{ className: "pw-page" },
				h(
					"div",
					{ className: "pw-breadcrumb" },
					h("button", { type: "button", onClick: onHome }, "🏠 工作台首页"),
					h("span", { className: "sep" }, "/"),
					h("span", null, "全部任务"),
				),
				h(
					"div",
					{ className: "pw-head" },
					h("div", null, h("h1", null, "全部任务"), h("p", null, `跨项目共 ${tasks.length} 个任务`)),
					h(
						"div",
						{ className: "pw-head-right" },
						h(Button, { onClick: onHome }, "返回首页"),
						h(Button, { onClick: () => void load(), disabled: state.loading }, state.loading ? "加载中…" : "刷新"),
					),
				),
				h(
					"div",
					{ className: "pw-project-tabs" },
					h(
						"div",
						{ className: "pw-seg" },
						filters.map(([value, label]) => h("button", { key: value, type: "button", className: filter === value ? "active" : "", onClick: () => setFilter(value) }, label)),
					),
				),
				state.error !== null ? h(ErrorBanner, { error: state.error, onRetry: load }) : null,
				state.loading && tasks.length === 0
					? h(Spinner)
					: tasks.length === 0
						? h(Empty, { big: "没有符合条件的任务" })
						: h(
								"div",
								{ className: "pw-task-list" },
								tasks.map((task) =>
									h(
										"div",
										{ key: task.id, className: "pw-task-row", role: "button", tabIndex: 0, onClick: () => onOpenTask(task.id) },
										h("span", { className: `pw-dash-icon ${taskTone(task.viewStatus)}` }, taskIcon(task.viewStatus)),
										h(
											"div",
											{ className: "pw-task-row-main" },
											h("div", { className: "pw-task-title" }, task.title),
											h(
												"div",
												{ className: "pw-task-sub" },
												h("span", { className: "pw-badge" }, task.projectName),
												h(StatusBadge, { status: task.viewStatus }),
												h(PriorityBadge, { priority: task.priority }),
												h("span", { className: "pw-info-line" }, `更新于 ${relativeTime(task.updatedAt)}`),
											),
										),
									),
								),
							),
			);
		}

		function ProjectsView({ onOpenProject, onHome }) {
			const [filter, setFilter] = useState("active");
			const [state, setState] = useState({ loading: true, data: null, error: null });
			const [createOpen, setCreateOpen] = useState(false);
			const [settingsOpen, setSettingsOpen] = useState(false);
			const [settings, setSettings] = useState(null);
			const [notice, setNotice] = useState(null);
			const [busyId, setBusyId] = useState(null);

			const load = useCallback(async () => {
				setState((previous) => ({ ...previous, loading: true, error: null }));
				try {
					const [data, settingsData] = await Promise.all([
						api(`/projects?status=${encodeURIComponent(filter)}`),
						api("/settings").catch(() => null),
					]);
					setSettings(settingsData);
					setState({ loading: false, data, error: null });
				} catch (error) {
					setState({ loading: false, data: null, error });
				}
			}, [filter]);

			useEffect(() => {
				void load();
			}, [load]);

			const showNotice = useCallback((text, kind) => {
				setNotice({ text, kind });
				setTimeout(() => setNotice(null), 2600);
			}, []);

			const archiveOrRestore = useCallback(
				async (project, nextStatus) => {
					const confirmText = nextStatus === "archived" ? t("projects.archiveConfirm") : undefined;
					if (confirmText !== undefined && typeof window.confirm === "function" && !window.confirm(confirmText)) return;
					setBusyId(project.id);
					try {
						await api(`/projects/${encodeURIComponent(project.id)}`, { method: "PATCH", body: { status: nextStatus } });
						showNotice(nextStatus === "archived" ? t("toast.archived") : t("toast.restored"));
						await load();
					} catch (error) {
						showNotice(errorText(error), "warn");
					} finally {
						setBusyId(null);
					}
				},
				[load, showNotice],
			);

			const deleteProject = useCallback(
				async (project) => {
					if (typeof window.confirm === "function" && !window.confirm(t("projects.deleteConfirm"))) return;
					setBusyId(project.id);
					try {
						await api(`/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
						showNotice(t("toast.deleted"));
						await load();
					} catch (error) {
						showNotice(errorText(error), "warn");
					} finally {
						setBusyId(null);
					}
				},
				[load, showNotice],
			);

			const filters = [
				["active", t("projects.filter.active")],
				["archived", t("projects.filter.archived")],
				["all", t("projects.filter.all")],
			];

			const projects = state.data?.projects ?? [];

			return h(
				"div",
				{ className: "pw-page" },
				h(
					"div",
					{ className: "pw-breadcrumb" },
					h("button", { type: "button", onClick: () => onHome?.() }, "🏠 工作台首页"),
					h("span", { className: "sep" }, "/"),
					h("span", null, t("projects.title")),
				),
				h(
					"div",
					{ className: "pw-head" },
					h("div", null, h("h1", null, t("projects.title")), h("p", null, t("panel.subtitle"))),
					h(
						"div",
						{ className: "pw-head-right" },
						onHome === undefined ? null : h(Button, { onClick: onHome }, t("dashboard.home")),
						h(
							"div",
							{ className: "pw-seg" },
							filters.map(([value, label]) =>
								h("button", { key: value, type: "button", className: filter === value ? "active" : "", onClick: () => setFilter(value) }, label),
							),
						),
						h(Button, { onClick: () => setSettingsOpen(true) }, t("settings.button")),
						h(Button, { kind: "primary", onClick: () => setCreateOpen(true) }, t("projects.new")),
					),
				),
				settings === null
					? null
					: h(
							"div",
							{ className: "pw-info-line", style: { marginTop: -8, marginBottom: 12 } },
							`${t("projects.workbenchRoot")}：`,
							h("code", { className: "pw-code" }, settings.workbenchRoot),
						),
				notice === null ? null : h("div", { className: `pw-toast${notice.kind === "warn" ? " warn" : ""}` }, notice.text),
				state.error !== null ? h(ErrorBanner, { error: state.error, onRetry: load }) : null,
				state.loading && state.data === null
					? h(Spinner)
					: projects.length === 0
						? h(Empty, { big: filter === "archived" ? t("projects.emptyArchived") : t("projects.empty") })
						: h(
								"div",
								{ className: "pw-grid" },
								projects.map((project) =>
									h(ProjectCard, {
										key: project.id,
										project,
										busy: busyId === project.id,
										onOpen: () => onOpenProject(project.id),
										onArchive: () => archiveOrRestore(project, "archived"),
										onRestore: () => archiveOrRestore(project, "active"),
										onDelete: () => deleteProject(project),
									}),
								),
							),
				createOpen
					? h(CreateProjectModal, {
							onClose: () => setCreateOpen(false),
							workbenchRoot: settings?.workbenchRoot ?? null,
							onCreated: (project) => {
								setCreateOpen(false);
								showNotice(t("toast.projectCreated"));
								void load();
								if (project?.id) onOpenProject(project.id);
							},
						})
					: null,
				settingsOpen
					? h(WorkbenchSettingsModal, {
							settings,
							onClose: () => setSettingsOpen(false),
							onMigrated: () => {
								setSettingsOpen(false);
								showNotice(t("settings.migrated"));
								void load();
							},
						})
					: null,
			);
		}

		function WorkbenchSettingsModal({ settings, onClose, onMigrated }) {
			const [root, setRoot] = useState(settings?.workbenchRoot ?? "");
			const [busy, setBusy] = useState(false);
			const [error, setError] = useState(null);
			const submit = useCallback(async () => {
				if (root.trim() === "") return;
				setBusy(true);
				setError(null);
				try {
					const data = await api("/settings/root", { method: "POST", body: { workbenchRoot: root.trim() } });
					onMigrated(data);
				} catch (submitError) {
					setError(submitError);
				} finally {
					setBusy(false);
				}
			}, [root, onMigrated]);
			return h(
				Modal,
				{
					title: t("settings.title"),
					onClose: busy ? () => undefined : onClose,
					footer: [
						h(Button, { key: "cancel", onClick: onClose, disabled: busy }, t("common.cancel")),
						h(Button, { key: "migrate", kind: "primary", disabled: busy, onClick: submit }, busy ? t("settings.migrating") : t("settings.migrate")),
					],
				},
				h(
					"div",
					{ className: "pw-form" },
					error === null ? null : h(ErrorBanner, { error }),
					settings === null
						? h(Spinner)
						: h(
								"div",
								{ className: "pw-stats" },
								h(Stat, { value: settings.projectCount, label: t("settings.projects") }),
								h(Stat, { value: settings.taskCount, label: t("settings.tasks") }),
							),
					h("p", { className: "pw-hint" }, t("settings.hint")),
					h(
						"div",
						{ className: "pw-info-line" },
						`${t("settings.current")}：`,
						h("code", { className: "pw-code" }, settings?.workbenchRoot ?? ""),
						settings?.source === "user" ? h(Badge, null, t("settings.source.user")) : h(Badge, null, t("settings.source.config")),
					),
					h(Field, { label: t("settings.newRoot") }, h(TextInput, { value: root, onChange: setRoot, placeholder: t("settings.newRootPh"), autoFocus: true })),
					h("p", { className: "pw-hint", style: { color: "var(--pw-amber)" } }, t("settings.warning")),
				),
			);
		}

		function ProjectCard({ project, busy, onOpen, onArchive, onRestore, onDelete }) {
			const stats = project.stats ?? {};
			const archived = project.status === "archived";
			return h(
				"div",
				{
					className: `pw-project-card${archived ? " archived" : ""}`,
					role: "button",
					tabIndex: 0,
					onClick: onOpen,
					onKeyDown: (event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							onOpen();
						}
					},
				},
				h(
					"div",
					{ className: "pw-project-card-top" },
					h("div", { className: "pw-project-name" }, project.name),
					archived ? h(Badge, { tone: "warn" }, t("projects.archivedBadge")) : null,
				),
				h("div", { className: "pw-project-desc" }, project.description === "" ? t("common.none") : project.description),
				h(
					"div",
					{ className: "pw-stats" },
					h(Stat, { value: stats.backlog ?? 0, label: t("project.stats.backlog") }),
					h(Stat, { value: stats.running ?? 0, label: t("project.stats.running"), tone: "info" }),
					h(Stat, { value: stats.needsYou ?? 0, label: t("project.stats.needsYou"), tone: "warn" }),
					h(Stat, { value: stats.done ?? 0, label: t("project.stats.done"), tone: "success" }),
				),
				h(
					"div",
					{ className: "pw-project-meta" },
					h("span", null, `${t("projects.rootPath")}：`, h("span", { className: "pw-mono" }, project.rootPath)),
					h("span", null, `${t("projects.updatedAt")} ${relativeTime(project.updatedAt)}`),
				),
				h(
					"div",
					{ className: "pw-project-foot" },
					h("span", { className: "pw-info-line" }, t("projects.taskCount", { n: stats.total ?? 0 })),
					h(
						"div",
						{ className: "pw-actions", onClick: (event) => event.stopPropagation() },
						archived
							? h(Button, { small: true, disabled: busy, onClick: onRestore }, t("projects.restore"))
							: h(Button, { small: true, disabled: busy, onClick: onArchive }, t("projects.archive")),
						(stats.total ?? 0) === 0 ? h(Button, { small: true, kind: "danger", disabled: busy, onClick: onDelete }, t("projects.deleteEmpty")) : null,
					),
				),
			);
		}

		function CreateProjectModal({ onClose, onCreated, workbenchRoot }) {
			const [name, setName] = useState("");
			const [description, setDescription] = useState("");
			const [folderName, setFolderName] = useState("");
			const [useDefault, setUseDefault] = useState(true);
			const [template, setTemplate] = useState(() => buildProjectTemplate("", ""));
			const [busy, setBusy] = useState(false);
			const [error, setError] = useState(null);

			useEffect(() => {
				if (useDefault) setTemplate(buildProjectTemplate(name, description));
			}, [name, description, useDefault]);

			const submit = useCallback(async () => {
				if (name.trim() === "") {
					setError(new Error(t("createProject.name")));
					return;
				}
				setBusy(true);
				setError(null);
				try {
					const body = { name: name.trim(), description: description.trim() };
					if (folderName.trim() !== "") body.folderName = folderName.trim();
					if (!useDefault && template.trim() !== "") body.agentsMd = template;
					const data = await api("/projects", { method: "POST", body });
					onCreated(data.project);
				} catch (submitError) {
					setError(submitError);
				} finally {
					setBusy(false);
				}
			}, [name, description, folderName, useDefault, template, onCreated]);

			return h(
				Modal,
				{
					title: t("createProject.title"),
					onClose: busy ? () => undefined : onClose,
					footer: [
						h(Button, { key: "cancel", onClick: onClose, disabled: busy }, t("common.cancel")),
						h(Button, { key: "submit", kind: "primary", onClick: submit, disabled: busy }, busy ? t("common.creating") : t("createProject.submit")),
					],
				},
				h(
					"div",
					{ className: "pw-form" },
					error === null ? null : h(ErrorBanner, { error }),
					workbenchRoot === null
						? null
						: h(
								"div",
								{ className: "pw-info-line" },
								`${t("projects.workbenchRoot")}：`,
								h("code", { className: "pw-code" }, workbenchRoot),
							),
					h(Field, { label: t("createProject.name"), required: true }, h(TextInput, { value: name, onChange: setName, placeholder: t("createProject.namePh"), autoFocus: true })),
					h(Field, { label: t("createProject.desc") }, h(TextArea, { value: description, onChange: setDescription, placeholder: t("createProject.descPh"), rows: 3 })),
					h(Field, { label: t("createProject.folder"), hint: t("createProject.folderPh") }, h(TextInput, { value: folderName, onChange: setFolderName, placeholder: "my-project" })),
					h(
						"div",
						{ className: "pw-field" },
						h("label", null, t("createProject.template")),
						h(
							"label",
							{ className: "pw-check" },
							h("input", { type: "checkbox", checked: useDefault, onChange: (event) => setUseDefault(event.target.checked) }),
							t("createProject.useDefault"),
						),
						h("div", { className: "pw-hint" }, t("createProject.templateHint")),
						useDefault
							? null
							: h(TextArea, { value: template, onChange: setTemplate, rows: 10, mono: true }),
					),
				),
			);
		}

		/* ───────────────────────── 项目详情 ───────────────────────── */

		/** 已归档的会话先取消归档，否则 DSH 会拒绝打开或显示为空。 */
		async function ensureSessionOpenable(sessionId) {
			const uiWorkspace = rootClientCtx?.get?.("uiWorkspace");
			if (uiWorkspace === undefined || uiWorkspace === null) return;
			const archived = uiWorkspace.workspaces?.list?.getSnapshot?.()?.archivedSessionIds ?? [];
			if (Array.isArray(archived) && archived.includes(sessionId) && typeof uiWorkspace.unarchiveSession === "function") {
				await uiWorkspace.unarchiveSession(sessionId).catch(() => undefined);
			}
		}

		/** 解析/复用任务会话，必要时创建并绑定。返回是否更新了任务绑定。 */
		async function openTaskSessionFor(task, projectRoot) {
			const detail = await api(`/tasks/${encodeURIComponent(task.id)}`).catch(() => null);
			const taskDir = projectRoot === "" ? "" : `${projectRoot}/tasks/${task.id}`;
			const sessionRoot = taskDir === "" ? projectRoot : taskDir;
			const titleKey = String(task.title ?? "").trim();
			let sessionItems = [];
			try {
				const sessionsService = rootClientCtx?.get?.("sessions");
				const snapshot = sessionsService?.list?.getSnapshot?.() ?? sessionsService?.list?.();
				sessionItems = Array.isArray(snapshot?.items) ? snapshot.items : Object.values(snapshot?.byId ?? {});
			} catch {
				sessionItems = [];
			}
			const sessionRow = (item) => ({
				id: item?.sessionId ?? item?.id ?? null,
				title: String(item?.title ?? item?.name ?? ""),
				cwd: String(item?.cwd ?? ""),
				blank: item?.blank === true,
				archived: item?.archived === true,
				updatedAt: Number(item?.updatedAt ?? 0),
			});
			const relatedSessions = sessionItems
				.map(sessionRow)
				.filter((item) => typeof item.id === "string" && item.id !== "" && item.archived !== true)
				.filter((item) => (titleKey !== "" && item.title.includes(titleKey)) || (taskDir !== "" && item.cwd.startsWith(taskDir)))
				.sort((left, right) => right.updatedAt - left.updatedAt);
			let sessionId = detail?.task?.sessionId ?? task.sessionId ?? null;
			let sessionTitle = `${task.title} · 会话`;
			let sessionCwd = sessionRoot;
			let needsLink = false;

			if (typeof sessionId === "string" && sessionId !== "") {
				const current = sessionItems.map(sessionRow).find((item) => item.id === sessionId);
				if (current?.blank === true) {
					const replacement = relatedSessions.find((item) => item.id !== sessionId && item.blank !== true);
					if (replacement !== undefined) {
						sessionId = replacement.id;
						sessionTitle = replacement.title || sessionTitle;
						sessionCwd = replacement.cwd || sessionCwd;
						needsLink = true;
					}
				}
			}

			if (typeof sessionId !== "string" || sessionId === "") {
				const goalSessions = (detail?.goals ?? [])
					.flatMap((goal) => (goal.sessions ?? []).map((session) => ({ ...session, goalTitle: goal.title })))
					.filter((session) => typeof session.sessionId === "string" && session.sessionId !== "")
					.sort((left, right) => Date.parse(right.linkedAt ?? right.createdAt ?? 0) - Date.parse(left.linkedAt ?? left.createdAt ?? 0));
				if (goalSessions.length > 0) {
					sessionId = goalSessions[0].sessionId;
					sessionTitle = goalSessions[0].title || sessionTitle;
					sessionCwd = goalSessions[0].cwd || sessionCwd;
					needsLink = true;
				}
			}

			if (typeof sessionId !== "string" || sessionId === "") {
				if (relatedSessions.length > 0) {
					sessionId = relatedSessions[0].id;
					sessionTitle = relatedSessions[0].title || sessionTitle;
					sessionCwd = relatedSessions[0].cwd || sessionCwd;
					needsLink = true;
				}
			}

			if (typeof sessionId !== "string" || sessionId === "") {
				const created = await createDshSessionInWorkspace(sessionRoot, task.title);
				sessionId = created.sessionId;
				sessionCwd = created.cwd;
				needsLink = true;
			}

			if (needsLink) {
				await api(`/tasks/${encodeURIComponent(task.id)}/session`, {
					method: "POST",
					body: { sessionId, title: sessionTitle, cwd: sessionCwd },
				});
			}
			await ensureSessionOpenable(sessionId);
			if (!openDshSession(sessionId)) throw new Error("无法打开任务会话");
			openTaskContextTab(sessionId);
			return needsLink;
		}

		/** 从任意入口（首页/看板/项目任务行）按 taskId 进入任务会话。 */
		async function openTaskSessionById(taskId) {
			const detail = await api(`/tasks/${encodeURIComponent(taskId)}`);
			await openTaskSessionFor(detail.task, detail.project?.rootPath ?? "");
		}

		function ProjectView({ projectId, onBack, onHome }) {
			const [filter, setFilter] = useState("all");
			const [tab, setTab] = useState("list");
			const [state, setState] = useState({ loading: true, data: null, error: null });
			const [createOpen, setCreateOpen] = useState(false);
			const [notice, setNotice] = useState(null);
			const [busy, setBusy] = useState(false);
			const [tick, setTick] = useState(0);

			const load = useCallback(async () => {
				setState((previous) => ({ ...previous, loading: true, error: null }));
				try {
					const data = await api(`/projects/${encodeURIComponent(projectId)}?taskStatus=${encodeURIComponent(filter)}`);
					setState({ loading: false, data, error: null });
				} catch (error) {
					setState({ loading: false, data: null, error });
				}
			}, [projectId, filter, tick]);

			useEffect(() => {
				void load();
			}, [load]);

			const showNotice = useCallback((text, kind) => {
				setNotice({ text, kind });
				setTimeout(() => setNotice(null), 2600);
			}, []);

			const refresh = useCallback(() => setTick((value) => value + 1), []);

			const openTaskSession = useCallback(
				async (task) => {
					try {
						const projectRoot = state.data?.project?.rootPath ?? "";
						const linked = await openTaskSessionFor(task, projectRoot);
						if (linked) refresh();
					} catch (error) {
						showNotice(`${t("error.session")}：${errorText(error)}`, "warn");
					}
				},
				[state.data?.project?.rootPath, refresh, showNotice],
			);

			const project = state.data?.project ?? null;
			const tasks = state.data?.tasks ?? [];
			const stats = state.data?.stats ?? project?.stats ?? {};
			const instructions = state.data?.instructions ?? null;
			const archived = project?.status === "archived";
			const enableBoardView = state.data?.enableBoardView !== false;

			const archiveOrRestore = useCallback(async () => {
				if (project === null) return;
				const nextStatus = archived ? "active" : "archived";
				if (!archived && typeof window.confirm === "function" && !window.confirm(t("projects.archiveConfirm"))) return;
				setBusy(true);
				try {
					await api(`/projects/${encodeURIComponent(project.id)}`, { method: "PATCH", body: { status: nextStatus } });
					showNotice(archived ? t("toast.restored") : t("toast.archived"));
					refresh();
				} catch (error) {
					showNotice(errorText(error), "warn");
				} finally {
					setBusy(false);
				}
			}, [project, archived, refresh, showNotice]);

			const deleteProject = useCallback(async () => {
				if (project === null) return;
				if (typeof window.confirm === "function" && !window.confirm(t("projects.deleteConfirm"))) return;
				setBusy(true);
				try {
					await api(`/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
					onBack();
				} catch (error) {
					showNotice(errorText(error), "warn");
				} finally {
					setBusy(false);
				}
			}, [project, onBack, showNotice]);

			const taskFilters = [
				["all", t("project.filter.all")],
				["backlog", t("project.filter.backlog")],
				["running", t("project.filter.running")],
				["needs-you", t("project.filter.needs-you")],
				["done", t("project.filter.done")],
			];

			return h(
				"div",
				{ className: "pw-page" },
				h(
					"div",
					{ className: "pw-breadcrumb" },
					h("button", { type: "button", onClick: () => onHome?.() }, "🏠 工作台首页"),
					h("span", { className: "sep" }, "/"),
					h("button", { type: "button", onClick: onBack }, t("projects.title")),
					h("span", { className: "sep" }, "/"),
					h("span", null, project?.name ?? projectId),
				),
				notice === null ? null : h("div", { className: `pw-toast${notice.kind === "warn" ? " warn" : ""}` }, notice.text),
				state.error !== null ? h(ErrorBanner, { error: state.error, onRetry: load }) : null,
				state.data === null && state.loading
					? h(Spinner)
					: project === null
						? h(Empty, { big: t("error.load"), hint: t("common.retry"), action: h(Button, { onClick: load }, t("common.retry")) })
						: h(
								"div",
								null,
								h(
									"div",
									{ className: "pw-project-head" },
									h(
										"div",
										{ className: "pw-project-head-top" },
										h(
											"div",
											null,
											h("h2", null, project.name),
											archived ? h(Badge, { tone: "warn" }, t("projects.archivedBadge")) : null,
											h("div", { className: "desc" }, project.description === "" ? t("common.none") : project.description),
											state.data?.workbenchRoot
												? h(CopyChip, { text: state.data.workbenchRoot, label: `${t("projects.workbenchRoot")}：` })
												: null,
											h(CopyChip, { text: project.rootPath, label: `${t("project.folder")}：` }),
											instructions === null
												? null
												: h(CopyChip, {
														text: instructions.project.path,
														label: `${t("projects.agentsMd")}：`,
													}),
										),
										h(
											"div",
											{ className: "pw-actions" },
											h(Button, { disabled: busy, onClick: archiveOrRestore }, archived ? t("projects.restore") : t("projects.archive")),
											archived && (stats.total ?? 0) === 0 ? h(Button, { kind: "danger", disabled: busy, onClick: deleteProject }, t("projects.deleteEmpty")) : null,
										),
									),
									h(
										"div",
										{ className: "pw-stats", style: { marginTop: 12 } },
										h(Stat, { value: stats.backlog ?? 0, label: t("project.stats.backlog") }),
										h(Stat, { value: stats.running ?? 0, label: t("project.stats.running"), tone: "info" }),
										h(Stat, { value: stats.needsYou ?? 0, label: t("project.stats.needsYou"), tone: "warn" }),
										h(Stat, { value: stats.done ?? 0, label: t("project.stats.done"), tone: "success" }),
										h(Stat, { value: stats.blocked ?? 0, label: t("project.stats.blocked") }),
										h(Stat, { value: stats.unresolvedComments ?? 0, label: t("project.stats.unresolved") }),
										h(Stat, { value: stats.overdue ?? 0, label: t("project.stats.overdue") }),
									),
									archived ? h("div", { className: "pw-toast warn", style: { marginTop: 12, marginBottom: 0 } }, t("project.archivedReadonly")) : null,
								),
								h(
									"div",
									{ className: "pw-tabs" },
									h("button", { type: "button", className: `pw-tab${tab === "list" ? " active" : ""}`, onClick: () => setTab("list") }, t("project.list")),
									enableBoardView
										? h("button", { type: "button", className: `pw-tab${tab === "board" ? " active" : ""}`, onClick: () => setTab("board") }, t("project.board"))
										: null,
								),
								h(
									"div",
									{ className: "pw-toolbar" },
									tab === "list"
										? h(
												"div",
												{ className: "pw-seg" },
												taskFilters.map(([value, label]) =>
													h("button", { key: value, type: "button", className: filter === value ? "active" : "", onClick: () => setFilter(value) }, label),
												),
											)
										: h("span", { className: "pw-info-line" }, archived ? t("project.archivedReadonly") : t("board.dragHint")),
									h("span", { className: "pw-spacer" }),
									h(Button, { onClick: refresh, disabled: state.loading }, t("common.refresh")),
									archived ? null : h(Button, { kind: "primary", onClick: () => setCreateOpen(true) }, t("project.newTask")),
								),
								tab === "board" && enableBoardView
									? h(Board, { projectId, onOpenSession: openTaskSession, onChanged: refresh, readOnly: archived })
									: tasks.length === 0
										? h(Empty, { big: filter === "all" ? t("project.noTasks") : t("project.noTasksFiltered") })
										: h(
												"div",
												{ className: "pw-task-list" },
												tasks.map((task) => h(TaskRow, { key: task.id, task, onOpenSession: openTaskSession })),
											),
								createOpen
									? h(CreateTaskModal, {
											projectId,
											tasks: state.data?.tasks ?? [],
											onClose: () => setCreateOpen(false),
											onCreated: () => {
												setCreateOpen(false);
												showNotice(t("toast.taskCreated"));
												refresh();
											},
										})
									: null,
							),
			);
		}

		function TaskRow({ task, onOpenSession }) {
			const openSession = () => (typeof onOpenSession === "function" ? onOpenSession(task) : undefined);
			return h(
				"div",
				{
					className: "pw-task-row",
					role: "button",
					tabIndex: 0,
					onClick: openSession,
					onKeyDown: (event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							openSession();
						}
					},
				},
				h(
					"div",
					{ className: "pw-task-row-main" },
					h("div", { className: "pw-task-title", title: task.title }, task.title),
					h(
						"div",
						{ className: "pw-task-sub" },
						h(StatusBadge, { status: task.viewStatus }),
						h(PriorityBadge, { priority: task.priority }),
						task.dueAt === null ? null : h(Badge, { tone: isOverdue(task) ? "danger" : undefined }, `${fmtDate(task.dueAt)}${isOverdue(task) ? ` · ${t("time.overdue")}` : ""}`),
						task.childCount > 0 ? h(Badge, null, t("project.children", { n: task.childCount })) : null,
						task.commentCount > 0 ? h(Badge, null, t("project.comments", { n: task.commentCount })) : null,
					),
					task.needsYouReasons?.length > 0
						? h("div", { className: "pw-task-reasons" }, task.needsYouReasons.map(needsYouReasonText).join(" · "))
						: null,
				),
				h(
					"div",
					{ className: "pw-task-side" },
					h("span", { className: "pw-info-line" }, relativeTime(task.updatedAt)),
					h("span", { className: "pw-task-open-hint" }, "打开会话"),
				),
			);
		}

		function CreateTaskModal({ projectId, tasks, onClose, onCreated }) {
			const [title, setTitle] = useState("");
			const [description, setDescription] = useState("");
			const [goal, setGoal] = useState("");
			const [priority, setPriority] = useState("medium");
			const [dueAt, setDueAt] = useState("");
			const [parentId, setParentId] = useState("");
			const [addAgentsMd, setAddAgentsMd] = useState(false);
			const [agentsMd, setAgentsMd] = useState("");
			const [busy, setBusy] = useState(false);
			const [error, setError] = useState(null);

			const parentOptions = useMemo(() => {
				const options = [{ value: "", label: t("createTask.parentNone") }];
				for (const task of tasks) options.push({ value: task.id, label: task.title });
				return options;
			}, [tasks]);

			const submit = useCallback(async () => {
				if (title.trim() === "") {
					setError(new Error(t("createTask.titleField")));
					return;
				}
				setBusy(true);
				setError(null);
				try {
					const body = { title: title.trim(), description: description.trim(), goal: goal.trim(), priority };
					if (dueAt !== "") body.dueAt = fromLocalInput(dueAt);
					if (parentId !== "") body.parentId = parentId;
					if (addAgentsMd && agentsMd.trim() !== "") body.agentsMd = agentsMd;
					await api(`/projects/${encodeURIComponent(projectId)}/tasks`, { method: "POST", body });
					onCreated();
				} catch (submitError) {
					setError(submitError);
				} finally {
					setBusy(false);
				}
			}, [title, description, priority, dueAt, parentId, addAgentsMd, agentsMd, projectId, onCreated]);

			return h(
				Modal,
				{
					title: t("createTask.title"),
					onClose: busy ? () => undefined : onClose,
					footer: [
						h(Button, { key: "cancel", onClick: onClose, disabled: busy }, t("common.cancel")),
						h(Button, { key: "submit", kind: "primary", onClick: submit, disabled: busy }, busy ? t("common.creating") : t("createTask.submit")),
					],
				},
				h(
					"div",
					{ className: "pw-form" },
					error === null ? null : h(ErrorBanner, { error }),
					h(Field, { label: t("createTask.titleField"), required: true }, h(TextInput, { value: title, onChange: setTitle, placeholder: t("createTask.titlePh"), autoFocus: true })),
					h(Field, { label: t("task.goal") }, h(TextArea, { value: goal, onChange: setGoal, placeholder: t("task.goalPh"), rows: 2 })),
					h(Field, { label: t("createTask.desc") }, h(TextArea, { value: description, onChange: setDescription, placeholder: t("createTask.descPh"), rows: 3 })),
					h(
						"div",
						{ style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } },
						h(
							Field,
							{ label: t("createTask.priority") },
							h(Select, {
								value: priority,
								onChange: setPriority,
								options: ["low", "medium", "high", "urgent"].map((value) => ({ value, label: priorityLabel(value) })),
							}),
						),
						h(Field, { label: t("createTask.due") }, h("input", { className: "pw-input", type: "datetime-local", value: dueAt, onChange: (event) => setDueAt(event.target.value) })),
					),
					h(Field, { label: t("createTask.parent") }, h(Select, { value: parentId, onChange: setParentId, options: parentOptions })),
					h(
						"div",
						{ className: "pw-field" },
						h(
							"label",
							{ className: "pw-check" },
							h("input", { type: "checkbox", checked: addAgentsMd, onChange: (event) => setAddAgentsMd(event.target.checked) }),
							t("createTask.addAgentsMd"),
						),
						h("div", { className: "pw-hint" }, t("createTask.agentsMdHint")),
						addAgentsMd ? h(TextArea, { value: agentsMd, onChange: setAgentsMd, rows: 7, mono: true, placeholder: "# 任务级增量指令\n\n- 只改 docs/ch3.md" }) : null,
					),
				),
			);
		}

		/* ───────────────────────── 看板 ───────────────────────── */

		const BOARD_COLUMNS = ["backlog", "running", "needs-you", "done"];

		function Board({ projectId, onOpenSession, onChanged, readOnly }) {
			const [state, setState] = useState({ loading: true, data: null, error: null });
			const [dragging, setDragging] = useState(null);
			const [over, setOver] = useState(null);
			const [notice, setNotice] = useState(null);

			const load = useCallback(async () => {
				setState((previous) => ({ ...previous, loading: true, error: null }));
				try {
					const data = await api(`/projects/${encodeURIComponent(projectId)}/board`);
					setState({ loading: false, data, error: null });
				} catch (error) {
					setState({ loading: false, data: null, error });
				}
			}, [projectId]);

			useEffect(() => {
				void load();
			}, [load]);

			const showNotice = useCallback((text, kind) => {
				setNotice({ text, kind });
				setTimeout(() => setNotice(null), 2600);
			}, []);

			const move = useCallback(
				async (taskId, status) => {
					if (taskId === null || taskId === undefined) return;
					try {
						await api(`/tasks/${encodeURIComponent(taskId)}/move`, { method: "POST", body: { status } });
						await load();
						if (typeof onChanged === "function") onChanged();
					} catch (error) {
						showNotice(`${t("board.moveFailed")}：${errorText(error)}`, "warn");
						await load();
					}
				},
				[load, onChanged, showNotice],
			);

			const columns = state.data?.columns ?? [];

			return h(
				"div",
				null,
				notice === null ? null : h("div", { className: `pw-toast${notice.kind === "warn" ? " warn" : ""}` }, notice.text),
				state.error !== null ? h(ErrorBanner, { error: state.error, onRetry: load }) : null,
				state.loading && state.data === null
					? h(Spinner)
					: h(
							"div",
							{ className: "pw-board" },
							columns.map((column) => {
								const locked = column.droppable === false;
								const cards = column.tasks ?? [];
								return h(
									"div",
									{
										key: column.key,
										className: `pw-col ${column.key}${locked ? " locked" : ""}${over === column.key && !locked ? " drag-over" : ""}`,
										onDragOver: locked || readOnly === true
											? undefined
											: (event) => {
													event.preventDefault();
													if (event.dataTransfer !== undefined && event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
													setOver(column.key);
												},
										onDragLeave: locked || readOnly === true ? undefined : () => setOver((value) => (value === column.key ? null : value)),
										onDrop: locked || readOnly === true
											? undefined
											: (event) => {
													event.preventDefault();
													setOver(null);
													const taskId = dragging ?? event.dataTransfer?.getData("text/plain");
													setDragging(null);
													void move(taskId, column.key);
												},
									},
									h(
										"div",
										{ className: "pw-col-head", title: locked ? t("board.needsYouLocked") : undefined },
										h("span", { className: "dot" }),
										h("span", null, t(`board.${column.key}`)),
										locked ? h("span", { style: { fontSize: 10.5, color: "var(--pw-dim)" } }, "🔒") : null,
										h("span", { className: "count" }, cards.length),
									),
									h(
										"div",
										{ className: "pw-col-body" },
										cards.length === 0
											? h("div", { className: "pw-col-empty" }, t("board.empty"))
											: cards.map((task) =>
													h(
														"div",
														{
															key: task.id,
															className: `pw-kanban-card${dragging === task.id ? " dragging" : ""}`,
															draggable: readOnly !== true,
															onDragStart: (event) => {
																if (readOnly === true) return;
																setDragging(task.id);
																try {
																	event.dataTransfer.effectAllowed = "move";
																	event.dataTransfer.setData("text/plain", task.id);
																} catch {
																	/* ignore */
																}
															},
															onDragEnd: () => {
																setDragging(null);
																setOver(null);
															},
															onClick: () => onOpenSession?.(task),
														},
														h("div", { className: "title" }, task.title),
														h(
															"div",
															{ className: "meta" },
															h(PriorityBadge, { priority: task.priority }),
															task.dueAt === null ? null : h("span", { style: { color: isOverdue(task) ? "var(--pw-red)" : undefined } }, fmtDate(task.dueAt)),
															task.childCount > 0 ? h("span", null, `↳ ${task.childCount}`) : null,
															task.commentCount > 0 ? h("span", null, `💬 ${task.commentCount}`) : null,
														),
														task.needsYouReasons?.length > 0
															? h("div", { className: "pw-task-reasons" }, task.needsYouReasons.map(needsYouReasonText).join(" · "))
															: null,
													),
												),
									),
								);
							}),
						),
			);
		}

		/* ───────────────────────── 任务详情 ───────────────────────── */

		function InstructionsCard({ instructions, hasTaskLayer }) {
			if (instructions === null || instructions === undefined) return null;
			const taskLayer = instructions.task ?? null;
			return h(
				"section",
				{ className: "pw-card" },
				h("h3", null, t("instructions.title")),
				h("p", { className: "pw-hint" }, t("instructions.hint")),
				instructions.taskDir
					? h(
							"div",
							{ className: "pw-info-line" },
							`${t("task.taskDir")}：`,
							h("code", { className: "pw-code" }, instructions.taskDir),
						)
					: null,
				h(
					"div",
					{ className: "pw-layer" },
					h(Badge, { tone: "info" }, t("instructions.projectLayer")),
					h("code", { className: "pw-mono" }, instructions.project.path),
					instructions.project.exists ? h("span", { className: "ok" }, t("instructions.exists")) : h("span", { className: "miss" }, t("instructions.missing")),
				),
				taskLayer === null
					? h(
							"div",
							{ className: "pw-layer" },
							h(Badge, null, t("instructions.taskLayer")),
							h("span", { className: "miss" }, t("instructions.noTaskLayer")),
						)
					: h(
							"div",
							{ className: "pw-layer" },
							h(Badge, { tone: "warn" }, t("instructions.taskLayer")),
							h("code", { className: "pw-mono" }, taskLayer.path),
							h("span", { className: "ok" }, t("instructions.exists")),
						),
				h("div", { className: "pw-info-line" }, `${t("instructions.loader")}：`, h("code", { className: "pw-code" }, instructions.loader)),
			);
		}

		function CommentItem({ comment, busy, onResolve, onReopen }) {
			return h(
				"div",
				{ className: `pw-comment${comment.resolved ? " resolved" : ""}` },
				h(
					"div",
					{ className: "pw-comment-head" },
					h("b", { style: { color: "var(--pw-fg)" } }, comment.author),
					h("span", null, fmtDateTime(comment.createdAt)),
					comment.resolved ? h(Badge, { tone: "success" }, t("task.resolved")) : h(Badge, { tone: "warn" }, t("task.unresolved")),
					comment.resolved && comment.resolvedAt ? h("span", null, fmtDateTime(comment.resolvedAt)) : null,
					h("span", { className: "pw-spacer" }),
					comment.resolved
						? h("button", { type: "button", className: "pw-btn small", disabled: busy, onClick: onReopen }, t("task.reopen"))
						: h("button", { type: "button", className: "pw-btn small primary", disabled: busy, onClick: onResolve }, t("task.resolve")),
				),
				h("div", { className: "pw-comment-body" }, comment.body),
			);
		}

		function ActivityTimeline({ activity }) {
			if (!Array.isArray(activity) || activity.length === 0) return h("div", { className: "pw-hint" }, t("task.noActivity"));
			return h(
				"div",
				{ className: "pw-timeline" },
				activity
					.slice()
					.reverse()
					.map((entry) =>
						h(
							"div",
							{ key: entry.id, className: `pw-timeline-item ${entry.kind.startsWith("comment") ? "comment" : entry.kind === "task.status" ? "status" : ""}` },
							h("span", { className: "pw-timeline-dot" }),
							h(
								"div",
								{ className: "pw-timeline-body" },
								h("b", null, activityKindLabel(entry.kind)),
								h("span", null, ` ${entry.detail}`),
								h("span", { className: "pw-timeline-time" }, `${entry.actor} · ${fmtDateTime(entry.at)}`),
							),
						),
					),
			);
		}

		function GoalModal({ taskId, goal, onClose, onSaved }) {
			const [title, setTitle] = useState(goal?.title ?? "");
			const [description, setDescription] = useState(goal?.description ?? "");
			const [status, setStatus] = useState(goal?.status ?? "open");
			const [busy, setBusy] = useState(false);
			const [error, setError] = useState(null);
			const submit = useCallback(async () => {
				if (title.trim() === "") {
					setError(new Error(t("goals.createTitle")));
					return;
				}
				setBusy(true);
				setError(null);
				try {
					if (goal === null || goal === undefined) {
						await api(`/tasks/${encodeURIComponent(taskId)}/goals`, { method: "POST", body: { title: title.trim(), description: description.trim(), status } });
					} else {
						await api(`/goals/${encodeURIComponent(goal.id)}`, { method: "PATCH", body: { title: title.trim(), description: description.trim(), status } });
					}
					onSaved();
				} catch (submitError) {
					setError(submitError);
				} finally {
					setBusy(false);
				}
			}, [taskId, goal, title, description, status, onSaved]);
			return h(
				Modal,
				{
					title: goal === null || goal === undefined ? t("goals.createTitle") : t("goals.editTitle"),
					onClose: busy ? () => undefined : onClose,
					footer: [
						h(Button, { key: "cancel", onClick: onClose, disabled: busy }, t("common.cancel")),
						h(Button, { key: "save", kind: "primary", onClick: submit, disabled: busy }, busy ? t("common.saving") : t("common.save")),
					],
				},
				h(
					"div",
					{ className: "pw-form" },
					error === null ? null : h(ErrorBanner, { error }),
					h(Field, { label: t("goals.title"), required: true }, h(TextInput, { value: title, onChange: setTitle, autoFocus: true })),
					h(Field, { label: t("task.description") }, h(TextArea, { value: description, onChange: setDescription, placeholder: t("goals.descriptionPh"), rows: 4 })),
					h(
						Field,
						{ label: t("task.status") },
						h(Select, {
							value: status,
							onChange: setStatus,
							options: ["open", "doing", "done"].map((value) => ({ value, label: t(`goals.status.${value}`) })),
						}),
					),
				),
			);
		}

		function SessionPicker({ goal, onClose, onPick, onCreate, busy }) {
			const [query, setQuery] = useState("");
			const sessions = useMemo(() => dshSessionList(), []);
			const filtered = useMemo(() => {
				const needle = query.trim().toLowerCase();
				const list = needle === "" ? sessions : sessions.filter((session) => `${session.title} ${session.cwd}`.toLowerCase().includes(needle));
				return list.slice(0, 100);
			}, [sessions, query]);
			return h(
				Modal,
				{
					title: t("sessionPicker.title"),
					onClose: busy ? () => undefined : onClose,
					footer: [
						h(Button, { key: "cancel", onClick: onClose, disabled: busy }, t("common.cancel")),
						h(Button, { key: "create", onClick: onCreate, disabled: busy }, busy ? t("common.saving") : t("sessionPicker.create")),
					],
				},
				h(
					"div",
					{ className: "pw-form" },
					h("p", { className: "pw-hint" }, t("sessionPicker.newHint")),
					h("div", { className: "pw-info-line" }, `${t("goals.dir")}：`, h("code", { className: "pw-code" }, goal?.dir ?? "")),
					h(TextInput, { value: query, onChange: setQuery, placeholder: t("sessionPicker.search") }),
					h(
						"div",
						{ className: "pw-session-list" },
						filtered.length === 0
							? h("div", { className: "pw-hint" }, t("sessionPicker.empty"))
							: filtered.map((session) =>
									h(
										"div",
										{
											key: session.sessionId,
											className: "pw-session-pick",
											onClick: () => (busy ? undefined : onPick(session)),
										},
										h(
											"div",
											{ className: "name" },
											h("b", null, session.title || session.sessionId),
											h("span", null, session.cwd || "—"),
										),
										h(Badge, null, session.status ?? "unknown"),
										h(Button, { small: true, kind: "primary", disabled: busy, onClick: () => onPick(session) }, t("sessionPicker.link")),
									),
								),
					),
				),
			);
		}

		function ArtifactRow({ artifact, busy, onDelete }) {
			return h(
				"div",
				{ className: "pw-artifact-row" },
				h("span", { className: "name", title: artifact.path }, artifact.name),
				h("span", { className: "meta" }, fmtSize(artifact.size)),
				h("a", { className: "pw-btn small", href: artifact.downloadPath, target: "_blank", rel: "noreferrer" }, t("goals.openArtifact")),
				h("button", { type: "button", className: "pw-btn small danger", disabled: busy, onClick: onDelete }, t("goals.deleteArtifact")),
			);
		}

		function GoalCard({ goal, readOnly, onEdit, onDelete, onLinkSession, onNewSession, onOpenSession, onUnlinkSession, onUpload, onSync, onDeleteArtifact }) {
			const inputRef = useRef(null);
			const outputRef = useRef(null);
			const [uploading, setUploading] = useState(null);
			const [busy, setBusy] = useState(false);
			const [notice, setNotice] = useState(null);
			const inputs = (goal.artifacts ?? []).filter((artifact) => artifact.kind === "input");
			const outputs = (goal.artifacts ?? []).filter((artifact) => artifact.kind === "output");
			const showNotice = (text, kind) => {
				setNotice({ text, kind });
				setTimeout(() => setNotice(null), 2600);
			};
			const doUpload = async (kind, file) => {
				if (file === null || file === undefined) return;
				setUploading(kind);
				try {
					await onUpload(goal, kind, file);
					showNotice(t("toast.saved"));
				} catch (error) {
					showNotice(`${t("error.artifact")}：${errorText(error)}`, "warn");
				} finally {
					setUploading(null);
					if (inputRef.current !== null) inputRef.current.value = "";
					if (outputRef.current !== null) outputRef.current.value = "";
				}
			};
			const artifactColumn = (kind, items, ref) =>
				h(
					"div",
					{ className: "pw-artifact-col" },
					h(
						"h4",
						null,
						kind === "input" ? t("goals.inputs") : t("goals.outputs"),
						h(
							"span",
							null,
							h(
								"button",
								{
									type: "button",
									className: "pw-btn small",
									disabled: readOnly || uploading !== null,
									onClick: () => (ref.current === null ? undefined : ref.current.click()),
								},
								uploading === kind ? t("goals.uploading") : t("goals.upload"),
							),
							h("input", {
								ref,
								className: "pw-file-input",
								type: "file",
								onChange: (event) => void doUpload(kind, event.target.files?.[0]),
							}),
						),
					),
					items.length === 0
						? h("div", { className: "pw-hint", style: { margin: 0 } }, t("goals.noArtifacts"))
						: items.map((artifact) =>
								h(ArtifactRow, {
									key: artifact.id,
									artifact,
									busy,
									onDelete: async () => {
										if (typeof window.confirm === "function" && !window.confirm(t("goals.deleteArtifactConfirm"))) return;
										setBusy(true);
										try {
											await onDeleteArtifact(goal, artifact);
											showNotice(t("toast.deleted"));
										} catch (error) {
											showNotice(`${t("error.artifact")}：${errorText(error)}`, "warn");
										} finally {
											setBusy(false);
										}
									},
								}),
							),
				);
			return h(
				"section",
				{ className: "pw-card pw-goal" },
				h(
					"div",
					{ className: "pw-goal-head" },
					h(
						"h3",
						null,
						goal.title,
						h(Badge, { tone: goal.status === "done" ? "success" : goal.status === "doing" ? "info" : undefined }, t(`goals.status.${goal.status}`)),
						h(Badge, null, `${goal.sessionCount ?? 0} ${t("goals.sessions")}`),
						h(Badge, null, `${goal.artifactCount ?? 0} ${t("goals.artifacts")}`),
					),
					readOnly
						? null
						: h(
								"div",
								{ className: "pw-actions" },
								h(Button, { small: true, onClick: () => onEdit(goal) }, t("goals.edit")),
								h(Button, { small: true, kind: "danger", onClick: () => onDelete(goal) }, t("goals.delete")),
							),
				),
				goal.description === "" ? null : h("div", { className: "pw-hint", style: { whiteSpace: "pre-wrap" } }, goal.description),
				h(CopyChip, { text: goal.dir, label: `${t("goals.dir")}：` }),
				h(
					"div",
					{ className: "pw-goal-section" },
					h(
						"div",
						{ className: "pw-goal-section-head" },
						h("span", null, t("goals.sessions")),
						readOnly
							? null
							: h(
									"span",
									{ className: "pw-actions" },
									h(Button, { small: true, onClick: () => onLinkSession(goal) }, t("goals.linkSession")),
									h(Button, { small: true, kind: "primary", onClick: () => onNewSession(goal) }, t("goals.newSession")),
								),
					),
					(goal.sessions ?? []).length === 0
						? h("div", { className: "pw-hint", style: { margin: 0 } }, t("goals.noSessions"))
						: (goal.sessions ?? []).map((session) =>
								h(
									"div",
									{ key: session.id, className: "pw-session-row" },
									h("span", { className: "name", title: session.sessionId }, session.title || session.sessionId),
									h("span", { className: "cwd", title: session.cwd }, session.cwd || "—"),
									h(Badge, null, session.status ?? "unknown"),
									h("button", { type: "button", className: "pw-btn small", onClick: () => onOpenSession(session.sessionId) }, t("goals.openSession")),
									readOnly
										? null
										: h("button", { type: "button", className: "pw-btn small danger", onClick: () => onUnlinkSession(goal, session) }, t("goals.unlink")),
								),
							),
				),
				h(
					"div",
					{ className: "pw-goal-section" },
					h(
						"div",
						{ className: "pw-goal-section-head" },
						h("span", null, t("goals.artifacts")),
						readOnly
							? null
							: h(Button, { small: true, onClick: () => onSync(goal) }, t("goals.sync")),
					),
					h(
						"div",
						{ className: "pw-artifact-grid" },
						artifactColumn("input", inputs, inputRef),
						artifactColumn("output", outputs, outputRef),
					),
				),
				notice === null ? null : h("div", { className: `pw-toast${notice.kind === "warn" ? " warn" : ""}` }, notice.text),
			);
		}

		function TaskArtifactsCard({ artifacts, readOnly, onUpload, onSync, onDelete }) {
			const inputRef = useRef(null);
			const outputRef = useRef(null);
			const [uploading, setUploading] = useState(null);
			const [busy, setBusy] = useState(false);
			const [notice, setNotice] = useState(null);
			const inputs = (artifacts ?? []).filter((artifact) => artifact.kind === "input");
			const outputs = (artifacts ?? []).filter((artifact) => artifact.kind === "output");
			const showNotice = (text, kind) => {
				setNotice({ text, kind });
				setTimeout(() => setNotice(null), 2600);
			};
			const doUpload = async (kind, file) => {
				if (file === null || file === undefined) return;
				setUploading(kind);
				try {
					await onUpload(kind, file);
					showNotice(t("task.artifacts.uploaded"));
				} catch (error) {
					showNotice(`${t("error.artifact")}：${errorText(error)}`, "warn");
				} finally {
					setUploading(null);
					if (inputRef.current !== null) inputRef.current.value = "";
					if (outputRef.current !== null) outputRef.current.value = "";
				}
			};
			const column = (kind, items, ref) =>
				h(
					"div",
					{ className: "pw-artifact-col" },
					h(
						"h4",
						null,
						kind === "input" ? t("task.artifacts.inputs") : t("task.artifacts.outputs"),
						h(
							"span",
							null,
							h(
								"button",
								{
									type: "button",
									className: "pw-btn small",
									disabled: readOnly || uploading !== null,
									onClick: () => (ref.current === null ? undefined : ref.current.click()),
								},
								uploading === kind ? t("task.artifacts.uploading") : t("task.artifacts.upload"),
							),
							h("input", { ref, className: "pw-file-input", type: "file", onChange: (event) => void doUpload(kind, event.target.files?.[0]) }),
						),
					),
					items.length === 0
						? h("div", { className: "pw-hint", style: { margin: 0 } }, t("task.artifacts.none"))
						: items.map((artifact) =>
								h(ArtifactRow, {
									key: artifact.id,
									artifact,
									busy,
									onDelete: async () => {
										if (typeof window.confirm === "function" && !window.confirm(t("task.artifacts.deleteConfirm"))) return;
										setBusy(true);
										try {
											await onDelete(artifact);
											showNotice(t("toast.deleted"));
										} catch (error) {
											showNotice(`${t("error.artifact")}：${errorText(error)}`, "warn");
										} finally {
											setBusy(false);
										}
									},
								}),
							),
				);
			return h(
				"section",
				{ className: "pw-card" },
				h(
					"div",
					{ className: "pw-goal-head" },
					h("h3", null, t("task.artifacts.title")),
					readOnly ? null : h(Button, { small: true, onClick: onSync }, t("task.artifacts.sync")),
				),
				h(
					"div",
					{ className: "pw-artifact-grid" },
					column("input", inputs, inputRef),
					column("output", outputs, outputRef),
				),
				notice === null ? null : h("div", { className: `pw-toast${notice.kind === "warn" ? " warn" : ""}` }, notice.text),
			);
		}

		function TaskBackButton(props) {
			const sessionId = props?.sessionId;
			const [context, setContext] = useState(null);
			useEffect(() => {
				let cancelled = false;
				if (typeof sessionId !== "string" || sessionId === "") return undefined;
				api(`/context-by-session/${encodeURIComponent(sessionId)}`)
					.then((data) => {
						if (!cancelled && data?.task !== null && data?.task !== undefined) setContext(data);
					})
					.catch(() => undefined);
				return () => {
					cancelled = true;
				};
			}, [sessionId]);
			if (context === null) return null;
			return h(
				"button",
				{
					type: "button",
					className: "pw-session-back",
					title: "返回工作台",
					onClick: () => navigateWorkbench({ name: "dashboard" }),
				},
				"← 工作台",
			);
		}

		function SideCollapsibleSection({ icon, title, extra, defaultOpen = true, children }) {
			const [open, setOpen] = useState(defaultOpen);
			return h(
				"section",
				{ className: `pw-side-card${open ? " open" : " closed"}` },
				h(
					"button",
					{
						type: "button",
						className: "pw-side-card-head",
						"aria-expanded": open,
						onClick: () => setOpen((value) => !value),
					},
					h("span", { className: "ico" }, icon),
					h("h4", null, title),
					extra === undefined || extra === null ? null : h("span", { className: "extra" }, extra),
					h("span", { className: "chev", "aria-hidden": "true" }, "›"),
				),
				open ? h("div", { className: "pw-side-card-body" }, children) : null,
			);
		}

		function TaskSessionPicker({ task, project, currentSessionId, onClose, onApply }) {
			const [search, setSearch] = useState("");
			const [sessions, setSessions] = useState(null);
			const [busy, setBusy] = useState(null);
			const [error, setError] = useState(null);
			useEffect(() => {
				let cancelled = false;
				try {
					const uiWorkspace = rootClientCtx?.get?.("uiWorkspace");
					const sessionService = rootClientCtx?.get?.("sessions");
					const workspaceItems = uiWorkspace?.workspaces?.list?.getSnapshot?.()?.items ?? [];
					const snapshot = sessionService?.list?.getSnapshot?.() ?? sessionService?.list?.();
					const rawItems = Array.isArray(snapshot?.items) ? snapshot.items : Object.values(snapshot?.byId ?? {});
					const projectName = String(project?.name ?? "");
					const projectRoot = String(project?.rootPath ?? "");
					const taskTitle = String(task?.title ?? "");
					const tokens = projectName.split(/[\s\-_/]+/).filter((token) => token.length >= 2);
					const rows = rawItems
						.map((item) => {
							const id = item?.sessionId ?? item?.id;
							const cwd = String(item?.cwd ?? "");
							const workspace = workspaceItems.find((entry) => Array.isArray(entry.sessionIds) && entry.sessionIds.includes(id));
							const title = String(item?.title ?? "");
							const workspaceLabel = String(workspace?.title ?? workspace?.path ?? "");
							let score = 0;
							if (taskTitle !== "" && title.includes(taskTitle)) score += 100;
							if (projectRoot !== "" && cwd.startsWith(projectRoot)) score += 80;
							for (const token of tokens) {
								if (title.includes(token) || cwd.includes(token) || workspaceLabel.includes(token)) score += 30;
							}
							return { id, title, cwd, workspaceLabel, updatedAt: Number(item?.updatedAt ?? 0), score, blank: item?.blank === true };
						})
						.filter((item) => typeof item.id === "string" && item.id !== "")
						.sort((left, right) => right.score - left.score || right.updatedAt - left.updatedAt);
					if (!cancelled) setSessions(rows);
				} catch (reason) {
					if (!cancelled) setError(reason);
				}
				return () => {
					cancelled = true;
				};
			}, [project?.name, project?.rootPath, task?.title]);
			const keyword = search.trim().toLowerCase();
			const visible = (sessions ?? []).filter((item) => keyword === "" || `${item.title} ${item.cwd} ${item.workspaceLabel}`.toLowerCase().includes(keyword));
			const choose = async (session) => {
				setBusy(session.id);
				try {
					await onApply(session);
				} catch (reason) {
					setError(reason);
				} finally {
					setBusy(null);
				}
			};
			return h(
				Modal,
				{
					title: "选择历史会话",
					onClose,
					footer: h(Button, { onClick: onClose }, t("common.close")),
				},
				h("div", { className: "pw-form" },
					h("div", { className: "pw-hint", style: { marginTop: 0 } }, "选择一个已有会话绑定到当前任务；绑定后会直接打开该会话。"),
					h(TextInput, { value: search, onChange: setSearch, placeholder: "搜索会话标题、目录或工作区", autoFocus: true }),
					error === null ? null : h(ErrorBanner, { error }),
					sessions === null
						? h(Spinner)
						: visible.length === 0
							? h("div", { className: "pw-hint" }, "没有找到会话。")
							: h(
									"div",
									{ className: "pw-session-picker-list" },
									visible.slice(0, 120).map((session) =>
										h(
											"button",
											{
												key: session.id,
												type: "button",
												className: `pw-session-picker-row${session.id === currentSessionId ? " current" : ""}`,
												disabled: busy !== null,
												onClick: () => void choose(session),
											},
											h("span", { className: "title" }, session.title === "" ? "未命名会话" : session.title, session.score > 0 ? h("span", { className: "pw-badge info" }, "推荐") : null),
											h("span", { className: "meta" }, `${session.workspaceLabel === "" ? "未分组" : session.workspaceLabel}${session.cwd === "" ? "" : ` · ${session.cwd}`}`),
											h("span", { className: "time" }, busy === session.id ? "绑定中…" : relativeTime(session.updatedAt)),
										),
									),
								),
				),
			);
		}

		function TaskSidePanel(props) {
			const sessionId = props?.sessionId ?? props?.useTabInfo?.()?.sessionId;
			const [state, setState] = useState({ loading: true, data: null, error: null });
			const [pickerOpen, setPickerOpen] = useState(false);
			const [goalDraft, setGoalDraft] = useState("");
			const [descDraft, setDescDraft] = useState("");
			const [savingSide, setSavingSide] = useState(false);
			const [uploadKind, setUploadKind] = useState(null);
			const [sideError, setSideError] = useState(null);
			const goalInputRef = useRef(null);
			const outputInputRef = useRef(null);
			const load = useCallback(async () => {
				if (typeof sessionId !== "string" || sessionId === "") {
					setState({ loading: false, data: null, error: null });
					return;
				}
				setState((previous) => ({ ...previous, loading: true, error: null }));
				try {
					const data = await api(`/context-by-session/${encodeURIComponent(sessionId)}`);
					setState({ loading: false, data, error: null });
				} catch (error) {
					setState({ loading: false, data: null, error });
				}
			}, [sessionId]);
			useEffect(() => {
				void load();
			}, [load]);
			useEffect(() => {
				const current = state.data?.task;
				if (current !== undefined && current !== null) {
					setGoalDraft(current.goal ?? "");
					setDescDraft(current.description ?? "");
				}
			}, [state.data?.task?.id, state.data?.task?.updatedAt]);
			if (state.loading) return h("div", { className: "pw-side" }, h(Spinner));
			if (state.error !== null) return h("div", { className: "pw-side" }, h(ErrorBanner, { error: state.error, onRetry: load }));
			const task = state.data?.task;
			if (task === null || task === undefined) {
				return h("div", { className: "pw-side" }, h("div", { className: "pw-hint" }, "当前会话还没有绑定工作台任务。"));
			}
			const artifacts = state.data.artifacts ?? [];
			const sessionCwd = state.data.session?.cwd ?? state.data.project?.rootPath ?? "";
			const patchTask = async (patch) => {
				setSavingSide(true);
				setSideError(null);
				try {
					await api(`/tasks/${encodeURIComponent(task.id)}`, { method: "PATCH", body: patch });
					await load();
				} catch (reason) {
					setSideError(reason);
				} finally {
					setSavingSide(false);
				}
			};
			const uploadArtifact = async (kind, file) => {
				if (file === null || file === undefined) return;
				setUploadKind(kind);
				setSideError(null);
				try {
					const url = `${API}/tasks/${encodeURIComponent(task.id)}/artifacts/upload?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(file.name)}`;
					const response = await fetch(url, { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
					const payload = await response.json().catch(() => null);
					if (payload === null || payload.ok !== true) throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
					await load();
				} catch (reason) {
					setSideError(reason);
				} finally {
					setUploadKind(null);
					if (goalInputRef.current !== null) goalInputRef.current.value = "";
					if (outputInputRef.current !== null) outputInputRef.current.value = "";
				}
			};
			const syncArtifacts = async () => {
				setSavingSide(true);
				setSideError(null);
				try {
					await api(`/tasks/${encodeURIComponent(task.id)}/artifacts/sync`, { method: "POST" });
					await load();
				} catch (reason) {
					setSideError(reason);
				} finally {
					setSavingSide(false);
				}
			};
			const removeArtifact = async (artifact) => {
				if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(`删除成果「${artifact.name}」？`)) return;
				setSavingSide(true);
				setSideError(null);
				try {
					await api(`/tasks/${encodeURIComponent(task.id)}/artifacts/${encodeURIComponent(artifact.id)}?deleteFile=1`, { method: "DELETE" });
					await load();
				} catch (reason) {
					setSideError(reason);
				} finally {
					setSavingSide(false);
				}
			};
			const applySession = async (session) => {
				await api(`/tasks/${encodeURIComponent(task.id)}/session`, {
					method: "POST",
					body: { sessionId: session.id, title: session.title || `${task.title} · 会话`, cwd: session.cwd || sessionCwd },
				});
				setPickerOpen(false);
				await load();
				await ensureSessionOpenable(session.id);
				if (openDshSession(session.id)) openTaskContextTab(session.id);
			};
			const sideArtifactRow = (artifact) =>
				h(
					"div",
					{
						key: artifact.id,
						className: "pw-side-artifact",
						role: "button",
						tabIndex: 0,
						title: artifact.path,
						onClick: () => {
							if (typeof sessionId === "string") openArtifactInSidebar(sessionId, sessionCwd, artifact);
						},
						onKeyDown: (event) => {
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								if (typeof sessionId === "string") openArtifactInSidebar(sessionId, sessionCwd, artifact);
							}
						},
					},
					h("span", { className: "ico" }, artifactIcon(artifact.name)),
					h("span", { className: "name", title: artifact.name }, artifact.name),
					h("span", { className: "size" }, fmtSize(artifact.size)),
					h("span", { className: "open-hint" }, "打开"),
					h("button", { type: "button", className: "pw-side-artifact-del", title: "删除成果", onClick: (event) => { event.stopPropagation(); void removeArtifact(artifact); } }, "×"),
				);
			const inputs = artifacts.filter((artifact) => artifact.kind === "input");
			const outputs = artifacts.filter((artifact) => artifact.kind === "output");
			const activity = state.data.activity ?? [];
			const progress = task.viewStatus === "done" ? 100 : task.viewStatus === "running" ? 62 : task.viewStatus === "needs-you" ? 34 : 12;
			const circumference = 2 * Math.PI * 15;
			const totalArtifacts = inputs.length + outputs.length;
			const inputPercent = totalArtifacts === 0 ? 0 : Math.round((inputs.length / totalArtifacts) * 100);
			const now = new Date();
			const days = Array.from({ length: 7 }, (_, index) => {
				const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - index));
				const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
				const count = activity.filter((entry) => {
					const at = new Date(entry.at);
					return at.getFullYear() === date.getFullYear() && at.getMonth() === date.getMonth() && at.getDate() === date.getDate();
				}).length;
				return { key, label: `${date.getMonth() + 1}/${date.getDate()}`, count };
			});
			const maxDay = Math.max(1, ...days.map((day) => day.count));
			const section = (icon, title, extra, body) =>
				h(SideCollapsibleSection, { key: title, icon, title, extra, defaultOpen: true }, body);
			return h(
				"div",
				{ className: "pw-side" },
				h(
					"div",
					{ className: "pw-side-nav" },
					h("button", { type: "button", onClick: () => navigateWorkbench({ name: "dashboard" }) }, "← 工作台"),
					state.data.project?.id === undefined
						? null
						: h("button", { type: "button", onClick: () => navigateWorkbench({ name: "project", projectId: state.data.project.id }) }, "← 项目"),
					h("button", { type: "button", onClick: () => setPickerOpen(true) }, "历史会话"),
				),
				h(
					"div",
					{ className: "pw-side-hero" },
					h("div", { className: "pw-side-hero-icon" }, "📋"),
					h(
						"div",
						{ className: "pw-side-hero-main" },
						h("div", { className: "pw-side-hero-title" }, task.title),
						h(
							"div",
							{ className: "pw-side-hero-meta" },
							h(StatusBadge, { status: task.viewStatus }),
							h(PriorityBadge, { priority: task.priority }),
							h("span", { className: "pw-side-id" }, task.id),
						),
					),
				),
				sideError === null ? null : h(ErrorBanner, { error: sideError, onRetry: load }),
				section(
					"🎯",
					"任务目标",
					null,
					h(
						"div",
						{ className: "pw-side-edit" },
						h(TextArea, { value: goalDraft, onChange: setGoalDraft, rows: 3, placeholder: "一句话说清任务目标" }),
						h(
							"div",
							{ className: "pw-side-actions" },
							h(Button, { small: true, kind: "primary", disabled: savingSide || goalDraft === (task.goal ?? ""), onClick: () => void patchTask({ goal: goalDraft }) }, "保存目标"),
						),
					),
				),
				section(
					"📈",
					"任务进度",
					`${progress}%`,
					h(
						"div",
						{ className: "pw-side-progress" },
						h(
							"div",
							{ className: "pw-side-ring" },
							h(
								"svg",
								{ viewBox: "0 0 40 40", width: 62, height: 62, "aria-hidden": "true" },
								h("circle", { cx: 20, cy: 20, r: 15, className: "ring-bg" }),
								h("circle", {
									cx: 20,
									cy: 20,
									r: 15,
									className: "ring-fg",
									strokeDasharray: circumference,
									strokeDashoffset: circumference * (1 - progress / 100),
									transform: "rotate(-90 20 20)",
								}),
							),
							h("span", { className: "ring-label" }, `${progress}%`),
						),
						h(
							"div",
							{ className: "pw-side-progress-main" },
							h(
								"div",
								{ className: "pw-side-kv" },
								h("div", { className: "pw-side-kv-row" }, h("span", null, "状态"), h("b", null, statusLabel(task.viewStatus))),
								h("div", { className: "pw-side-kv-row" }, h("span", null, "输入成果"), h("b", null, String(inputs.length))),
								h("div", { className: "pw-side-kv-row" }, h("span", null, "输出成果"), h("b", null, String(outputs.length))),
							),
							h(
								"div",
								{ className: "pw-side-split" },
								h("div", { className: "pw-side-split-bar" }, h("span", { className: "input", style: { width: `${inputPercent}%` } }), h("span", { className: "output", style: { width: `${100 - inputPercent}%` } })),
								h("div", { className: "pw-side-legend" }, h("span", { className: "dot input" }, `输入 ${inputs.length}`), h("span", { className: "dot output" }, `输出 ${outputs.length}`)),
							),
						),
					),
				),
				section(
					"⚙️",
					"任务属性",
					null,
					h(
						"div",
						{ className: "pw-side-controls" },
						h(
							"label",
							null,
							h("span", null, "状态"),
							h(
								"select",
								{ value: task.status, disabled: savingSide, onChange: (event) => void patchTask({ status: event.target.value }) },
								["backlog", "running", "done"].map((value) => h("option", { key: value, value }, statusLabel(value))),
							),
						),
						h(
							"label",
							null,
							h("span", null, "优先级"),
							h(
								"select",
								{ value: task.priority, disabled: savingSide, onChange: (event) => void patchTask({ priority: event.target.value }) },
								["low", "medium", "high", "urgent"].map((value) => h("option", { key: value, value }, priorityLabel(value))),
							),
						),
						h(
							"label",
							null,
							h("span", null, "截止时间"),
							h("input", {
								type: "date",
								value: (task.dueAt ?? "").slice(0, 10),
								disabled: savingSide,
								onChange: (event) => void patchTask({ dueAt: event.target.value === "" ? null : `${event.target.value}T23:59:59+08:00` }),
							}),
						),
					),
				),
				section(
					"🧭",
					"主要过程",
					String(activity.length),
					activity.length === 0
						? h("div", { className: "pw-side-empty" }, "还没有会话过程记录")
						: h(
								"div",
								{ className: "pw-side-timeline" },
								activity.slice(-6).reverse().map((entry) =>
									h(
										"div",
										{ key: entry.id, className: "pw-side-timeline-item" },
										h("span", { className: "dot" }),
										h(
											"div",
											{ className: "body" },
											h("b", null, activityKindLabel(entry.kind)),
											h("span", null, ` ${entry.detail}`),
											h("span", { className: "time" }, relativeTime(entry.at)),
										),
									),
								),
							),
				),
				section(
					"📦",
					"输入 / 输出成果",
					`${totalArtifacts}`,
					h(
						"div",
						{ className: "pw-side-artifacts" },
						h(
							"div",
							{ className: "pw-side-art-actions" },
							h("button", { type: "button", className: "pw-btn small", disabled: savingSide, onClick: () => goalInputRef.current?.click() }, uploadKind === "input" ? "上传中…" : "上传输入"),
							h("button", { type: "button", className: "pw-btn small", disabled: savingSide, onClick: () => outputInputRef.current?.click() }, uploadKind === "output" ? "上传中…" : "上传输出"),
							h("button", { type: "button", className: "pw-btn small ghost", disabled: savingSide, onClick: () => void syncArtifacts() }, "刷新"),
							h("input", { ref: goalInputRef, className: "pw-file-input", type: "file", onChange: (event) => void uploadArtifact("input", event.target.files?.[0]) }),
							h("input", { ref: outputInputRef, className: "pw-file-input", type: "file", onChange: (event) => void uploadArtifact("output", event.target.files?.[0]) }),
						),
						h(
							"div",
							{ className: "pw-side-artifacts-group" },
							h("div", { className: "pw-side-group-title" }, `输入成果 · ${inputs.length}`),
							inputs.length === 0 ? h("div", { className: "pw-side-empty" }, "还没有输入成果") : inputs.map((artifact) => sideArtifactRow(artifact)),
						),
						h(
							"div",
							{ className: "pw-side-artifacts-group" },
							h("div", { className: "pw-side-group-title" }, `输出成果 · ${outputs.length}`),
							outputs.length === 0 ? h("div", { className: "pw-side-empty" }, "还没有输出成果") : outputs.map((artifact) => sideArtifactRow(artifact)),
						),
					),
				),
				section(
					"📝",
					"任务描述",
					null,
					h(
						"div",
						{ className: "pw-side-edit" },
						h(TextArea, { value: descDraft, onChange: setDescDraft, rows: 4, placeholder: "补充任务背景、验收标准等" }),
						h("div", { className: "pw-side-actions" }, h(Button, { small: true, kind: "primary", disabled: savingSide || descDraft === (task.description ?? ""), onClick: () => void patchTask({ description: descDraft }) }, "保存描述")),
					),
				),
				section(
					"🧩",
					"子目标",
					String((state.data.goals ?? []).length),
					(state.data.goals ?? []).length === 0
						? h("div", { className: "pw-side-empty" }, "还没有子目标")
						: h(
								"div",
								{ className: "pw-side-goals" },
								(state.data.goals ?? []).map((goal) =>
									h(
										"div",
										{ key: goal.id, className: "pw-side-goal-row" },
										h("span", { className: "title" }, goal.title),
										h("span", { className: "meta" }, `${goal.artifacts?.length ?? 0} 成果 · ${goal.sessions?.length ?? 0} 会话`),
									),
								),
							),
				),
				section(
					"📊",
					"近 7 天活动",
					`${days.reduce((total, day) => total + day.count, 0)} 条`,
					h(
						"div",
						{ className: "pw-side-chart" },
						days.map((day) =>
							h(
								"div",
								{ key: day.key, className: "pw-side-chart-col", title: `${day.label}: ${day.count}` },
								h("div", { className: "pw-side-chart-track" }, h("div", { className: "pw-side-chart-bar", style: { height: `${Math.max(3, Math.round((day.count / maxDay) * 58))}px` } })),
								h("span", null, day.label),
							),
						),
					),
				),
				pickerOpen
					? h(TaskSessionPicker, {
							task,
							project: state.data.project,
							currentSessionId: sessionId,
							onClose: () => setPickerOpen(false),
							onApply: applySession,
						})
					: null,
			);
		}

		function TaskView({ taskId, onBack, onOpenProject, onOpenTask }) {
			const [state, setState] = useState({ loading: true, data: null, error: null });
			const [titleDraft, setTitleDraft] = useState("");
			const [descDraft, setDescDraft] = useState("");
			const [editingTitle, setEditingTitle] = useState(false);
			const [commentText, setCommentText] = useState("");
			const [busyComment, setBusyComment] = useState(false);
			const [busyCommentId, setBusyCommentId] = useState(null);
			const [saving, setSaving] = useState(false);
			const [notice, setNotice] = useState(null);
			const [goalDraft, setGoalDraft] = useState("");
			const [goalModal, setGoalModal] = useState(null);
			const [sessionGoal, setSessionGoal] = useState(null);
			const [sessionBusy, setSessionBusy] = useState(false);
			const [taskSessionBusy, setTaskSessionBusy] = useState(false);

			const load = useCallback(async () => {
				setState((previous) => ({ ...previous, loading: true, error: null }));
				try {
					const data = await api(`/tasks/${encodeURIComponent(taskId)}`);
					setState({ loading: false, data, error: null });
					setTitleDraft(data.task.title);
					setDescDraft(data.task.description ?? "");
					setGoalDraft(data.task.goal ?? "");
				} catch (error) {
					setState({ loading: false, data: null, error });
				}
			}, [taskId]);

			useEffect(() => {
				void load();
			}, [load]);

			const showNotice = useCallback((text, kind) => {
				setNotice({ text, kind });
				setTimeout(() => setNotice(null), 2600);
			}, []);

			const task = state.data?.task ?? null;
			const project = state.data?.project ?? null;
			const archived = project?.status === "archived";
			const instructions = state.data?.instructions ?? null;

			const patch = useCallback(
				async (body, options = {}) => {
					if (archived) return;
					setSaving(true);
					try {
						await api(`/tasks/${encodeURIComponent(taskId)}`, { method: "PATCH", body });
						await load();
						if (options.toast !== false) showNotice(t("toast.saved"));
					} catch (error) {
						showNotice(`${t("error.update")}：${errorText(error)}`, "warn");
					} finally {
						setSaving(false);
					}
				},
				[archived, taskId, load, showNotice],
			);

			const addComment = useCallback(async () => {
				if (commentText.trim() === "") return;
				setBusyComment(true);
				try {
					await api(`/tasks/${encodeURIComponent(taskId)}/comments`, { method: "POST", body: { body: commentText.trim(), author: "user" } });
					setCommentText("");
					await load();
					showNotice(t("toast.commentAdded"));
				} catch (error) {
					showNotice(`${t("error.comment")}：${errorText(error)}`, "warn");
				} finally {
					setBusyComment(false);
				}
			}, [commentText, taskId, load, showNotice]);

			const resolveComment = useCallback(
				async (comment, resolved) => {
					setBusyCommentId(comment.id);
					try {
						await api(`/tasks/${encodeURIComponent(taskId)}/comments/${encodeURIComponent(comment.id)}/resolve`, {
							method: "POST",
							body: { resolved },
						});
						await load();
						showNotice(t("toast.resolved"));
					} catch (error) {
						showNotice(`${t("error.resolve")}：${errorText(error)}`, "warn");
					} finally {
						setBusyCommentId(null);
					}
				},
				[taskId, load, showNotice],
			);

			const deleteGoal = useCallback(
				async (goal) => {
					if (typeof window.confirm === "function" && !window.confirm(t("goals.deleteConfirm"))) return;
					try {
						await api(`/goals/${encodeURIComponent(goal.id)}`, { method: "DELETE" });
						await load();
						showNotice(t("toast.deleted"));
					} catch (error) {
						showNotice(`${t("error.goal")}：${errorText(error)}`, "warn");
					}
				},
				[load, showNotice],
			);

			const linkSession = useCallback(
				async (goal, session) => {
					setSessionBusy(true);
					try {
						await api(`/goals/${encodeURIComponent(goal.id)}/sessions`, {
							method: "POST",
							body: { sessionId: session.sessionId, title: session.title, cwd: session.cwd, status: session.status, source: "linked" },
						});
						setSessionGoal(null);
						await load();
						showNotice(t("goalSession.linked"));
					} catch (error) {
						showNotice(`${t("error.session")}：${errorText(error)}`, "warn");
					} finally {
						setSessionBusy(false);
					}
				},
				[load, showNotice],
			);

			const newSession = useCallback(
				async (goal) => {
					setSessionBusy(true);
					try {
						const sessionRoot = state.data?.workbenchRoot || goal.dir;
						let created;
						try {
							created = await createDshSessionInWorkspace(sessionRoot, "工作台");
						} catch (firstError) {
							// 工作区快照可能尚未刷新，重试一次。
							await new Promise((resolve) => setTimeout(resolve, 800));
							created = await createDshSessionInWorkspace(sessionRoot, "工作台");
						}
						await api(`/goals/${encodeURIComponent(goal.id)}/sessions`, {
							method: "POST",
							body: { sessionId: created.sessionId, title: `${goal.title} · 会话`, cwd: created.cwd, status: "new", source: "created" },
						});
						setSessionGoal(null);
						await load();
						showNotice(t("goalSession.created"));
					} catch (error) {
						showNotice(`${t("error.session")}：${errorText(error)}`, "warn");
					} finally {
						setSessionBusy(false);
					}
				},
				[load, showNotice, state.data?.workbenchRoot],
			);

			const unlinkSession = useCallback(
				async (goal, session) => {
					try {
						await api(`/goals/${encodeURIComponent(goal.id)}/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
						await load();
						showNotice(t("goalSession.unlinked"));
					} catch (error) {
						showNotice(`${t("error.session")}：${errorText(error)}`, "warn");
					}
				},
				[load, showNotice],
			);

			const uploadArtifact = useCallback(
				async (goal, kind, file) => {
					const url = `${API}/goals/${encodeURIComponent(goal.id)}/artifacts/upload?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(file.name)}`;
					const response = await fetch(url, {
						method: "POST",
						headers: { "content-type": file.type || "application/octet-stream" },
						body: file,
					});
					const payload = await response.json().catch(() => null);
					if (payload === null || payload.ok !== true) throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
					await load();
				},
				[load],
			);

			const syncArtifacts = useCallback(
				async (goal) => {
					try {
						const data = await api(`/goals/${encodeURIComponent(goal.id)}/artifacts/sync`, { method: "POST" });
						await load();
						showNotice(t("goals.synced", { n: data?.added ?? 0 }));
					} catch (error) {
						showNotice(`${t("error.artifact")}：${errorText(error)}`, "warn");
					}
				},
				[load, showNotice],
			);

			const deleteArtifact = useCallback(
				async (goal, artifact) => {
					await api(`/goals/${encodeURIComponent(goal.id)}/artifacts/${encodeURIComponent(artifact.id)}?deleteFile=1`, { method: "DELETE" });
					await load();
				},
				[load],
			);

			const createTaskSession = useCallback(async () => {
				setTaskSessionBusy(true);
				try {
					const root = state.data?.workbenchRoot ?? "";
					const created = await createDshSessionInWorkspace(root, "工作台");
					await api(`/tasks/${encodeURIComponent(taskId)}/session`, {
						method: "POST",
						body: { sessionId: created.sessionId, title: `${state.data?.task?.title ?? "任务"} · 会话`, cwd: created.cwd },
					});
					await load();
					showNotice(t("task.session.created"));
				} catch (error) {
					showNotice(`${t("error.session")}：${errorText(error)}`, "warn");
				} finally {
					setTaskSessionBusy(false);
				}
			}, [state.data?.workbenchRoot, state.data?.task?.title, taskId, load, showNotice]);

			const unlinkTaskSession = useCallback(async () => {
				try {
					await api(`/tasks/${encodeURIComponent(taskId)}/session`, { method: "DELETE" });
					await load();
					showNotice(t("task.session.unlink"));
				} catch (error) {
					showNotice(`${t("error.session")}：${errorText(error)}`, "warn");
				}
			}, [taskId, load, showNotice]);

			const uploadTaskArtifact = useCallback(
				async (kind, file) => {
					const url = `${API}/tasks/${encodeURIComponent(taskId)}/artifacts/upload?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(file.name)}`;
					const response = await fetch(url, { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
					const payload = await response.json().catch(() => null);
					if (payload === null || payload.ok !== true) throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
					await load();
				},
				[taskId, load],
			);

			const syncTaskArtifacts = useCallback(async () => {
				try {
					const data = await api(`/tasks/${encodeURIComponent(taskId)}/artifacts/sync`, { method: "POST" });
					await load();
					showNotice(t("task.artifacts.synced", { n: data?.added ?? 0 }));
				} catch (error) {
					showNotice(`${t("error.artifact")}：${errorText(error)}`, "warn");
				}
			}, [taskId, load, showNotice]);

			const deleteTaskArtifact = useCallback(
				async (artifact) => {
					await api(`/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifact.id)}?deleteFile=1`, { method: "DELETE" });
					await load();
				},
				[taskId, load],
			);

			if (state.loading && state.data === null) {
				return h("div", { className: "pw-page" }, h(Spinner));
			}
			if (state.error !== null || task === null) {
				return h(
					"div",
					{ className: "pw-page" },
					h(ErrorBanner, { error: state.error ?? new Error(t("error.load")), onRetry: load }),
					h(Button, { onClick: onBack }, t("common.back")),
				);
			}

			const statusOptions = ["backlog", "running", "done"].map((value) => ({ value, label: statusLabel(value) }));
			const priorityOptions = ["low", "medium", "high", "urgent"].map((value) => ({ value, label: priorityLabel(value) }));

			return h(
				"div",
				{ className: "pw-page" },
				h(
					"div",
					{ className: "pw-breadcrumb" },
					h("button", { type: "button", onClick: onBack }, t("task.backToProject")),
					h("span", { className: "sep" }, "/"),
					h("button", { type: "button", onClick: () => onOpenProject(project?.id) }, project?.name ?? t("task.project")),
					h("span", { className: "sep" }, "/"),
					h("span", null, task.title),
				),
				notice === null ? null : h("div", { className: `pw-toast${notice.kind === "warn" ? " warn" : ""}` }, notice.text),
				archived ? h("div", { className: "pw-toast warn" }, t("task.archivedReadonly")) : null,
				h(
					"div",
					{ className: "pw-task-head" },
					h(
						"div",
						{ className: "sub" },
						h(StatusBadge, { status: task.viewStatus }),
						h(PriorityBadge, { priority: task.priority }),
						task.dueAt === null ? null : h(Badge, { tone: isOverdue(task) ? "danger" : undefined }, `${fmtDateTime(task.dueAt)}${isOverdue(task) ? ` · ${t("time.overdue")}` : ""}`),
						task.blocked ? h(Badge, { tone: "danger" }, t("task.blocked")) : null,
						task.waitingReview ? h(Badge, { tone: "warn" }, t("task.waitingReview")) : null,
						h("span", { className: "pw-spacer" }),
						h("span", { className: "pw-info-line" }, `${t("task.updatedAt")} ${relativeTime(task.updatedAt)}`),
					),
					editingTitle
						? h(
								"div",
								{ className: "pw-split", style: { marginTop: 10 } },
								h("div", { style: { flex: 1 } }, h(TextInput, { value: titleDraft, onChange: setTitleDraft, autoFocus: true })),
								h(Button, { small: true, kind: "primary", disabled: saving, onClick: async () => { await patch({ title: titleDraft }); setEditingTitle(false); } }, t("task.saveTitle")),
								h(Button, { small: true, onClick: () => { setEditingTitle(false); setTitleDraft(task.title); } }, t("common.cancel")),
							)
						: h(
								"h2",
								null,
								task.title,
								archived ? null : h("button", { type: "button", className: "pw-btn small ghost", style: { marginLeft: 8, verticalAlign: "middle" }, onClick: () => setEditingTitle(true) }, t("task.editTitle")),
							),
					task.needsYouReasons?.length > 0
						? h(
								"div",
								{ className: "pw-info-line", style: { color: "var(--pw-amber)", marginTop: 6 } },
								`${t("task.needsYouReasons")}：`,
								task.needsYouReasons.map(needsYouReasonText).join(" · "),
							)
						: null,
				),
				h(
					"div",
					{ className: "pw-task-layout" },
					h(
						"div",
						{ className: "pw-task-main" },
						h(
							"section",
							{ className: "pw-card" },
							h("h3", null, t("task.goal")),
							archived
								? h("div", { style: { whiteSpace: "pre-wrap" } }, task.goal === "" ? t("common.none") : task.goal)
								: h(
										"div",
										{ className: "pw-form" },
										h(TextArea, { value: goalDraft, onChange: setGoalDraft, rows: 3, placeholder: t("task.goalPh") }),
										h(
											"div",
											{ className: "pw-actions" },
											h(Button, { disabled: saving, onClick: () => patch({ goal: goalDraft }) }, saving ? t("common.saving") : t("task.saveGoal")),
										),
									),
						),
						h(
							"section",
							{ className: "pw-card" },
							h("h3", null, t("task.session.title")),
							state.data.session === null || state.data.session === undefined
								? h(
										"div",
										{ className: "pw-form" },
										h("div", { className: "pw-hint", style: { margin: 0 } }, t("task.session.none")),
										archived
											? null
											: h(
													"div",
													{ className: "pw-actions" },
													h(Button, { kind: "primary", disabled: taskSessionBusy, onClick: createTaskSession }, taskSessionBusy ? t("task.session.busy") : t("task.session.create")),
												),
									)
								: h(
										"div",
										{ className: "pw-form" },
										h(
											"div",
											{ className: "pw-info-line" },
											t("task.session.title"),
											"：",
											h("b", null, state.data.session.title || state.data.session.sessionId),
										),
										h("div", { className: "pw-info-line" }, `${t("task.session.cwd")}：`, h("code", { className: "pw-code" }, state.data.session.cwd || "—")),
										h(
											"div",
											{ className: "pw-actions" },
											h(Button, { onClick: () => { if (!openDshSession(state.data.session.sessionId)) showNotice(t("goalSession.openFailed"), "warn"); else openTaskContextTab(state.data.session.sessionId); } }, t("task.session.open")),
											archived ? null : h(Button, { kind: "danger", onClick: unlinkTaskSession }, t("task.session.unlink")),
										),
									),
						),
						h(TaskArtifactsCard, {
							artifacts: state.data.artifacts ?? [],
							readOnly: archived,
							onUpload: uploadTaskArtifact,
							onSync: syncTaskArtifacts,
							onDelete: deleteTaskArtifact,
						}),
						h(
							"section",
							{ className: "pw-card" },
							h(
								"div",
								{ className: "pw-goal-head" },
								h(
									"h3",
									null,
									t("goals.title"),
									h("span", { className: "pw-badge" }, String((state.data.goals ?? []).length)),
								),
								archived ? null : h(Button, { small: true, kind: "primary", onClick: () => setGoalModal({ goal: null }) }, t("goals.add")),
							),
							(state.data.goals ?? []).length === 0
								? h("div", { className: "pw-hint", style: { margin: 0 } }, t("goals.empty"))
								: h(
										"div",
										{ style: { display: "flex", flexDirection: "column", gap: 10, marginTop: 10 } },
										(state.data.goals ?? []).map((goal) =>
											h(GoalCard, {
												key: goal.id,
												goal,
												readOnly: archived,
												onEdit: (item) => setGoalModal({ goal: item }),
												onDelete: deleteGoal,
												onLinkSession: (item) => setSessionGoal(item),
												onNewSession: newSession,
												onOpenSession: (sessionId) => {
													if (!openDshSession(sessionId)) showNotice(t("goalSession.openFailed"), "warn");
												},
												onUnlinkSession: unlinkSession,
												onUpload: uploadArtifact,
												onSync: syncArtifacts,
												onDeleteArtifact: deleteArtifact,
											}),
										),
									),
						),
						h(
							"section",
							{ className: "pw-card" },
							h("h3", null, t("task.description")),
							archived
								? h("div", { style: { whiteSpace: "pre-wrap" } }, task.description === "" ? t("task.noDescription") : task.description)
								: h(
										"div",
										{ className: "pw-form" },
										h(TextArea, { value: descDraft, onChange: setDescDraft, rows: 6, placeholder: t("task.noDescription") }),
										h(
											"div",
											{ className: "pw-actions" },
											h(Button, { disabled: saving, onClick: () => patch({ description: descDraft }) }, saving ? t("common.saving") : t("task.saveDescription")),
										),
									),
						),
						h(
							"section",
							{ className: "pw-card" },
							h("h3", null, `${t("task.comments")}`, h("span", { className: "pw-badge" }, state.data.comments.length)),
							state.data.comments.length === 0 ? h("div", { className: "pw-hint" }, t("task.noComments")) : null,
							state.data.comments.map((comment) =>
								h(CommentItem, {
									key: comment.id,
									comment,
									busy: busyCommentId === comment.id,
									onResolve: () => resolveComment(comment, true),
									onReopen: () => resolveComment(comment, false),
								}),
							),
							archived
								? null
								: h(
										"div",
										{ className: "pw-form", style: { marginTop: 10 } },
										h(TextArea, { value: commentText, onChange: setCommentText, rows: 3, placeholder: t("task.commentPh") }),
										h(
											"div",
											{ className: "pw-actions" },
											h(Button, { kind: "primary", disabled: busyComment || commentText.trim() === "", onClick: addComment }, t("task.addComment")),
										),
									),
						),
						h(
							"section",
							{ className: "pw-card" },
							h("h3", null, t("task.activity")),
							h(ActivityTimeline, { activity: state.data.activity }),
						),
					),
					h(
						"div",
						{ className: "pw-task-side" },
						h(
							"section",
							{ className: "pw-card" },
							h("h3", null, t("task.status")),
							h(
								"div",
								{ className: "pw-form" },
								h(Field, { label: t("task.status") }, h(Select, { value: task.status, disabled: archived, onChange: (value) => patch({ status: value }), options: statusOptions })),
								h(Field, { label: t("task.viewStatus") }, h(StatusBadge, { status: task.viewStatus })),
								h(Field, { label: t("task.priority") }, h(Select, { value: task.priority, disabled: archived, onChange: (value) => patch({ priority: value }), options: priorityOptions })),
								h(Field, { label: t("task.due") }, h("input", { className: "pw-input", type: "datetime-local", disabled: archived, value: toLocalInput(task.dueAt), onChange: (event) => patch({ dueAt: event.target.value === "" ? "" : fromLocalInput(event.target.value) }) })),
								h(
									"label",
									{ className: "pw-check" },
									h("input", { type: "checkbox", checked: task.blocked === true, disabled: archived, onChange: (event) => patch({ blocked: event.target.checked }) }),
									t("task.blocked"),
								),
								h(
									"label",
									{ className: "pw-check" },
									h("input", { type: "checkbox", checked: task.waitingReview === true, disabled: archived, onChange: (event) => patch({ waitingReview: event.target.checked }) }),
									t("task.waitingReview"),
								),
							),
						),
						h(
							"section",
							{ className: "pw-card" },
							h("h3", null, t("task.project")),
							h(
								"div",
								{ className: "pw-kv" },
								h("div", { className: "pw-kv-row" }, h("span", null, t("task.project")), h("button", { type: "button", className: "pw-btn small", onClick: () => onOpenProject(project?.id) }, project?.name ?? t("task.openProject"))),
								h("div", { className: "pw-kv-row" }, h("span", null, t("task.createdAt")), h("span", null, fmtDateTime(task.createdAt))),
								h("div", { className: "pw-kv-row" }, h("span", null, t("task.completedAt")), h("span", null, task.completedAt === null ? t("common.none") : fmtDateTime(task.completedAt))),
								h("div", { className: "pw-kv-row block" }, h("span", null, t("projects.workbenchRoot")), h("code", { className: "pw-code" }, project?.workbenchRoot ?? state.data.workbenchRoot ?? "")),
								h("div", { className: "pw-kv-row block" }, h("span", null, t("project.folder")), h("code", { className: "pw-code" }, project?.rootPath ?? "")),
								h("div", { className: "pw-kv-row block" }, h("span", null, t("task.taskDir")), h("code", { className: "pw-code" }, state.data.taskDir ?? "")),
							),
							state.data.parent === null
								? null
								: h(
										"div",
										{ style: { marginTop: 10 } },
										h("div", { className: "pw-hint" }, t("task.parent")),
										h("button", { type: "button", className: "pw-btn small", onClick: () => onOpenTask(state.data.parent.id) }, state.data.parent.title),
									),
							state.data.children.length === 0
								? null
								: h(
										"div",
										{ style: { marginTop: 10 } },
										h("div", { className: "pw-hint" }, t("task.children")),
										h(
											"div",
											{ className: "pw-actions" },
											state.data.children.map((child) =>
												h("button", { key: child.id, type: "button", className: "pw-btn small", onClick: () => onOpenTask(child.id) }, child.title),
											),
										),
									),
						),
						h(InstructionsCard, { instructions, hasTaskLayer: instructions?.task !== null && instructions?.task !== undefined }),
					),
				),
				goalModal === null
					? null
					: h(GoalModal, {
							taskId,
							goal: goalModal.goal,
							onClose: () => setGoalModal(null),
							onSaved: async () => {
								setGoalModal(null);
								await load();
								showNotice(t("toast.saved"));
							},
						}),
				sessionGoal === null
					? null
					: h(SessionPicker, {
							goal: sessionGoal,
							busy: sessionBusy,
							onClose: () => (sessionBusy ? undefined : setSessionGoal(null)),
							onPick: (session) => linkSession(sessionGoal, session),
							onCreate: () => newSession(sessionGoal),
						}),
			);
		}

		/* ───────────────────────── 挂载 ───────────────────────── */

		const inject = ["slots", "sidebarRightTabs", "sidebarRight", "layout"];

		function View(props) {
			const [route, setRoute] = useState(() => pendingWorkbenchRoute ?? { name: "dashboard" });
			useEffect(() => {
				pendingWorkbenchRoute = null;
				const handler = () => {
					if (pendingWorkbenchRoute !== null) {
						setRoute(pendingWorkbenchRoute);
						pendingWorkbenchRoute = null;
					}
				};
				window.addEventListener("workbench:navigate", handler);
				return () => window.removeEventListener("workbench:navigate", handler);
			}, []);
			const openTask = async (projectId, taskId) => {
				try {
					await openTaskSessionById(taskId);
				} catch {
					setRoute({ name: "project", projectId });
				}
			};
			return h(
				"div",
				{ className: "pw-root" },
				route.name === "dashboard"
					? h(DashboardView, {
							onOpenProject: (projectId) => setRoute({ name: "project", projectId }),
							onOpenTask: openTask,
							onOpenProjects: () => setRoute({ name: "projects" }),
							onOpenTasks: () => setRoute({ name: "tasks" }),
							renderSlot: props?.renderSlot,
						})
					: route.name === "tasks"
						? h(TasksView, {
								onHome: () => setRoute({ name: "dashboard" }),
								onOpenTask: (taskId) => void openTaskSessionById(taskId),
							})
					: route.name === "projects"
						? h(ProjectsView, {
								onOpenProject: (projectId) => setRoute({ name: "project", projectId }),
								onHome: () => setRoute({ name: "dashboard" }),
							})
						: h(ProjectView, {
								projectId: route.projectId,
								onBack: () => setRoute({ name: "projects" }),
								onHome: () => setRoute({ name: "dashboard" }),
							}),
			);
		}

		/** 隐藏 DSH 原生「工作区 / 会话列表」浏览器，只保留工作台的项目/任务入口。 */
		function installWorkspaceChromeHider() {
			if (typeof document === "undefined" || document.body === null) return () => undefined;
			const hide = (element) => {
				if (element === null || element === undefined) return;
				if (element.style.display !== "none") element.style.display = "none";
			};
			const applyHiding = () => {
				const spans = [...document.querySelectorAll("span")];
				const sectionLabels = new Set(["工作区", "Workspaces", "会话", "Sessions"]);
				const workspaceLabel = spans.find((span) => span.children.length === 0 && sectionLabels.has(span.textContent.trim()) && String(span.className).includes("sectionLabel"));
				if (workspaceLabel !== undefined) hide(workspaceLabel.closest('[class*="_root"]'));
				const newSessionLabels = new Set(["新会话", "New session", "New Session", "New chat", "New Chat"]);
				const newSessionLabel = spans.find((span) => span.children.length === 0 && newSessionLabels.has(span.textContent.trim()) && String(span.className).includes("newSessionLabel"));
				if (newSessionLabel !== undefined) hide(newSessionLabel.closest("button"));
			};
			applyHiding();
			const observer = new MutationObserver(() => applyHiding());
			observer.observe(document.body, { childList: true, subtree: true });
			return () => observer.disconnect();
		}

		/** 新会话默认落在当前/最近工作区，避免每次手动选择工作区。 */
		function installDefaultSessionWorkspace(ctx) {
			const uiWorkspace = ctx.get?.("uiWorkspace");
			if (uiWorkspace === undefined || uiWorkspace === null || typeof uiWorkspace.startSession !== "function") return () => undefined;
			const original = uiWorkspace.startSession.bind(uiWorkspace);
			try {
				uiWorkspace.startSession = function (workspaceId, options) {
					if (workspaceId === undefined) {
						try {
							const items = uiWorkspace.workspaces?.list?.getSnapshot?.()?.items ?? [];
							const currentSession = uiWorkspace.mainReference?.sessionId;
							const currentWorkspace = items.find((item) => Array.isArray(item.sessionIds) && item.sessionIds.includes(currentSession));
							const target = currentWorkspace ?? items[0];
							if (target?.workspaceId !== undefined) workspaceId = target.workspaceId;
						} catch {
							/* keep caller's choice */
						}
					}
					return original(workspaceId, options);
				};
			} catch {
				return () => undefined;
			}
			return () => {
				try {
					uiWorkspace.startSession = original;
				} catch {
					/* ignore */
				}
			};
		}

		function apply(ctx) {
			rootClientCtx = ctx;
			// 应用语言（Settings › 语言）优先；没有 locale 服务时退回 navigator.language
			currentLocale = detectLanguage();
			try {
				const locale = ctx.get?.("locale");
				if (locale !== undefined && locale !== null) {
					ctx.effect(() => locale.register(NS, { zh: ZH, en: EN }), "project-workbench: locale");
					const bound = locale.bind(NS);
					if (typeof bound === "function") translate = (key, vars) => bound(key, vars);
				}
			} catch {
				/* 保留 navigator 回退 */
			}
			ensureCss();
			ctx.effect(() => installWorkspaceChromeHider(), "project-workbench: hide workspace chrome");
			ctx.effect(() => installDefaultSessionWorkspace(ctx), "project-workbench: default session workspace");
			ctx.slots.inject("sidebar.panellist", () =>
				ctx.slots.register(
					{ name: "sidebar.panellist", id: PANEL_ID, order: 42, label: () => t("panel.title"), locale: NS },
					PanelIcon,
				),
			);
			ctx.slots.inject("main", () =>
				ctx.slots.register(
					{ name: "main", key: PANEL_ID, locale: NS },
					View,
				),
			);
			ctx.slots.inject("conversation.session.header.actions", () =>
				ctx.slots.register(
					{ name: "conversation.session.header.actions", id: "workbench-back", order: 5, locale: NS },
					TaskBackButton,
				),
			);
			if (ctx.sidebarRightTabs?.register !== undefined && ctx.sidebarRight !== undefined) {
				ctx.effect(
					() =>
						ctx.sidebarRightTabs.register({
							id: TASK_TAB_ID,
							kind: TASK_TAB_KIND,
							priority: "builtin",
							title: () => "任务工作台",
						}),
					"project-workbench: task tab type",
				);
				ctx.slots.inject("sidebar.right.pane.tab", () =>
					ctx.slots.register({ name: "sidebar.right.pane.tab", key: TASK_TAB_ID, locale: NS }, TaskSidePanel),
				);
			}
		}

		return {
			name: NS,
			inject,
			apply,
			__test: {
				t,
				buildProjectTemplate,
				toLocalInput,
				fromLocalInput,
				isOverdue,
				relativeTime,
				fmtDate,
				fmtDateTime,
				needsYouReasonText,
				activityKindLabel,
				BOARD_COLUMNS,
			},
		};
	},
});
