import { ApiProperty } from "@nestjs/swagger";
import { RoleName } from "@prisma/client";
import { IsEnum } from "class-validator";

export class AssignRoleDto {
  @ApiProperty({ enum: RoleName })
  @IsEnum(RoleName)
  role: RoleName;
}
