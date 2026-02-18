'use strict';

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Readable } = require('stream');
const config = require('../config');
const logger = require('../utils/logger');

// Initialize S3 client
let s3Client = null;

function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: config.aws.region,
      credentials: {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      },
    });
  }
  return s3Client;
}

/**
 * Upload a buffer or stream to S3
 * @param {Object} options
 * @param {string} options.key - S3 object key (path)
 * @param {Buffer|ReadableStream} options.body - File content
 * @param {string} options.contentType - MIME type
 * @param {Object} [options.metadata] - Custom metadata
 * @returns {Promise<{key: string, bucket: string}>}
 */
async function uploadToS3({ key, body, contentType, metadata = {} }) {
  const client = getS3Client();
  const bucket = config.aws.s3Bucket;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    Metadata: metadata,
    ServerSideEncryption: 'AES256', // encrypt at rest
  });

  await client.send(command);

  logger.info('File uploaded to S3', { key, bucket, contentType });

  return { key, bucket };
}

/**
 * Generate a pre-signed URL for downloading from S3
 * @param {string} key - S3 object key
 * @param {number} [expiresIn] - URL expiry in seconds (default from config)
 * @returns {Promise<{url: string, expiresAt: Date}>}
 */
async function getSignedDownloadUrl(key, expiresIn = null) {
  const client = getS3Client();
  const bucket = config.aws.s3Bucket;
  const expiry = expiresIn || config.aws.signedUrlExpiry;

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const url = await getSignedUrl(client, command, { expiresIn: expiry });
  const expiresAt = new Date(Date.now() + expiry * 1000);

  logger.info('Signed URL generated', { key, expiresIn: expiry });

  return { url, expiresAt };
}

/**
 * Generate the S3 key path for an export file
 * @param {string} partnerId
 * @param {string} jobId
 * @param {string} format - csv, xlsx, pdf, zip
 * @returns {string}
 */
function generateExportKey(partnerId, jobId, format) {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const extensions = {
    csv: 'csv',
    excel: 'xlsx',
    pdf: 'pdf',
    zip: 'zip',
  };
  const ext = extensions[format] || format;
  return `exports/${partnerId}/${date}/${jobId}.${ext}`;
}

/**
 * Content type mapping for export formats
 */
function getContentType(format) {
  const types = {
    csv: 'text/csv',
    excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pdf: 'application/pdf',
    zip: 'application/zip',
  };
  return types[format] || 'application/octet-stream';
}

module.exports = {
  uploadToS3,
  getSignedDownloadUrl,
  generateExportKey,
  getContentType,
};


