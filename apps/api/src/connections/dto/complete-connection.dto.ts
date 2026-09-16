import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CompleteConnectionDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  providerItemId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  institution?: string;
}
