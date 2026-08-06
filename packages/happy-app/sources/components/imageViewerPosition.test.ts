import { describe, expect, it } from 'vitest';

import { clampImageViewerIndex } from './imageViewerPosition';

describe('image viewer positioning', () => {
  it('clamps indices to the available image range', () => {
    expect(clampImageViewerIndex(-1, 4)).toBe(0);
    expect(clampImageViewerIndex(4, 4)).toBe(3);
    expect(clampImageViewerIndex(2, 0)).toBe(0);
  });
});
