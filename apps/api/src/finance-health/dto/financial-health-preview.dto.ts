import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const decimalPattern = /^\d{1,15}(\.\d{1,2})?$/;

export class FinancialHealthPreviewDto {
  @IsOptional() @IsString() @Matches(decimalPattern) @MaxLength(18) monthlyIncome?: string;
  @IsOptional() @IsString() @Matches(decimalPattern) @MaxLength(18) monthlyExpenses?: string;
  @IsOptional()
  @IsString()
  @Matches(decimalPattern)
  @MaxLength(18)
  essentialMonthlyExpenses?: string;
  @IsOptional() @IsString() @Matches(decimalPattern) @MaxLength(18) liquidAssets?: string;
  @IsOptional() @IsString() @Matches(decimalPattern) @MaxLength(18) monthlyDebtService?: string;
  @IsOptional() @IsString() @Matches(decimalPattern) @MaxLength(18) revolvingOrCardBalance?: string;
  @IsOptional() @IsString() @Matches(decimalPattern) @MaxLength(18) totalCardLimit?: string;
  @IsOptional() @IsString() @Matches(decimalPattern) @MaxLength(18) upcoming30dCommitments?: string;
  @IsOptional() @IsString() @Matches(decimalPattern) @MaxLength(18) incomeVolatility?: string;
  @IsOptional()
  @IsString()
  @Matches(decimalPattern)
  @MaxLength(18)
  essentialExpenseVolatility?: string;
  @IsOptional() @IsInt() @Min(0) @Max(120) historyMonths?: number;
}
