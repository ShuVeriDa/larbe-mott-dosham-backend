import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from "@nestjs/terminus";
import { PrismaService } from "src/prisma.service";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prismaHealth: PrismaHealthIndicator,
    private prisma: PrismaService,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: "Health check (DB connectivity)" })
  check() {
    return this.health.check([
      () => this.prismaHealth.pingCheck("database", this.prisma),
    ]);
  }
}
