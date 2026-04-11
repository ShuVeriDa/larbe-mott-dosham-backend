import { IsOptional, IsString, MaxLength } from "class-validator";

export class BlockUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  banReason?: string;
}
