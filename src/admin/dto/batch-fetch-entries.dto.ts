import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsPositive } from "class-validator";

export class BatchFetchEntriesDto {
  @ApiProperty({ type: [Number], maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  ids!: number[];
}
