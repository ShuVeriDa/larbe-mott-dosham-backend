import { ApiPropertyOptional } from "@nestjs/swagger";
import { RoleName } from "@prisma/client";
import {
  IsBoolean,
  IsDateString,
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

  @ApiPropertyOptional({
    example: "2027-01-01T00:00:00.000Z",
    description: "Key expiration date",
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
