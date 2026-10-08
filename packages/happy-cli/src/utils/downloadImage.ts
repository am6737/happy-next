import axios from 'axios';
import { delay } from '@/utils/time';
import { logger } from '@/ui/logger';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

interface DownloadedImage {
    base64: string;
    mimeType: string;
}

/**
 * Downloads an image from URL and returns it as base64.
 */
export async function downloadImage(url: string): Promise<DownloadedImage> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
            });

            const buffer = Buffer.from(response.data);
            const base64 = buffer.toString('base64');

            const contentType = response.headers['content-type'];
            let mimeType = typeof contentType === 'string' ? contentType : 'image/jpeg';
            if (mimeType.includes(';')) {
                mimeType = mimeType.split(';')[0].trim();
            }

            return { base64, mimeType };
        } catch (error) {
            lastError = error;
            if (attempt < MAX_RETRIES) {
                logger.debug(`[downloadImage] Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed for ${url}, retrying in ${RETRY_DELAYS[attempt]}ms`, error);
                await delay(RETRY_DELAYS[attempt]);
            }
        }
    }
    throw lastError;
}
