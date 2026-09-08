export class PushTokenRegistrationGate {
    private stopped = false;
    private activeController: AbortController | null = null;
    private activeTask: Promise<void> | null = null;
    private activeMutationStarted = false;

    async run(
        task: (signal: AbortSignal, startMutation: () => boolean) => Promise<void>,
    ): Promise<void> {
        if (this.stopped) {
            return;
        }

        const controller = new AbortController();
        const startMutation = () => {
            if (this.stopped || controller.signal.aborted) {
                return false;
            }
            this.activeMutationStarted = true;
            return true;
        };
        const activeTask = task(controller.signal, startMutation);
        this.activeController = controller;
        this.activeTask = activeTask;

        try {
            await activeTask;
        } finally {
            if (this.activeTask === activeTask) {
                this.activeController = null;
                this.activeTask = null;
                this.activeMutationStarted = false;
            }
        }
    }

    async stop(): Promise<void> {
        this.stopped = true;

        const activeTask = this.activeTask;
        if (!activeTask) {
            return;
        }

        // Once a server mutation has started, let it finish before logout deletes the token.
        // Aborting or timing out here could allow a late registration to run after that delete.
        if (this.activeMutationStarted) {
            await activeTask.catch(() => {});
            return;
        }

        // No Happy server binding has started. Marking the gate stopped above
        // makes every later startMutation() fail, even if native token lookup
        // ignores abort. Logout need not wait for that lookup to settle.
        this.activeController?.abort();
    }
}
