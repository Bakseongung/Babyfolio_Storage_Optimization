import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { StartUploadDto } from "../src/media/media.dto.js";

function uploadDto(contentType: string, fileSize = 1024) {
  return Object.assign(new StartUploadDto(), {
    date: "2026-08-03",
    originalName: contentType === "video/mp4" ? "baby.mp4" : "baby.jpg",
    contentType,
    fileSize,
    clientUploadId: "4f37028b-a575-42c4-8b78-b67b2c41df3e"
  });
}

describe("StartUploadDto", () => {
  it("accepts formats supported by the image processor", async () => {
    await expect(validate(uploadDto("image/jpeg"))).resolves.toHaveLength(0);
  });

  it("rejects HEIC until the image processor supports it", async () => {
    const errors = await validate(uploadDto("image/heic"));
    expect(errors.some(({ property }) => property === "contentType")).toBe(true);
  });

  it("accepts MP4 videos up to 200MB while keeping the image limit at 20MB", async () => {
    await expect(validate(uploadDto("video/mp4", 200 * 1024 * 1024))).resolves.toHaveLength(0);

    const oversizedVideo = await validate(uploadDto("video/mp4", 200 * 1024 * 1024 + 1));
    const oversizedImage = await validate(uploadDto("image/jpeg", 20 * 1024 * 1024 + 1));

    expect(oversizedVideo.some(({ property }) => property === "fileSize")).toBe(true);
    expect(oversizedImage.some(({ property }) => property === "fileSize")).toBe(true);
  });
});
