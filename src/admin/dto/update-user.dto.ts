import { IsEmail, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { RoleName } from "@prisma/client";

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(16)
  username?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(RoleName)
  role?: RoleName;

  @IsOptional()
  @IsIn(["active", "blocked"])
  status?: string;
}
