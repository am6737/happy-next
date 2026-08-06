export interface LocalAttachment {
    uri: string;
    name: string;
    mimeType: string;
    size: number;
    image?: {
        width: number;
        height: number;
    };
}
