import { IsIn, IsInt, IsString, MaxLength, MinLength, Max, Min } from 'class-validator';

export class CreateCategoryRuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  categoryId!: string;

  @IsIn(['description', 'merchant'])
  field!: string;

  @IsIn(['CONTAINS', 'EQUALS'])
  operator!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  value!: string;

  @IsInt()
  @Min(-1000)
  @Max(1000)
  priority = 0;
}
