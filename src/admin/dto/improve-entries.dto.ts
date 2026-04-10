import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsPositive } from "class-validator";

export class ImproveEntriesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  ids!: number[];
}
