import React from 'react';
import type { TeammateDraft, TeammateDraftAnswer, TeammateDraftRequest } from 'happy-wire';
import { changedDraftFields, generateTeammateDraft, mergeDraftAnswers, type TeammateDraftRound } from '@/sync/teammateDraft';
import { teammateErrorMessage } from '@/components/teammates/ui';
import { getCurrentLanguage } from '@/text';

export type TeammateInterviewMessage = { from: 'me' | 'ai'; text: string };

/**
 * AI interview for a new Agent. The description starts a round on the chosen machine; the round's questions are
 * then asked one at a time (pick a suggestion, type an answer, or skip). Once the last question of a round is
 * handled, the answers go out in the next round; a round with no questions left is "ready", and free text then
 * becomes feedback. Every round re-sends the description, all answers and the latest draft, so nothing lives
 * on the machine between rounds. A generation counter drops replies that arrive after "start over" or unmount.
 */
export function useTeammateInterview() {
    const [machineId, setMachineId] = React.useState('');
    const [description, setDescription] = React.useState('');
    const [round, setRound] = React.useState<TeammateDraftRound | null>(null);
    const [previousDraft, setPreviousDraft] = React.useState<TeammateDraft | undefined>();
    const [answers, setAnswers] = React.useState<TeammateDraftAnswer[]>([]);
    const [replies, setReplies] = React.useState<(string | undefined)[]>([]);
    const [messages, setMessages] = React.useState<TeammateInterviewMessage[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const lastRequest = React.useRef<{ machineId: string; request: TeammateDraftRequest } | null>(null);
    const generation = React.useRef(0);

    React.useEffect(() => () => { generation.current += 1; }, []);

    const run = async (machine: string, request: TeammateDraftRequest) => {
        const current = ++generation.current;
        lastRequest.current = { machineId: machine, request };
        setLoading(true);
        setError(null);
        try {
            const result = await generateTeammateDraft(machine, request);
            if (current !== generation.current) return;
            setPreviousDraft(request.previous);
            setRound(result);
            setAnswers(request.answers ?? []);
            setReplies([]);
        } catch (failure) {
            if (current === generation.current) setError(teammateErrorMessage(failure));
        } finally {
            if (current === generation.current) setLoading(false);
        }
    };

    const start = (machine: string, text: string) => {
        const trimmed = text.trim();
        if (!trimmed || !machine) return;
        setMachineId(machine);
        setDescription(trimmed);
        setMessages([{ from: 'me', text: trimmed }]);
        void run(machine, { description: trimmed, locale: getCurrentLanguage() });
    };

    const questions = round?.questions ?? [];
    const questionIndex = replies.length;
    const question = !loading && questionIndex < questions.length ? questions[questionIndex] : null;

    /** Answers (or, with `undefined`, skips) the current question; the last one sends the round. */
    const reply = (text: string | undefined) => {
        if (!round || !question) return;
        const answer = text?.trim() || undefined;
        const next = [...replies, answer];
        setReplies(next);
        if (answer) setMessages(current => [...current, { from: 'ai', text: question.question }, { from: 'me', text: answer }]);
        if (next.length < questions.length) return;
        const merged = mergeDraftAnswers(answers, questions, next);
        // Nothing new to tell the AI: keep the draft and treat it as ready.
        if (merged.length === answers.length && merged.every((item, index) => item === answers[index])) return;
        void run(machineId, { description, answers: merged, previous: round.draft, locale: getCurrentLanguage() });
    };

    /** Free-form change request once the round's questions are done. */
    const sendFeedback = (text: string) => {
        const feedback = text.trim();
        if (!round || !feedback || question) return;
        setMessages(current => [...current, { from: 'me', text: feedback }]);
        void run(machineId, { description, answers, previous: round.draft, feedback, locale: getCurrentLanguage() });
    };

    const retry = () => {
        if (lastRequest.current) void run(lastRequest.current.machineId, lastRequest.current.request);
    };

    const startOver = () => {
        generation.current += 1;
        lastRequest.current = null;
        setRound(null);
        setPreviousDraft(undefined);
        setAnswers([]);
        setReplies([]);
        setMessages([]);
        setLoading(false);
        setError(null);
    };

    const changed = React.useMemo(() => round ? changedDraftFields(previousDraft, round.draft) : [], [previousDraft, round]);

    return {
        machineId, started: messages.length > 0, draft: round?.draft ?? null, changed, messages, loading, error,
        question, questionIndex, questionCount: questions.length,
        start, reply, sendFeedback, retry, startOver,
    };
}
