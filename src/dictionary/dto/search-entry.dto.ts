import { Transform, Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

const CEFR_VALUES = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

export class SearchEntryDto {
  @IsString()
  q: string;

  /**
   * Один уровень: ?cefr=A1
   * Несколько: ?cefr[]=A1&cefr[]=A2  или  ?cefr=A1,A2
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value;
    if (typeof value === "string" && value.includes(","))
      return value.split(",").map((v) => v.trim());
    return [value];
  })
  @IsArray()
  @IsIn(CEFR_VALUES, { each: true })
  cefr?: string[];

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
