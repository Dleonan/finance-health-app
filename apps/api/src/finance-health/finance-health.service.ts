import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { MetricsService } from '../observability/metrics.service';

export type MetricAvailability =
  'AVAILABLE' | 'UNAVAILABLE' | 'ESTIMATED' | 'STALE' | 'INSUFFICIENT_HISTORY';
export type MetricQuality = 'COMPLETE' | 'PARTIAL' | 'STALE' | 'ESTIMATED' | 'UNAVAILABLE';
export type MetricProvenance = 'OBSERVED' | 'ESTIMATED' | 'USER_DECLARED';

export type MetricMeta = {
  availability: MetricAvailability;
  quality: MetricQuality;
  provenance: MetricProvenance;
  sources: string[];
  window: string;
};

export type FinancialHealthInputs = {
  monthlyIncome?: string | null;
  monthlyExpenses?: string | null;
  essentialMonthlyExpenses?: string | null;
  liquidAssets?: string | null;
  monthlyDebtService?: string | null;
  revolvingOrCardBalance?: string | null;
  totalCardLimit?: string | null;
  upcoming30dCommitments?: string | null;
  incomeVolatility?: string | null;
  essentialExpenseVolatility?: string | null;
  historyMonths?: number;
  meta?: Partial<Record<MetricKey, MetricMeta>>;
};

type MetricKey = keyof Omit<FinancialHealthInputs, 'historyMonths' | 'meta'>;

type Component = {
  key: string;
  score: number | null;
  maxScore: number;
  measurement: string | null;
  referenceBand: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  quality: MetricQuality;
  availability: MetricAvailability;
  provenance: MetricProvenance;
  sources: string[];
  window: string;
  explanation: string;
  suggestedAction: string | null;
};

const DEFAULT_META: MetricMeta = {
  availability: 'AVAILABLE',
  quality: 'COMPLETE',
  provenance: 'OBSERVED',
  sources: ['financial-health-preview'],
  window: 'current-period',
};

@Injectable()
export class FinanceHealthService {
  static readonly VERSION = 'fh-v1.0.0';

  constructor(private readonly metrics: MetricsService) {}

  calculate(input: FinancialHealthInputs) {
    const startedAt = Date.now();
    const components: Component[] = [
      this.cashFlow(input),
      this.emergencyLiquidity(input),
      this.debtService(input),
      this.cardStress(input),
      this.shortTermResilience(input),
      this.stability(input),
    ];
    const availableWeight = components.reduce(
      (sum, component) => sum + (component.score === null ? 0 : component.maxScore),
      0,
    );
    const coverage = new Decimal(availableWeight).div(100).toDecimalPlaces(4).toNumber();
    const status = coverage >= 0.6 ? 'AVAILABLE' : 'INSUFFICIENT_DATA';
    const score =
      status === 'AVAILABLE'
        ? Math.round(
            (components.reduce((sum, component) => sum + (component.score ?? 0), 0) /
              availableWeight) *
              100,
          )
        : null;

    const result = {
      score,
      coverage,
      confidence: this.overallConfidence(coverage, components),
      status,
      version: FinanceHealthService.VERSION,
      components,
    };
    this.metrics.observe('financial_health_calculation_ms', Date.now() - startedAt);
    return result;
  }

  private cashFlow(input: FinancialHealthInputs): Component {
    const income = this.decimal(input.monthlyIncome);
    const expenses = this.decimal(input.monthlyExpenses);
    const meta = this.meta(input, 'monthlyIncome');
    const expenseMeta = this.meta(input, 'monthlyExpenses');
    if (!income || !expenses)
      return this.unavailable(
        'cash_flow',
        25,
        'Renda e despesas do período ainda não estão disponíveis.',
        'Entre ao menos um período completo de movimentações para medir o fluxo de caixa.',
        [meta, expenseMeta],
      );

    const savingsRate = income.gt(0)
      ? income.minus(expenses).div(income)
      : expenses.gt(0)
        ? new Decimal(-1)
        : null;
    if (!savingsRate)
      return this.unavailable(
        'cash_flow',
        25,
        'Não foi possível calcular a taxa de poupança com renda zero.',
        null,
        [meta, expenseMeta],
      );
    return this.component(
      'cash_flow',
      25,
      savingsRate.toFixed(4),
      '-10% a 25%',
      this.interpolate(savingsRate, '-0.10', '0.25', 0, 25),
      'Relação entre renda observada e despesas do período.',
      'Revisar despesas recorrentes e preservar uma margem mensal positiva.',
      [meta, expenseMeta],
    );
  }

  private emergencyLiquidity(input: FinancialHealthInputs): Component {
    const liquid = this.decimal(input.liquidAssets);
    const essentials = this.decimal(input.essentialMonthlyExpenses);
    const meta = this.meta(input, 'liquidAssets');
    const essentialMeta = this.meta(input, 'essentialMonthlyExpenses');
    if (!liquid || !essentials || essentials.lte(0))
      return this.unavailable(
        'emergency_liquidity',
        20,
        'Recursos líquidos ou despesas essenciais não estão disponíveis.',
        'Informar despesas essenciais permite estimar a cobertura de reserva.',
        [meta, essentialMeta],
      );
    const months = liquid.div(essentials);
    return this.component(
      'emergency_liquidity',
      20,
      months.toFixed(2),
      '0 a 6 meses',
      this.interpolate(months, '0', '6', 0, 20),
      'Meses de despesas essenciais cobertos por recursos líquidos.',
      'Avaliar uma reserva compatível com as despesas essenciais e a estabilidade da renda.',
      [meta, essentialMeta],
    );
  }

  private debtService(input: FinancialHealthInputs): Component {
    const income = this.decimal(input.monthlyIncome);
    const debt = this.decimal(input.monthlyDebtService);
    const meta = this.meta(input, 'monthlyIncome');
    const debtMeta = this.meta(input, 'monthlyDebtService');
    if (!income || !debt || income.lte(0))
      return this.unavailable(
        'debt_service',
        20,
        'Renda ou serviço mensal da dívida não estão disponíveis.',
        null,
        [meta, debtMeta],
      );
    const burden = debt.div(income);
    return this.component(
      'debt_service',
      20,
      burden.toFixed(4),
      '10% a 50% da renda',
      this.interpolate(burden, '0.50', '0.10', 0, 20),
      'Parcela da renda mensal comprometida com empréstimos e financiamentos.',
      'Comparar o serviço mensal da dívida com a renda antes de assumir novos compromissos.',
      [meta, debtMeta],
    );
  }

  private cardStress(input: FinancialHealthInputs): Component {
    const balance = this.decimal(input.revolvingOrCardBalance);
    const limit = this.decimal(input.totalCardLimit);
    const balanceMeta = this.meta(input, 'revolvingOrCardBalance');
    const limitMeta = this.meta(input, 'totalCardLimit');
    if (!balance || !limit || limit.lte(0))
      return this.unavailable(
        'card_stress',
        15,
        'Não há limite de cartão disponível para calcular utilização.',
        'Conectar cartões que exponham limite e fatura permite medir esta dimensão.',
        [balanceMeta, limitMeta],
      );
    const utilization = balance.div(limit);
    return this.component(
      'card_stress',
      15,
      utilization.toFixed(4),
      '20% a 90% do limite',
      this.interpolate(utilization, '0.90', '0.20', 0, 15),
      'Uso do limite e exposição corrente de cartão, sem somar o saldo duas vezes às dívidas.',
      'Acompanhar a exposição das faturas e manter margem de limite disponível.',
      [balanceMeta, limitMeta],
    );
  }

  private shortTermResilience(input: FinancialHealthInputs): Component {
    const liquid = this.decimal(input.liquidAssets);
    const commitments = this.decimal(input.upcoming30dCommitments);
    const liquidMeta = this.meta(input, 'liquidAssets');
    const commitmentMeta = this.meta(input, 'upcoming30dCommitments');
    if (!liquid || !commitments)
      return this.unavailable(
        'short_term_resilience',
        10,
        'Compromissos dos próximos 30 dias ainda não estão disponíveis.',
        null,
        [liquidMeta, commitmentMeta],
      );
    const resilience = commitments.gt(0) ? liquid.div(commitments) : new Decimal(2);
    return this.component(
      'short_term_resilience',
      10,
      resilience.toFixed(4),
      '0,5x a 1,5x dos compromissos',
      this.interpolate(resilience, '0.50', '1.50', 0, 10),
      'Capacidade líquida de cobrir compromissos conhecidos dos próximos 30 dias.',
      'Revisar vencimentos próximos quando a cobertura ficar abaixo de 1x.',
      [liquidMeta, commitmentMeta],
    );
  }

  private stability(input: FinancialHealthInputs): Component {
    const historyMonths = input.historyMonths ?? 0;
    const incomeVolatility = this.decimal(input.incomeVolatility);
    const expenseVolatility = this.decimal(input.essentialExpenseVolatility);
    const incomeMeta = this.meta(input, 'incomeVolatility');
    const expenseMeta = this.meta(input, 'essentialExpenseVolatility');
    if (historyMonths < 3)
      return this.unavailable(
        'stability',
        10,
        'Histórico insuficiente para medir estabilidade mensal.',
        'Aguardar pelo menos três meses de dados antes de publicar esta dimensão.',
        [incomeMeta, expenseMeta],
        'INSUFFICIENT_HISTORY',
      );
    if (!incomeVolatility || !expenseVolatility)
      return this.unavailable(
        'stability',
        10,
        'O histórico existe, mas a volatilidade mensal ainda não está disponível.',
        'Manter pelo menos três meses completos de movimentações para medir estabilidade.',
        [incomeMeta, expenseMeta],
      );
    const averageVolatility = incomeVolatility.plus(expenseVolatility).div(2);
    return this.component(
      'stability',
      10,
      averageVolatility.toFixed(4),
      '0% a 30% de variação relativa',
      this.interpolate(averageVolatility, '0.30', '0', 0, 10),
      'Variação relativa média da renda e das despesas essenciais nos meses observados.',
      'Criar margem de segurança quando renda ou despesas oscilarem muito entre meses.',
      [incomeMeta, expenseMeta],
    );
  }

  private component(
    key: string,
    maxScore: number,
    measurement: string,
    referenceBand: string,
    score: number,
    explanation: string,
    suggestedAction: string,
    metas: MetricMeta[],
  ): Component {
    const meta = this.mergeMeta(metas);
    return {
      key,
      score,
      maxScore,
      measurement,
      referenceBand,
      confidence: this.componentConfidence(meta),
      quality: meta.quality,
      availability: meta.availability,
      provenance: meta.provenance,
      sources: meta.sources,
      window: meta.window,
      explanation,
      suggestedAction,
    };
  }

  private unavailable(
    key: string,
    maxScore: number,
    explanation: string,
    suggestedAction: string | null,
    metas: MetricMeta[],
    availability: MetricAvailability = 'UNAVAILABLE',
  ): Component {
    const meta = this.mergeMeta(
      metas.length
        ? metas
        : [
            {
              ...DEFAULT_META,
              availability,
              quality: availability === 'STALE' ? 'STALE' : 'UNAVAILABLE',
              sources: [],
            },
          ],
    );
    return {
      key,
      score: null,
      maxScore,
      measurement: null,
      referenceBand: 'indisponível',
      confidence: 'LOW',
      quality: meta.quality,
      availability,
      provenance: meta.provenance,
      sources: meta.sources,
      window: meta.window,
      explanation,
      suggestedAction,
    };
  }

  private meta(input: FinancialHealthInputs, key: MetricKey) {
    return input[key] === undefined || input[key] === null
      ? {
          ...DEFAULT_META,
          availability: 'UNAVAILABLE' as const,
          quality: 'UNAVAILABLE' as const,
          sources: [],
        }
      : (input.meta?.[key] ?? DEFAULT_META);
  }

  private mergeMeta(metas: MetricMeta[]) {
    return {
      ...metas[0],
      quality: metas.some((meta) => meta.quality === 'STALE')
        ? 'STALE'
        : metas.some((meta) => meta.quality === 'PARTIAL')
          ? 'PARTIAL'
          : metas.some((meta) => meta.quality === 'ESTIMATED')
            ? 'ESTIMATED'
            : (metas[0]?.quality ?? 'UNAVAILABLE'),
      availability: metas.some((meta) => meta.availability === 'STALE')
        ? 'STALE'
        : (metas[0]?.availability ?? 'UNAVAILABLE'),
      provenance: metas.some((meta) => meta.provenance === 'USER_DECLARED')
        ? 'USER_DECLARED'
        : metas.some((meta) => meta.provenance === 'ESTIMATED')
          ? 'ESTIMATED'
          : (metas[0]?.provenance ?? 'OBSERVED'),
      sources: [...new Set(metas.flatMap((meta) => meta.sources))],
    } as MetricMeta;
  }

  private componentConfidence(meta: MetricMeta): 'HIGH' | 'MEDIUM' | 'LOW' {
    if (meta.quality === 'STALE' || meta.quality === 'UNAVAILABLE') return 'LOW';
    if (
      meta.quality === 'PARTIAL' ||
      meta.quality === 'ESTIMATED' ||
      meta.provenance !== 'OBSERVED'
    )
      return 'MEDIUM';
    return 'HIGH';
  }

  private overallConfidence(coverage: number, components: Component[]) {
    if (coverage < 0.6 || components.some((component) => component.quality === 'STALE'))
      return 'LOW';
    if (coverage < 0.85 || components.some((component) => component.confidence !== 'HIGH'))
      return 'MEDIUM';
    return 'HIGH';
  }

  private decimal(value: string | null | undefined) {
    if (value === null || value === undefined || value === '') return null;
    try {
      const result = new Decimal(value);
      return result.isFinite() && result.gte(0) ? result : null;
    } catch {
      return null;
    }
  }

  private interpolate(
    value: Decimal,
    bad: string,
    good: string,
    minScore: number,
    maxScore: number,
  ) {
    const t = value.minus(bad).div(new Decimal(good).minus(bad));
    const clamped = Decimal.max(0, Decimal.min(1, t));
    return new Decimal(minScore)
      .plus(clamped.mul(maxScore - minScore))
      .toDecimalPlaces(2)
      .toNumber();
  }
}
