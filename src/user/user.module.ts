import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PrismaService } from "src/prisma.service";
import { AuthService } from "src/auth/auth.service";
import { RedisModule } from "src/redis/redis.module";
import { MailModule } from "src/mail/mail.module";
import { SmsModule } from "src/sms/sms.module";
import { PermissionsService } from "src/auth/permissions/permissions.service";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";

@Module({
  imports: [
    ConfigModule,
    RedisModule,
    MailModule,
    SmsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>("JWT_ACCESS_SECRET"),
      }),
    }),
  ],
  controllers: [UserController],
  providers: [UserService, AuthService, PrismaService, ConfigService, PermissionsService],
  exports: [UserService],
})
export class UserModule {}
