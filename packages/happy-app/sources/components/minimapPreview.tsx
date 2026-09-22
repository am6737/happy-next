import * as React from 'react';
import { Text, View } from 'react-native';
import { AskUserQuestionMessage, MinimapMessage, readAskUserQuestionAnswer, UserTextMessage } from '@/sync/typesMessage';
import { formatMessageTime } from '@/utils/messageTime';
import { t } from '@/text';

export const PREVIEW_WIDTH = 260;
const MAX_PREVIEW_CHARS = 180;

function truncatePreview(raw: string) {
    return raw.length > MAX_PREVIEW_CHARS ? `${raw.slice(0, MAX_PREVIEW_CHARS - 1)}…` : raw;
}

function getPromptPreviewText(message: UserTextMessage) {
    const raw = (message.displayText || message.text || '').replace(/\s+/g, ' ').trim();
    if (!raw) return '(empty message)';
    return truncatePreview(raw);
}

/** One line per question so a multi-question prompt stays readable in the preview. */
function getQuestionPreviewText(message: AskUserQuestionMessage) {
    return truncatePreview(message.questions.map((question) => question.question.trim()).filter(Boolean).join('\n'));
}

function getPreviewText(message: MinimapMessage) {
    if (message.kind === 'ask-user-question') return getQuestionPreviewText(message);
    if (message.kind === 'preview-html') {
        // The card is named by its title; an untitled one says what it is instead of showing blank.
        return truncatePreview(message.title?.trim() || t('tools.names.previewHtml'));
    }
    // A plan proposal is named by its tool, and its opening line is what the card shows.
    if (message.kind === 'plan-proposal') return truncatePreview(message.summary);
    return getPromptPreviewText(message);
}

/**
 * Small heading above the preview body: the first question's header for a single question, the
 * question count otherwise; a preview's name when its title is about to follow, and the plan
 * proposal's whenever there is a plan under it. Prompts have no heading.
 */
function getPreviewLabel(message: MinimapMessage) {
    if (message.kind === 'preview-html') {
        return message.title?.trim() ? t('tools.names.previewHtml') : null;
    }
    if (message.kind === 'plan-proposal') {
        return t('tools.names.planProposal');
    }
    if (message.kind !== 'ask-user-question') return null;
    if (message.questions.length > 1) {
        return t('tools.askUserQuestion.multipleQuestions', { count: message.questions.length });
    }
    return message.questions[0]?.header?.trim() || t('tools.names.question');
}

/** Secondary preview line: attachments for a prompt, the chosen answers for a question, nothing for the
 * two cards the agent made. */
function getPreviewDetail(message: MinimapMessage) {
    if (message.kind === 'ask-user-question') {
        const chosen = message.answers;
        if (!chosen) return null;
        const answers = message.questions
            .map((question) => readAskUserQuestionAnswer(chosen, question))
            .filter((answer): answer is string => !!answer);
        return answers.length > 0 ? t('tools.askUserQuestion.answered', { answer: answers.join(' · ') }) : null;
    }
    // Only prompts carry attachments; questions reported theirs above, previews and plan proposals
    // have none.
    if (message.kind !== 'user-text') return null;
    const images = message.images ?? [];
    if (images.length === 0) return null;
    const kinds = Array.from(new Set(images.map((image) => image.mimeType || 'image')));
    const kindText = kinds.length === 1 ? kinds[0] : kinds.join(', ');
    return `${images.length} attachment${images.length === 1 ? '' : 's'} · ${kindText}`;
}

/** What hovering (web) or landing on a landmark (touch) shows about it. */
export function MinimapPreviewCard({ message, style }: { message: MinimapMessage; style?: any }) {
    const previewLabel = getPreviewLabel(message);
    const previewDetail = getPreviewDetail(message);
    return (
        <View
            pointerEvents="none"
            style={[{
                width: PREVIEW_WIDTH,
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
                backgroundColor: 'rgba(18, 18, 20, 0.88)',
                borderWidth: 1,
                borderColor: 'rgba(255, 255, 255, 0.12)',
                shadowColor: '#000',
                shadowOpacity: 0.25,
                shadowRadius: 14,
                shadowOffset: { width: 0, height: 8 },
            }, style]}
        >
            <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 11, marginBottom: 6 }}>
                {formatMessageTime(message.createdAt)}
            </Text>
            {previewLabel ? (
                <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.72)', fontSize: 11, fontWeight: '600', marginBottom: 4 }}>
                    {previewLabel}
                </Text>
            ) : null}
            <Text numberOfLines={5} style={{ color: '#fff', fontSize: 13, lineHeight: 18 }}>
                {getPreviewText(message)}
            </Text>
            {previewDetail ? (
                <Text numberOfLines={2} style={{ color: 'rgba(255,255,255,0.64)', fontSize: 11, marginTop: 7 }}>
                    {previewDetail}
                </Text>
            ) : null}
        </View>
    );
}
