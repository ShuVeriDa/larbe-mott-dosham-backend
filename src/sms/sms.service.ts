import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * SmsService — отправка OTP-кодов по SMS.
 *
 * Провайдер выбирается через переменную окружения SMS_PROVIDER:
 *   - "log"   (default, dev) — код только логируется, SMS не отправляется
 *   - "twilio"               — отправка через Twilio REST API
 *
 * Для подключения другого провайдера (SMSC, МТС, Beeline и т.п.) добавьте
 * соответствующий кейс в метод send().
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly provider: string;

  constructor(private readonly config: ConfigService) {
    this.provider = this.config.get<string>("SMS_PROVIDER", "log");
  }

  async send(phone: string, message: string): Promise<void> {
    switch (this.provider) {
      case "twilio":
        await this.sendViaTwilio(phone, message);
        break;
      default:
        // dev / fallback — только логируем
        this.logger.warn(`[SMS-LOG] To: ${phone} | Message: ${message}`);
    }
  }

  private async sendViaTwilio(phone: string, message: string): Promise<void> {
    const accountSid = this.config.getOrThrow<string>("TWILIO_ACCOUNT_SID");
    const authToken = this.config.getOrThrow<string>("TWILIO_AUTH_TOKEN");
    const from = this.config.getOrThrow<string>("TWILIO_FROM_NUMBER");

    // Простой HTTP-запрос к Twilio без лишних зависимостей
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const body = new URLSearchParams({ To: phone, From: from, Body: message });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Twilio error ${response.status}: ${text}`);
    }

    this.logger.log(`SMS sent via Twilio to ${phone}`);
  }
}
