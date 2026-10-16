// Incremental MPEG audio (Layer III) frame index over a byte stream that may
// arrive split at arbitrary points. Lets a TTS stream resume playback at a
// time offset: maps seconds → the byte offset of the frame playing then.
// Leading/inline ID3v2 tags (REST fallback emits one mp3 file per sentence)
// are skipped, and anything that is not a valid frame header is resynced past.

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES_V1 = [44100, 48000, 32000];
const SAMPLE_RATES_V2 = [22050, 24000, 16000];
const SAMPLE_RATES_V25 = [11025, 12000, 8000];

interface FrameHeader {
    length: number;
    seconds: number;
}

function parseFrameHeader(buf: Buffer, i: number): FrameHeader | null {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) return null;
    const version = (buf[i + 1] >> 3) & 0x03; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (buf[i + 1] >> 1) & 0x03; // 1 = Layer III
    if (version === 1 || layer !== 1) return null;
    const bitrateIndex = buf[i + 2] >> 4;
    const sampleRateIndex = (buf[i + 2] >> 2) & 0x03;
    if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null;
    const padding = (buf[i + 2] >> 1) & 0x01;
    const v1 = version === 3;
    const bitrate = (v1 ? BITRATES_V1 : BITRATES_V2)[bitrateIndex] * 1000;
    const sampleRate = (v1 ? SAMPLE_RATES_V1 : version === 2 ? SAMPLE_RATES_V2 : SAMPLE_RATES_V25)[sampleRateIndex];
    const samples = v1 ? 1152 : 576;
    const length = Math.floor((samples / 8) * bitrate / sampleRate) + padding;
    return { length, seconds: samples / sampleRate };
}

export class Mp3FrameIndex {
    private readonly frameStarts: number[] = [];
    private readonly frameTimes: number[] = [];
    private duration = 0;
    /** Absolute offset just past the last complete frame or skipped tag. */
    private indexedEnd = 0;
    private tail: Buffer = Buffer.alloc(0);
    private tailStart = 0;
    private skip = 0;

    get durationSeconds(): number {
        return this.duration;
    }

    push(chunk: Buffer) {
        const buf = this.tail.length > 0 ? Buffer.concat([this.tail, chunk]) : chunk;
        const base = this.tailStart;
        let i = 0;
        if (this.skip > 0) {
            const s = Math.min(this.skip, buf.length);
            i += s;
            this.skip -= s;
            if (this.skip === 0) this.indexedEnd = base + i;
        }
        while (buf.length - i >= 4) {
            if (buf[i] === 0x49 && buf[i + 1] === 0x44 && buf[i + 2] === 0x33) { // "ID3"
                if (buf.length - i < 10) break;
                const size = ((buf[i + 6] & 0x7f) << 21) | ((buf[i + 7] & 0x7f) << 14)
                    | ((buf[i + 8] & 0x7f) << 7) | (buf[i + 9] & 0x7f);
                const total = 10 + size + ((buf[i + 5] & 0x10) ? 10 : 0);
                const s = Math.min(total, buf.length - i);
                i += s;
                this.skip = total - s;
                if (this.skip === 0) this.indexedEnd = base + i;
                continue;
            }
            const header = parseFrameHeader(buf, i);
            if (!header) {
                i++;
                continue;
            }
            if (buf.length - i < header.length) break;
            this.frameStarts.push(base + i);
            this.frameTimes.push(this.duration);
            this.duration += header.seconds;
            i += header.length;
            this.indexedEnd = base + i;
        }
        this.tail = Buffer.from(buf.subarray(i));
        this.tailStart = base + i;
    }

    /**
     * Byte offset to start a stream at so playback begins at `seconds`: the
     * start of the frame playing then, or the end of everything indexed so far
     * when `seconds` is at or past the indexed duration.
     */
    byteOffsetAt(seconds: number): number {
        if (!(seconds > 0)) return 0;
        if (seconds >= this.duration) return this.indexedEnd;
        let lo = 0;
        let hi = this.frameTimes.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (this.frameTimes[mid] <= seconds) lo = mid;
            else hi = mid - 1;
        }
        return this.frameStarts[lo];
    }
}
