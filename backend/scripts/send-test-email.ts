import path from 'path';
import { config as loadEnv } from 'dotenv';
import { EmailService } from '../src/services/emailService';

// Load environment variables from backend/.env by default
loadEnv({
  path: process.env.DOTENV_CONFIG_PATH || path.resolve(__dirname, '../.env')
});

async function main() {
  console.log('Email configured?', EmailService.isConfigured());

  const didSend = await EmailService.sendBudgetAlertEmail({
    to: process.env.TEST_EMAIL_TO || 'you@example.com',
    subject: 'Mazzy Money SMTP smoke test',
    text: 'If you see this message, SMTP credentials are working.'
  });

  console.log('Send result:', didSend ? 'success' : 'failed');
}

main().catch((error) => {
  console.error('SMTP test script failed:', error);
  process.exitCode = 1;
});

