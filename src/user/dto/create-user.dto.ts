import { ApiProperty } from "@nestjs/swagger";
import {
  IsEmail,
  IsString,
  IsStrongPassword,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateUserDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @IsString()
  @IsStrongPassword({
    minLength: 6,
    minUppercase: 1,
    minSymbols: 1,
  })
  password: string;

  @ApiProperty()
  @IsString()
  @MinLength(2, { message: "Username must be at least 2 characters long" })
  @MaxLength(16, { message: "Username must be no more than 16 characters long" })
  username: string;

  @ApiProperty()
  @IsString()
  @MinLength(2, { message: "Name must be at least 2 characters long" })
  @MaxLength(32, { message: "Name must be no more than 32 characters long" })
  name: string;
}
