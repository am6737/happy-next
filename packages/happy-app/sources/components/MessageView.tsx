import * as React from "react";
import { View, Text, Pressable, Platform, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { Ionicons, SimpleLineIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { ImageViewer } from "./ImageViewer";
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { MarkdownView, OptionsLoadingState } from "./markdown/MarkdownView";
import { t } from '@/text';
import { storeTempText } from '@/sync/persistence';
import { Message, UserTextMessage, AgentTextMessage, ToolCallMessage } from "@/sync/typesMessage";
import { Metadata } from "@/sync/storageTypes";
import { layout } from "./layout";
import { ToolView } from "./tools/ToolView";
import { AgentEvent } from "@/sync/typesRaw";
import stripAnsi from 'strip-ansi';
import { Option } from './markdown/MarkdownView';
import { OptionItem as OptionItemData } from './markdown/parseMarkdown';
import { Modal } from "@/modal";
import { sync } from "@/sync/sync";
import { useSetting } from "@/sync/storage";
import { showCopiedToast, showToast } from '@/components/Toast';
import { formatMessageTime, formatFullMessageTime } from '@/utils/messageTime';
import { hapticsLight } from './haptics';
import { useMessageTts } from '@/hooks/useMessageTts';

export const MessageView = (props: {
  message: Message;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
  isNewestMessage?: boolean;
  onFillInput?: (text: string, allOptions?: string[]) => void;
  readOnly?: boolean;
  isSharedSession?: boolean;
  currentUserId?: string;
  showSenderName?: boolean;
  onFork?: () => void;
  showActionBar?: boolean;
  forkLoading?: boolean;
}) => {
  return (
    <View style={styles.messageContainer} renderToHardwareTextureAndroid={true}>
      <View style={styles.messageContent}>
        <RenderBlock
          message={props.message}
          metadata={props.metadata}
          sessionId={props.sessionId}
          getMessageById={props.getMessageById}
          isNewestMessage={props.isNewestMessage}
          onFillInput={props.onFillInput}
          readOnly={props.readOnly}
          isSharedSession={props.isSharedSession}
          currentUserId={props.currentUserId}
          showSenderName={props.showSenderName}
          onFork={props.onFork}
          showActionBar={props.showActionBar}
          forkLoading={props.forkLoading}
        />
      </View>
    </View>
  );
};

function MessageActionBar(props: {
  side: 'left' | 'right';
  hovered: boolean;
  createdAt: number;
  onCopy?: () => void;
  onFork?: () => void;
  forkLoading?: boolean;
  onSpeak?: () => void | Promise<void>;
  ttsState?: 'idle' | 'loading' | 'playing' | 'queued';
}) {
  const { theme } = useUnistyles();
  const ttsState = props.ttsState ?? 'idle';
  // Web: visible only on hover (but the row always occupies layout space).
  // Native: always visible. While a fork is in progress, or TTS is
  // loading/playing/queued, force the bar visible on web so the spinner /
  // play state stays shown even if the cursor moved away.
  const ttsActive = ttsState !== 'idle';
  const contentVisible = Platform.OS !== 'web' || props.hovered || !!props.forkLoading || ttsActive;
  return (
    <View
      style={[
        styles.actionBar,
        props.side === 'right' ? styles.actionBarRight : styles.actionBarLeft,
        Platform.OS === 'web' && { opacity: contentVisible ? 1 : 0 },
      ]}
      pointerEvents={contentVisible ? 'auto' : 'none'}
    >
      {props.onCopy ? (
        <Pressable
          style={styles.actionButton}
          onPress={props.onCopy}
          accessibilityLabel={t('common.copy')}
          hitSlop={6}
        >
          <Ionicons name="copy-outline" size={14} color={theme.colors.textSecondary} />
        </Pressable>
      ) : null}
      {props.onSpeak ? (
        <Pressable
          style={styles.actionButton}
          onPress={ttsState === 'loading' ? undefined : () => { hapticsLight(); props.onSpeak?.(); }}
          disabled={ttsState === 'loading'}
          accessibilityLabel={
            ttsState === 'playing' ? t('message.stopVoice')
              : ttsState === 'queued' ? t('message.queuedVoice')
                : t('message.playVoice')
          }
          hitSlop={6}
        >
          {ttsState === 'loading' ? (
            <ActivityIndicator size="small" color={theme.colors.textSecondary} style={styles.actionSpinner} />
          ) : ttsState === 'queued' ? (
            <Ionicons name="time-outline" size={15} color={theme.colors.textSecondary} />
          ) : (
            <SimpleLineIcons
              name={ttsState === 'playing' ? 'control-pause' : 'volume-2'}
              size={ttsState === 'playing' ? 12 : 14.5}
              color={theme.colors.textSecondary}
            />
          )}
        </Pressable>
      ) : null}
      {props.onFork ? (
        <Pressable
          style={styles.actionButton}
          onPress={props.forkLoading ? undefined : () => { hapticsLight(); props.onFork?.(); }}
          disabled={props.forkLoading}
          accessibilityLabel={t('message.forkFromHere')}
          hitSlop={6}
        >
          {props.forkLoading ? (
            <ActivityIndicator size="small" color={theme.colors.textSecondary} style={styles.actionSpinner} />
          ) : (
            <Ionicons name="git-branch-outline" size={14} color={theme.colors.textSecondary} />
          )}
        </Pressable>
      ) : null}
      {Platform.OS === 'web' ? (
        // react-native-web doesn't forward the DOM `title` prop, so wrap the
        // time in a native <span> to show the full timestamp on hover.
        <span title={formatFullMessageTime(props.createdAt)} style={{ display: 'inline-flex' }}>
          <Text style={styles.actionTime}>{formatMessageTime(props.createdAt)}</Text>
        </span>
      ) : (
        // Native: tap the time to reveal the full timestamp in a toast.
        <Pressable
          onPress={() => { hapticsLight(); showToast(formatFullMessageTime(props.createdAt), { icon: null }); }}
          hitSlop={6}
        >
          <Text style={styles.actionTime}>{formatMessageTime(props.createdAt)}</Text>
        </Pressable>
      )}
    </View>
  );
}

// The hover handlers live on the message container and the action bar is an
// in-flow child of it. This debounce just adds a small grace period on
// mouseleave so the bar doesn't flicker out when the cursor briefly crosses
// the container edge (e.g. over the inter-message gap) before settling.
const HOVER_LEAVE_DEBOUNCE_MS = 200;

function useMessageHover() {
  const [hovered, setHovered] = React.useState(false);
  const leaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
  }, []);
  const handlers = Platform.OS === 'web'
    ? {
      onMouseEnter: () => {
        if (leaveTimer.current) {
          clearTimeout(leaveTimer.current);
          leaveTimer.current = null;
        }
        setHovered(true);
      },
      onMouseLeave: () => {
        if (leaveTimer.current) clearTimeout(leaveTimer.current);
        leaveTimer.current = setTimeout(() => setHovered(false), HOVER_LEAVE_DEBOUNCE_MS);
      },
    }
    : {};
  return { hovered, handlers };
}

async function copyMessageText(text: string | null | undefined) {
  if (!text) return;
  await Clipboard.setStringAsync(text);
  hapticsLight();
  showCopiedToast();
}

// RenderBlock function that dispatches to the correct component based on message kind
function RenderBlock(props: {
  message: Message;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
  isNewestMessage?: boolean;
  onFillInput?: (text: string, allOptions?: string[]) => void;
  readOnly?: boolean;
  isSharedSession?: boolean;
  currentUserId?: string;
  showSenderName?: boolean;
  onFork?: () => void;
  showActionBar?: boolean;
  forkLoading?: boolean;
}): React.ReactElement {
  switch (props.message.kind) {
    case 'user-text':
      return (
        <UserTextBlock
          message={props.message}
          sessionId={props.sessionId}
          sessionWorkingDirectory={props.metadata?.path ?? null}
          sessionHomeDirectory={props.metadata?.homeDir ?? null}
          isNewestMessage={props.isNewestMessage}
          onFillInput={props.onFillInput}
          readOnly={props.readOnly}
          isSharedSession={props.isSharedSession}
          currentUserId={props.currentUserId}
          showSenderName={props.showSenderName}
          onFork={props.onFork}
          showActionBar={props.showActionBar}
          forkLoading={props.forkLoading}
        />
      );

    case 'agent-text':
      return (
        <AgentTextBlock
          message={props.message}
          sessionId={props.sessionId}
          sessionWorkingDirectory={props.metadata?.path ?? null}
          sessionHomeDirectory={props.metadata?.homeDir ?? null}
          isNewestMessage={props.isNewestMessage}
          onFillInput={props.onFillInput}
          readOnly={props.readOnly}
          onFork={props.onFork}
          showActionBar={props.showActionBar}
          forkLoading={props.forkLoading}
        />
      );

    case 'tool-call':
      return <ToolCallBlock
        message={props.message}
        metadata={props.metadata}
        sessionId={props.sessionId}
        getMessageById={props.getMessageById}
      />;

    case 'agent-event':
      return <AgentEventBlock event={props.message.event} metadata={props.metadata} />;


    default:
      // Exhaustive check - TypeScript will error if we miss a case
      const _exhaustive: never = props.message;
      throw new Error(`Unknown message kind: ${_exhaustive}`);
  }
}

// Beyond this many characters, parseMarkdown + the resulting React tree freezes the UI on
// mid-range devices. Such messages are almost always pasted dumps (skill bodies, logs, files),
// so we collapse them to a single tap-to-view placeholder instead of rendering them inline.
const LONG_USER_MESSAGE_THRESHOLD = 20000;

function UserTextBlock(props: {
  message: UserTextMessage;
  sessionId: string;
  sessionWorkingDirectory?: string | null;
  sessionHomeDirectory?: string | null;
  isNewestMessage?: boolean;
  onFillInput?: (text: string, allOptions?: string[]) => void;
  readOnly?: boolean;
  isSharedSession?: boolean;
  currentUserId?: string;
  showSenderName?: boolean;
  onFork?: () => void;
  showActionBar?: boolean;
  forkLoading?: boolean;
}) {
  const router = useRouter();
  const [imageViewerVisible, setImageViewerVisible] = React.useState(false);
  const [imageViewerIndex, setImageViewerIndex] = React.useState(0);
  const [optionsLoadingState, setOptionsLoadingState] = React.useState<OptionsLoadingState>({ loadingIndex: null });

  // Click to send
  const handleOptionPress = React.useCallback(async (option: Option, allOptions: OptionItemData[]) => {
    if (option.destructive) {
      // Destructive confirmation takes priority (skip old-option confirmation)
      const confirmed = await Modal.confirm(
        t('message.confirmDestructive'),
        t('message.confirmDestructiveMessage'),
        { destructive: true }
      );
      if (!confirmed) return;
    } else if (!props.isNewestMessage) {
      const confirmed = await Modal.confirm(
        t('message.confirmOldOption'),
        t('message.confirmOldOptionMessage')
      );
      if (!confirmed) return;
    }

    // Find the index of this option for loading state
    const index = allOptions.findIndex(o => o.title === option.title);
    setOptionsLoadingState({ loadingIndex: index });

    try {
      await sync.sendOrQueueMessage(props.sessionId, option.title);
    } finally {
      setOptionsLoadingState({ loadingIndex: null });
    }
  }, [props.sessionId, props.isNewestMessage]);

  // Long press to fill input (mobile only, handled in MarkdownView)
  const handleOptionLongPress = React.useCallback((option: Option, allOptions: OptionItemData[]) => {
    props.onFillInput?.(option.title, allOptions.map(o => o.title));
  }, [props.onFillInput]);

  const images = props.message.images ?? [];
  const imageViewingImages = images.map(img => ({ uri: img.url }));

  const handleImagePress = React.useCallback((index: number) => {
    setImageViewerIndex(index);
    setImageViewerVisible(true);
  }, []);

  const senderLabel = React.useMemo(() => {
    if (!props.isSharedSession || !props.showSenderName || !props.message.sentBy) return null;
    if (props.message.sentBy === props.currentUserId) return t('message.you');
    return props.message.sentByName || t('message.unknownSender');
  }, [props.isSharedSession, props.showSenderName, props.message.sentBy, props.currentUserId, props.message.sentByName]);

  const { hovered, handlers: hoverHandlers } = useMessageHover();
  const messageText = props.message.text;
  const handleCopy = React.useCallback(() => {
    copyMessageText(messageText);
  }, [messageText]);

  const renderedText = props.message.displayText || props.message.text;
  const isTooLong = renderedText.length > LONG_USER_MESSAGE_THRESHOLD;
  const handleOpenFullText = React.useCallback(() => {
    try {
      const textId = storeTempText(renderedText);
      router.push(`/text-selection?textId=${textId}`);
    } catch (error) {
      console.error('Error opening long message:', error);
    }
  }, [renderedText, router]);

  return (
    <View style={styles.userMessageContainer} {...hoverHandlers}>
      {senderLabel && (
        <Text style={styles.senderLabel}>{senderLabel}</Text>
      )}
      <View style={styles.userMessageBubble}>
        {images.length > 0 && (
          <>
            <View style={styles.messageImages}>
              {images.map((img, index) => (
                <Pressable key={index} onPress={() => handleImagePress(index)}>
                  <Image
                    source={{ uri: img.url }}
                    style={{ width: 120, height: 120, borderRadius: 8 }}
                    contentFit="cover"
                    placeholder={img.thumbhash ? { thumbhash: img.thumbhash } : undefined}
                  />
                </Pressable>
              ))}
            </View>
            <ImageViewer
              images={imageViewingImages}
              initialIndex={imageViewerIndex}
              visible={imageViewerVisible}
              onClose={() => setImageViewerVisible(false)}
            />
          </>
        )}
        {isTooLong ? (
          <Pressable
            onPress={handleOpenFullText}
            onLongPress={handleOpenFullText}
            style={styles.longMessagePlaceholder}
          >
            <Text style={styles.longMessagePlaceholderText}>
              {t('message.tooLongPlaceholder', { chars: renderedText.length })}
            </Text>
          </Pressable>
        ) : (
          <MarkdownView
            markdown={renderedText}
            sessionId={props.sessionId}
            sessionWorkingDirectory={props.sessionWorkingDirectory}
            sessionHomeDirectory={props.sessionHomeDirectory}
            onOptionPress={props.readOnly ? undefined : handleOptionPress}
            onOptionLongPress={props.readOnly ? undefined : handleOptionLongPress}
            optionsLoadingState={props.readOnly ? undefined : optionsLoadingState}
            hideOptions={props.readOnly}
          />
        )}
        {props.message.deliveryError ? (
          <Text style={styles.deliveryErrorText}>{props.message.deliveryError}</Text>
        ) : null}
      </View>
      {props.showActionBar !== false && (
        <MessageActionBar
          side="right"
          hovered={hovered}
          createdAt={props.message.createdAt}
          onCopy={messageText ? handleCopy : undefined}
          onFork={props.onFork}
          forkLoading={props.forkLoading}
        />
      )}
    </View>
  );
}

function AgentTextBlock(props: {
  message: AgentTextMessage;
  sessionId: string;
  sessionWorkingDirectory?: string | null;
  sessionHomeDirectory?: string | null;
  isNewestMessage?: boolean;
  onFillInput?: (text: string, allOptions?: string[]) => void;
  readOnly?: boolean;
  onFork?: () => void;
  showActionBar?: boolean;
  forkLoading?: boolean;
}) {
  const showThinkingMessages = useSetting('showThinkingMessages');
  const [optionsLoadingState, setOptionsLoadingState] = React.useState<OptionsLoadingState>({ loadingIndex: null });

  // Click to send
  const handleOptionPress = React.useCallback(async (option: Option, allOptions: OptionItemData[]) => {
    if (option.destructive) {
      // Destructive confirmation takes priority (skip old-option confirmation)
      const confirmed = await Modal.confirm(
        t('message.confirmDestructive'),
        t('message.confirmDestructiveMessage'),
        { destructive: true }
      );
      if (!confirmed) return;
    } else if (!props.isNewestMessage) {
      const confirmed = await Modal.confirm(
        t('message.confirmOldOption'),
        t('message.confirmOldOptionMessage')
      );
      if (!confirmed) return;
    }

    // Find the index of this option for loading state
    const index = allOptions.findIndex(o => o.title === option.title);
    setOptionsLoadingState({ loadingIndex: index });

    try {
      await sync.sendOrQueueMessage(props.sessionId, option.title);
    } finally {
      setOptionsLoadingState({ loadingIndex: null });
    }
  }, [props.sessionId, props.isNewestMessage]);

  // Long press to fill input (mobile only, handled in MarkdownView)
  const handleOptionLongPress = React.useCallback((option: Option, allOptions: OptionItemData[]) => {
    props.onFillInput?.(option.title, allOptions.map(o => o.title));
  }, [props.onFillInput]);

  const hasOptions = props.message.text.includes('<options>');
  const { hovered, handlers: hoverHandlers } = useMessageHover();
  const messageText = props.message.text;
  const handleCopy = React.useCallback(() => {
    copyMessageText(messageText);
  }, [messageText]);
  const { state: ttsState, toggle: handleSpeak } = useMessageTts(props.message.id, props.sessionId, messageText);

  // Hide thinking messages if setting is disabled. Must run AFTER all hooks so
  // the hook count stays constant across renders (Rules of Hooks).
  if (props.message.isThinking && !showThinkingMessages) {
    return null;
  }

  return (
    <View
      style={[styles.agentMessageContainer, props.message.isThinking && { opacity: 0.3 }, hasOptions && styles.agentMessageContainerStretch]}
      {...hoverHandlers}
    >
      <MarkdownView
        markdown={props.message.text}
        sessionId={props.sessionId}
        sessionWorkingDirectory={props.sessionWorkingDirectory}
        sessionHomeDirectory={props.sessionHomeDirectory}
        onOptionPress={props.readOnly ? undefined : handleOptionPress}
        onOptionLongPress={props.readOnly ? undefined : handleOptionLongPress}
        optionsLoadingState={props.readOnly ? undefined : optionsLoadingState}
        hideOptions={props.readOnly}
      />
      {props.showActionBar !== false && !props.message.isThinking && (
        <MessageActionBar
          side="left"
          hovered={hovered}
          createdAt={props.message.createdAt}
          onCopy={messageText ? handleCopy : undefined}
          onFork={props.onFork}
          forkLoading={props.forkLoading}
          onSpeak={messageText ? handleSpeak : undefined}
          ttsState={ttsState}
        />
      )}
    </View>
  );
}

function AgentEventBlock(props: {
  event: AgentEvent;
  metadata: Metadata | null;
}) {
  if (props.event.type === 'switch') {
    return (
      <View style={styles.agentEventContainer}>
        <Text style={styles.agentEventText}>{t('message.switchedToMode', { mode: props.event.mode })}</Text>
      </View>
    );
  }
  if (props.event.type === 'message') {
    // Strip ANSI escape codes so terminal color sequences (e.g. \x1b[90m…\x1b[0m
    // from a CLI startup banner) don't leak into the bubble as raw text.
    return (
      <View style={styles.agentEventContainer}>
        <Text style={styles.agentEventText}>{stripAnsi(props.event.message)}</Text>
      </View>
    );
  }
  if (props.event.type === 'limit-reached') {
    const formatTime = (timestamp: number): string => {
      try {
        const date = new Date(timestamp * 1000); // Convert from Unix timestamp
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch {
        return t('message.unknownTime');
      }
    };

    return (
      <View style={styles.agentEventContainer}>
        <Text style={styles.agentEventText}>
          {t('message.usageLimitUntil', { time: formatTime(props.event.endsAt) })}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.agentEventContainer}>
      <Text style={styles.agentEventText}>{t('message.unknownEvent')}</Text>
    </View>
  );
}

function ToolCallBlock(props: {
  message: ToolCallMessage;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
}) {
  if (!props.message.tool) {
    return null;
  }
  return (
    <View style={styles.toolContainer}>
      <ToolView
        tool={props.message.tool}
        metadata={props.metadata}
        messages={props.message.children}
        sessionId={props.sessionId}
        messageId={props.message.id}
        localId={props.message.localId}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  messageContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  messageContent: {
    flexDirection: 'column',
    flexGrow: 1,
    flexBasis: 0,
    maxWidth: layout.maxWidth,
  },
  userMessageContainer: {
    maxWidth: '100%',
    flexDirection: 'column',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  userMessageBubble: {
    backgroundColor: theme.colors.userMessageBackground,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 0,
    maxWidth: '100%',
    position: 'relative',
  },
  senderLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    marginBottom: 2,
    paddingRight: 4,
  },
  deliveryErrorText: {
    color: theme.colors.textDestructive,
    fontSize: 12,
    marginTop: 4,
    marginBottom: 4,
  },
  longMessagePlaceholder: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  longMessagePlaceholderText: {
    color: theme.colors.userMessageText,
    fontSize: 14,
    fontStyle: 'italic',
    opacity: 0.85,
  },
  agentMessageContainer: {
    paddingHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    position: 'relative',
  },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    paddingHorizontal: 4,
  },
  actionBarRight: {
    alignSelf: 'flex-end',
  },
  actionBarLeft: {
    alignSelf: 'flex-start',
  },
  actionButton: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTime: {
    fontSize: 11,
    height: 20,
    lineHeight: 20,
    color: theme.colors.textSecondary,
  },
  actionSpinner: {
    transform: [{ scale: 0.7 }],
  },
  agentMessageContainerStretch: {
    alignSelf: 'stretch',
  },
  agentEventContainer: {
    marginHorizontal: 8,
    alignItems: 'center',
    paddingVertical: 8,
  },
  agentEventText: {
    color: theme.colors.agentEventText,
    fontSize: 14,
  },
  toolContainer: {
    marginHorizontal: 8,
  },
  debugText: {
    color: theme.colors.agentEventText,
    fontSize: 12,
  },
  messageImages: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
    marginBottom: 8,
    gap: 12,
  },
}));
