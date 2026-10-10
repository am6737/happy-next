# P1 E2E smoke: local/remote handoff

This smoke test checks that one Claude session can move from the terminal to
the Happy app (or web client) and back without losing the conversation.

## Preconditions

- Node.js 20 or newer is installed.
- The Claude CLI is installed and authenticated on the computer.
- `happy-next-cli` is installed and the Happy app is available, or the
  [Happy web client](https://app.happy-next.com/) can be opened in a browser.
- Use a disposable project directory. Do not paste the QR code, access token,
  or test prompts into an issue or pull request.

## Smoke steps

1. On the computer, open the disposable project directory and start a session:

   ```bash
   happy
   ```

   Leave the terminal running. Confirm that it prints a QR code and shows the
   local Claude session.

2. Open the Happy app or web client, sign in to the same account, and scan the
   QR code. Confirm that the new session appears and that its conversation is
   visible.

3. From the app or web client, send this message:

   ```text
   Reply with exactly P1_REMOTE_OK and no other text.
   ```

   Sending a message while the terminal owns the session hands control to the
   app. Confirm all of the following:

   - The terminal changes to `Remote Mode - Claude Messages`.
   - The response containing `P1_REMOTE_OK` appears in the app and in the
     terminal's remote display.

4. In the terminal's remote display, press **Space** once, then press
   **Space** again within 15 seconds. The first press asks for confirmation;
   the second confirms the switch to local mode. Confirm that the terminal
   reports `Switching to local mode...` and returns to the local Claude prompt.

5. In the terminal, send this message to Claude:

   ```text
   Reply with exactly P1_LOCAL_OK and no other text.
   ```

   Confirm that the response containing `P1_LOCAL_OK` is shown in the terminal
   and is synced to the app or web client. The session view should indicate
   that permissions are controlled by the terminal while local mode is active.

## Pass criteria

- The same session is visible after QR pairing.
- App-to-terminal handoff reaches remote mode and preserves `P1_REMOTE_OK`.
- The double-space confirmation returns control to local mode.
- Terminal-to-app sync preserves `P1_LOCAL_OK`.
- No duplicate session or unrecoverable terminal state is created.

## Failure notes

- No QR code: verify that `happy` is running in a TTY and that the CLI
  prerequisites are installed.
- The session is missing from the app: verify the account, network connection,
  and QR scan, then restart `happy` with a fresh disposable session.
- The app message does not take control: wait for the local prompt to become
  idle, then send the message again; the app should show the terminal-only
  permission notice while local mode is active.
- Double-space does not switch: press the second space before the 15-second
  confirmation expires. Any other key cancels the confirmation.
- If the terminal is left in a bad state after an interrupted run, close the
  CLI normally and reopen a fresh terminal before retrying.

— 🤖 Reviewer (Happy Agent)
