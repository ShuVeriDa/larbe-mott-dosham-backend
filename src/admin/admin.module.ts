import { Module } from "@nestjs/common";
import { AuthModule } from "src/auth/auth.module";
import { MergeModule } from "src/merge/merge.module";
import { AdminService } from "./admin.service";
import { ApiKeysController } from "./controllers/api-keys.controller";
import { UsersAdminController } from "./controllers/users-admin.controller";
import { PipelineAdminController } from "./controllers/pipeline-admin.controller";
import { QualityAdminController } from "./controllers/quality-admin.controller";
import { AuditAdminController } from "./controllers/audit-admin.controller";
import { EntriesAdminController } from "./controllers/entries-admin.controller";

@Module({
  imports: [AuthModule, MergeModule],
  controllers: [
    ApiKeysController,
    UsersAdminController,
    PipelineAdminController,
    QualityAdminController,
    AuditAdminController,
    EntriesAdminController,
  ],
  providers: [AdminService],
})
export class AdminModule {}
