import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class UpdatePreferencesDto {
  // ─── Существующие поля ───────────────────────────────────────────────────────

  @ApiPropertyOptional({ description: "Сохранять историю поиска" })
  @IsOptional()
  @IsBoolean()
  prefSaveHistory?: boolean;

  @ApiPropertyOptional({ description: "Автоматически раскрывать примеры" })
  @IsOptional()
  @IsBoolean()
  prefShowExamples?: boolean;

  @ApiPropertyOptional({ description: "Компактный вид списков" })
  @IsOptional()
  @IsBoolean()
  prefCompactView?: boolean;

  // ─── Новые поля ──────────────────────────────────────────────────────────────

  @ApiPropertyOptional({ description: "Тема оформления", enum: ["light", "dark", "system"] })
  @IsOptional()
  @IsString()
  @IsIn(["light", "dark", "system"])
  prefTheme?: string;

  @ApiPropertyOptional({ description: "Язык интерфейса", enum: ["ru", "ce", "en"] })
  @IsOptional()
  @IsString()
  @IsIn(["ru", "ce", "en"])
  prefLanguage?: string;

  @ApiPropertyOptional({ description: "Горячие клавиши включены" })
  @IsOptional()
  @IsBoolean()
  prefHotkeys?: boolean;

  @ApiPropertyOptional({ description: "Показывать таблицы склонения/спряжения по умолчанию" })
  @IsOptional()
  @IsBoolean()
  prefShowGrammar?: boolean;

  @ApiPropertyOptional({ description: "Результатов на странице", enum: [10, 20, 50] })
  @IsOptional()
  @IsInt()
  @IsIn([10, 20, 50])
  prefPerPage?: number;

  @ApiPropertyOptional({ description: "CEFR-уровень по умолчанию (null = все)", nullable: true })
  @IsOptional()
  @IsString()
  @IsIn(["A1", "A2", "B1", "B2", "C1", "C2"])
  prefDefaultCefr?: string;

  @ApiPropertyOptional({ description: "Показывать профиль публично" })
  @IsOptional()
  @IsBoolean()
  prefPublicProfile?: boolean;

  @ApiPropertyOptional({ description: "Показывать избранное публично" })
  @IsOptional()
  @IsBoolean()
  prefPublicFavorites?: boolean;
}
