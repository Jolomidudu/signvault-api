import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectInput, StoredObject, StoredObjectInfo } from './storage.types';

const MAX_OBJECT_SIZE = 64 * 1024;
const OBJECT_KEY_PATTERN = /^users\/[0-9a-f-]{36}\/signatures\/[0-9a-f-]{36}\/versions\/[0-9a-f-]{36}\/signature\.svg$/i;

@Injectable()
export class StorageService {
  private client: S3Client | undefined;
  private bucket: string | undefined;

  constructor(private readonly configService: ConfigService) {}

  private unavailable() {
    return new ServiceUnavailableException({
      message: 'Signature asset storage is unavailable.',
      code: 'SIGNATURE_ASSET_STORAGE_FAILED',
    });
  }

  private configuration() {
    const endpoint = this.configService.get<string>('AWS_ENDPOINT_URL_S3');
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
    const region = this.configService.get<string>('AWS_REGION');
    const bucket = this.configService.get<string>('NEON_OBJECT_STORAGE_BUCKET');

    if (!endpoint || !accessKeyId || !secretAccessKey || !region || !bucket) {
      throw this.unavailable();
    }

    if (!this.client || bucket !== this.bucket) {
      this.client?.destroy();
      this.client = new S3Client({
        endpoint,
        region,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true,
        requestChecksumCalculation: 'WHEN_REQUIRED',
      });
      this.bucket = bucket;
    }

    return { client: this.client, bucket };
  }

  private validateKey(key: string) {
    if (!OBJECT_KEY_PATTERN.test(key) || key.includes('..')) {
      throw this.unavailable();
    }
  }

  private isNotFound(error: unknown) {
    if (typeof error !== 'object' || error === null) return false;
    const providerError = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    return (
      providerError.$metadata?.httpStatusCode === 404 ||
      providerError.name === 'NotFound' ||
      providerError.name === 'NoSuchKey'
    );
  }

  private async send<T>(operation: (client: S3Client, bucket: string) => Promise<T>): Promise<T> {
    const { client, bucket } = this.configuration();
    try {
      return await operation(client, bucket);
    } catch {
      throw this.unavailable();
    }
  }

  async putObject(input: PutObjectInput) {
    this.validateKey(input.key);
    if (input.body.byteLength > MAX_OBJECT_SIZE || input.contentType !== 'image/svg+xml') {
      throw this.unavailable();
    }

    return this.send((client, bucket) =>
      client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          CacheControl: 'private, max-age=0, must-revalidate',
          Metadata: { sha256: input.checksum },
        }),
      ),
    );
  }

  async getObject(key: string): Promise<StoredObject | null> {
    this.validateKey(key);
    try {
      const { client, bucket } = this.configuration();
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!response.Body) return null;
      if (!Number.isInteger(response.ContentLength) || response.ContentLength! > MAX_OBJECT_SIZE) {
        throw this.unavailable();
      }

      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        const buffer = Buffer.from(chunk);
        size += buffer.byteLength;
        if (size > MAX_OBJECT_SIZE) throw this.unavailable();
        chunks.push(buffer);
      }

      return {
        body: Buffer.concat(chunks, size),
        contentType: response.ContentType,
        size: response.ContentLength,
        checksum: response.Metadata?.sha256,
      };
    } catch (error) {
      if (this.isNotFound(error)) return null;
      if (error instanceof ServiceUnavailableException) throw error;
      throw this.unavailable();
    }
  }

  async objectExists(key: string): Promise<StoredObjectInfo | null> {
    this.validateKey(key);
    try {
      const { client, bucket } = this.configuration();
      const response = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return {
        contentType: response.ContentType,
        size: response.ContentLength,
        checksum: response.Metadata?.sha256,
      };
    } catch (error) {
      if (this.isNotFound(error)) return null;
      if (error instanceof ServiceUnavailableException) throw error;
      throw this.unavailable();
    }
  }

  async deleteObject(key: string) {
    this.validateKey(key);
    return this.send((client, bucket) =>
      client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
    );
  }
}