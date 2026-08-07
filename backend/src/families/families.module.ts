import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { FamiliesController } from "./families.controller.js";
import { FamiliesService } from "./families.service.js";
import { InvitesController } from "./invites.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [FamiliesController, InvitesController],
  providers: [FamiliesService],
  exports: [FamiliesService]
})
export class FamiliesModule {}
