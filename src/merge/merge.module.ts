import { Module } from "@nestjs/common";
import { MergeController } from "./merge.controller";
import { MergeService } from "./merge.service";
import { ParsePipelineService } from "./parse-pipeline.service";
import { UnifyPipelineService } from "./unify-pipeline.service";
import { LoadPipelineService } from "./load-pipeline.service";

@Module({
  controllers: [MergeController],
  providers: [
    MergeService,
    ParsePipelineService,
    UnifyPipelineService,
    LoadPipelineService,
  ],
  exports: [MergeService],
})
export class MergeModule {}
