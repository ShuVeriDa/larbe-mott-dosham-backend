import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";

export class PhraseDto {
  @ApiProperty()
  @IsString()
  nah: string;

  @ApiProperty()
  @IsString()
  ru: string;
}

export class MeaningDto {
  @ApiProperty()
  @IsString()
  translation: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  partOfSpeech?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  partOfSpeechNah?: string;

  @ApiPropertyOptional({ type: [PhraseDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PhraseDto)
  examples?: PhraseDto[];
}

export class CitationDto {
  @ApiProperty()
  @IsString()
  text: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  source?: string;
}

export class UpdateEntryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  word?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  wordAccented?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  partOfSpeech?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  partOfSpeechNah?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nounClass?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nounClassPlural?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  grammar?: Record<string, any>;

  @ApiPropertyOptional({ type: [MeaningDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MeaningDto)
  meanings?: MeaningDto[];

  @ApiPropertyOptional({ type: [PhraseDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PhraseDto)
  phraseology?: PhraseDto[];

  @ApiPropertyOptional({ type: [CitationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CitationDto)
  citations?: CitationDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  latinName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  styleLabel?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  variants?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  domain?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(["A1", "A2", "B1", "B2", "C1", "C2"])
  cefrLevel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(["standard", "neologism"])
  entryType?: string;
}

/** Один элемент bulk-обновления: id записи + поля для изменения */
export class BulkUpdateItemDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  id: number;

  @ApiProperty({ type: UpdateEntryDto })
  @ValidateNested()
  @Type(() => UpdateEntryDto)
  data: UpdateEntryDto;
}

export class BulkUpdateEntriesDto {
  @ApiProperty({ type: [BulkUpdateItemDto], maxItems: 100 })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateItemDto)
  entries: BulkUpdateItemDto[];
}
