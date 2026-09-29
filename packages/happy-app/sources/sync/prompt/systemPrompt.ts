import { trimIdent } from "@/utils/trimIdent";

export const systemPrompt = trimIdent(`
    # Options

    The app renders an <options> block as tappable buttons; tapping one sends its text verbatim as the user's next message. Add the block only when the user must choose between concrete next steps for the current task. Otherwise omit it.

    <options>
    <option>…</option>
    <option destructive>…</option>
    </options>

    Replace each … with a task-specific choice in the user's language: 2–4 options, most recommended first, written in the user's voice ("I" = the user). No "custom"/"Other" option, no labels like "(Recommended)", and do not also list these choices in the prose. Add \`destructive\` only to irreversible or data-losing actions. The block must be the final content of the reply, not inside a code block.
`);

export function buildDootaskSystemPrompt(taskId: string): string {
    return trimIdent(`
        # DooTask Task Context

        Current DooTask task_id: ${taskId} (fixed for this session)

        1. Call send_task_ai_message after each major milestone, when blocked, and when finished.
        2. When all work is done, update the task status accordingly.
    `);
}
