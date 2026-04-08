import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { SuggestionStatus } from "@prisma/client";
import { PrismaService } from "src/prisma.service";

const EDITABLE_FIELDS = [
  "word",
  "wordAccented",
  "partOfSpeech",
  "partOfSpeechNah",
  "nounClass",
  "nounClassPlural",
  "grammar",
  "meanings",
  "phraseology",
  "citations",
  "latinName",
  "styleLabel",
  "variants",
  "domain",
  "cefrLevel",
] as const;

@Injectable()
export class SuggestionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    entryId: number,
    field: string,
    newValue: string,
    comment?: string,
  ) {
    if (!EDITABLE_FIELDS.includes(field as (typeof EDITABLE_FIELDS)[number])) {
      throw new BadRequestException(
        `Field "${field}" is not editable. Allowed: ${EDITABLE_FIELDS.join(", ")}`,
      );
    }

    const entry = await this.prisma.unifiedEntry.findUnique({
      where: { id: entryId },
    });
    if (!entry) throw new NotFoundException(`Entry #${entryId} not found`);

    const oldValue =
      entry[field as keyof typeof entry] != null
        ? JSON.stringify(entry[field as keyof typeof entry])
        : null;

    return this.prisma.suggestion.create({
      data: { userId, entryId, field, oldValue, newValue, comment },
    });
  }

  async getMySubmissions(userId: string) {
    return this.prisma.suggestion.findMany({
      where: { userId },
      include: { entry: { select: { id: true, word: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Admin: список всех предложений с фильтром по статусу */
  async list(status?: SuggestionStatus, limit = 50, offset = 0) {
    const where = status ? { status } : undefined;

    const [data, total] = await Promise.all([
      this.prisma.suggestion.findMany({
        where,
        include: {
          user: { select: { id: true, username: true, name: true } },
          entry: { select: { id: true, word: true } },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      this.prisma.suggestion.count({ where }),
    ]);

    return { data, meta: { total, limit, offset } };
  }

  /** Admin: одобрить или отклонить */
  async review(
    suggestionId: string,
    reviewerId: string,
    decision: "approve" | "reject",
    reviewComment?: string,
  ) {
    const suggestion = await this.prisma.suggestion.findUnique({
      where: { id: suggestionId },
    });
    if (!suggestion)
      throw new NotFoundException(`Suggestion #${suggestionId} not found`);
    if (suggestion.status !== SuggestionStatus.PENDING)
      throw new BadRequestException("Suggestion already reviewed");

    const newStatus =
      decision === "approve"
        ? SuggestionStatus.APPROVED
        : SuggestionStatus.REJECTED;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.suggestion.update({
        where: { id: suggestionId },
        data: {
          status: newStatus,
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          reviewComment,
        },
      });

      // При одобрении — применяем изменение к записи
      if (decision === "approve") {
        let parsedValue: unknown;
        try {
          parsedValue = JSON.parse(suggestion.newValue);
        } catch {
          parsedValue = suggestion.newValue;
        }

        await tx.unifiedEntry.update({
          where: { id: suggestion.entryId },
          data: { [suggestion.field]: parsedValue },
        });
      }

      return updated;
    });
  }
}
