import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, Length, Matches } from "class-validator";

export class CreateAlbumDto {
  @IsString()
  @Length(1, 60)
  @Matches(/\S/)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  @Matches(/\S/, { each: true })
  childNames!: string[];
}

export class CreateChildTagDto {
  @IsString()
  @Length(1, 40)
  @Matches(/\S/)
  name!: string;
}
