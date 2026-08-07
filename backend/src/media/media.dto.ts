import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface
} from "class-validator";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

@ValidatorConstraint({ name: "mediaFileSize", async: false })
class MediaFileSizeConstraint implements ValidatorConstraintInterface {
  validate(fileSize: number, { object }: ValidationArguments): boolean {
    const contentType = (object as StartUploadDto).contentType;
    const limit = contentType === "video/mp4" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    return Number.isInteger(fileSize) && fileSize >= 1 && fileSize <= limit;
  }

  defaultMessage({ object }: ValidationArguments): string {
    return (object as StartUploadDto).contentType === "video/mp4"
      ? "영상은 200MB 이하여야 합니다."
      : "사진은 20MB 이하여야 합니다.";
  }
}

export class StartUploadDto {
  @IsDateString()
  date!: string;

  @IsString()
  @Length(1, 200)
  originalName!: string;

  @IsIn(["image/jpeg", "image/png", "image/webp", "video/mp4"])
  contentType!: string;

  @IsInt()
  @Min(1)
  @Validate(MediaFileSizeConstraint)
  fileSize!: number;

  @IsUUID()
  clientUploadId!: string;

  @IsOptional()
  @IsDateString()
  capturedAt?: string;

  @IsOptional()
  @IsIn(["EXIF_ORIGINAL", "EXIF_CREATED", "FILE_MODIFIED", "USER", "DEFAULT"])
  dateSource?: "EXIF_ORIGINAL" | "EXIF_CREATED" | "FILE_MODIFIED" | "USER" | "DEFAULT";

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  childTagIds?: string[];
}

export class RepresentativeDto {
  @IsString()
  mediaId!: string;
}
