import { Controller, Param, ParseIntPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermissionCode } from "@prisma/client";
import { AdminPermission } from "src/auth/decorators/admin-permission.decorator";
import { AdminService } from "../admin.service";

@ApiTags("admin/pipeline")
@Controller("admin/pipeline")
@AdminPermission(PermissionCode.CAN_RUN_PIPELINE)
@ApiBearerAuth()
export class PipelineAdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post("parse/:slug")
  @ApiOperation({ summary: "Run parse for a dictionary" })
  parse(@Param("slug") slug: string) {
    return this.adminService.runParse(slug);
  }

  @Post("unify-step/:slug")
  @ApiOperation({ summary: "Run unify-step for a dictionary" })
  unifyStep(@Param("slug") slug: string) {
    return this.adminService.runUnifyStep(slug);
  }

  @Post("load")
  @ApiOperation({ summary: "Load unified.json into database" })
  load() {
    return this.adminService.runLoad();
  }

  @Post("improve")
  @ApiOperation({ summary: "Run improve on unified.json" })
  improve() {
    return this.adminService.runImprove();
  }

  @Post("rollback/:step")
  @ApiOperation({ summary: "Rollback to a specific step" })
  rollback(@Param("step", ParseIntPipe) step: number) {
    return this.adminService.runRollback(step);
  }

  @Post("reset")
  @ApiOperation({ summary: "Reset all merge steps" })
  reset() {
    return this.adminService.runReset();
  }
}
