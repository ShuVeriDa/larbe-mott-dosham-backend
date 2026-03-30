import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ApiKeyGuard } from "src/common/guards/api-key.guard";
import { MergeController } from "./merge.controller";
import { MergeService } from "./merge.service";

@Module({
  imports: [ConfigModule],
  controllers: [MergeController],
  providers: [MergeService, ApiKeyGuard],
})
export class MergeModule {}
