import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermissionCode } from "@prisma/client";
import { AdminPermission } from "src/auth/decorators/admin-permission.decorator";
import { AdminService } from "../admin.service";
import { CreateApiKeyDto } from "../dto/create-api-key.dto";
import { UpdateApiKeyDto } from "../dto/update-api-key.dto";

@ApiTags("admin/api-keys")
@Controller("admin/api-keys")
@AdminPermission(PermissionCode.CAN_MANAGE_API_KEYS)
@ApiBearerAuth()
export class ApiKeysController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  @ApiOperation({ summary: "List all API keys" })
  listKeys() {
    return this.adminService.listApiKeys();
  }

  @Post()
  @ApiOperation({ summary: "Create a new API key" })
  createKey(@Body() dto: CreateApiKeyDto) {
    return this.adminService.createApiKey(dto.name, dto.role);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update API key (activate/deactivate, rename)" })
  updateKey(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateApiKeyDto,
  ) {
    return this.adminService.updateApiKey(id, dto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete an API key" })
  deleteKey(@Param("id", ParseUUIDPipe) id: string) {
    return this.adminService.deleteApiKey(id);
  }
}
