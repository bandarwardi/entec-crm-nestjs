import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(EmailService.name);

  constructor(private configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST', 'smtp.hostinger.com');
    const port = Number(this.configService.get<number>('SMTP_PORT', 465));
    const secure = port === 465;

    this.logger.log(`Initializing EmailService with host: ${host}, port: ${port}, secure: ${secure}`);

    const transportOptions: any = {
      host: host,
      port: port,
      secure: secure,
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASS'),
      },
      tls: {
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2'
      },
      connectionTimeout: 60000, // Increase to 60s
      greetingTimeout: 60000,
      socketTimeout: 60000,
      family: 4 // Force IPv4 to avoid ENETUNREACH on IPv6
    };

    this.transporter = nodemailer.createTransport(transportOptions);
  }

  async sendMail(to: string, subject: string, text: string, html?: string, attachments?: any[]) {
    try {
      const info = await this.transporter.sendMail({
        from: this.configService.get<string>('SMTP_FROM', '"EN TEC" <noreply@entec.com>'),
        to,
        subject,
        text,
        html,
        attachments,
      });
      this.logger.log(`Email sent: ${info.messageId}`);
      return info;
    } catch (error) {
      this.logger.error(`Error sending email: ${error.message}`);
      throw error;
    }
  }
}
