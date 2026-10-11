import { describe, expect, it } from 'vitest';
import { expandEnvironmentVariables } from '@/utils/expandEnvVars';
import { getUnexpandedSessionAuthVariables, mergeSessionEnvironment, isolateTeammateEnvironment } from './sessionAuth';

describe('agent authentication validation after profile expansion', () => {
  const deepseekProfile = { ANTHROPIC_AUTH_TOKEN: '${DEEPSEEK_AUTH_TOKEN}', CUSTOM_VAR: '${CUSTOM_VALUE}' };

  it('allows Codex local login even if an old client sends unresolved Claude credentials', () => {
    const environment = expandEnvironmentVariables(deepseekProfile, {});
    expect(getUnexpandedSessionAuthVariables(environment, 'codex')).toEqual([]);
  });

  it('reports the unresolved credential when starting Claude with DeepSeek', () => {
    const environment = expandEnvironmentVariables(deepseekProfile, {});
    expect(getUnexpandedSessionAuthVariables(environment, 'claude')).toEqual(['ANTHROPIC_AUTH_TOKEN']);
  });

  it('allows Claude when the daemon can resolve the DeepSeek token', () => {
    const environment = expandEnvironmentVariables(deepseekProfile, { DEEPSEEK_AUTH_TOKEN: 'test-token' });
    expect(getUnexpandedSessionAuthVariables(environment, 'claude')).toEqual([]);
  });

  it.each(['claude', 'codex', 'gemini'] as const)('does not require an API key for %s local login', agent => {
    expect(getUnexpandedSessionAuthVariables({}, agent)).toEqual([]);
  });

  it('checks Codex credentials and ignores unrelated Gemini credentials', () => {
    expect(getUnexpandedSessionAuthVariables({ OPENAI_API_KEY: '${OPENAI_TOKEN}', GEMINI_API_KEY: '${GOOGLE_TOKEN}' }, 'codex'))
      .toEqual(['OPENAI_API_KEY']);
  });

  it('defers Gemini validation until its backend selects the actual credentials', () => {
    expect(getUnexpandedSessionAuthVariables({ GEMINI_API_KEY: '${GOOGLE_TOKEN}', ...deepseekProfile }, 'gemini'))
      .toEqual([]);
  });
});

it('merges internal extraEnv after profiles and before authentication for both spawn paths', () => {
  expect(mergeSessionEnvironment(
    { CUSTOM: 'profile', CLAUDE_CODE_OAUTH_TOKEN: 'profile-token' },
    { CUSTOM: 'teammate', HAPPY_TEAMMATE_ID: 'agent', CLAUDE_CODE_OAUTH_TOKEN: 'extra-token', CODEX_HOME: '/extra' },
    { CLAUDE_CODE_OAUTH_TOKEN: 'auth-token', CODEX_HOME: '/auth' },
  )).toEqual({ CUSTOM: 'teammate', HAPPY_TEAMMATE_ID: 'agent', CLAUDE_CODE_OAUTH_TOKEN: 'auth-token', CODEX_HOME: '/auth' });
});


it('isolates inherited credentials and controller capabilities by role', () => {
  const inherited = { HAPPY_TEAMMATE_CONTROL_TOKEN: 'controller-secret', HAPPY_TEAMMATE_SYSTEM_PROMPT_FILE: '/prompt', HAPPY_TEAMMATE_WORKER_ID: 'worker', HAPPY_TEAMMATE_EXTERNAL_CONTEXT: '{}', GH_TOKEN: 'github-secret', GITHUB_PERSONAL_ACCESS_TOKEN: 'github-secret', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'header', GIT_CONFIG_VALUE_0: 'secret', KEEP: 'value' };
  const worker = isolateTeammateEnvironment({ ...inherited, HAPPY_TEAMMATE_SESSION_ROLE: 'worker' });
  expect(worker).not.toHaveProperty('HAPPY_TEAMMATE_CONTROL_TOKEN');
  expect(worker).not.toHaveProperty('HAPPY_TEAMMATE_SYSTEM_PROMPT_FILE');
  expect(worker.GH_TOKEN).toBe('github-secret');
  const controller = isolateTeammateEnvironment({ ...inherited, HAPPY_TEAMMATE_SESSION_ROLE: 'controller' });
  for (const key of ['GH_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'HAPPY_TEAMMATE_WORKER_ID', 'HAPPY_TEAMMATE_EXTERNAL_CONTEXT']) expect(controller).not.toHaveProperty(key);
  expect(controller.HAPPY_TEAMMATE_CONTROL_TOKEN).toBe('controller-secret');
  expect(controller.KEEP).toBe('value');
  expect(isolateTeammateEnvironment(inherited)).toEqual(inherited);
});
