import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { RoleName } from "@prisma/client";
import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";

export class CreateApiKeyDto {
  @ApiProperty({ example: "Mobile App" })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiPropertyOptional({ enum: RoleName, default: RoleName.USER })
  @IsOptional()
  @IsEnum(RoleName)
  role?: RoleName;
}
