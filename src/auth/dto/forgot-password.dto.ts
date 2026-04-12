import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsOptional, IsString, Matches } from "class-validator";

export class ForgotPasswordDto {
  @ApiProperty({
    example: "user@example.com",
    description: "Email for password recovery (provide either email or phone, not both)",
    required: false,
  })
  @IsOptional()
  @IsEmail({}, { message: "Provide a valid email address" })
  email?: string;

  @ApiProperty({
    example: "+79001234567",
    description: "Phone number for password recovery (provide either email or phone, not both)",
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^\+\d{10,15}$/, { message: "Phone must be in format +79001234567" })
  phone?: string;
}
