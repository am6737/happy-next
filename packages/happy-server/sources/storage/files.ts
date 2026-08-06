import * as Minio from 'minio';
import { validateS3PublicUrl } from './s3PublicUrl';

const s3Host = process.env.S3_HOST!;
const s3Port = process.env.S3_PORT ? parseInt(process.env.S3_PORT, 10) : undefined;
const s3UseSSL = process.env.S3_USE_SSL ? process.env.S3_USE_SSL === 'true' : true;

const s3Region = process.env.S3_REGION || 'us-east-1';
const s3PartSize = 5 * 1024 * 1024;

export const s3client = new Minio.Client({
    endPoint: s3Host,
    port: s3Port,
    useSSL: s3UseSSL,
    accessKey: process.env.S3_ACCESS_KEY!,
    secretKey: process.env.S3_SECRET_KEY!,
    region: s3Region,
    // MinIO buffers streams smaller than partSize. Keep attachment uploads
    // bounded instead of buffering the SDK default of up to 64 MB.
    partSize: s3PartSize,
});

export const s3bucket = process.env.S3_BUCKET!;
export const s3privateBucket = process.env.S3_PRIVATE_BUCKET || `${s3bucket}-private`;

export const s3host = process.env.S3_HOST!

export const s3public = validateS3PublicUrl();

function isBucketAlreadyExistsError(error: unknown): boolean {
    return error instanceof Minio.S3Error
        && (error.code === 'BucketAlreadyOwnedByYou' || error.code === 'BucketAlreadyExists');
}

export async function loadFiles() {
    await s3client.bucketExists(s3bucket); // Throws if bucket does not exist or is not accessible
    if (!await s3client.bucketExists(s3privateBucket)) {
        try {
            await s3client.makeBucket(s3privateBucket, s3Region);
        } catch (error) {
            if (!isBucketAlreadyExistsError(error) || !await s3client.bucketExists(s3privateBucket)) {
                throw error;
            }
        }
    }
}

export function getPublicUrl(path: string) {
    return `${s3public}/${path}`;
}

export type ImageRef = {
    width: number;
    height: number;
    thumbhash: string;
    path: string;
}
