import nodemailer, { Transporter } from 'nodemailer';

interface BudgetAlertEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export class EmailService {
  private static transporter: Transporter | null = null;
  private static configured = false;

  private static ensureTransporter(): void {
    if (this.transporter) {
      return;
    }

    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: {
          user,
          pass
        }
      });
      this.configured = true;
      return;
    }

    // Fallback transport that writes emails to console for local development
    this.transporter = nodemailer.createTransport({
      jsonTransport: true
    });
    this.configured = false;
  }

  static isConfigured(): boolean {
    this.ensureTransporter();
    return this.configured;
  }

  static async sendBudgetAlertEmail(message: BudgetAlertEmail): Promise<boolean> {
    this.ensureTransporter();

    if (!this.transporter) {
      console.warn('EmailService: transporter not initialized');
      return false;
    }

    const from = process.env.EMAIL_FROM || 'Money App <no-reply@money-app.local>';

    try {
      const info = await this.transporter.sendMail({
        from,
        ...message
      });

      if (!this.configured) {
        console.log('EmailService (dev fallback) payload:', info.message);
      }

      return this.configured;
    } catch (error) {
      console.error('EmailService: failed to send email', error);
      return false;
    }
  }
}

