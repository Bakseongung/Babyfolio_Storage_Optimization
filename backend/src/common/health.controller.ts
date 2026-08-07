import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { StorageService } from "../media/storage.service.js";
import { PrismaService } from "./prisma.service.js";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService
  ) {}

  @Get("live")
  live() {
    return { status: "ok" };
  }

  @Get("ready")
  async ready() {
    try {
      await Promise.all([
        this.prisma.assertSchemaReady(),
        this.storage.check()
      ]);
      return { status: "ready" };
    } catch {
      throw new ServiceUnavailableException({
        code: "NOT_READY",
        message: "필수 저장소에 연결할 수 없습니다."
      });
    }
  }
}
