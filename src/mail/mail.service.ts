import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import * as fs from "fs";
import * as path from "path";

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const host = this.config.get<string>("MAIL_HOST");
    const user = this.config.get<string>("MAIL_USER");
    const pass = this.config.get<string>("MAIL_PASS");

    if (!host || !user || !pass) {
      this.logger.warn(
        "SMTP не настроен (MAIL_HOST / MAIL_USER / MAIL_PASS не заданы). " +
          "Отправка писем отключена — в dev-режиме токен возвращается в ответе API.",
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port: this.config.get<number>("MAIL_PORT", 587),
      secure: this.config.get<boolean>("MAIL_SECURE", false),
      auth: { user, pass },
    });

    this.logger.log(`SMTP транспорт инициализирован: ${host}`);
  }

  async sendPasswordReset(to: string, resetToken: string): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`[MAIL-SKIP] sendPasswordReset → ${to} (SMTP не настроен)`);
      return;
    }

    const frontendUrl = this.config.get<string>("FRONTEND_URL", "http://localhost:3000");
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    const templatePath = path.join(__dirname, "templates", "reset-password.html");
    let html = fs.readFileSync(templatePath, "utf8");
    html = html
      .replace(/\{\{resetUrl\}\}/g, resetUrl)
      .replace(/\{\{resetToken\}\}/g, resetToken);

    const from = this.config.get<string>("MAIL_FROM", "MottLarbe <noreply@mottlarbe.ru>");

    await this.transporter.sendMail({
      from,
      to,
      subject: "Сброс пароля — MottLarbe Dosham",
      html,
    });

    this.logger.log(`Password reset email sent to ${to}`);
  }
}
