import { env } from './config/env.js';
import { connectDb } from './config/db.js';
import { createApp } from './app.js';
import { hubEnabled, hubStatus } from './services/hub.js';
import { mpesaEnabled } from './services/mpesa.js';
import { markInterruptedJobs } from './services/narration.js';

// One line in the logs that says whether readers can pay, and if not, why.
async function logPaymentSetup() {
  if (hubEnabled()) {
    const status = await hubStatus();
    console.log(
      status.reachable
        ? `M-Pesa: through ISA Tech Hub as "${status.platform?.name}", customers pay ${status.till?.kind} ${status.till?.payNumber}`
        : `M-Pesa: ISA Tech Hub is set but not usable: ${status.error}`,
    );
  } else if (mpesaEnabled()) {
    console.log('M-Pesa: directly with Daraja (MPESA_* settings)');
  } else {
    const { missing } = await hubStatus();
    console.log(`M-Pesa: off. Readers see "not set up yet". Missing: ${missing.join(', ')}`);
  }
}

async function main() {
  await connectDb();
  await markInterruptedJobs();
  const app = createApp();
  app.listen(env.port, () => {
    console.log(`A-Read API listening on http://localhost:${env.port}`);
    if (!env.googleTtsEnabled) console.log('Google Cloud TTS is off (set GOOGLE_APPLICATION_CREDENTIALS to enable narration)');
    logPaymentSetup().catch((err) => console.warn(`Could not check the payment setup: ${err.message}`));
  });
}

main().catch((err) => {
  console.error('Failed to start the server:', err);
  process.exit(1);
});
