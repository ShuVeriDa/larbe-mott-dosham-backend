import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches, MinLength } from "class-validator";

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  currentPassword: string;

  @ApiProperty({ description: "Мин. 8 символов, буквы и цифры" })
  @IsString()
  @MinLength(8, { message: "Пароль должен быть не менее 8 символов" })
  @Matches(/^(?=.*[a-zA-Z])(?=.*\d).+$/, {
    message: "Пароль должен содержать буквы и цифры",
  })
  newPassword: string;
}
