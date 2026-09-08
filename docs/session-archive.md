# Codex Native Archive

## Behavior

Happy keeps its existing archive action: stop the session, remove it from the
active group, clear the client message cache, and retain its history.

For Codex only, the client then calls the daemon's encrypted
`codex-archive-session` machine RPC. The daemon verifies the recorded local process
identities, finishes stopping the wrapper and its descendants, and calls Codex
app-server `thread/archive` for the session's recorded native thread IDs.
Claude and Gemini keep their previous behavior.

Native failures are reported separately. They do not undo Happy's stop or claim
that the Codex thread was archived. The existing archive action can be retried,
including after the session RPC has exited. A machine must be online; there is
no durable queue, background retry, or server-side archive state.

The existing Codex resume/copy path restores missing native history with
`thread/unarchive` before copying the session file and starting the new Happy
session. A native archive or restore by itself never starts a conversation.
Normal forks of available session files do not invoke the native helper.

## Deployment

Upgrade the app and CLI and restart the daemon. The new native RPC reuses the
existing server RPC relay; deploy the scoped native-history RPC timeout update
as well. No server archive endpoint or database schema change is required by
this feature.

## Boundaries

- New Codex sessions record private bindings under
  `$HAPPY_HOME_DIR/session-bindings`. Older sessions without bindings can still be
  stopped using Happy's original action, but report a native archive failure.
  Unverified PIDs are never killed by the native archive helper.
- Bindings retain the original Codex home and package. Deleted worktrees use a
  private fallback directory for the native helper.
- Linux and macOS process identities are supported. Windows currently reports
  that process verification is unsupported.
- Native archive and fork/restore RPCs are serialized by the daemon. Another
  known live Happy session using the same native thread prevents archival.
  Independent native CLI clients must be stopped separately.
- A timeout or lost RPC response can leave native completion uncertain. Retry
  the operation; native archive/restore checks the target state first.
- Tests use mocked native APIs and disposable local processes. A real Codex
  archive, followed by resuming the same Happy history entry, still requires
  end-to-end verification on a disposable session.
