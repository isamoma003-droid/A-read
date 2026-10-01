import { cloudinary } from '../config/cloudinary.js';
import { env } from '../config/env.js';

const CHUNKED_UPLOAD_BYTES = 20 * 1024 * 1024;

export const bookFolder = (bookId) => `${env.cloudinaryFolder}/books/${bookId}`;

function toAsset(result, resourceType) {
  return {
    url: result.secure_url,
    publicId: result.public_id,
    resourceType,
    bytes: result.bytes,
    format: result.format,
    duration: result.duration,
  };
}

// Cloudinary errors carry the full request (including the API secret), so only log the message.
const errorMessage = (err) => err?.error?.message || err?.message || String(err);

function callbackPromise(start) {
  return new Promise((resolve, reject) => {
    start((error, result) => {
      if (error) reject(new Error(`Cloudinary upload failed: ${errorMessage(error)}`));
      else resolve(result);
    });
  });
}

// Uploads a file from disk. Large files go up in chunks (required above 100 MB).
export async function uploadFile(filePath, { publicId, resourceType, size = 0, transformation }) {
  const options = { public_id: publicId, resource_type: resourceType, overwrite: true, invalidate: true, transformation };
  const result = await callbackPromise((done) =>
    size > CHUNKED_UPLOAD_BYTES
      ? cloudinary.uploader.upload_large(filePath, { ...options, chunk_size: CHUNKED_UPLOAD_BYTES }, done)
      : cloudinary.uploader.upload(filePath, options, done),
  );
  return toAsset(result, resourceType);
}

export async function uploadBuffer(buffer, { publicId, resourceType, transformation }) {
  const result = await callbackPromise((done) =>
    cloudinary.uploader
      .upload_stream(
        { public_id: publicId, resource_type: resourceType, overwrite: true, invalidate: true, transformation },
        done,
      )
      .end(buffer),
  );
  return toAsset(result, resourceType);
}

export async function destroyAsset(asset) {
  if (!asset?.publicId) return;
  try {
    await cloudinary.uploader.destroy(asset.publicId, { resource_type: asset.resourceType || 'image', invalidate: true });
  } catch (err) {
    console.warn(`Could not delete Cloudinary asset ${asset.publicId}: ${errorMessage(err)}`);
  }
}

// Removes every file stored for a book (book file, covers, narration, audiobook).
export async function deleteBookFolder(bookId) {
  const prefix = `${bookFolder(bookId)}/`;
  for (const resourceType of ['image', 'video', 'raw']) {
    try {
      await cloudinary.api.delete_resources_by_prefix(prefix, { resource_type: resourceType });
    } catch (err) {
      console.warn(`Could not delete Cloudinary ${resourceType} files under ${prefix}: ${errorMessage(err)}`);
    }
  }
  await cloudinary.api.delete_folder(bookFolder(bookId)).catch(() => {});
}

// Cloudinary renders the first page of an uploaded PDF as a JPG, which makes a free cover.
export function pdfCoverUrl(publicId) {
  return cloudinary.url(publicId, {
    resource_type: 'image',
    format: 'jpg',
    page: 1,
    width: 600,
    crop: 'limit',
    quality: 'auto',
    secure: true,
  });
}

export { errorMessage };

export const COVER_TRANSFORMATION = [{ width: 800, height: 1200, crop: 'limit', quality: 'auto' }];
