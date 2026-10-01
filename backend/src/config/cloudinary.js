import { v2 as cloudinary } from 'cloudinary';
import { HttpError } from '../utils/httpError.js';

// The SDK reads CLOUDINARY_URL (cloudinary://<key>:<secret>@<cloud_name>) from the environment.
cloudinary.config({ secure: true });

export function assertCloudinaryConfigured() {
  const { cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret } = cloudinary.config();
  if (!cloudName || !apiKey || !apiSecret) {
    throw new HttpError(503, 'File storage is not configured on this server (set CLOUDINARY_URL in backend/.env)');
  }
}

export { cloudinary };
