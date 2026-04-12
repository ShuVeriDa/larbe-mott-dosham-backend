import { ApiProperty } from "@nestjs/swagger";
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateUserDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ description: "Minimum 8 characters, letters and digits" })
  @IsString()
  @MinLength(8, { message: "Password must be at least 8 characters" })
  @Matches(/^(?=.*[a-zA-Z])(?=.*\d).+$/, {
    message: "Password must contain both letters and digits",
  })
  password: string;

  @ApiProperty()
  @IsString()
  @MinLength(2, { message: "Username must be at least 2 characters long" })
  @MaxLength(16, {
    message: "Username must be no more than 16 characters long",
  })
  username: string;

  @ApiProperty()
  @IsString()
  @MinLength(2, { message: "Name must be at least 2 characters long" })
  @MaxLength(32, { message: "Name must be no more than 32 characters long" })
  name: string;
}
