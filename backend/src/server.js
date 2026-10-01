import { env } from './config/env.js';
import { connectDb } from './config/db.js';
import { createApp } from './app.js';
import { markInterruptedJobs } from './services/narration.js';

async function main() {
  await connectDb();
  await markInterruptedJobs();
  const app = createApp();
  app.listen(env.port, () => {
    console.log(`A-Read API listening on http://localhost:${env.port}`);
    if (!env.googleTtsEnabled) console.log('Google Cloud TTS is off (set GOOGLE_APPLICATION_CREDENTIALS to enable narration)');
  });
}

main().catch((err) => {
  console.error('Failed to start the server:', err);
  process.exit(1);
});
