import { describe, expect, it } from 'vitest';
import { Mp3FrameIndex } from './mp3FrameIndex';

// MPEG2 Layer III, 32 kbps, 24 kHz, no padding: 96-byte frames of 24 ms.
const FRAME_BYTES = 96;
const FRAME_SECONDS = 576 / 24000;

function frame(fill = 0) {
    const buf = Buffer.alloc(FRAME_BYTES, fill);
    buf[0] = 0xff;
    buf[1] = 0xf3;
    buf[2] = 0x44;
    buf[3] = 0xc4;
    return buf;
}

function id3(bodyBytes: number) {
    const buf = Buffer.alloc(10 + bodyBytes);
    buf.write('ID3', 0);
    buf[3] = 4;
    buf[9] = bodyBytes; // syncsafe size, < 128 here
    return buf;
}

describe('Mp3FrameIndex', () => {
    it('maps seconds to the start of the frame playing then', () => {
        const index = new Mp3FrameIndex();
        index.push(Buffer.concat([frame(), frame(), frame(), frame()]));
        expect(index.durationSeconds).toBeCloseTo(4 * FRAME_SECONDS);
        expect(index.byteOffsetAt(0)).toBe(0);
        expect(index.byteOffsetAt(FRAME_SECONDS * 1.5)).toBe(FRAME_BYTES);
        expect(index.byteOffsetAt(FRAME_SECONDS * 3.2)).toBe(3 * FRAME_BYTES);
        expect(index.byteOffsetAt(10)).toBe(4 * FRAME_BYTES);
    });

    it('indexes frames split across chunks and only counts complete frames', () => {
        const all = Buffer.concat([frame(), frame(), frame()]);
        const index = new Mp3FrameIndex();
        index.push(all.subarray(0, 50));
        expect(index.durationSeconds).toBe(0);
        index.push(all.subarray(50, 200));
        expect(index.durationSeconds).toBeCloseTo(2 * FRAME_SECONDS);
        expect(index.byteOffsetAt(10)).toBe(2 * FRAME_BYTES);
        index.push(all.subarray(200));
        expect(index.durationSeconds).toBeCloseTo(3 * FRAME_SECONDS);
        expect(index.byteOffsetAt(FRAME_SECONDS * 2.5)).toBe(2 * FRAME_BYTES);
    });

    it('skips ID3 tags between per-sentence files, even split across chunks', () => {
        const tag = id3(20);
        const all = Buffer.concat([tag, frame(), tag, frame()]);
        const index = new Mp3FrameIndex();
        index.push(all.subarray(0, 5));
        index.push(all.subarray(5, 140));
        index.push(all.subarray(140));
        expect(index.durationSeconds).toBeCloseTo(2 * FRAME_SECONDS);
        expect(index.byteOffsetAt(FRAME_SECONDS * 1.5)).toBe(tag.length * 2 + FRAME_BYTES);
    });

    it('resyncs past bytes that are not frame headers', () => {
        const index = new Mp3FrameIndex();
        index.push(Buffer.concat([Buffer.from([1, 2, 3]), frame(), frame()]));
        expect(index.durationSeconds).toBeCloseTo(2 * FRAME_SECONDS);
        expect(index.byteOffsetAt(FRAME_SECONDS * 0.5)).toBe(3);
        expect(index.byteOffsetAt(FRAME_SECONDS * 1.5)).toBe(3 + FRAME_BYTES);
    });
});
