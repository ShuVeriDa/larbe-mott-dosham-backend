import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsOptional, IsString, Matches } from "class-validator";

export class ForgotPasswordDto {
  @ApiProperty({
    example: "user@example.com",
    description: "Email для восстановления пароля (email или phone — одно из двух)",
    required: false,
  })
  @IsOptional()
  @IsEmail({}, { message: "Укажите корректный email" })
  email?: string;

  @ApiProperty({
    example: "+79001234567",
    description: "Номер телефона для восстановления пароля (email или phone — одно из двух)",
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^\+\d{10,15}$/, { message: "Укажите телефон в формате +79001234567" })
  phone?: string;
}
