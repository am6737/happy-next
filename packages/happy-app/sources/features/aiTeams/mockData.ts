import { getCurrentLanguage } from '@/text';
import type { AiAgentAvailability } from './agentPresence';

export type AiAgentStatus = 'working' | 'waiting' | 'idle' | 'reviewing' | 'disabled';
export type AiWorkStatus = 'todo' | 'working' | 'blocked' | 'review' | 'done';
export type AiWorkSource = 'github' | 'dootask' | 'session' | 'execution';
export type AiExecutionStatus = 'queued' | 'dispatched' | 'running' | 'waiting_human' | 'reviewing' | 'completed' | 'failed' | 'cancelled';
export type AiExecutionEventKind = 'status' | 'comment' | 'tool' | 'result';
export type AiAcceptanceStatus = 'pending' | 'approved' | 'changes_requested';

export type AiAgentEngine = 'claude-code' | 'codex' | 'gemini';
export type AiAgentReasoningLevel = 'low' | 'medium' | 'high';
export type AiAgentRuntime = 'local' | 'cloud' | 'openclaw';
export type AiAgentPermissionMode = 'read_only' | 'approval' | 'guarded_auto';
export type AiAgentWorkspaceAccess = 'read_only' | 'read_write';
export type AiAgentVisibility = 'private' | 'workspace';
export type AiAgentServiceTier = 'default' | 'fast' | 'economy';

export type AiAgentSettings = {
    instructions: string;
    engine: AiAgentEngine;
    model: string;
    reasoningLevel: AiAgentReasoningLevel;
    runtime: AiAgentRuntime;
    workingDirectory: string;
    maxConcurrentTasks: number;
    permissionMode: AiAgentPermissionMode;
    workspaceAccess: AiAgentWorkspaceAccess;
    allowNetwork: boolean;
    requireApprovalForExternalActions: boolean;
    allowDelegation: boolean;
    allowGroupChat: boolean;
    enabledTools: string[];
    visibility?: AiAgentVisibility;
    serviceTier?: AiAgentServiceTier;
    customArguments?: string[];
    environmentVariables?: string[];
    mcpServers?: string[];
};

export type AiAgent = {
    id: string;
    name: string;
    role: string;
    description: string;
    status: AiAgentStatus;
    statusLabel: string;
    emoji: string;
    skills: string[];
    responsibilities: string[];
    teamIds: string[];
    currentWorkId: string | null;
    settings: AiAgentSettings;
    enabled?: boolean;
    managedLocally?: boolean;
    availability?: AiAgentAvailability;
};

export type AiTeam = {
    id: string;
    name: string;
    description: string;
    emoji: string;
    leaderId: string;
    memberIds: string[];
    instructions: string;
    currentGoal: string;
    progress: number;
};

export type AiWorkItem = {
    id: string;
    title: string;
    status: AiWorkStatus;
    statusLabel: string;
    assigneeId: string;
    teamId: string;
    sourceType: AiWorkSource;
    sourceLabel: string;
    summary: string;
    requiresDecision: boolean;
    sourceResourceId: string;
    executionIds: string[];
    acceptanceStatus?: AiAcceptanceStatus;
};

export type AiExecutionEvent = {
    id: string;
    kind: AiExecutionEventKind;
    actor: 'system' | 'human' | 'agent';
    agentId?: string;
    title: string;
    body?: string;
    timeLabel: string;
    status?: AiExecutionStatus;
};

export type AiExecution = {
    id: string;
    workItemId: string;
    agentId: string;
    status: AiExecutionStatus;
    statusLabel: string;
    triggerLabel: string;
    startedAt: string;
    durationLabel: string;
    summary: string;
    attempt: number;
    conversationId?: string;
    sessionId?: string;
    events: AiExecutionEvent[];
};

export type AiMockSessionMessage = {
    id: string;
    role: 'user' | 'assistant' | 'tool';
    title?: string;
    text: string;
    timeLabel: string;
};

export type AiMockExecutionSession = {
    id: string;
    executionId: string;
    agentId: string;
    title: string;
    provider: 'Claude Code' | 'Codex' | 'Gemini';
    statusLabel: string;
    projectLabel: string;
    messages: AiMockSessionMessage[];
};

export type AiConversation = {
    id: string;
    kind: 'direct' | 'group';
    agentId: string;
    teamId: string | null;
    title: string;
    subtitle: string;
    lastMessage: string;
    timeLabel: string;
    unread: boolean;
    emoji: string;
    participantAgentIds: string[];
    humanParticipantCount: number;
};

export type AiChatMessage =
    | { id: string; kind: 'text'; sender: 'user' | 'agent'; agentId?: string; text: string; timeLabel: string }
    | { id: string; kind: 'decision'; sender: 'agent'; agentId?: string; title: string; body: string; options: string[]; selectedOption?: string; timeLabel: string }
    | { id: string; kind: 'progress'; sender: 'agent'; agentId?: string; title: string; completed: string[]; active: string[]; pending: string[]; progress: number; timeLabel: string }
    | { id: string; kind: 'assignment'; sender: 'agent'; agentId?: string; title: string; workItemIds: string[]; timeLabel: string }
    | { id: string; kind: 'work'; sender: 'agent'; agentId?: string; workItemId: string; timeLabel: string }
    | { id: string; kind: 'completion'; sender: 'agent'; agentId?: string; title: string; body: string; timeLabel: string };

export type AiTeamMockData = {
    agents: AiAgent[];
    teams: AiTeam[];
    workItems: AiWorkItem[];
    executions: AiExecution[];
    executionSessions: AiMockExecutionSession[];
    conversations: AiConversation[];
    messages: Record<string, AiChatMessage[]>;
};

function createZhData(): AiTeamMockData {
    return {
        agents: [
            {
                id: 'product-lead', name: 'Aria', role: '产品与交付负责人', description: '理解目标、控制范围、协调成员，并把重要取舍提交真人决定。',
                status: 'idle', statusLabel: '可用', emoji: '🧭', skills: ['需求分析', '任务拆解', '进度汇总', '风险识别'],
                responsibilities: ['明确交付目标和验收标准', '根据成员职责安排工作', '汇总进度、风险和待决策事项', '在成果完成后提交真人验收'],
                teamIds: ['happy-dev-team'], currentWorkId: null,
                settings: {
                    instructions: '先理解真人目标，再拆解任务、协调成员并汇总结果。遇到业务规则、高风险操作或目标冲突时必须请求真人确认。',
                    engine: 'claude-code', model: 'runtime-default', reasoningLevel: 'medium', runtime: 'local', workingDirectory: '/workspace/happy-next', maxConcurrentTasks: 2,
                    permissionMode: 'guarded_auto', workspaceAccess: 'read_write', allowNetwork: true, requireApprovalForExternalActions: true, allowDelegation: true, allowGroupChat: true,
                    enabledTools: ['files', 'terminal', 'git', 'github', 'dootask', 'browser'],
                },
            },
            {
                id: 'developer', name: '程墨', role: '全栈工程师', description: '负责产品实现、问题排查和可运行成果交付。',
                status: 'idle', statusLabel: '可用', emoji: '💻', skills: ['移动端开发', '服务端开发', '问题排查', '自动测试'],
                responsibilities: ['根据任务要求完成实现', '主动报告阻塞和不确定事项', '提交变更说明和测试结果', '高风险操作前申请批准'],
                teamIds: ['happy-dev-team'], currentWorkId: null,
                settings: {
                    instructions: '优先提交可运行、可测试的实现。修改前确认目标和边界，完成后提供变更说明、测试结果和剩余风险。',
                    engine: 'codex', model: 'runtime-default', reasoningLevel: 'high', runtime: 'local', workingDirectory: '/workspace/happy-next', maxConcurrentTasks: 2,
                    permissionMode: 'guarded_auto', workspaceAccess: 'read_write', allowNetwork: true, requireApprovalForExternalActions: true, allowDelegation: false, allowGroupChat: true,
                    enabledTools: ['files', 'terminal', 'git', 'github'],
                },
            },
            {
                id: 'designer', name: 'Iris', role: '产品设计师', description: '负责通知信息层级、点击路径和跨端体验一致性。',
                status: 'idle', statusLabel: '可用', emoji: '✦', skills: ['信息架构', '交互设计', '界面评审', '体验一致性'],
                responsibilities: ['梳理用户路径和信息层级', '设计关键交互方案', '检查跨端体验一致性', '在需要时提供可执行的设计建议'],
                teamIds: ['happy-dev-team'], currentWorkId: null,
                settings: {
                    instructions: '从用户目标和操作路径出发提出简洁、可实现的设计方案。避免增加无必要的页面层级、状态和视觉元素。',
                    engine: 'gemini', model: 'runtime-default', reasoningLevel: 'medium', runtime: 'cloud', workingDirectory: '/workspace/happy-next', maxConcurrentTasks: 1,
                    permissionMode: 'approval', workspaceAccess: 'read_only', allowNetwork: true, requireApprovalForExternalActions: true, allowDelegation: false, allowGroupChat: true,
                    enabledTools: ['files', 'browser', 'dootask'],
                },
            },
            {
                id: 'tester', name: '安衡', role: '质量与发布', description: '负责账号切换、通知链路和回归测试。',
                status: 'idle', statusLabel: '可用', emoji: '🧪', skills: ['流程验证', '回归测试', '异常复现', '发布检查'],
                responsibilities: ['根据验收标准设计测试', '记录问题和复现步骤', '验证修复结果', '确认发布前质量状态'],
                teamIds: ['happy-dev-team'], currentWorkId: null,
                settings: {
                    instructions: '根据验收标准验证关键流程，记录可复现步骤。未经批准不扩大测试范围，不修改生产数据。',
                    engine: 'gemini', model: 'runtime-default', reasoningLevel: 'medium', runtime: 'cloud', workingDirectory: '/workspace/happy-next', maxConcurrentTasks: 1,
                    permissionMode: 'approval', workspaceAccess: 'read_only', allowNetwork: true, requireApprovalForExternalActions: true, allowDelegation: false, allowGroupChat: true,
                    enabledTools: ['files', 'terminal', 'browser', 'dootask'],
                },
            },
            {
                id: 'reviewer', name: 'Sage', role: '技术审查', description: '检查配置、安全边界、兼容路径和长期维护风险。',
                status: 'idle', statusLabel: '可用', emoji: '🔍', skills: ['架构审查', '代码质量', '安全边界', '技术风险'],
                responsibilities: ['检查实现与目标是否一致', '识别架构和维护风险', '确认权限与安全边界', '输出技术审查结论'],
                teamIds: ['happy-dev-team'], currentWorkId: null,
                settings: {
                    instructions: '独立检查交付是否符合目标、权限边界和质量要求。明确区分阻塞问题与后续改进建议。',
                    engine: 'claude-code', model: 'runtime-default', reasoningLevel: 'high', runtime: 'openclaw', workingDirectory: '/workspace/happy-next', maxConcurrentTasks: 1,
                    permissionMode: 'read_only', workspaceAccess: 'read_only', allowNetwork: false, requireApprovalForExternalActions: true, allowDelegation: false, allowGroupChat: true,
                    enabledTools: ['files', 'git', 'github'],
                },
            },
        ],
        teams: [{
            id: 'happy-dev-team', name: 'Happy Next 产品研发组', description: '负责 Happy Next 的产品协调、体验设计、开发、质量验证和技术审查。', emoji: '🚀',
            leaderId: 'product-lead', memberIds: ['product-lead', 'designer', 'developer', 'tester', 'reviewer'],
            instructions: '优先交付可运行、可检查的成果；遇到业务规则、高风险操作和重要取舍时提交真人决定。',
            currentGoal: '完成 DooPush 多端通知接入、账号隔离修复和凭证适配，并形成可核验的提交与测试记录。', progress: 100,
        }],
        workItems: [
            {
                id: 'push-upgrade', title: 'DooPush 多端通知接入', status: 'done', statusLabel: '已完成', assigneeId: 'product-lead', teamId: 'happy-dev-team',
                sourceType: 'github', sourceLabel: 'GitHub Issue #328 · 演示记录', summary: '完成 App 注册、CLI 通知、服务端账号范围转发、厂商通道配置与 Expo 兼容。',
                requiresDecision: false, sourceResourceId: 'am6737/happy-next#328', executionIds: ['exec-push-upgrade'], acceptanceStatus: 'approved',
            },
            {
                id: 'account-binding', title: '修复设备 Token 账号归属', status: 'done', statusLabel: '已完成', assigneeId: 'developer', teamId: 'happy-dev-team',
                sourceType: 'github', sourceLabel: 'GitHub Issue #331 · 演示记录', summary: '确保同一设备 Token 只归属当前账号，退出和切换账号后不会继续向旧账号发送通知。',
                requiresDecision: false, sourceResourceId: 'am6737/happy-next#331', executionIds: ['exec-account-binding-1', 'exec-account-binding-2'], acceptanceStatus: 'approved',
            },
            {
                id: 'final-validation', title: '账号切换与通知回归验证', status: 'done', statusLabel: '已完成', assigneeId: 'tester', teamId: 'happy-dev-team',
                sourceType: 'execution', sourceLabel: '执行 · 回归验证', summary: '覆盖账号 A 退出后登录账号 B、重复登录、旧账号隔离和当前账号有效绑定。',
                requiresDecision: false, sourceResourceId: 'exec-final-validation', executionIds: ['exec-final-validation'], acceptanceStatus: 'approved',
            },
            {
                id: 'review-delivery', title: '通知交付与凭证配置审查', status: 'done', statusLabel: '已完成', assigneeId: 'reviewer', teamId: 'happy-dev-team',
                sourceType: 'execution', sourceLabel: '执行 · 交付审查', summary: '检查敏感信息边界、Expo 兼容、生产发布权限和 DooPush 应用凭证格式。',
                requiresDecision: false, sourceResourceId: 'exec-review-delivery', executionIds: ['exec-review-delivery'], acceptanceStatus: 'approved',
            },
        ],
        executions: [
            {
                id: 'exec-push-upgrade', sessionId: 'mock-session-push-upgrade-1', workItemId: 'push-upgrade', agentId: 'product-lead', status: 'completed', statusLabel: '已完成',
                triggerLabel: '真人在群聊中发起', startedAt: '2026年8月5日 09:18', durationLabel: '6天 4小时', attempt: 1,
                summary: '协调 App、CLI、Server 和数据库改动，完成 54 个文件的 DooPush 端到端接入并形成提交 1028e2d9。', conversationId: 'team-lead-chat',
                events: [
                    { id: 'ep1', kind: 'status', actor: 'system', title: '开始执行', body: '读取现有 Expo 推送、CLI 通知和服务端转发链路。', timeLabel: '8月5日 09:18', status: 'running' },
                    { id: 'ep2', kind: 'comment', actor: 'agent', agentId: 'product-lead', title: '范围已确认', body: 'Android 主流程优先，保留 Expo 兼容，不自动进行生产发布。', timeLabel: '8月5日 09:26' },
                    { id: 'ep3', kind: 'tool', actor: 'agent', agentId: 'developer', title: '完成主链路接入', body: '补齐 DooPush 注册、前台通知、安装标识、CLI 触发和服务端账号范围转发。', timeLabel: '8月6日 16:40' },
                    { id: 'ep4', kind: 'comment', actor: 'agent', agentId: 'designer', title: '通知体验检查', body: '锁屏摘要不展示敏感任务正文，点击只携带恢复目标所需的数据。', timeLabel: '8月7日 10:12' },
                    { id: 'ep5', kind: 'tool', actor: 'agent', agentId: 'tester', title: '运行相关测试', body: '覆盖注册状态、退出清理、前台通知、CLI 推送和服务端路由。', timeLabel: '8月7日 15:36' },
                    { id: 'ep6', kind: 'result', actor: 'agent', agentId: 'product-lead', title: '提交 1028e2d9', body: '54 files changed，3316 insertions，130 deletions；主接入完成。', timeLabel: '8月11日 13:20', status: 'completed' },
                ],
            },
            {
                id: 'exec-account-binding-1', sessionId: 'mock-session-account-binding-1', workItemId: 'account-binding', agentId: 'developer', status: 'failed', statusLabel: '未通过验证',
                triggerLabel: '回归缺陷触发', startedAt: '2026年8月11日 09:12', durationLabel: '24分钟', attempt: 1,
                summary: '第一次只调整 App 退出与注册顺序，相关用例仍暴露服务端可能选中旧账号 Token，原修复假设不完整。', conversationId: 'developer-chat',
                events: [
                    { id: 'ea11', kind: 'status', actor: 'system', title: '开始第 1 次执行', body: '检查退出清理、注册门控和账号切换顺序。', timeLabel: '8月11日 09:12', status: 'running' },
                    { id: 'ea12', kind: 'tool', actor: 'agent', agentId: 'developer', title: '调整 App 流程', body: '先清理旧绑定，再允许当前账号重新注册。', timeLabel: '8月11日 09:22' },
                    { id: 'ea13', kind: 'tool', actor: 'agent', agentId: 'developer', title: '运行定向测试', body: 'pushTokenLogout 通过，但 pushRoutes 的账号范围用例失败。', timeLabel: '8月11日 09:31' },
                    { id: 'ea14', kind: 'result', actor: 'agent', agentId: 'developer', title: '第 1 次执行未通过', body: '问题不只在 App 顺序，服务端 Token 选择也必须按当前账号过滤。', timeLabel: '8月11日 09:36', status: 'failed' },
                ],
            },
            {
                id: 'exec-account-binding-2', sessionId: 'mock-session-account-binding-2', workItemId: 'account-binding', agentId: 'developer', status: 'completed', statusLabel: '已完成',
                triggerLabel: '根据失败结果重试', startedAt: '2026年8月11日 09:42', durationLabel: '1小时 16分钟', attempt: 2,
                summary: '同时修正 App 注册门控、Token 全局唯一约束和服务端账号范围选择，提交 d18127bd（PR #28）。', conversationId: 'developer-chat',
                events: [
                    { id: 'ea21', kind: 'status', actor: 'system', title: '开始第 2 次执行', body: '基于失败结果扩大到 App、数据库约束和服务端选择逻辑。', timeLabel: '8月11日 09:42', status: 'running' },
                    { id: 'ea22', kind: 'tool', actor: 'agent', agentId: 'developer', title: '修正账号归属', body: '增加注册门控，使同一 Token 只保留一条账号归属记录。', timeLabel: '8月11日 10:08' },
                    { id: 'ea23', kind: 'tool', actor: 'agent', agentId: 'developer', title: '补充数据库约束', body: '增加 Token 全局唯一迁移，避免并发注册留下重复归属。', timeLabel: '8月11日 10:21' },
                    { id: 'ea24', kind: 'tool', actor: 'agent', agentId: 'tester', title: '测试通过', body: 'apiPush、pushTokenLogout、pushTokenRegistrationGate 和 pushRoutes 相关用例通过。', timeLabel: '8月11日 10:49' },
                    { id: 'ea25', kind: 'result', actor: 'agent', agentId: 'developer', title: '提交 d18127bd', body: '设备 Token 账号归属修复完成，对应 PR #28。', timeLabel: '8月11日 10:58', status: 'completed' },
                ],
            },
            {
                id: 'exec-final-validation', sessionId: 'mock-session-final-validation-1', workItemId: 'final-validation', agentId: 'tester', status: 'completed', statusLabel: '已完成',
                triggerLabel: '修复后回归', startedAt: '2026年8月11日 11:06', durationLabel: '42分钟', attempt: 1,
                summary: '验证账号 A 退出后登录账号 B、重复登录和旧账号隔离，确认当前设备只保留一条有效绑定。', conversationId: 'tester-chat',
                events: [
                    { id: 'ev1', kind: 'status', actor: 'system', title: '开始回归验证', body: '限定验证账号归属修复，不扩大到营销通知等无关范围。', timeLabel: '8月11日 11:06', status: 'running' },
                    { id: 'ev2', kind: 'tool', actor: 'agent', agentId: 'tester', title: '验证账号切换', body: '账号 A 退出后登录账号 B，旧账号不再接收当前设备通知。', timeLabel: '8月11日 11:24' },
                    { id: 'ev3', kind: 'tool', actor: 'agent', agentId: 'tester', title: '验证重复登录', body: '重复登录和重新注册后，当前设备仍只有一条有效 Token 记录。', timeLabel: '8月11日 11:37' },
                    { id: 'ev4', kind: 'result', actor: 'agent', agentId: 'tester', title: '回归通过', body: '账号隔离、退出重登和重复注册均符合验收条件。', timeLabel: '8月11日 11:48', status: 'completed' },
                ],
            },
            {
                id: 'exec-review-delivery', sessionId: 'mock-session-review-delivery-1', workItemId: 'review-delivery', agentId: 'reviewer', status: 'completed', statusLabel: '已完成',
                triggerLabel: '交付前审查', startedAt: '2026年8月12日 09:20', durationLabel: '1小时 12分钟', attempt: 1,
                summary: '确认安全和兼容边界，并将 DooPush 配置改为应用凭证格式，形成提交 48ace234。', conversationId: 'reviewer-chat',
                events: [
                    { id: 'er1', kind: 'status', actor: 'system', title: '开始交付审查', body: '检查配置来源、客户端暴露范围、Expo 兼容和生产权限。', timeLabel: '8月12日 09:20', status: 'reviewing' },
                    { id: 'er2', kind: 'comment', actor: 'agent', agentId: 'reviewer', title: '发现凭证格式差异', body: '现有环境变量与 DooPush 应用凭证格式不完全一致，应单独修正。', timeLabel: '8月12日 09:38' },
                    { id: 'er3', kind: 'tool', actor: 'agent', agentId: 'developer', title: '适配应用凭证', body: '同步修改 App 配置、Server 路由、Docker 示例和相关测试。', timeLabel: '8月12日 10:16' },
                    { id: 'er4', kind: 'result', actor: 'agent', agentId: 'reviewer', title: '提交 48ace234', body: '凭证适配完成；不自动发布生产环境，服务端密钥不下发客户端。', timeLabel: '8月12日 10:32', status: 'completed' },
                ],
            },
        ],
        executionSessions: [
            {
                id: 'mock-session-push-upgrade-1', executionId: 'exec-push-upgrade', agentId: 'product-lead', title: 'DooPush 多端通知接入', provider: 'Claude Code', statusLabel: '已完成', projectLabel: 'happy-next · feature/doopush',
                messages: [
                    { id: 'sp1', role: 'user', text: '先梳理现有推送链路。目标是接入 DooPush，但保留 Expo 兼容，不做生产发布。', timeLabel: '8月5日 09:18' },
                    { id: 'sp2', role: 'assistant', text: '我会先确认 App 注册、CLI 触发、Server 转发、数据库模型和通知点击数据，再按可独立验证的部分分工。', timeLabel: '8月5日 09:20' },
                    { id: 'sp3', role: 'assistant', text: '范围确认：Android 主流程和现有 Expo 路径并存；厂商通道配置纳入接入，但不阻塞主流程验收。', timeLabel: '8月5日 09:26' },
                    { id: 'sp4', role: 'tool', title: '仓库检查', text: '找到 apiPush、pushNotifications、pushRoutes 和现有 Expo Token 生命周期代码。', timeLabel: '8月5日 09:34' },
                    { id: 'sp5', role: 'assistant', text: '将实现拆为 App 注册与前台通知、CLI 触发、Server 账号范围转发、安装标识与迁移、测试与配置五部分。', timeLabel: '8月5日 09:41' },
                    { id: 'sp6', role: 'tool', title: '实现进度', text: '已新增 doopush、doopushRegistrationState、pushInstallationId、pushTokenCleanup 与 notificationData 等模块。', timeLabel: '8月6日 16:40' },
                    { id: 'sp7', role: 'assistant', text: 'Iris 确认锁屏摘要不放任务正文；点击数据仅保留恢复页面所需字段。安衡开始覆盖注册、退出和前台通知。', timeLabel: '8月7日 10:12' },
                    { id: 'sp8', role: 'tool', title: '测试结果', text: 'App、CLI 和 Server 推送相关定向测试通过。', timeLabel: '8月7日 15:36' },
                    { id: 'sp9', role: 'assistant', text: '主接入已整理为提交 1028e2d9：54 个文件，新增 3316 行、删除 130 行。账号归属修复与回归已一并纳入主线。', timeLabel: '8月11日 13:20' },
                ],
            },
            {
                id: 'mock-session-account-binding-1', executionId: 'exec-account-binding-1', agentId: 'developer', title: '设备 Token 账号归属 · 第 1 次执行', provider: 'Codex', statusLabel: '未通过验证', projectLabel: 'happy-next · feature/doopush',
                messages: [
                    { id: 'sa11', role: 'user', text: '复现账号 A 退出后登录账号 B 的设备归属问题。只修账号隔离，不改通知协议。', timeLabel: '8月11日 09:12' },
                    { id: 'sa12', role: 'assistant', text: '我先看 AuthContext、pushTokenLogout、apiPush 和注册状态，确认旧绑定在哪一步没有清理。', timeLabel: '8月11日 09:14' },
                    { id: 'sa13', role: 'tool', title: '检查结果', text: 'App 侧退出和新账号注册存在时序窗口，先调整为清理完成后再开放注册。', timeLabel: '8月11日 09:20' },
                    { id: 'sa14', role: 'assistant', text: '第一版修复只改 App 顺序，并补了退出后重新注册测试。', timeLabel: '8月11日 09:24' },
                    { id: 'sa15', role: 'tool', title: '定向测试', text: 'pushTokenLogout 通过；pushRoutes 的旧账号 Token 选择用例仍失败。', timeLabel: '8月11日 09:31' },
                    { id: 'sa16', role: 'assistant', text: '原判断不完整。即使 App 清理顺序正确，服务端仍可能从历史记录中选到旧账号 Token。', timeLabel: '8月11日 09:33' },
                    { id: 'sa17', role: 'assistant', text: '本次执行应标记未通过。下一次同时检查 Token 唯一约束、注册门控和服务端账号范围选择。', timeLabel: '8月11日 09:36' },
                    { id: 'sa18', role: 'tool', title: '执行结束', text: '未生成提交；保留失败测试作为下一次修复的验收条件。', timeLabel: '8月11日 09:36' },
                ],
            },
            {
                id: 'mock-session-account-binding-2', executionId: 'exec-account-binding-2', agentId: 'developer', title: '设备 Token 账号归属 · 第 2 次执行', provider: 'Codex', statusLabel: '已完成', projectLabel: 'happy-next · feature/doopush',
                messages: [
                    { id: 'sa21', role: 'user', text: '按失败结果继续。目标仍然只有一个：同一设备 Token 只能归属当前账号。', timeLabel: '8月11日 09:42' },
                    { id: 'sa22', role: 'assistant', text: '这次会同时处理 App 注册门控、数据库唯一约束和 Server 账号范围，不扩展通知协议。', timeLabel: '8月11日 09:44' },
                    { id: 'sa23', role: 'tool', title: 'App 修复', text: '新增 pushTokenRegistrationGate，并调整 apiPush、pushTokenLogout 和 sync 的注册时机。', timeLabel: '8月11日 10:08' },
                    { id: 'sa24', role: 'tool', title: '数据约束', text: '新增 make_push_token_globally_unique 迁移，避免同一 Token 同时归属多个账号。', timeLabel: '8月11日 10:21' },
                    { id: 'sa25', role: 'tool', title: '服务端修复', text: 'pushRoutes 仅保留当前账号有效 Token，并补充账号切换测试。', timeLabel: '8月11日 10:33' },
                    { id: 'sa26', role: 'assistant', text: '第一轮失败的服务端用例现在通过，接着运行 apiPush、退出清理和注册门控测试。', timeLabel: '8月11日 10:40' },
                    { id: 'sa27', role: 'tool', title: '测试结果', text: 'apiPush、pushTokenLogout、pushTokenRegistrationGate、pushRoutes 相关用例全部通过。', timeLabel: '8月11日 10:49' },
                    { id: 'sa28', role: 'assistant', text: '已形成提交 d18127bd（PR #28）。修复覆盖 13 个文件，新增 538 行、删除 38 行。', timeLabel: '8月11日 10:58' },
                    { id: 'sa29', role: 'assistant', text: '剩余动作是由安衡独立复测账号 A→退出→账号 B，以及重复登录。', timeLabel: '8月11日 10:58' },
                ],
            },
            {
                id: 'mock-session-final-validation-1', executionId: 'exec-final-validation', agentId: 'tester', title: '账号切换与通知回归验证', provider: 'Gemini', statusLabel: '已完成', projectLabel: 'happy-next · feature/doopush',
                messages: [
                    { id: 'sv1', role: 'user', text: '只验证账号归属修复，不扩大测试范围。', timeLabel: '8月11日 11:06' },
                    { id: 'sv2', role: 'assistant', text: '验收路径：账号 A 登录并注册、退出、账号 B 登录、账号 B 重复登录、向两个账号分别触发通知。', timeLabel: '8月11日 11:08' },
                    { id: 'sv3', role: 'tool', title: '账号切换', text: '账号 B 登录后，当前设备只保留账号 B 的有效绑定。', timeLabel: '8月11日 11:24' },
                    { id: 'sv4', role: 'tool', title: '旧账号隔离', text: '向账号 A 触发通知时不会命中当前设备；账号 B 可正常接收。', timeLabel: '8月11日 11:31' },
                    { id: 'sv5', role: 'tool', title: '重复登录', text: '账号 B 重复登录和重新注册后未产生第二条 Token 归属。', timeLabel: '8月11日 11:37' },
                    { id: 'sv6', role: 'assistant', text: '三个关键路径均通过，未发现旧账号继续接收或重复绑定。', timeLabel: '8月11日 11:44' },
                    { id: 'sv7', role: 'assistant', text: '回归结论：账号归属修复可以验收。', timeLabel: '8月11日 11:48' },
                ],
            },
            {
                id: 'mock-session-review-delivery-1', executionId: 'exec-review-delivery', agentId: 'reviewer', title: '通知交付与凭证配置审查', provider: 'Claude Code', statusLabel: '已完成', projectLabel: 'happy-next · feature/doopush',
                messages: [
                    { id: 'sr1', role: 'user', text: '检查凭证、安全边界和 Expo 兼容。不要触发生产发布。', timeLabel: '8月12日 09:20' },
                    { id: 'sr2', role: 'assistant', text: '我会核对 .env.example、Docker、App 配置、Server 路由和测试中的凭证字段。', timeLabel: '8月12日 09:23' },
                    { id: 'sr3', role: 'tool', title: '配置检查', text: 'DooPush 应用凭证字段与当前配置命名不完全一致，可能导致真实环境初始化失败。', timeLabel: '8月12日 09:38' },
                    { id: 'sr4', role: 'assistant', text: '这是独立配置缺陷，不应与账号归属修复混为一个提交。服务端密钥继续只保留在服务端环境。', timeLabel: '8月12日 09:41' },
                    { id: 'sr5', role: 'tool', title: '适配完成', text: '已同步修改 doopush.config.js、App 初始化、Server 路由、Docker 示例和测试。', timeLabel: '8月12日 10:16' },
                    { id: 'sr6', role: 'tool', title: '测试结果', text: 'doopush、doopushConfig 和 pushRoutes 的凭证相关测试通过。', timeLabel: '8月12日 10:26' },
                    { id: 'sr7', role: 'assistant', text: '提交 48ace234 已完成。Expo 兼容路径保留，客户端未暴露服务端凭证，也没有自动发布生产环境。', timeLabel: '8月12日 10:32' },
                ],
            },
        ],
        conversations: [
            { id: 'team-lead-chat', kind: 'group', agentId: 'product-lead', teamId: 'happy-dev-team', title: 'DooPush 接入协作群', subtitle: '群组 · 1 位真人 · 5 个 Agent', lastMessage: '三个真实提交和回归记录已整理完成。', timeLabel: '8月12日', unread: false, emoji: '🚀', participantAgentIds: ['product-lead', 'designer', 'developer', 'tester', 'reviewer'], humanParticipantCount: 1 },
            { id: 'developer-chat', kind: 'direct', agentId: 'developer', teamId: null, title: '程墨', subtitle: '全栈工程师', lastMessage: 'd18127bd 已提交，等待独立回归。', timeLabel: '8月11日', unread: false, emoji: '💻', participantAgentIds: ['developer'], humanParticipantCount: 1 },
            { id: 'tester-chat', kind: 'direct', agentId: 'tester', teamId: null, title: '安衡', subtitle: '质量与发布', lastMessage: '账号切换和重复登录回归通过。', timeLabel: '8月11日', unread: false, emoji: '🧪', participantAgentIds: ['tester'], humanParticipantCount: 1 },
            { id: 'reviewer-chat', kind: 'direct', agentId: 'reviewer', teamId: null, title: 'Sage', subtitle: '技术审查', lastMessage: '凭证适配已独立提交，交付可以验收。', timeLabel: '8月12日', unread: false, emoji: '🔍', participantAgentIds: ['reviewer'], humanParticipantCount: 1 },
        ],
        messages: {
            'team-lead-chat': [
                { id: 'tl1', kind: 'text', sender: 'user', text: '接入 DooPush。主流程先跑通，保留 Expo 兼容，不做生产发布。', timeLabel: '8月5日 09:18' },
                { id: 'tl2', kind: 'text', sender: 'agent', agentId: 'product-lead', text: '先确认范围：iOS、Android 和所有厂商通道都要同时完成，还是 Android 主流程优先？', timeLabel: '8月5日 09:21' },
                { id: 'tl3', kind: 'text', sender: 'user', text: 'Android 主流程优先。厂商通道配置可以做，但不要阻塞主流程。', timeLabel: '8月5日 09:24' },
                { id: 'tl4', kind: 'assignment', sender: 'agent', agentId: 'product-lead', title: '按接入、验证和审查分工', workItemIds: ['push-upgrade', 'final-validation', 'review-delivery'], timeLabel: '8月5日 09:26' },
                { id: 'tl5', kind: 'text', sender: 'agent', agentId: 'designer', text: '我检查通知内容和点击路径。锁屏摘要不放任务正文，点击只带恢复页面需要的数据。', timeLabel: '8月5日 09:31' },
                { id: 'tl6', kind: 'text', sender: 'agent', agentId: 'developer', text: '现有链路分散在 App 注册、CLI 触发和 Server 转发。我会保留 Expo 路径，再增加 DooPush provider 和安装标识。', timeLabel: '8月5日 09:38' },
                { id: 'tl7', kind: 'text', sender: 'agent', agentId: 'tester', text: '我会覆盖注册、前台通知、退出清理、账号切换和服务端账号范围，不把营销通知纳入本轮。', timeLabel: '8月5日 09:44' },
                { id: 'tl9', kind: 'text', sender: 'agent', agentId: 'tester', text: '账号 A 退出后登录账号 B 时，服务端仍可能从历史记录选到旧账号 Token。', timeLabel: '8月11日 09:08' },
                { id: 'tl10', kind: 'assignment', sender: 'agent', agentId: 'product-lead', title: '新增账号归属修复', workItemIds: ['account-binding'], timeLabel: '8月11日 09:10' },
                { id: 'tl11', kind: 'decision', sender: 'agent', agentId: 'product-lead', title: '修复范围', body: '账号归属缺陷会涉及 App 与 Server。是否保持通知协议不变，只修账号隔离？', options: ['只修账号隔离，不改通知协议', '同时重做通知协议'], selectedOption: '只修账号隔离，不改通知协议', timeLabel: '8月11日 09:11' },
                { id: 'tl12', kind: 'text', sender: 'user', text: '只修账号隔离，不改通知协议。第一次不通过就把失败原因保留下来。', timeLabel: '8月11日 09:12' },
                { id: 'tl13', kind: 'text', sender: 'agent', agentId: 'developer', text: '第一次只改 App 顺序后，Server 账号范围测试仍失败。第二次补了 Token 唯一约束和服务端选择逻辑。', timeLabel: '8月11日 10:49' },
                { id: 'tl14', kind: 'text', sender: 'agent', agentId: 'tester', text: '复测通过：账号 A→退出→账号 B、重复登录、旧账号隔离都符合预期。', timeLabel: '8月11日 11:48' },
                { id: 'tl8', kind: 'completion', sender: 'agent', agentId: 'product-lead', title: '主接入完成', body: '已形成提交 1028e2d9：54 个文件，新增 3316 行、删除 130 行。账号归属修复与回归已一并纳入主线。', timeLabel: '8月11日 13:20' },
                { id: 'tl15', kind: 'text', sender: 'agent', agentId: 'reviewer', text: '另发现 DooPush 应用凭证格式和现有配置不一致，建议单独修复，不与账号归属提交混在一起。', timeLabel: '8月12日 09:38' },
                { id: 'tl16', kind: 'completion', sender: 'agent', agentId: 'product-lead', title: 'DooPush 案例完成', body: '主接入 1028e2d9、账号归属 d18127bd（PR #28）、凭证适配 48ace234 均有对应测试和记录。', timeLabel: '8月12日 10:35' },
            ],
            'developer-chat': [
                { id: 'dev1', kind: 'text', sender: 'user', text: '先复现设备 Token 还归属旧账号的问题，只在开发分支处理。', timeLabel: '8月11日 09:12' },
                { id: 'dev2', kind: 'text', sender: 'agent', agentId: 'developer', text: '我先看 AuthContext、pushTokenLogout、apiPush、注册门控和 Server 的 pushRoutes。', timeLabel: '8月11日 09:14' },
                { id: 'dev3', kind: 'text', sender: 'agent', agentId: 'developer', text: '第一判断是退出清理与新账号注册有时序窗口，我先只调整 App 顺序。', timeLabel: '8月11日 09:20' },
                { id: 'dev4', kind: 'text', sender: 'agent', agentId: 'developer', text: 'App 退出用例通过，但 Server 账号范围用例仍失败。说明问题不只在退出顺序。', timeLabel: '8月11日 09:31' },
                { id: 'dev5', kind: 'text', sender: 'user', text: '保留这次失败，按测试结果继续，不要掩盖第一次判断不完整。', timeLabel: '8月11日 09:37' },
                { id: 'dev6', kind: 'text', sender: 'agent', agentId: 'developer', text: '第二次会同时补注册门控、Token 全局唯一约束和 Server 当前账号过滤。', timeLabel: '8月11日 09:42' },
                { id: 'dev7', kind: 'work', sender: 'agent', agentId: 'developer', workItemId: 'account-binding', timeLabel: '8月11日 09:43' },
                { id: 'dev8', kind: 'text', sender: 'agent', agentId: 'developer', text: 'apiPush、pushTokenLogout、pushTokenRegistrationGate 和 pushRoutes 相关用例已通过。', timeLabel: '8月11日 10:49' },
                { id: 'dev9', kind: 'text', sender: 'agent', agentId: 'developer', text: '已提交 d18127bd，对应 PR #28。现在交给安衡做账号切换和重复登录的独立回归。', timeLabel: '8月11日 10:58' },
            ],
            'tester-chat': [
                { id: 'qa1', kind: 'text', sender: 'user', text: '只验证账号归属修复：账号切换、退出重登和重复登录。', timeLabel: '8月11日 11:06' },
                { id: 'qa2', kind: 'text', sender: 'agent', agentId: 'tester', text: '验收步骤已固定：账号 A 登录并注册、退出、账号 B 登录、账号 B 重复登录，再分别触发通知。', timeLabel: '8月11日 11:08' },
                { id: 'qa3', kind: 'work', sender: 'agent', agentId: 'tester', workItemId: 'final-validation', timeLabel: '8月11日 11:09' },
                { id: 'qa4', kind: 'text', sender: 'agent', agentId: 'tester', text: '账号 B 登录后，当前设备只保留账号 B 的一条有效绑定。', timeLabel: '8月11日 11:24' },
                { id: 'qa5', kind: 'text', sender: 'agent', agentId: 'tester', text: '向账号 A 触发通知不会命中当前设备；账号 B 可正常接收。', timeLabel: '8月11日 11:31' },
                { id: 'qa6', kind: 'text', sender: 'agent', agentId: 'tester', text: '账号 B 重复登录和重新注册后，没有产生第二条 Token 归属记录。', timeLabel: '8月11日 11:37' },
                { id: 'qa7', kind: 'text', sender: 'user', text: '测试结果和对应用例都保留，给交付审查看。', timeLabel: '8月11日 11:42' },
                { id: 'qa8', kind: 'completion', sender: 'agent', agentId: 'tester', title: '回归通过', body: '账号切换、旧账号隔离和重复登录均符合验收条件。', timeLabel: '8月11日 11:48' },
            ],
            'reviewer-chat': [
                { id: 'rv1', kind: 'text', sender: 'user', text: '检查凭证、安全边界和 Expo 兼容，不要触发生产发布。', timeLabel: '8月12日 09:20' },
                { id: 'rv2', kind: 'work', sender: 'agent', agentId: 'reviewer', workItemId: 'review-delivery', timeLabel: '8月12日 09:22' },
                { id: 'rv3', kind: 'text', sender: 'agent', agentId: 'reviewer', text: '账号归属修复和回归证据一致，没有自动生产发布路径。', timeLabel: '8月12日 09:31' },
                { id: 'rv4', kind: 'text', sender: 'agent', agentId: 'reviewer', text: '发现 DooPush 应用凭证字段与现有配置命名不完全一致，真实环境可能初始化失败。', timeLabel: '8月12日 09:38' },
                { id: 'rv5', kind: 'text', sender: 'user', text: '单独修这个配置问题，不要和账号归属提交混在一起。', timeLabel: '8月12日 09:41' },
                { id: 'rv6', kind: 'text', sender: 'agent', agentId: 'reviewer', text: '已同步 App 配置、Server 路由、Docker 示例和测试；服务端凭证不会下发客户端。', timeLabel: '8月12日 10:26' },
                { id: 'rv7', kind: 'completion', sender: 'agent', agentId: 'reviewer', title: '交付审查通过', body: '凭证适配提交 48ace234 已完成，Expo 兼容路径保留，可以验收。', timeLabel: '8月12日 10:32' },
            ],
        },
    };
}

function createEnData(): AiTeamMockData {
    const zh = createZhData();
    const agents: AiAgent[] = [
        { ...zh.agents[0], role: 'Product & Delivery Lead', description: 'Clarifies goals, controls scope, coordinates the team, and escalates important trade-offs.', statusLabel: 'Available', skills: ['Requirements', 'Task planning', 'Progress synthesis', 'Risk identification'] },
        { ...zh.agents[1], role: 'Full-stack Engineer', description: 'Implements features, investigates defects, and delivers runnable results.', statusLabel: 'Available', skills: ['Mobile', 'Backend', 'Debugging', 'Automated tests'] },
        { ...zh.agents[2], role: 'Product Designer', description: 'Reviews notification hierarchy, navigation, and cross-platform consistency.', statusLabel: 'Available', skills: ['Information architecture', 'Interaction design', 'UI review', 'Cross-platform UX'] },
        { ...zh.agents[3], role: 'Quality & Release', description: 'Validates account switching, notification delivery, and regression scope.', statusLabel: 'Available', skills: ['Flow validation', 'Regression tests', 'Reproduction', 'Release checks'] },
        { ...zh.agents[4], role: 'Technical Reviewer', description: 'Reviews configuration, security boundaries, compatibility, and maintenance risks.', statusLabel: 'Available', skills: ['Architecture review', 'Code quality', 'Security boundaries', 'Technical risk'] },
    ];
    const workItems: AiWorkItem[] = [
        { ...zh.workItems[0], title: 'DooPush cross-platform integration', statusLabel: 'Completed', sourceLabel: 'GitHub Issue #328 · Demo record', summary: 'Integrated app registration, CLI delivery, account-scoped server relay, vendor configuration, and Expo compatibility.' },
        { ...zh.workItems[1], title: 'Bind device token to one account', statusLabel: 'Completed', sourceLabel: 'GitHub Issue #331 · Demo record', summary: 'Ensured one device token belongs only to the current account after logout or account switching.' },
        { ...zh.workItems[2], title: 'Account switching regression', statusLabel: 'Completed', sourceLabel: 'Execution · Regression', summary: 'Covered account A logout, account B login, repeated login, old-account isolation, and one active binding.' },
        { ...zh.workItems[3], title: 'Delivery and credential review', statusLabel: 'Completed', sourceLabel: 'Execution · Delivery review', summary: 'Reviewed sensitive data, Expo compatibility, production permissions, and DooPush app credentials.' },
    ];
    const executions: AiExecution[] = [
        { ...zh.executions[0], statusLabel: 'Completed', triggerLabel: 'Started by human in group chat', startedAt: 'Aug 5, 2026, 09:18', durationLabel: '6 days 4 hours', summary: 'Coordinated app, CLI, server, and database changes across 54 files and produced commit 1028e2d9.', events: [
            { id: 'ep1-en', kind: 'status', actor: 'system', title: 'Execution started', body: 'Read the existing Expo push, CLI notification, and server relay flows.', timeLabel: 'Aug 5, 09:18', status: 'running' },
            { id: 'ep2-en', kind: 'comment', actor: 'agent', agentId: 'product-lead', title: 'Scope confirmed', body: 'Prioritize the Android main flow, preserve Expo compatibility, and do not deploy to production.', timeLabel: 'Aug 5, 09:26' },
            { id: 'ep3-en', kind: 'tool', actor: 'agent', agentId: 'developer', title: 'Main flow integrated', body: 'Added DooPush registration, foreground delivery, installation identity, CLI triggers, and account-scoped server relay.', timeLabel: 'Aug 6, 16:40' },
            { id: 'ep4-en', kind: 'comment', actor: 'agent', agentId: 'designer', title: 'Notification UX reviewed', body: 'Lock-screen summaries exclude sensitive task content and carry only navigation data.', timeLabel: 'Aug 7, 10:12' },
            { id: 'ep5-en', kind: 'tool', actor: 'agent', agentId: 'tester', title: 'Tests completed', body: 'Covered registration state, logout cleanup, foreground delivery, CLI push, and server routes.', timeLabel: 'Aug 7, 15:36' },
            { id: 'ep6-en', kind: 'result', actor: 'agent', agentId: 'product-lead', title: 'Committed 1028e2d9', body: '54 files changed, 3316 insertions, and 130 deletions.', timeLabel: 'Aug 11, 13:20', status: 'completed' },
        ] },
        { ...zh.executions[1], statusLabel: 'Validation failed', triggerLabel: 'Triggered by regression defect', startedAt: 'Aug 11, 2026, 09:12', durationLabel: '24 minutes', summary: 'The first attempt changed only app ordering; server token selection could still return the old account.', events: [
            { id: 'ea11-en', kind: 'status', actor: 'system', title: 'Run 1 started', body: 'Checked logout cleanup, registration gating, and account-switch ordering.', timeLabel: 'Aug 11, 09:12', status: 'running' },
            { id: 'ea12-en', kind: 'tool', actor: 'agent', agentId: 'developer', title: 'App flow changed', body: 'Clear the old binding before allowing current-account registration.', timeLabel: 'Aug 11, 09:22' },
            { id: 'ea13-en', kind: 'tool', actor: 'agent', agentId: 'developer', title: 'Targeted tests run', body: 'pushTokenLogout passed, but the account-scoped pushRoutes case failed.', timeLabel: 'Aug 11, 09:31' },
            { id: 'ea14-en', kind: 'result', actor: 'agent', agentId: 'developer', title: 'Run 1 failed', body: 'The server also had to filter tokens by the active account.', timeLabel: 'Aug 11, 09:36', status: 'failed' },
        ] },
        { ...zh.executions[2], statusLabel: 'Completed', triggerLabel: 'Retried from failed result', startedAt: 'Aug 11, 2026, 09:42', durationLabel: '1 hour 16 minutes', summary: 'Fixed app registration gating, global token uniqueness, and account-scoped server selection in d18127bd (PR #28).', events: [
            { id: 'ea21-en', kind: 'status', actor: 'system', title: 'Run 2 started', body: 'Expanded the fix to app, database constraints, and server selection.', timeLabel: 'Aug 11, 09:42', status: 'running' },
            { id: 'ea22-en', kind: 'tool', actor: 'agent', agentId: 'developer', title: 'Account ownership fixed', body: 'Added registration gating so a token keeps one account owner.', timeLabel: 'Aug 11, 10:08' },
            { id: 'ea23-en', kind: 'tool', actor: 'agent', agentId: 'developer', title: 'Database constraint added', body: 'Added a global unique constraint for device tokens.', timeLabel: 'Aug 11, 10:21' },
            { id: 'ea24-en', kind: 'tool', actor: 'agent', agentId: 'tester', title: 'Tests passed', body: 'apiPush, pushTokenLogout, pushTokenRegistrationGate, and pushRoutes cases passed.', timeLabel: 'Aug 11, 10:49' },
            { id: 'ea25-en', kind: 'result', actor: 'agent', agentId: 'developer', title: 'Committed d18127bd', body: 'Device-token ownership fix completed in PR #28.', timeLabel: 'Aug 11, 10:58', status: 'completed' },
        ] },
        { ...zh.executions[3], statusLabel: 'Completed', triggerLabel: 'Post-fix regression', startedAt: 'Aug 11, 2026, 11:06', durationLabel: '42 minutes', summary: 'Validated account A logout, account B login, repeated login, old-account isolation, and one active binding.', events: [
            { id: 'ev1-en', kind: 'status', actor: 'system', title: 'Regression started', body: 'Kept the scope limited to account ownership.', timeLabel: 'Aug 11, 11:06', status: 'running' },
            { id: 'ev2-en', kind: 'tool', actor: 'agent', agentId: 'tester', title: 'Account switch validated', body: 'The old account no longer receives notifications on the current device.', timeLabel: 'Aug 11, 11:24' },
            { id: 'ev3-en', kind: 'tool', actor: 'agent', agentId: 'tester', title: 'Repeated login validated', body: 'Repeated registration still leaves one active token record.', timeLabel: 'Aug 11, 11:37' },
            { id: 'ev4-en', kind: 'result', actor: 'agent', agentId: 'tester', title: 'Regression passed', body: 'All account-isolation acceptance paths passed.', timeLabel: 'Aug 11, 11:48', status: 'completed' },
        ] },
        { ...zh.executions[4], statusLabel: 'Completed', triggerLabel: 'Delivery review', startedAt: 'Aug 12, 2026, 09:20', durationLabel: '1 hour 12 minutes', summary: 'Confirmed security and compatibility boundaries, then adapted DooPush app credentials in 48ace234.', events: [
            { id: 'er1-en', kind: 'status', actor: 'system', title: 'Delivery review started', body: 'Reviewed credential sources, client exposure, Expo compatibility, and production permissions.', timeLabel: 'Aug 12, 09:20', status: 'reviewing' },
            { id: 'er2-en', kind: 'comment', actor: 'agent', agentId: 'reviewer', title: 'Credential mismatch found', body: 'Existing environment fields did not fully match DooPush app credentials.', timeLabel: 'Aug 12, 09:38' },
            { id: 'er3-en', kind: 'tool', actor: 'agent', agentId: 'developer', title: 'App credentials adapted', body: 'Updated app config, server routes, Docker examples, and tests.', timeLabel: 'Aug 12, 10:16' },
            { id: 'er4-en', kind: 'result', actor: 'agent', agentId: 'reviewer', title: 'Committed 48ace234', body: 'Credentials fixed; server secrets remain server-side and no production deployment was triggered.', timeLabel: 'Aug 12, 10:32', status: 'completed' },
        ] },
    ];
    const sessionText: Record<string, string> = {
        sp1: 'Review the existing push flow first. Integrate DooPush, preserve Expo compatibility, and do not deploy to production.',
        sp2: 'I will check app registration, CLI triggers, server relay, database models, and notification navigation data before splitting the work.',
        sp3: 'Scope confirmed: keep the Android main flow and Expo path together; vendor-channel configuration is included but does not block acceptance.',
        sp4: 'Found apiPush, pushNotifications, pushRoutes, and the existing Expo token lifecycle.',
        sp5: 'Split into app registration and foreground delivery, CLI triggers, account-scoped server relay, installation migration, and tests/configuration.',
        sp6: 'Added doopush, doopushRegistrationState, pushInstallationId, pushTokenCleanup, notificationData, and related modules.',
        sp7: 'Iris confirmed that lock-screen summaries exclude task content. 安衡 started registration, logout, and foreground-notification checks.',
        sp8: 'Targeted push tests for app, CLI, and server passed.',
        sp9: 'Prepared commit 1028e2d9: 54 files changed, 3316 insertions, and 130 deletions. The account-ownership fix and regression are included in the integration branch.',
        sa11: 'Reproduce the device ownership problem after account A logs out and account B logs in. Fix isolation only; do not change the notification protocol.',
        sa12: 'I will inspect AuthContext, pushTokenLogout, apiPush, and registration state to find where the old binding survives.',
        sa13: 'There is a timing window between logout and new-account registration. First, require cleanup to finish before registration.',
        sa14: 'The first patch changes only app ordering and adds a logout-then-register test.',
        sa15: 'pushTokenLogout passed, but the old-account selection case in pushRoutes still failed.',
        sa16: 'The first assumption was incomplete. Even with correct app ordering, the server can still select a historical token.',
        sa17: 'Mark this run as failed. The next run must cover token uniqueness, registration gating, and account-scoped server selection.',
        sa18: 'No commit created. The failing test remains the acceptance condition for the retry.',
        sa21: 'Continue from the failed result. The goal remains one device token owned only by the current account.',
        sa22: 'This run will cover app registration gating, database uniqueness, and server account scope without expanding the protocol.',
        sa23: 'Added pushTokenRegistrationGate and adjusted apiPush, pushTokenLogout, and sync registration timing.',
        sa24: 'Added the make_push_token_globally_unique migration to prevent multi-account ownership.',
        sa25: 'pushRoutes now keeps only active tokens for the current account, with additional switching tests.',
        sa26: 'The previously failing server case now passes. Running apiPush, logout cleanup, and registration-gate tests next.',
        sa27: 'apiPush, pushTokenLogout, pushTokenRegistrationGate, and pushRoutes cases all passed.',
        sa28: 'Created commit d18127bd (PR #28): 13 files changed, 538 insertions, and 38 deletions.',
        sa29: 'The remaining step is an independent account A → logout → account B and repeated-login regression by 安衡.',
        sv1: 'Validate only the account-ownership fix; do not expand the scope.',
        sv2: 'Acceptance path: account A login and registration, logout, account B login, repeated account B login, then notifications for both accounts.',
        sv3: 'After account B logs in, the device keeps only account B as its active owner.',
        sv4: 'A notification for account A does not reach the current device; account B receives normally.',
        sv5: 'Repeated login and re-registration for account B do not create another token owner.',
        sv6: 'All three critical paths passed; no stale-account delivery or duplicate binding was found.',
        sv7: 'Regression result: the account-ownership fix is accepted.',
        sr1: 'Review credentials, security boundaries, and Expo compatibility. Do not deploy to production.',
        sr2: 'I will check .env.example, Docker, app configuration, server routes, and credential fields in tests.',
        sr3: 'DooPush app credential fields do not fully match the current configuration and may fail in a real environment.',
        sr4: 'This is a separate configuration defect and should not be mixed with the account-ownership commit. Server secrets remain server-side.',
        sr5: 'Updated doopush.config.js, app initialization, server routes, Docker examples, and tests.',
        sr6: 'Credential-related doopush, doopushConfig, and pushRoutes tests passed.',
        sr7: 'Commit 48ace234 is complete. Expo compatibility remains, server credentials are not exposed to clients, and production was not deployed.',
    };
    const sessionTitle: Record<string, string> = {
        sp4: 'Repository inspection', sp6: 'Implementation progress', sp8: 'Test results',
        sa13: 'Inspection result', sa15: 'Targeted tests', sa18: 'Run ended',
        sa23: 'App fix', sa24: 'Data constraint', sa25: 'Server fix', sa27: 'Test results',
        sv3: 'Account switching', sv4: 'Old-account isolation', sv5: 'Repeated login',
        sr3: 'Configuration review', sr5: 'Adaptation completed', sr6: 'Test results',
    };
    const executionSessions: AiMockExecutionSession[] = zh.executionSessions.map((session, index) => ({
        ...session,
        title: ['DooPush cross-platform integration', 'Device token ownership · Run 1', 'Device token ownership · Run 2', 'Account switching regression', 'Delivery and credential review'][index],
        statusLabel: index === 1 ? 'Validation failed' : 'Completed',
        messages: session.messages.map((message) => ({
            ...message,
            text: sessionText[message.id] ?? message.text,
            title: sessionTitle[message.id] ?? message.title,
            timeLabel: message.timeLabel.replace('8月5日', 'Aug 5').replace('8月6日', 'Aug 6').replace('8月7日', 'Aug 7').replace('8月11日', 'Aug 11').replace('8月12日', 'Aug 12'),
        })),
    }));
    const messages: Record<string, AiChatMessage[]> = {
        'team-lead-chat': [
            { id: 'tl1-en', kind: 'text', sender: 'user', text: 'Integrate DooPush. Get the main flow working, preserve Expo compatibility, and do not deploy to production.', timeLabel: 'Aug 5, 09:18' },
            { id: 'tl2-en', kind: 'text', sender: 'agent', agentId: 'product-lead', text: 'Should iOS, Android, and every vendor channel land together, or should we prioritize the Android main flow?', timeLabel: 'Aug 5, 09:21' },
            { id: 'tl3-en', kind: 'text', sender: 'user', text: 'Prioritize Android. Include vendor configuration, but do not let it block the main flow.', timeLabel: 'Aug 5, 09:24' },
            { id: 'tl4-en', kind: 'assignment', sender: 'agent', agentId: 'product-lead', title: 'Split into integration, validation, and review', workItemIds: ['push-upgrade', 'final-validation', 'review-delivery'], timeLabel: 'Aug 5, 09:26' },
            { id: 'tl5-en', kind: 'text', sender: 'agent', agentId: 'designer', text: 'I will review notification content and navigation. Lock-screen summaries should not contain task bodies.', timeLabel: 'Aug 5, 09:31' },
            { id: 'tl6-en', kind: 'text', sender: 'agent', agentId: 'developer', text: 'The current path is split across app registration, CLI triggers, and server relay. I will preserve Expo and add a DooPush provider plus installation identity.', timeLabel: 'Aug 5, 09:38' },
            { id: 'tl7-en', kind: 'text', sender: 'agent', agentId: 'tester', text: 'I will cover registration, foreground delivery, logout cleanup, account switching, and server account scope.', timeLabel: 'Aug 5, 09:44' },
            { id: 'tl9-en', kind: 'text', sender: 'agent', agentId: 'tester', text: "After account A logs out and account B logs in, the server can still select account A's historical token.", timeLabel: 'Aug 11, 09:08' },
            { id: 'tl10-en', kind: 'assignment', sender: 'agent', agentId: 'product-lead', title: 'Added account-ownership fix', workItemIds: ['account-binding'], timeLabel: 'Aug 11, 09:10' },
            { id: 'tl11-en', kind: 'decision', sender: 'agent', agentId: 'product-lead', title: 'Fix scope', body: 'The defect spans app and server behavior. Should we keep the protocol unchanged and fix only account isolation?', options: ['Fix account isolation only', 'Redesign the notification protocol too'], selectedOption: 'Fix account isolation only', timeLabel: 'Aug 11, 09:11' },
            { id: 'tl12-en', kind: 'text', sender: 'user', text: 'Fix account isolation only. If the first attempt fails, keep the failure evidence.', timeLabel: 'Aug 11, 09:12' },
            { id: 'tl13-en', kind: 'text', sender: 'agent', agentId: 'developer', text: 'The first app-only fix still failed server account-scope tests. The retry added token uniqueness and server filtering.', timeLabel: 'Aug 11, 10:49' },
            { id: 'tl14-en', kind: 'text', sender: 'agent', agentId: 'tester', text: 'Regression passed: account A → logout → account B, repeated login, and old-account isolation all behave correctly.', timeLabel: 'Aug 11, 11:48' },
            { id: 'tl8-en', kind: 'completion', sender: 'agent', agentId: 'product-lead', title: 'Main integration completed', body: 'Commit 1028e2d9 changes 54 files with 3316 insertions and 130 deletions. The account-ownership fix and regression are included in the integration branch.', timeLabel: 'Aug 11, 13:20' },
            { id: 'tl15-en', kind: 'text', sender: 'agent', agentId: 'reviewer', text: 'DooPush credential fields also differ from the current configuration. This should be fixed separately.', timeLabel: 'Aug 12, 09:38' },
            { id: 'tl16-en', kind: 'completion', sender: 'agent', agentId: 'product-lead', title: 'DooPush case completed', body: 'Integration 1028e2d9, account ownership d18127bd (PR #28), and credential adaptation 48ace234 all have test evidence.', timeLabel: 'Aug 12, 10:35' },
        ],
        'developer-chat': [
            { id: 'dev1-en', kind: 'text', sender: 'user', text: 'Reproduce the stale device-token ownership problem on the development branch only.', timeLabel: 'Aug 11, 09:12' },
            { id: 'dev2-en', kind: 'text', sender: 'agent', agentId: 'developer', text: 'I will inspect AuthContext, pushTokenLogout, apiPush, registration gating, and server pushRoutes.', timeLabel: 'Aug 11, 09:14' },
            { id: 'dev3-en', kind: 'text', sender: 'agent', agentId: 'developer', text: 'My first hypothesis is a timing window between cleanup and new-account registration. I will change only app ordering first.', timeLabel: 'Aug 11, 09:20' },
            { id: 'dev4-en', kind: 'text', sender: 'agent', agentId: 'developer', text: 'The logout test passes, but the server account-scope test still fails. The defect is not app ordering alone.', timeLabel: 'Aug 11, 09:31' },
            { id: 'dev5-en', kind: 'text', sender: 'user', text: 'Keep this failed run and continue from the test evidence.', timeLabel: 'Aug 11, 09:37' },
            { id: 'dev6-en', kind: 'text', sender: 'agent', agentId: 'developer', text: 'The retry will add registration gating, global token uniqueness, and active-account filtering on the server.', timeLabel: 'Aug 11, 09:42' },
            { id: 'dev7-en', kind: 'work', sender: 'agent', agentId: 'developer', workItemId: 'account-binding', timeLabel: 'Aug 11, 09:43' },
            { id: 'dev8-en', kind: 'text', sender: 'agent', agentId: 'developer', text: 'apiPush, pushTokenLogout, pushTokenRegistrationGate, and pushRoutes cases now pass.', timeLabel: 'Aug 11, 10:49' },
            { id: 'dev9-en', kind: 'text', sender: 'agent', agentId: 'developer', text: 'Committed d18127bd in PR #28. It is ready for independent account-switching regression.', timeLabel: 'Aug 11, 10:58' },
        ],
        'tester-chat': [
            { id: 'qa1-en', kind: 'text', sender: 'user', text: 'Validate account switching, logout-login, and repeated login only.', timeLabel: 'Aug 11, 11:06' },
            { id: 'qa2-en', kind: 'text', sender: 'agent', agentId: 'tester', text: 'The path is fixed: account A login, logout, account B login, repeated account B login, then notifications for both accounts.', timeLabel: 'Aug 11, 11:08' },
            { id: 'qa3-en', kind: 'work', sender: 'agent', agentId: 'tester', workItemId: 'final-validation', timeLabel: 'Aug 11, 11:09' },
            { id: 'qa4-en', kind: 'text', sender: 'agent', agentId: 'tester', text: 'After account B logs in, the device keeps one active binding for account B.', timeLabel: 'Aug 11, 11:24' },
            { id: 'qa5-en', kind: 'text', sender: 'agent', agentId: 'tester', text: 'Account A notifications no longer reach this device; account B notifications do.', timeLabel: 'Aug 11, 11:31' },
            { id: 'qa6-en', kind: 'text', sender: 'agent', agentId: 'tester', text: 'Repeated login and registration for account B do not create a second ownership record.', timeLabel: 'Aug 11, 11:37' },
            { id: 'qa7-en', kind: 'text', sender: 'user', text: 'Keep the results and linked tests for delivery review.', timeLabel: 'Aug 11, 11:42' },
            { id: 'qa8-en', kind: 'completion', sender: 'agent', agentId: 'tester', title: 'Regression passed', body: 'Account switching, old-account isolation, and repeated login meet acceptance criteria.', timeLabel: 'Aug 11, 11:48' },
        ],
        'reviewer-chat': [
            { id: 'rv1-en', kind: 'text', sender: 'user', text: 'Review credentials, security boundaries, and Expo compatibility. Do not deploy to production.', timeLabel: 'Aug 12, 09:20' },
            { id: 'rv2-en', kind: 'work', sender: 'agent', agentId: 'reviewer', workItemId: 'review-delivery', timeLabel: 'Aug 12, 09:22' },
            { id: 'rv3-en', kind: 'text', sender: 'agent', agentId: 'reviewer', text: 'The account-ownership fix matches its regression evidence and has no automatic production deployment path.', timeLabel: 'Aug 12, 09:31' },
            { id: 'rv4-en', kind: 'text', sender: 'agent', agentId: 'reviewer', text: 'DooPush app credential fields do not fully match the current configuration and may fail in a real environment.', timeLabel: 'Aug 12, 09:38' },
            { id: 'rv5-en', kind: 'text', sender: 'user', text: 'Fix the configuration separately; do not mix it with account ownership.', timeLabel: 'Aug 12, 09:41' },
            { id: 'rv6-en', kind: 'text', sender: 'agent', agentId: 'reviewer', text: 'App config, server routes, Docker examples, and tests are aligned. Server credentials stay server-side.', timeLabel: 'Aug 12, 10:26' },
            { id: 'rv7-en', kind: 'completion', sender: 'agent', agentId: 'reviewer', title: 'Delivery review passed', body: 'Credential adaptation commit 48ace234 is complete and Expo compatibility remains.', timeLabel: 'Aug 12, 10:32' },
        ],
    };
    return {
        agents,
        teams: [{ ...zh.teams[0], name: 'Happy Next Product Team', description: 'Coordinates product, design, engineering, quality, and technical review.', currentGoal: 'Complete DooPush integration, account-isolation fixes, credential adaptation, and verifiable test evidence.' }],
        workItems,
        executions,
        executionSessions,
        conversations: [
            { ...zh.conversations[0], title: 'DooPush Integration Group', subtitle: 'Group · 1 human · 5 agents', lastMessage: 'All three commits and regression records are ready.', timeLabel: 'Aug 12' },
            { ...zh.conversations[1], subtitle: agents[1].role, lastMessage: 'd18127bd is committed and ready for independent regression.', timeLabel: 'Aug 11' },
            { ...zh.conversations[2], subtitle: agents[3].role, lastMessage: 'Account switching and repeated-login regression passed.', timeLabel: 'Aug 11' },
            { ...zh.conversations[3], subtitle: agents[4].role, lastMessage: 'Credential adaptation is committed and the delivery is approved.', timeLabel: 'Aug 12' },
        ],
        messages,
    };
}

export function getAiTeamMockData(): AiTeamMockData {
    return getCurrentLanguage().startsWith('zh') ? createZhData() : createEnData();
}

export function findAiAgent(data: AiTeamMockData, id: string): AiAgent | undefined {
    return data.agents.find((agent) => agent.id === id);
}

export function findAiTeam(data: AiTeamMockData, id: string): AiTeam | undefined {
    return data.teams.find((team) => team.id === id);
}

export function findAiWorkItem(data: AiTeamMockData, id: string): AiWorkItem | undefined {
    return data.workItems.find((item) => item.id === id);
}

export function findAiExecution(data: AiTeamMockData, id: string): AiExecution | undefined {
    return data.executions.find((execution) => execution.id === id);
}

export function findAiExecutionSession(data: AiTeamMockData, id: string): AiMockExecutionSession | undefined {
    return data.executionSessions.find((session) => session.id === id);
}

export function findAiExecutionsForWork(data: AiTeamMockData, workItemId: string): AiExecution[] {
    return data.executions.filter((execution) => execution.workItemId === workItemId).sort((a, b) => b.attempt - a.attempt);
}

export function getAiWorkSourcePath(work: AiWorkItem): string | null {
    if (work.sourceType === 'github') {
        const match = work.sourceResourceId.match(/^([^/]+)\/([^#]+)#(\d+)$/);
        return match ? `/repos/${match[1]}/${match[2]}/issue/${match[3]}?mockWorkId=${encodeURIComponent(work.id)}` : null;
    }
    if (work.sourceType === 'dootask') return `/dootask/${work.sourceResourceId}`;
    if (work.sourceType === 'session') return `/session/${work.sourceResourceId}`;
    const executionId = work.executionIds.at(-1);
    return executionId ? `/inbox/ai/executions/${executionId}` : null;
}
