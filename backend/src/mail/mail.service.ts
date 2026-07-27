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
    return Boolean(
      this.config.get<string>('mail.resendApiKey') ||
        this.config.get<string>('mail.host'),
    );
  }

  private usesResend(): boolean {
    return Boolean(this.config.get<string>('mail.resendApiKey'));
  }

  private getTransporter(): Transporter {
    if (!this.config.get<string>('mail.host')) {
      throw new ServiceUnavailableException(
        'Email is not configured. Set RESEND_API_KEY (Railway) or MAIL_HOST.',
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

  private async sendMail(params: {
    to: string;
    subject: string;
    text: string;
    html: string;
    failureLabel: string;
  }): Promise<void> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Email is not configured. Set RESEND_API_KEY (Railway) or MAIL_HOST.',
      );
    }

    try {
      if (this.usesResend()) {
        await this.sendViaResend(params);
      } else {
        await this.sendViaSmtp(params);
      }
      this.logger.log(
        `Sent ${params.failureLabel} email to ${params.to} via ${this.usesResend() ? 'Resend' : 'SMTP'}`,
      );
    } catch (err) {
      if (err instanceof ServiceUnavailableException) {
        throw err;
      }
      this.logger.error(
        `Failed to send ${params.failureLabel} email to ${params.to}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw new ServiceUnavailableException(
        `Failed to send ${params.failureLabel} email. Try again later.`,
      );
    }
  }

  /**
   * HTTPS API — works on Railway Hobby (outbound SMTP ports are blocked).
   * No extra npm dependency; plain fetch to Resend REST.
   */
  private async sendViaResend(params: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<void> {
    const apiKey = this.config.get<string>('mail.resendApiKey') ?? '';
    // Resend rejects unverified domains. Test sender must be onboarding@resend.dev
    // until you verify your own domain in the Resend dashboard.
    const configuredFrom = this.config.get<string>('mail.from') ?? '';
    const from =
      !configuredFrom ||
      configuredFrom.includes('localhost') ||
      configuredFrom.includes('task-tracker.local')
        ? 'Task Tracker <onboarding@resend.dev>'
        : configuredFrom;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        text: params.text,
        html: params.html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(
        `Resend API ${res.status} (from=${from}): ${body}`,
      );
      // Surface Resend's message so misconfigured MAIL_FROM is obvious in the UI.
      let detail = body;
      try {
        const parsed = JSON.parse(body) as { message?: string };
        if (parsed.message) detail = parsed.message;
      } catch {
        /* keep raw body */
      }
      throw new ServiceUnavailableException(
        `Failed to send email via Resend: ${detail}`,
      );
    }
  }

  private async sendViaSmtp(params: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<void> {
    const from = this.config.get<string>('mail.from');
    await this.getTransporter().sendMail({
      from,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
    });
  }
}
