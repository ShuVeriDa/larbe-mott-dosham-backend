import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches, MinLength } from "class-validator";

export class ResetPasswordDto {
  @ApiProperty({ description: "Токен из письма / ответа forgot-password" })
  @IsString()
  token: string;

  @ApiProperty({ description: "Новый пароль: 8+ символов, буквы и цифры" })
  @IsString()
  @MinLength(8, { message: "Пароль должен быть не менее 8 символов" })
  @Matches(/^(?=.*[a-zA-Z])(?=.*\d).+$/, {
    message: "Пароль должен содержать буквы и цифры",
  })
  newPassword: string;
}
