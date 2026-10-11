import { TEAMMATE_ENV } from 'happy-wire';

// Only validate credentials consumed by the selected agent. Missing credentials
// are allowed: the agent may use its own locally persisted login.
const authVariables = {
  claude: ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'],
  codex: ['OPENAI_API_KEY', 'CODEX_HOME', 'AZURE_OPENAI_API_KEY', 'TOGETHER_API_KEY'],
  // Gemini resolves cloud/local tokens in createGeminiBackend before validating.
  gemini: [],
} as const;

export function getUnexpandedSessionAuthVariables(
  environment: Record<string, string>,
  agent: 'claude' | 'codex' | 'gemini' = 'claude',
): string[] {
  return authVariables[agent].filter(name => environment[name]?.includes('${'));
}

/** Internal overrides follow the profile, while resolved authentication always wins. */
export function mergeSessionEnvironment(
  profile: Record<string, string>,
  extra: Record<string, string> | undefined,
  auth: Record<string, string>,
): Record<string, string> {
  return { ...profile, ...extra, ...auth };
}

/** Credentials and controller capabilities cannot leak across teammate roles. */
export function isolateTeammateEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...environment };
  const role = env[TEAMMATE_ENV.sessionRole];
  if (role === 'worker') {
    delete env[TEAMMATE_ENV.controlToken];
    delete env[TEAMMATE_ENV.systemPromptFile];
  }
  if (role === 'controller') {
    delete env.GITHUB_PERSONAL_ACCESS_TOKEN;
    delete env.GH_TOKEN;
    for (const name of Object.keys(env)) {
      if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(name)) delete env[name];
    }
    delete env[TEAMMATE_ENV.workerId];
    delete env[TEAMMATE_ENV.externalContext];
  }
  return env;
}
