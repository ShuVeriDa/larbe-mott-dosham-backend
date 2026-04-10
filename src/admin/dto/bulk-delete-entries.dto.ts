import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsPositive } from "class-validator";

export class BulkDeleteEntriesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  ids!: number[];
}
