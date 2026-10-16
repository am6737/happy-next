import { fetchSpeechStreamStatus, speechStreamUrlFrom, type SpeechStreamStatus } from '@/sync/apiHappyVoice';

// Plays a gateway TTS stream and survives drops. The stream is chunked mp3
// with no length, so a dropped connection looks just like the natural end to
// the player. Whenever a source ends — cleanly, with an error, or by a
// watchdog — ask the gateway how much audio exists: if we have played it all,
// we're done; otherwise reopen the stream from where we left off (the gateway
// keeps the audio and resumes at an mp3 frame boundary).

// Load-failure deadline per source: iOS emits no 'failed' status on load
// errors, so a dead source would otherwise stay loading forever.
const START_WATCHDOG_MS = 15000;
// A playing source whose position stops moving this long is treated as dropped
// (a dead socket that never errors just stalls the player).
const STALL_WATCHDOG_MS = 12000;
// How long one interruption may take to recover before giving up on the item.
const RECOVERY_BUDGET_MS = 30000;
const STATUS_TIMEOUT_MS = 5000;
const MAX_RETRY_DELAY_MS = 4000;
// Played this close to the synthesized total counts as finished (players drop
// the mp3 info frame and trailing priming, so positions run slightly short).
const END_TOLERANCE_S = 1;
// Rewind a little on resume so the words cut off mid-drop are heard again.
const RESUME_REWIND_S = 0.5;
// Backstop against replaying forever if a platform ever misreports position.
const MAX_RESUMES = 10;

export interface SourceEvents {
    /** Audio is audibly coming out. */
    playing: () => void;
    /** Position within this source, in seconds. */
    progress: (seconds: number) => void;
    /** Source is over for any reason — finished, failed or dropped. */
    ended: () => void;
}

export interface StreamSource {
    stop: () => void;
}

export interface ResumableStreamOptions {
    url: string;
    /** Opens one player on `url`; events after stop() are ignored. */
    open: (url: string, events: SourceEvents) => StreamSource;
    onPlaying: () => void;
    /** Playing → loading while a dropped stream reconnects. */
    onLoading: () => void;
    onDone: () => void;
    fetchStatus?: (audioUrl: string, signal: AbortSignal) => Promise<SpeechStreamStatus | null>;
}

export function playResumableStream(opts: ResumableStreamOptions): { stop: () => void } {
    const fetchStatus = opts.fetchStatus ?? fetchSpeechStreamStatus;
    let stopped = false;
    let done = false;
    let source: StreamSource | null = null;
    // Bumped per source so events from a dropped one are ignored.
    let attempt = 0;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let statusAc: AbortController | null = null;
    // Absolute position heard so far, and where the current source starts.
    let played = 0;
    let base = 0;
    let resumes = 0;
    // Start of the current interruption (null while playing fine), and how
    // many recovery steps have failed since — drives the retry backoff.
    let recoveringSince: number | null = null;
    let failures = 0;

    const live = () => !done && !stopped;

    const clearWatchdog = () => {
        if (watchdog !== null) {
            clearTimeout(watchdog);
            watchdog = null;
        }
    };

    const dropSource = () => {
        attempt++;
        clearWatchdog();
        const s = source;
        source = null;
        s?.stop();
    };

    const finish = () => {
        if (!live()) return;
        done = true;
        dropSource();
        opts.onDone();
    };

    const openFrom = (from: number) => {
        const my = ++attempt;
        base = from;
        let sourcePlaying = false;
        let lastProgress = -1;
        const current = () => my === attempt && live();
        // A source that played but never reported a position can't be resumed
        // meaningfully; trust its end rather than replay it.
        const end = () => {
            if (current()) interrupted(sourcePlaying && lastProgress <= 0);
        };
        const arm = (ms: number) => {
            clearWatchdog();
            watchdog = setTimeout(() => {
                watchdog = null;
                end();
            }, ms);
        };
        arm(START_WATCHDOG_MS);
        source = opts.open(speechStreamUrlFrom(opts.url, from), {
            playing: () => {
                if (!current() || sourcePlaying) return;
                sourcePlaying = true;
                recoveringSince = null;
                arm(STALL_WATCHDOG_MS);
                opts.onPlaying();
            },
            progress: (seconds) => {
                if (!current() || !(seconds > lastProgress)) return;
                lastProgress = seconds;
                played = Math.max(played, base + seconds);
                if (sourcePlaying) arm(STALL_WATCHDOG_MS);
            },
            ended: end,
        });
    };

    const interrupted = (positionUnknown: boolean) => {
        dropSource();
        if (positionUnknown) {
            finish();
            return;
        }
        if (recoveringSince === null) {
            // First look is immediate: this is also how a natural end resolves.
            recoveringSince = Date.now();
            failures = 0;
            void recover();
        } else {
            retryLater();
        }
    };

    const retryLater = () => {
        const delay = Math.min(1000 * 2 ** failures, MAX_RETRY_DELAY_MS);
        failures++;
        retryTimer = setTimeout(() => {
            retryTimer = null;
            void recover();
        }, delay);
    };

    const recover = async () => {
        if (!live()) return;
        if (Date.now() - recoveringSince! > RECOVERY_BUDGET_MS) {
            finish();
            return;
        }
        const ac = new AbortController();
        statusAc = ac;
        const timeout = setTimeout(() => ac.abort(), STATUS_TIMEOUT_MS);
        let status: SpeechStreamStatus | null;
        try {
            status = await fetchStatus(opts.url, ac.signal);
        } catch {
            if (live()) retryLater();
            return;
        } finally {
            clearTimeout(timeout);
            statusAc = null;
        }
        if (!live()) return;
        const synthesisOver = status?.state === 'complete' || status?.state === 'failed';
        if (!status || !status.replayable || resumes >= MAX_RESUMES
            || (synthesisOver && played >= status.durationSeconds - END_TOLERANCE_S)) {
            finish();
            return;
        }
        // Natural ends never get here, so this is a real drop: show it.
        resumes++;
        opts.onLoading();
        openFrom(Math.max(0, played - RESUME_REWIND_S));
    };

    openFrom(0);

    return {
        stop: () => {
            if (!live()) return;
            stopped = true;
            statusAc?.abort();
            if (retryTimer !== null) clearTimeout(retryTimer);
            dropSource();
        },
    };
}
