import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { RoleName } from "@prisma/client";
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";

export class CreateApiKeyDto {
  @ApiProperty({ example: "Mobile App" })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiPropertyOptional({ enum: RoleName, default: RoleName.USER })
  @IsOptional()
  @IsEnum(RoleName)
  role?: RoleName;

  @ApiPropertyOptional({
    example: "2027-01-01T00:00:00.000Z",
    description: "Дата истечения ключа. null / отсутствие поля = бессрочный",
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
