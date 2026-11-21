'use strict';

const multer = require('multer');
const FileType = require('file-type');
const { Readable } = require('stream');
const objectStorage = require('../services/objectStorage');

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const TYPE_EXTENSIONS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const SNIFF_BYTES = 4100;

function fileFilter(_req, file, cb) {
  if (ALLOWED_TYPES.includes(file.mimetype)) return cb(null, true);
  return cb(
    Object.assign(new Error('Only JPEG, PNG, and WebP images are allowed'), {
      code: 'INVALID_TYPE',
    })
  );
}

function invalidTypeError() {
  return Object.assign(new Error('Only JPEG, PNG, and WebP images are allowed'), {
    code: 'INVALID_TYPE',
  });
}

async function detectImageType(buffer) {
  const detected = await FileType.fromBuffer(buffer);
  const extension = detected && TYPE_EXTENSIONS[detected.mime];
  if (!extension) throw invalidTypeError();
  return { mime: detected.mime, extension };
}

function filenameFor(key) {
  return key.split('/').pop();
}

// Local development retains data in memory; production uses the streaming S3
// engine below and never creates an instance-local file.
const memoryStorage = {
  _handleFile(_req, file, cb) {
    const chunks = [];
    let size = 0;
    file.stream.on('data', (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
    });
    file.stream.on('error', cb);
    file.stream.on('end', async () => {
      try {
        file.buffer = Buffer.concat(chunks, size);
        const detected = await detectImageType(file.buffer.subarray(0, SNIFF_BYTES));
        file.mimetype = detected.mime;
        file.extension = detected.extension;
        const key = objectStorage.createObjectKey(file.extension);
        file.key = key;
        file.filename = filenameFor(key);
        file.url = `/uploads/${file.filename}`;
        file.verified = true;
        cb(null, { size, key, filename: file.filename, url: file.url });
      } catch (error) {
        cb(error);
      }
    });
  },
  _removeFile(_req, file, cb) {
    delete file.buffer;
    cb(null);
  },
};

// Read just enough multipart stream data to validate its signature, then yield
// that prefix and the remaining incoming chunks directly to the S3 SDK. No
// production upload is buffered in full or written to local disk.
const objectStorageEngine = {
  _handleFile(_req, file, cb) {
    (async () => {
      const iterator = file.stream[Symbol.asyncIterator]();
      const prefix = [];
      let prefixSize = 0;
      let size = 0;
      while (prefixSize < SNIFF_BYTES) {
        const next = await iterator.next();
        if (next.done) break;
        prefix.push(next.value);
        prefixSize += next.value.length;
        size += next.value.length;
      }

      const detected = await detectImageType(Buffer.concat(prefix, prefixSize));
      const key = objectStorage.createObjectKey(detected.extension);
      const body = Readable.from(
        (async function* streamFile() {
          for (const chunk of prefix) yield chunk;
          while (true) {
            const next = await iterator.next();
            if (next.done) break;
            size += next.value.length;
            yield next.value;
          }
        })()
      );
      const stored = await objectStorage.putObject({
        key,
        body,
        contentType: detected.mime,
      });
      file.mimetype = detected.mime;
      file.extension = detected.extension;
      file.key = stored.key;
      file.filename = filenameFor(stored.key);
      file.url = stored.url;
      file.verified = true;
      file.stored = true;
      cb(null, {
        size,
        key: stored.key,
        filename: file.filename,
        url: stored.url,
      });
    })().catch((error) => {
      // Ensure the multipart parser can finish even when validation or S3 fails.
      file.stream.resume();
      cb(error);
    });
  },
  _removeFile(_req, file, cb) {
    if (!file.key) return cb(null);
    objectStorage.deleteObject(file.key).then(
      () => cb(null),
      (error) => cb(error)
    );
  },
};

const upload = multer({
  storage: objectStorage.configured ? objectStorageEngine : memoryStorage,
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter,
});

async function verifyUploadedFile(file) {
  if (file?.verified) return file;
  if (!file?.buffer) throw Object.assign(new Error('No file uploaded'), { code: 'INVALID_TYPE' });
  const detected = await detectImageType(file.buffer);
  file.mimetype = detected.mime;
  file.extension = detected.extension;
  file.verified = true;
  return file;
}

async function storeUploadedFile(file) {
  await verifyUploadedFile(file);
  if (file.stored) return file;
  const key = file.key || objectStorage.createObjectKey(file.extension);
  const stored = await objectStorage.putObject({
    key,
    body: file.buffer,
    contentType: file.mimetype,
    contentLength: file.buffer.length,
  });
  file.key = stored.key;
  file.url = stored.url;
  file.filename = filenameFor(stored.key);
  file.stored = objectStorage.configured;
  return file;
}

module.exports = upload;
module.exports.verifyUploadedFile = verifyUploadedFile;
module.exports.storeUploadedFile = storeUploadedFile;
module.exports.ALLOWED_TYPES = ALLOWED_TYPES;
module.exports.TYPE_EXTENSIONS = TYPE_EXTENSIONS;
