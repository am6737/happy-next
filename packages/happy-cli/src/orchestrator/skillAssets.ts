/**
 * Bundled orchestrator skill + command assets for controller sessions.
 *
 * These strings are synced to the Claude / Codex config dirs at startup by skillSync.ts, so that
 * `/orchestrator:claude|codex|gemini` and the `orchestrator` skill are available out of the box.
 * They are embedded as strings (not shipped files) so they travel inside the bundled dist with no
 * runtime asset-path or packaging concerns.
 *
 * Edit here — the on-disk copies are content-compared and overwritten on update.
 */

const MANAGED_NOTE =
  '<!-- Managed by Happy CLI — regenerated on update; edit the source in happy-cli, not this file. -->';

// NOTE: keep `description` a single-line plain scalar. Happy's frontmatter parser does not support
// YAML block scalars (`>-`, `>`, `|`) and renders the indicator literally, so a folded value shows
// up as the description text ">-" in the skill list.
export const ORCHESTRATOR_SKILL_MD = `---
name: orchestrator
description: Act as the commander and delegate work to one or more AI agents (claude/codex/gemini) that run in parallel or in dependency order via Happy's orchestrator. Use when the user wants to run several tasks at once, fan work out to multiple AIs, compare providers, build a dependency pipeline, or when invoking /orchestrator:claude|codex|gemini.
---

${MANAGED_NOTE}

# Orchestrator / Delegation

When using this capability, the main session is the **commander**: you decide what to split out, to
whom, and how to synthesize the results for the user. Execution runs through the \`orchestrator_*\`
tools — their descriptions already explain how to call them, so that is not repeated here.

Commander rules (none are in the tool descriptions, but they decide whether delegation succeeds):

1. **Command, do not do the work yourself.** Delegate the work that should be delegated; do not
   implement it in the main session. And do not read a pile of files just to understand before
   delegating — hand the context and the work to the agent; it will read what it needs.

2. **Give a contract, not steps.** For each task spell out four things: the objective, the
   deliverable (what to output and where to write it), the scope (which files or dirs it may touch),
   and what NOT to touch (that is another task's job). Leave how to do it entirely to the agent — do
   not micromanage; trust its ability.

3. **Decide how many agents by scale.** One for something simple; 2–4 for parallel review or
   comparison; more only when the work is genuinely large. Do not over-split or over-spawn.

4. **Match thinking effort to difficulty.** Work you could hand to a junior dev as a clear,
   unambiguous task → use a low effort tier (fast). Work needing judgment, weighing context, or
   architectural thinking → use a high tier (deep). Do not blanket-low everything (quality drops) or
   blanket-high everything (you wait for nothing).

5. **One file, one owner.** Two tasks must not edit the same file. Tasks do not pass data to each
   other — to pass data, have the upstream task write a file and the downstream task read it.

6. **Do not trust self-reports; verify what matters yourself.** A task saying it is done or that
   tests pass is not proof. Check important outputs yourself (run tests, look at the diff) rather
   than taking its word.

7. **Synthesize, do not concatenate.** Reconcile the agents' outputs into one coherent result for
   the user, resolving conflicts yourself instead of stacking them up.

**When not to delegate:** multi-agent fits work that is independent, parallel, and clearly bounded —
parallel review, multi-provider comparison, parallel research, and coding that splits into
independent modules (multi-agent coding like this is proven to work). The only poor fits are
multiple tasks editing the same file, strictly sequential steps, and deep dependency chains —
forcing those into a long \`dependsOn\` chain usually costs more than it saves; prefer fewer tasks or
just do it in the main session. Also note N agents ≈ N× usage, so split only as much as the work
needs.

Before submitting, briefly show the plan to the user for confirmation, then go.

---

Explicit entries: \`/orchestrator:claude\`, \`/orchestrator:codex\`, \`/orchestrator:gemini\` — choose
the primary provider; you can still mix providers or add dependencies within a single run.
`;

function commandFor(provider: 'claude' | 'codex' | 'gemini'): string {
  return `---
description: Delegate work to ${provider} agent(s) — can run in parallel
argument-hint: [task to delegate]
---

${MANAGED_NOTE}

The user wants to delegate work to **${provider}** agent(s). The task:

$ARGUMENTS

Split this into one or more tasks and delegate via the \`orchestrator_*\` tools, using provider
\`${provider}\`. Follow the commander rules in the orchestrator skill: give the objective and
boundaries, and do not over-constrain how the agent works. (If no task is given above, use the
current conversation context, or ask the user what to delegate.)
`;
}

export const ORCHESTRATOR_COMMAND_CLAUDE = commandFor('claude');
export const ORCHESTRATOR_COMMAND_CODEX = commandFor('codex');
export const ORCHESTRATOR_COMMAND_GEMINI = commandFor('gemini');
