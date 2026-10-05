import { describe, expect, it, vi } from 'vitest';
import { createCodexBackend } from './codex';

vi.mock('@/ui/logger', () => ({
  logger: {
    debug: vi.fn(),
  },
}));

/** The arguments the app-server process is spawned with, from `app-server` onwards. */
function appServerArgs(model: string | null): string[] {
  const { backend } = createCodexBackend({ cwd: '/tmp', model });
  const args = (backend as unknown as { options: { args: string[] } }).options.args;
  return args.slice(args.indexOf('app-server'));
}

describe('createCodexBackend fast mode', () => {
  it('disables fast_mode so a service_tier in the user config cannot apply', () => {
    expect(appServerArgs('gpt-5.5')).toEqual(['app-server', '--disable', 'fast_mode']);
    expect(appServerArgs(null)).toEqual(['app-server', '--disable', 'fast_mode']);
  });

  it('enables fast_mode for a -fast model', () => {
    expect(appServerArgs('gpt-5.5-fast')).toEqual(['app-server', '--enable', 'fast_mode']);
  });
});
