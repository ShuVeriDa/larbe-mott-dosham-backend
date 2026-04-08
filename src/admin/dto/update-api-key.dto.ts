import { ApiPropertyOptional } from "@nestjs/swagger";
import { RoleName } from "@prisma/client";
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";

export class UpdateApiKeyDto {
  @ApiPropertyOptional({ example: "Renamed Key" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ enum: RoleName })
  @IsOptional()
  @IsEnum(RoleName)
  role?: RoleName;
}
