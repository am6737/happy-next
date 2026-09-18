type AgentSettings = {
    instructions: string;
    engine: 'claude-code' | 'codex' | 'gemini';
    model: string;
    workingDirectory: string;
    permissionMode: 'read_only' | 'approval' | 'guarded_auto';
    allowDelegation: boolean;
};

type Agent = {
    id: string;
    name: string;
    role: string;
    description: string;
    emoji: string;
    skills: string[];
    responsibilities: string[];
    settings: AgentSettings;
    enabled?: boolean;
};

type Team = {
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

type State = { agents: Agent[]; teams: Team[] };

const serverUrl = (process.env.HAPPY_SERVER_URL || 'http://localhost:3031').replace(/\/$/, '');
const token = process.env.HAPPY_TOKEN;
const dryRun = process.argv.includes('--dry-run');
const updateExisting = process.argv.includes('--update-existing');

if (!token) {
    console.error('HAPPY_TOKEN is required. Do not put it in a committed file.');
    process.exit(1);
}

const commonDirectory = process.env.HAPPY_WORKING_DIRECTORY || process.cwd();

const agentDefinitions: Array<Omit<Agent, 'id' | 'enabled'>> = [
    {
        name: '技术负责人 Leader',
        role: '技术负责人',
        description: '负责需求技术评估、方案决策、代码审查和最终交付判断。',
        emoji: '🧭',
        skills: ['需求拆解', '架构设计', '代码审查', '风险管理'],
        responsibilities: ['评估需求范围', '选择技术方案', '审查实现结果', '确认是否交付'],
        settings: {
            instructions: `你负责 Happy 项目的技术决策和交付判断。先阅读真实代码、测试、数据库结构和现有 API，再评估需求范围、风险和验收方式。小任务直接推进，复杂任务才拆分。重点检查前后端、CLI、共享协议、数据库迁移和兼容性。不得编造接口、测试结果或完成状态。`,
            engine: 'claude-code',
            model: 'default',
            workingDirectory: commonDirectory,
            permissionMode: 'read_only',
            allowDelegation: true,
        },
    },
    {
        name: '产品经理',
        role: '产品经理',
        description: '负责把内部需求整理为清晰、可开发、可验收的产品任务。',
        emoji: '📝',
        skills: ['需求分析', '用户流程', '验收标准', '范围管理'],
        responsibilities: ['说明用户问题', '定义期望行为', '明确范围', '编写验收标准'],
        settings: {
            instructions: `你负责 Happy 项目的内部需求。把需求整理为背景、目标、当前问题、期望行为、范围、非目标、验收标准和待确认问题。先阅读相关产品流程和代码，不能编造不存在的页面、接口或字段。不要直接决定技术实现；当信息不足时明确阻塞问题。`,
            engine: 'claude-code',
            model: 'default',
            workingDirectory: commonDirectory,
            permissionMode: 'read_only',
            allowDelegation: false,
        },
    },
    {
        name: '全栈开发工程师',
        role: '全栈开发工程师',
        description: '负责在 Happy 中完成从 API、数据库到客户端和 CLI 的完整功能实现。',
        emoji: '🛠️',
        skills: ['TypeScript', 'React Native', 'Fastify', 'Prisma', 'CLI'],
        responsibilities: ['实现完整功能链路', '补充测试', '处理错误状态', '报告实现风险'],
        settings: {
            instructions: `你负责实现已确认的 Happy 内部需求。根据实际影响范围修改 happy-app、happy-server、happy-cli、happy-wire 或 Prisma schema，不按 package 人为限制工作范围。必须实现真实 API、数据库状态、任务执行链路、错误处理和前端反馈。禁止使用 mock 数据、固定成功响应或绕过后端的临时逻辑。完成后运行受影响 package 的类型检查和测试，并报告实际修改文件、命令结果和剩余风险。`,
            engine: 'codex',
            model: 'default',
            workingDirectory: commonDirectory,
            permissionMode: 'guarded_auto',
            allowDelegation: false,
        },
    },
    {
        name: '测试工程师',
        role: '测试工程师',
        description: '根据原始需求独立验证功能、数据流和异常路径是否达到交付标准。',
        emoji: '🧪',
        skills: ['Vitest', 'API 测试', '回归测试', 'PostgreSQL 验证'],
        responsibilities: ['验证正常流程', '验证失败和权限场景', '检查数据一致性', '提交测试结论'],
        settings: {
            instructions: `你负责独立验证 Happy 的内部需求。以真实用户流程和原始验收标准为准，检查正常流程、失败响应、空数据、重复提交、账户隔离、数据库 migration、Orchestrator 状态和真实 CLI runtime。不要把 mock 测试通过当作真实功能通过，也不能通过修改测试掩盖实现缺陷。问题必须包含复现步骤、实际结果、预期结果和影响范围。`,
            engine: 'codex',
            model: 'default',
            workingDirectory: commonDirectory,
            permissionMode: 'approval',
            allowDelegation: false,
        },
    },
    {
        name: '运维发布工程师',
        role: '运维与发布工程师',
        description: '负责构建、数据库迁移、环境检查、上线、回滚和发布后观察。',
        emoji: '🚀',
        skills: ['Docker', 'PostgreSQL', '部署检查', '回滚', '运行监控'],
        responsibilities: ['检查构建产物', '验证 migration', '检查环境依赖', '执行发布和回滚'],
        settings: {
            instructions: `你负责 Happy 的发布和运行环境。发布前检查构建、测试、Prisma migration、环境变量、CLI provider、任务队列和回滚方案。没有验证 migration 或关键运行链路时不得报告可以发布。发布后检查服务健康、API 错误、任务失败、provider 执行和日志异常。所有发布结论必须基于真实命令和真实环境结果。`,
            engine: 'codex',
            model: 'default',
            workingDirectory: commonDirectory,
            permissionMode: 'approval',
            allowDelegation: false,
        },
    },
];

const teamDefinition = {
    name: 'Happy 小型研发团队',
    description: '负责 Happy 项目从内部需求、开发、测试到发布的完整交付流程。',
    emoji: '🏗️',
    instructions: `这是一个小型研发团队，不要模拟大型组织的层层审批。\n\n工作流程：产品经理明确需求，技术负责人评估范围和方案，全栈开发完成实现，测试工程师独立验证，运维发布工程师检查环境并发布，技术负责人确认交付。\n\n全栈开发是一个需求的主要实现负责人，不要为了形式按 package 拆分任务。小需求可以由较少成员完成；涉及数据库、权限、任务调度或生产发布时必须增加验证。\n\n所有结论必须基于真实代码、真实数据库、真实测试和真实运行结果。禁止使用 mock、固定返回值或静态状态掩盖未实现的功能。`,
    currentGoal: '稳定交付 Happy 内部研发需求',
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${serverUrl}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...init?.headers,
        },
    });
    const body = await response.json().catch(() => undefined) as T & { error?: string } | undefined;
    if (!response.ok) throw new Error(body?.error || `${response.status} ${response.statusText}`);
    return body as T;
}

async function main() {
    const state = await request<State>('/v1/ai-team/state');
    const agentsByName = new Map(state.agents.map((agent) => [agent.name, agent]));
    const agentIds: string[] = [];

    for (const definition of agentDefinitions) {
        const existing = agentsByName.get(definition.name);
        if (existing) {
            agentIds.push(existing.id);
            if (updateExisting) {
                console.log(`${dryRun ? '[dry-run] would update' : 'updating'} agent: ${definition.name}`);
                if (!dryRun) await request(`/v1/ai-team/agents/${encodeURIComponent(existing.id)}`, { method: 'PUT', body: JSON.stringify({ ...definition, enabled: existing.enabled !== false }) });
            } else {
                console.log(`keeping existing agent: ${definition.name}`);
            }
            continue;
        }

        if (dryRun) {
            console.log(`[dry-run] would create agent: ${definition.name}`);
            agentIds.push(`dry-run:${definition.name}`);
        } else {
            const created = await request<{ id: string }>('/v1/ai-team/agents', { method: 'POST', body: JSON.stringify({ ...definition, enabled: true }) });
            console.log(`created agent: ${definition.name} (${created.id})`);
            agentIds.push(created.id);
        }
    }

    const existingTeam = state.teams.find((team) => team.name === teamDefinition.name);
    const leader = agentIds[0];
    if (!leader) throw new Error('The team leader was not created');
    const teamInput = { ...teamDefinition, leaderId: leader, memberIds: agentIds, progress: 0 };
    if (existingTeam) {
        if (updateExisting) {
            console.log(`${dryRun ? '[dry-run] would update' : 'updating'} team: ${teamDefinition.name}`);
            if (!dryRun) await request(`/v1/ai-team/teams/${encodeURIComponent(existingTeam.id)}`, { method: 'PUT', body: JSON.stringify(teamInput) });
        } else {
            console.log(`keeping existing team: ${teamDefinition.name}`);
        }
    } else if (dryRun) {
        console.log(`[dry-run] would create team: ${teamDefinition.name}`);
    } else {
        const created = await request<{ id: string }>('/v1/ai-team/teams', { method: 'POST', body: JSON.stringify(teamInput) });
        console.log(`created team: ${teamDefinition.name} (${created.id})`);
    }
}

main().catch((error) => {
    console.error(`AI team import failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
