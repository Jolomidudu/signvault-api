export type PutObjectInput = {
  key: string;
  body: Buffer;
  contentType: string;
  checksum: string;
};

export type StoredObject = {
  body: Buffer;
  contentType: string | undefined;
  size: number | undefined;
  checksum: string | undefined;
};

export type StoredObjectInfo = Omit<StoredObject, 'body'>;