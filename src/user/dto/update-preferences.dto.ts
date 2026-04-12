import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class UpdatePreferencesDto {
  // ─── Existing fields ─────────────────────────────────────────────────────────

  @ApiPropertyOptional({ description: "Save search history" })
  @IsOptional()
  @IsBoolean()
  prefSaveHistory?: boolean;

  @ApiPropertyOptional({ description: "Automatically expand examples" })
  @IsOptional()
  @IsBoolean()
  prefShowExamples?: boolean;

  @ApiPropertyOptional({ description: "Compact list view" })
  @IsOptional()
  @IsBoolean()
  prefCompactView?: boolean;

  // ─── New fields ───────────────────────────────────────────────────────────────

  @ApiPropertyOptional({ description: "UI theme", enum: ["light", "dark", "system"] })
  @IsOptional()
  @IsString()
  @IsIn(["light", "dark", "system"])
  prefTheme?: string;

  @ApiPropertyOptional({ description: "Interface language", enum: ["ru", "ce", "en"] })
  @IsOptional()
  @IsString()
  @IsIn(["ru", "ce", "en"])
  prefLanguage?: string;

  @ApiPropertyOptional({ description: "Hotkeys enabled" })
  @IsOptional()
  @IsBoolean()
  prefHotkeys?: boolean;

  @ApiPropertyOptional({ description: "Show declension/conjugation tables by default" })
  @IsOptional()
  @IsBoolean()
  prefShowGrammar?: boolean;

  @ApiPropertyOptional({ description: "Results per page", enum: [10, 20, 50] })
  @IsOptional()
  @IsInt()
  @IsIn([10, 20, 50])
  prefPerPage?: number;

  @ApiPropertyOptional({ description: "Default CEFR level (null = all)", nullable: true })
  @IsOptional()
  @IsString()
  @IsIn(["A1", "A2", "B1", "B2", "C1", "C2"])
  prefDefaultCefr?: string;

  @ApiPropertyOptional({ description: "Show profile publicly" })
  @IsOptional()
  @IsBoolean()
  prefPublicProfile?: boolean;

  @ApiPropertyOptional({ description: "Show favorites publicly" })
  @IsOptional()
  @IsBoolean()
  prefPublicFavorites?: boolean;
}
