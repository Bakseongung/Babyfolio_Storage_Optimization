import { Module } from "@nestjs/common";
import { AlbumsModule } from "../albums/albums.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { MediaController } from "./media.controller.js";
import { MediaService } from "./media.service.js";
import { StorageService } from "./storage.service.js";

@Module({
  imports: [AuthModule, AlbumsModule],
  controllers: [MediaController],
  providers: [MediaService, StorageService],
  exports: [StorageService]
})
export class MediaModule {}
