import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { FamiliesModule } from "../families/families.module.js";
import { AlbumsController } from "./albums.controller.js";
import { AlbumsService } from "./albums.service.js";

@Module({
  imports: [AuthModule, FamiliesModule],
  controllers: [AlbumsController],
  providers: [AlbumsService],
  exports: [AlbumsService]
})
export class AlbumsModule {}
