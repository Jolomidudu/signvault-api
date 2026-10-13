import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { jest } from '@jest/globals';
import type { Mock } from 'jest-mock';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

const objectKey =
  'users/11111111-1111-4111-8111-111111111111/signatures/22222222-2222-4222-8222-222222222222/versions/33333333-3333-4333-8333-333333333333/signature.svg';

describe('StorageService', () => {
  const values: Record<string, string> = {
    AWS_ENDPOINT_URL_S3: 'https://storage.example.invalid',
    AWS_ACCESS_KEY_ID: 'test-access-key',
    AWS_SECRET_ACCESS_KEY: 'test-secret-key',
    AWS_REGION: 'us-east-2',
    NEON_OBJECT_STORAGE_BUCKET: 'private-test-bucket',
  };
  let service: StorageService;
  let send: Mock<(command: unknown) => Promise<unknown>>;

  beforeEach(() => {
    const config = { get: (key: string) => values[key] } as unknown as ConfigService;
    service = new StorageService(config);
    send = jest
      .spyOn(S3Client.prototype, 'send')
      .mockResolvedValue({} as never) as unknown as Mock<(command: unknown) => Promise<unknown>>;
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.restoreAllMocks();
  });

  it('writes canonical SVG bytes with trusted metadata', async () => {
    await service.putObject({
      key: objectKey,
      body: Buffer.from('<svg/>'),
      contentType: 'image/svg+xml',
      checksum: 'a'.repeat(64),
    });

    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'private-test-bucket',
      Key: objectKey,
      ContentType: 'image/svg+xml',
      Metadata: { sha256: 'a'.repeat(64) },
    });
  });

  it('reads bounded object bodies and metadata', async () => {
    const response = {
      Body: {
        async *[Symbol.asyncIterator]() {
          yield Buffer.from('<svg/>');
        },
      },
      ContentLength: 6,
      ContentType: 'image/svg+xml',
      Metadata: { sha256: 'b'.repeat(64) },
    };
    send.mockResolvedValue(response as never);

    await expect(service.getObject(objectKey)).resolves.toMatchObject({
      body: Buffer.from('<svg/>'),
      contentType: 'image/svg+xml',
      size: 6,
      checksum: 'b'.repeat(64),
    });
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
  });

  it('translates provider failures without exposing provider details', async () => {
    send.mockRejectedValue(new Error('secret credential details'));

    await expect(
      service.putObject({ key: objectKey, body: Buffer.from('<svg/>'), contentType: 'image/svg+xml', checksum: 'c' }),
    ).rejects.toThrow('Signature asset storage is unavailable.');
  });

  it('rejects arbitrary keys and non-SVG content', async () => {
    await expect(
      service.putObject({
        key: '../../unowned.svg',
        body: Buffer.from('<svg/>'),
        contentType: 'image/svg+xml',
        checksum: 'd',
      }),
    ).rejects.toThrow();
    await expect(
      service.putObject({ key: objectKey, body: Buffer.from('x'), contentType: 'image/png', checksum: 'e' }),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('allows only the isolated text smoke-test prefix for non-SVG objects', async () => {
    const key = 'signvault-tests/storage-smoke/44444444-4444-4444-8444-444444444444.txt';
    await service.putObject({ key, body: Buffer.from('test'), contentType: 'text/plain', checksum: 'f' });
    expect((send.mock.calls[0][0] as PutObjectCommand).input).toMatchObject({ Key: key, ContentType: 'text/plain' });

    await service.deleteObject(key);
    expect(send.mock.calls[1][0]).toBeInstanceOf(DeleteObjectCommand);
    await expect(
      service.putObject({ key, body: Buffer.from('test'), contentType: 'image/svg+xml', checksum: 'f' }),
    ).rejects.toThrow();
  });
});