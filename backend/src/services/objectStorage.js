'use strict';

const crypto = require('crypto');
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const bucket = process.env.OBJECT_STORAGE_BUCKET || (process.env.NODE_ENV === 'production' ? null : process.env.S3_BUCKET);
const configured = Boolean(bucket);
const client = configured
  ? new S3Client({
      region: process.env.OBJECT_STORAGE_REGION || process.env.AWS_REGION || 'us-east-1',
      endpoint: process.env.OBJECT_STORAGE_ENDPOINT || process.env.S3_ENDPOINT || undefined,
      forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === 'true',
    })
  : null;

function getPublicBaseUrl() {
  return process.env.OBJECT_STORAGE_PUBLIC_URL || process.env.CDN_URL || process.env.S3_PUBLIC_URL || '';
}

function publicUrlForKey(key) {
  const base = getPublicBaseUrl();
  return base ? `${base.replace(/\/$/, '')}/${key.replace(/^\//, '')}` : null;
}

function createObjectKey(extension, prefix = 'uploads') {
  return `${prefix}/${crypto.randomBytes(16).toString('hex')}${extension}`;
}

async function putObject({ key, body, contentType, contentLength }) {
  if (!configured) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Object storage is not configured (OBJECT_STORAGE_BUCKET is required)');
    }
    return { key, url: `/uploads/${key.split('/').pop()}` };
  }
  const input = { Bucket: bucket, Key: key, Body: body, ContentType: contentType };
  if (Number.isFinite(contentLength)) input.ContentLength = contentLength;
  await client.send(new PutObjectCommand(input));
  return { key, url: await getDownloadUrl(key) };
}

async function getDownloadUrl(key, expiresIn = 900) {
  if (!configured) return `/uploads/${key.split('/').pop()}`;
  const publicUrl = publicUrlForKey(key);
  if (publicUrl) return publicUrl;
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

async function deleteObject(key) {
  if (!configured) return false;
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  return true;
}

async function listObjects(prefix = 'uploads/') {
  if (!configured) return [];
  const objects = [];
  let continuationToken;
  do {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
      })
    );
    objects.push(
      ...(result.Contents || []).map((item) => ({
        key: item.Key,
        lastModified: item.LastModified,
      }))
    );
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);
  return objects;
}

module.exports = {
  configured,
  bucket,
  createObjectKey,
  putObject,
  getDownloadUrl,
  deleteObject,
  listObjects,
};
