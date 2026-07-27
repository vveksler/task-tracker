import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

/** Cap SMTP wait so auth endpoints never hang until the platform times out. */
const SMTP_CONNECTION_TIMEOUT_MS = 10_000;
const SMTP_SOCKET_TIMEOUT_MS = 15_000;

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('mail.host'));
  }

  private getTransporter(): Transporter {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Email is not configured. Set MAIL_HOST (and related MAIL_* vars).',
      );
    }

    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.config.get<string>('mail.host'),
        port: this.config.get<number>('mail.port'),
        secure: this.config.get<number>('mail.port') === 465,
        connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
        greetingTimeout: SMTP_CONNECTION_TIMEOUT_MS,
        socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
        auth: {
          user: this.config.get<string>('mail.user') || undefined,
          pass: this.config.get<string>('mail.pass') || undefined,
        },
      });
    }

    return this.transporter;
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    await this.sendMail({
      to,
      subject: 'Reset your Task Tracker password',
      text: `Reset your password using this link (valid for 1 hour):\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>Reset your password using this link (valid for 1 hour):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you did not request this, you can ignore this email.</p>`,
      failureLabel: 'password reset',
    });
  }

  async sendEmailVerification(to: string, verifyUrl: string): Promise<void> {
    await this.sendMail({
      to,
      subject: 'Confirm your Task Tracker email',
      text: `Confirm your email using this link (valid for 24 hours):\n\n${verifyUrl}\n\nIf you did not create an account, you can ignore this email.`,
      html: `<p>Confirm your email using this link (valid for 24 hours):</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>If you did not create an account, you can ignore this email.</p>`,
      failureLabel: 'email verification',
    });
  }

  /**
   * Fire-and-forget send for signup / reset flows.
   * Trade-off vs awaiting sendMail: the HTTP handler returns immediately
   * ("check your email") even if SMTP is slow or temporarily down. Failures
   * are logged; the user can use resend. Prefer this over blocking register
   * for 30–60s until the platform kills the request.
   */
  enqueue(
    send: () => Promise<void>,
    context: string,
  ): void {
    void send().catch((err: unknown) => {
      this.logger.error(
        `Background ${context} email failed`,
        err instanceof Error ? err.stack : String(err),
      );
    });
  }

  private async sendMail(params: {
    to: string;
    subject: string;
    text: string;
    html: string;
    failureLabel: string;
  }): Promise<void> {
    const from = this.config.get<string>('mail.from');
    try {
      await this.getTransporter().sendMail({
        from,
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send ${params.failureLabel} email to ${params.to}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw new ServiceUnavailableException(
        `Failed to send ${params.failureLabel} email. Try again later.`,
      );
    }
  }
}
