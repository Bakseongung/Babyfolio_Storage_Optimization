import { Module } from "@nestjs/common";
import { MediaModule } from "../media/media.module.js";
import { HealthController } from "./health.controller.js";

@Module({
  imports: [MediaModule],
  controllers: [HealthController]
})
export class HealthModule {}
