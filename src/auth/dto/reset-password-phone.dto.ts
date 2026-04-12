import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length, Matches, MinLength } from "class-validator";

export class ResetPasswordPhoneDto {
  @ApiProperty({ example: "+79001234567", description: "Phone number" })
  @IsString()
  @Matches(/^\+\d{10,15}$/, { message: "Phone must be in format +79001234567" })
  phone: string;

  @ApiProperty({ example: "482931", description: "6-digit OTP code from SMS" })
  @IsString()
  @Length(6, 6, { message: "OTP code must be exactly 6 digits" })
  @Matches(/^\d{6}$/, { message: "OTP code must contain digits only" })
  code: string;

  @ApiProperty({ description: "New password: 8+ characters, letters and digits" })
  @IsString()
  @MinLength(8, { message: "Password must be at least 8 characters" })
  @Matches(/^(?=.*[a-zA-Z])(?=.*\d).+$/, {
    message: "Password must contain both letters and digits",
  })
  newPassword: string;
}
