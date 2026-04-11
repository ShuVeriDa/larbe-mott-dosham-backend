import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PrismaService } from "src/prisma.service";
import { RedisModule } from "src/redis/redis.module";
import { UserService } from "src/user/user.service";
import { MailModule } from "src/mail/mail.module";
import { SmsModule } from "src/sms/sms.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { PermissionGuard } from "./permissions/permission.guard";
import { PermissionsService } from "./permissions/permissions.service";

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PrismaService,
    JwtStrategy,
    PermissionsService,
    PermissionGuard,
    UserService,
    JwtService,
    ConfigService,
  ],
  exports: [PermissionsService],
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
})
export class AuthModule {}
