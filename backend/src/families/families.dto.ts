import { IsEmail, IsString, Length, Matches } from "class-validator";

export class CreateFamilyDto {
  @IsString()
  @Length(1, 60)
  @Matches(/\S/)
  name!: string;
}

export class UpdateFamilyDto extends CreateFamilyDto {}

export class CreateInviteDto {
  @IsEmail()
  email!: string;
}
