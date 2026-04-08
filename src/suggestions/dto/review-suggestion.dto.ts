import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString } from "class-validator";

export class ReviewSuggestionDto {
  @ApiProperty({ enum: ["approve", "reject"] })
  @IsIn(["approve", "reject"])
  decision: "approve" | "reject";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}
