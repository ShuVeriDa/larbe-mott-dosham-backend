import { Type } from "class-transformer";
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { RoleName } from "@prisma/client";

export class ListUsersDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(RoleName)
  role?: RoleName;

  @IsOptional()
  @IsIn(["active", "inactive", "blocked"])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsIn(["name", "username", "createdAt", "lastLoggedIn"])
  sortBy?: string = "createdAt";

  @IsOptional()
  @IsIn(["asc", "desc"])
  sortDir?: string = "desc";
}
