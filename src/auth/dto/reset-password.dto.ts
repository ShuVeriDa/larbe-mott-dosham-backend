import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches, MinLength } from "class-validator";

export class ResetPasswordDto {
  @ApiProperty({ description: "Token from email / forgot-password response" })
  @IsString()
  token: string;

  @ApiProperty({ description: "New password: 8+ characters, letters and digits" })
  @IsString()
  @MinLength(8, { message: "Password must be at least 8 characters" })
  @Matches(/^(?=.*[a-zA-Z])(?=.*\d).+$/, {
    message: "Password must contain both letters and digits",
  })
  newPassword: string;
}
