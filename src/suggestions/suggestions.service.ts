import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { SuggestionStatus } from "@prisma/client";
import { PrismaService } from "src/prisma.service";

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
    const entry = await this.prisma.unifiedEntry.findUnique({
      where: { id: entryId },
    });
    if (!entry) throw new NotFoundException(`Entry #${entryId} not found`);

    // Получаем текущее значение поля
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
  async list(status?: SuggestionStatus) {
    return this.prisma.suggestion.findMany({
      where: status ? { status } : undefined,
      include: {
        user: { select: { id: true, username: true, name: true } },
        entry: { select: { id: true, word: true } },
      },
      orderBy: { createdAt: "desc" },
    });
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

    const status =
      decision === "approve"
        ? SuggestionStatus.APPROVED
        : SuggestionStatus.REJECTED;

    return this.prisma.suggestion.update({
      where: { id: suggestionId },
      data: {
        status,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        reviewComment,
      },
    });
  }
}
