import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length, Matches, MinLength } from "class-validator";

export class ResetPasswordPhoneDto {
  @ApiProperty({ example: "+79001234567", description: "Номер телефона" })
  @IsString()
  @Matches(/^\+\d{10,15}$/, { message: "Укажите телефон в формате +79001234567" })
  phone: string;

  @ApiProperty({ example: "482931", description: "6-значный OTP-код из SMS" })
  @IsString()
  @Length(6, 6, { message: "OTP-код должен содержать 6 цифр" })
  @Matches(/^\d{6}$/, { message: "OTP-код должен содержать только цифры" })
  code: string;

  @ApiProperty({ description: "Новый пароль: 8+ символов, буквы и цифры" })
  @IsString()
  @MinLength(8, { message: "Пароль должен быть не менее 8 символов" })
  @Matches(/^(?=.*[a-zA-Z])(?=.*\d).+$/, {
    message: "Пароль должен содержать буквы и цифры",
  })
  newPassword: string;
}
