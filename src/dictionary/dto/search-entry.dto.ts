import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class SearchEntryDto {
  @IsString()
  q: string;

  @IsOptional()
  @IsIn(["A1", "A2", "B1", "B2", "C1", "C2"])
  cefr?: string;

  @IsOptional()
  @IsString()
  pos?: string; // фильтр по части речи: "сущ.", "гл.", "прил." и т.д.

  @IsOptional()
  @IsString()
  nounClass?: string; // фильтр по грамм. классу: "ву", "йу", "ду", "бу"

  @IsOptional()
  @IsIn(["standard", "neologism"])
  entryType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
