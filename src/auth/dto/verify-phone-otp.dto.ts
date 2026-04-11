import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length, Matches } from "class-validator";

export class VerifyPhoneOtpDto {
  @ApiProperty({ example: "+79001234567", description: "Номер телефона" })
  @IsString()
  @Matches(/^\+\d{10,15}$/, { message: "Укажите телефон в формате +79001234567" })
  phone: string;

  @ApiProperty({ example: "482931", description: "6-значный OTP-код из SMS" })
  @IsString()
  @Length(6, 6, { message: "OTP-код должен содержать 6 цифр" })
  @Matches(/^\d{6}$/, { message: "OTP-код должен содержать только цифры" })
  code: string;
}
