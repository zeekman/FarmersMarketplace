'use strict';

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  OBJECT_STORAGE_BUCKET: process.env.OBJECT_STORAGE_BUCKET,
  OBJECT_STORAGE_PUBLIC_URL: process.env.OBJECT_STORAGE_PUBLIC_URL,
  OBJECT_STORAGE_REGION: process.env.OBJECT_STORAGE_REGION,
};

let storage;
let sendMock;

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.OBJECT_STORAGE_BUCKET = 'test-uploads';
  process.env.OBJECT_STORAGE_PUBLIC_URL = 'https://cdn.example.test/assets/';
  process.env.OBJECT_STORAGE_REGION = 'us-east-1';

  jest.resetModules();
  const { S3Client } = require('@aws-sdk/client-s3');
  sendMock = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({});
  storage = require('../services/objectStorage');
});

afterEach(() => {
  if (sendMock) sendMock.mockRestore();
  restoreEnv('NODE_ENV', originalEnv.NODE_ENV);
  restoreEnv('OBJECT_STORAGE_BUCKET', originalEnv.OBJECT_STORAGE_BUCKET);
  restoreEnv('OBJECT_STORAGE_PUBLIC_URL', originalEnv.OBJECT_STORAGE_PUBLIC_URL);
  restoreEnv('OBJECT_STORAGE_REGION', originalEnv.OBJECT_STORAGE_REGION);
});

describe('objectStorage S3 operations', () => {
  it('streams the supplied body to S3 and returns the configured public URL', async () => {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const body = require('stream').Readable.from([Buffer.from('image bytes')]);

    const stored = await storage.putObject({
      key: 'uploads/test-image.webp',
      body,
      contentType: 'image/webp',
    });

    expect(stored).toEqual({
      key: 'uploads/test-image.webp',
      url: 'https://cdn.example.test/assets/uploads/test-image.webp',
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'test-uploads',
      Key: 'uploads/test-image.webp',
      Body: body,
      ContentType: 'image/webp',
    });
  });

  it('lists every page of matching S3 object keys', async () => {
    const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
    sendMock
      .mockResolvedValueOnce({
        Contents: [{ Key: 'uploads/first.jpg', LastModified: new Date('2026-01-01') }],
        IsTruncated: true,
        NextContinuationToken: 'page-2',
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'uploads/second.png', LastModified: new Date('2026-01-02') }],
        IsTruncated: false,
      });

    const objects = await storage.listObjects();

    expect(objects.map((object) => object.key)).toEqual([
      'uploads/first.jpg',
      'uploads/second.png',
    ]);
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0][0]).toBeInstanceOf(ListObjectsV2Command);
    expect(sendMock.mock.calls[1][0].input.ContinuationToken).toBe('page-2');
  });

  it('deletes an object by key', async () => {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');

    await expect(storage.deleteObject('uploads/old.jpg')).resolves.toBe(true);
    expect(sendMock.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
    expect(sendMock.mock.calls[0][0].input).toMatchObject({
      Bucket: 'test-uploads',
      Key: 'uploads/old.jpg',
    });
  });
});
