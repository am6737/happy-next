import { describe, expect, it } from 'vitest';

import { dropSessionEnv } from './sessionEnv';

describe('dropSessionEnv', () => {
  it('removes the variables of the session the daemon was started from and keeps the rest', () => {
    const env: NodeJS.ProcessEnv = {
      HAPPY_CLAUDE_RESUME_SESSION_ID: '65416e85-e27d-4e7c-aa99-44a60034b712',
      HAPPY_CLAUDE_SKIP_FORK_SESSION: '1',
      HAPPY_CLAUDE_BACKFILL: '1',
      HAPPY_SESSION_TITLE: 'An earlier session',
      HAPPY_ORCH_EXECUTION_ID: 'exec-1',
      CLAUDECODE: '1',
      CLAUDE_CODE_SESSION_ID: '65416e85-e27d-4e7c-aa99-44a60034b712',
      HAPPY_SERVER_URL: 'https://api.example.com',
      HAPPY_HOME_DIR: '/home/me/.happy-next',
      CLAUDE_CODE_OAUTH_TOKEN: 'token',
      PATH: '/usr/bin',
    };

    dropSessionEnv(env);

    expect(env).toEqual({
      HAPPY_SERVER_URL: 'https://api.example.com',
      HAPPY_HOME_DIR: '/home/me/.happy-next',
      CLAUDE_CODE_OAUTH_TOKEN: 'token',
      PATH: '/usr/bin',
    });
  });
});
