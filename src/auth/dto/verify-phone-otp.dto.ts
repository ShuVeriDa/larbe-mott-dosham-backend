import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length, Matches } from "class-validator";

export class VerifyPhoneOtpDto {
  @ApiProperty({ example: "+79001234567", description: "Phone number" })
  @IsString()
  @Matches(/^\+\d{10,15}$/, { message: "Phone must be in format +79001234567" })
  phone: string;

  @ApiProperty({ example: "482931", description: "6-digit OTP code from SMS" })
  @IsString()
  @Length(6, 6, { message: "OTP code must be exactly 6 digits" })
  @Matches(/^\d{6}$/, { message: "OTP code must contain digits only" })
  code: string;
}
