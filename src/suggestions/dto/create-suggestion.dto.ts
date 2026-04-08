import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Min } from "class-validator";

export class CreateSuggestionDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  entryId: number;

  @ApiProperty({ description: "Field to suggest change for: word, meanings, nounClass, etc." })
  @IsString()
  field: string;

  @ApiProperty({ description: "Suggested new value (JSON string for complex fields)" })
  @IsString()
  newValue: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}
