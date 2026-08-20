import type { RepoIssue, RepoIssueComment } from '@/data/mockRepos';

export type AiMockIssueTimelineEntry =
    | {
        id: string;
        type: 'activity';
        action: 'created' | 'assigned' | 'status_changed' | 'execution_started' | 'execution_completed' | 'execution_failed' | 'human_decision_required';
        actorType: 'human' | 'agent';
        actorName: string;
        agentId?: string;
        summary: string;
        timeLabel: string;
        executionId?: string;
    }
    | { id: string; type: 'comment'; commentId: number; timeLabel: string }
    | { id: string; type: 'run'; executionId: string; timeLabel: string };

export type AiMockGithubIssue = {
    issue: RepoIssue;
    comments: RepoIssueComment[];
    timeline: AiMockIssueTimelineEntry[];
};

const mockGithubIssues: Record<string, AiMockGithubIssue> = {
    'push-upgrade': {
        issue: {
            number: 328,
            title: '接入 DooPush 并保留现有通知兼容路径',
            body: `## 目标

在保留 Expo 兼容路径的前提下，接入 DooPush 原生通知，让 App 能接收 CLI 和服务端产生的账号范围通知。

## 本轮范围

- App 端 DooPush 注册、前台展示和通知点击数据
- 安装标识、Token 生命周期、退出清理和迁移
- CLI 通知触发与服务端账号范围转发
- Android 厂商通道配置与 Docker / 环境变量示例
- App、CLI、Server 相关测试

## 验收标准

- Android 主流程可运行，Expo 路径继续兼容
- 通知按账号范围转发，不自动触发生产发布
- 锁屏摘要不包含敏感任务正文
- 关键实现有对应测试和提交记录

> 本页是根据真实提交整理的交互演示 Issue；原始提交、文件变更和测试记录另附。`,
            state: 'closed', author: 'am6737', authorAvatarUrl: '', createdAt: '2026-08-05T01:18:00.000Z',
            labels: [{ name: 'enhancement', color: '1f6feb' }, { name: 'push', color: '8250df' }, { name: 'mobile', color: '0e8a16' }],
        },
        comments: [
            { id: 32801, author: 'am6737', authorAvatarUrl: '', authorAssociation: 'OWNER', createdAt: '2026-08-05T01:24:00.000Z', updatedAt: '2026-08-05T01:24:00.000Z', body: 'Android 主流程优先。厂商通道配置可以纳入，但不要阻塞主链路；保留 Expo 兼容，不做生产发布。' },
            { id: 32802, author: 'happy-next-agent[bot]', authorAvatarUrl: '', authorAssociation: 'COLLABORATOR', createdAt: '2026-08-05T01:41:00.000Z', updatedAt: '2026-08-05T01:41:00.000Z', body: 'Aria：已拆分为 App 注册与前台通知、CLI 触发、Server 账号范围转发、安装标识与迁移、测试与配置五部分。' },
            { id: 32803, author: 'happy-next-agent[bot]', authorAvatarUrl: '', authorAssociation: 'COLLABORATOR', createdAt: '2026-08-07T02:12:00.000Z', updatedAt: '2026-08-07T02:12:00.000Z', body: 'Iris：锁屏摘要不展示任务正文；点击数据只保留恢复目标页面所需字段，避免把敏感上下文放入系统通知。' },
            { id: 32804, author: 'happy-next-agent[bot]', authorAvatarUrl: '', authorAssociation: 'COLLABORATOR', createdAt: '2026-08-07T07:36:00.000Z', updatedAt: '2026-08-07T07:36:00.000Z', body: '安衡：注册状态、退出清理、前台通知、CLI 推送和服务端路由的相关测试已完成。账号切换将单独做回归。' },
            { id: 32805, author: 'happy-next-agent[bot]', authorAvatarUrl: '', authorAssociation: 'COLLABORATOR', createdAt: '2026-08-11T05:20:00.000Z', updatedAt: '2026-08-11T05:20:00.000Z', body: '程墨：主接入已形成提交 1028e2d9（feature/doopush），共 54 个文件，新增 3316 行、删除 130 行。' },
            { id: 32806, author: 'am6737', authorAvatarUrl: '', authorAssociation: 'OWNER', createdAt: '2026-08-12T02:35:00.000Z', updatedAt: '2026-08-12T02:35:00.000Z', body: '主接入、账号归属修复和凭证适配均已完成并有独立提交，关闭此演示 Issue。' },
        ],
        timeline: [
            { id: '328-created', type: 'activity', action: 'created', actorType: 'human', actorName: 'am6737', summary: '创建了 Issue', timeLabel: '8月5日 09:18' },
            { id: '328-assigned', type: 'activity', action: 'assigned', actorType: 'agent', actorName: 'Aria', agentId: 'product-lead', summary: '协调程墨、Iris、安衡和 Sage 参与接入', timeLabel: '8月5日 09:26' },
            { id: '328-comment-3', type: 'comment', commentId: 32803, timeLabel: '8月7日 10:12' },
            { id: '328-run-1', type: 'run', executionId: 'exec-push-upgrade', timeLabel: '8月11日 13:20' },
            { id: '328-comment-5', type: 'comment', commentId: 32805, timeLabel: '8月11日 13:20' },
            { id: '328-closed', type: 'activity', action: 'status_changed', actorType: 'human', actorName: 'am6737', summary: '将状态从 Open 改为 Closed', timeLabel: '8月12日 10:35' },
        ],
    },
    'account-binding': {
        issue: {
            number: 331,
            title: '设备 Token 只能归属一个账号',
            body: `## 问题

账号 A 退出后登录账号 B，当前设备 Token 仍可能保留在旧账号记录中；快速重复登录时也可能出现重复归属。

## 排查范围

- App 退出清理顺序
- Token 注册门控
- 数据库唯一约束
- 服务端账号范围 Token 选择

## 本轮边界

只修账号归属，不修改现有通知协议。

## 验收标准

- 账号 A 退出后，当前设备不再接收账号 A 的通知
- 登录账号 B 后，设备只保留账号 B 的有效绑定
- 重复登录或重新注册不会产生第二条归属记录

> 本页是根据真实提交 d18127bd（PR #28）整理的演示 Issue。`,
            state: 'closed', author: 'happy-next-agent[bot]', authorAvatarUrl: '', createdAt: '2026-08-11T01:08:00.000Z',
            labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'push', color: '8250df' }, { name: 'authentication', color: '0052cc' }],
        },
        comments: [
            { id: 33101, author: 'happy-next-agent[bot]', authorAvatarUrl: '', authorAssociation: 'COLLABORATOR', createdAt: '2026-08-11T01:08:00.000Z', updatedAt: '2026-08-11T01:08:00.000Z', body: '安衡：账号 A 退出后登录账号 B，服务端仍可能从历史记录选到旧账号 Token。' },
            { id: 33102, author: 'am6737', authorAvatarUrl: '', authorAssociation: 'OWNER', createdAt: '2026-08-11T01:12:00.000Z', updatedAt: '2026-08-11T01:12:00.000Z', body: '只修账号隔离，不改通知协议。第一次验证如果失败，保留失败原因再继续。' },
            { id: 33103, author: 'happy-next-agent[bot]', authorAvatarUrl: '', authorAssociation: 'COLLABORATOR', createdAt: '2026-08-11T01:36:00.000Z', updatedAt: '2026-08-11T01:36:00.000Z', body: '程墨：第一次只调整 App 退出与注册顺序。pushTokenLogout 通过，但 pushRoutes 的账号范围用例仍失败，说明服务端选择逻辑也需要修正。' },
            { id: 33104, author: 'happy-next-agent[bot]', authorAvatarUrl: '', authorAssociation: 'COLLABORATOR', createdAt: '2026-08-11T02:49:00.000Z', updatedAt: '2026-08-11T02:49:00.000Z', body: '程墨：第二次补充 pushTokenRegistrationGate、Token 全局唯一约束和 Server 当前账号过滤。apiPush、pushTokenLogout、pushTokenRegistrationGate、pushRoutes 相关用例通过。' },
            { id: 33105, author: 'happy-next-agent[bot]', authorAvatarUrl: '', authorAssociation: 'COLLABORATOR', createdAt: '2026-08-11T02:58:00.000Z', updatedAt: '2026-08-11T02:58:00.000Z', body: '程墨：修复已提交为 d18127bd，对应 PR #28。13 个文件变更，新增 538 行、删除 38 行。' },
            { id: 33106, author: 'happy-next-agent[bot]', authorAvatarUrl: '', authorAssociation: 'COLLABORATOR', createdAt: '2026-08-11T03:48:00.000Z', updatedAt: '2026-08-11T03:48:00.000Z', body: '安衡：账号 A→退出→账号 B、旧账号隔离和重复登录回归均通过，当前设备只保留一条有效绑定。' },
        ],
        timeline: [
            { id: '331-created', type: 'activity', action: 'created', actorType: 'agent', actorName: '安衡', agentId: 'tester', summary: '根据回归结果创建缺陷 Issue', timeLabel: '8月11日 09:08' },
            { id: '331-comment-2', type: 'comment', commentId: 33102, timeLabel: '8月11日 09:12' },
            { id: '331-run-1', type: 'run', executionId: 'exec-account-binding-1', timeLabel: '8月11日 09:36' },
            { id: '331-failed', type: 'activity', action: 'execution_failed', actorType: 'agent', actorName: '程墨', agentId: 'developer', summary: '第 1 次执行未通过，服务端账号范围测试仍失败', timeLabel: '8月11日 09:36', executionId: 'exec-account-binding-1' },
            { id: '331-run-2', type: 'run', executionId: 'exec-account-binding-2', timeLabel: '8月11日 10:58' },
            { id: '331-comment-6', type: 'comment', commentId: 33106, timeLabel: '8月11日 11:48' },
            { id: '331-closed', type: 'activity', action: 'status_changed', actorType: 'human', actorName: 'am6737', summary: '回归通过，将状态从 Open 改为 Closed', timeLabel: '8月11日 11:52' },
        ],
    },
};

export function getAiMockGithubIssue(workItemId: string): AiMockGithubIssue | null {
    return mockGithubIssues[workItemId] ?? null;
}
