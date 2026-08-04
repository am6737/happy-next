const STOP_TIMEOUT_MS = 3_000;

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

    async stop(timeoutMs: number = STOP_TIMEOUT_MS): Promise<void> {
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

        this.activeController?.abort();

        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                activeTask.catch(() => {}),
                new Promise<void>((resolve) => {
                    timeout = setTimeout(resolve, timeoutMs);
                }),
            ]);
        } finally {
            if (timeout) {
                clearTimeout(timeout);
            }
        }
    }
}
