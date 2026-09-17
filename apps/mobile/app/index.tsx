import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PluggyConnect } from 'react-native-pluggy-connect';
import {
  createPluggyToken,
  completePluggyConnection,
  reconnectPluggyToken,
} from '../src/api/connections';
import { listAccounts } from '../src/api/accounts';
import { getApiErrorMessage } from '../src/api/client';
import { getDashboard } from '../src/api/dashboard';
import { listTransactions } from '../src/api/transactions';
import { useAuth } from '../src/auth/auth-context';
import { tokens } from '../src/theme/tokens';

export default function Home() {
  const auth = useAuth();
  if (!auth.ready)
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  if (auth.locked)
    return (
      <Centered>
        <Text style={styles.title}>Finance Health bloqueado</Text>
        <Action title="Desbloquear" onPress={() => void auth.unlock()} />
      </Centered>
    );
  if (!auth.authenticated) return <AuthScreen />;
  return <DashboardScreen />;
}

function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [registerMode, setRegisterMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      if (registerMode) await signUp(email, password, displayName);
      else await signIn(email, password);
    } catch (error) {
      Alert.alert(
        'Não foi possível entrar',
        getApiErrorMessage(error, 'Confira seus dados e tente novamente.'),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Centered>
      <Text style={styles.eyebrow}>FINANCE HEALTH</Text>
      <Text style={styles.title}>
        {registerMode
          ? 'Comece a organizar sua vida financeira.'
          : 'Sua vida financeira, sem ruído.'}
      </Text>
      {registerMode && (
        <TextInput
          placeholder="Nome (opcional)"
          value={displayName}
          onChangeText={setDisplayName}
          style={styles.input}
        />
      )}
      <TextInput
        placeholder="E-mail"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={styles.input}
      />
      <TextInput
        placeholder="Senha"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={styles.input}
      />
      <Action
        title={busy ? 'Aguarde…' : registerMode ? 'Criar conta' : 'Entrar'}
        onPress={() => void submit()}
        disabled={busy}
      />
      <Pressable onPress={() => setRegisterMode(!registerMode)}>
        <Text style={styles.link}>{registerMode ? 'Já tenho uma conta' : 'Criar uma conta'}</Text>
      </Pressable>
    </Centered>
  );
}

function DashboardScreen() {
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const [connectToken, setConnectToken] = useState<string | null>(null);
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: getDashboard,
    refetchInterval: 30_000,
  });
  const connections = useQuery({
    queryKey: ['connections'],
    queryFn: () => import('../src/api/connections').then((module) => module.listConnections()),
    refetchInterval: 5_000,
  });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts });
  const transactions = useQuery({
    queryKey: ['transactions'],
    queryFn: () => listTransactions(10),
  });

  const connect = async () => {
    try {
      setConnectToken((await createPluggyToken()).accessToken);
    } catch (error) {
      Alert.alert(
        'Conexão indisponível',
        getApiErrorMessage(error, 'Não foi possível iniciar a conexão agora.'),
      );
    }
  };
  if (connectToken)
    return (
      <SafeAreaView style={styles.safe}>
        <PluggyConnect
          connectToken={connectToken}
          language="pt"
          includeSandbox={__DEV__}
          forceOauthInBrowser={false}
          onClose={() => setConnectToken(null)}
          onSuccess={async ({ item }) => {
            try {
              await completePluggyConnection(item.id, item.connector?.name);
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
                queryClient.invalidateQueries({ queryKey: ['connections'] }),
                queryClient.invalidateQueries({ queryKey: ['accounts'] }),
                queryClient.invalidateQueries({ queryKey: ['transactions'] }),
              ]);
            } catch (error) {
              Alert.alert(
                'Conexão incompleta',
                getApiErrorMessage(error, 'Não foi possível salvar a instituição.'),
              );
            } finally {
              setConnectToken(null);
            }
          }}
          onError={(error) => {
            setConnectToken(null);
            const message = error.message?.trim() || 'A instituição não foi conectada.';
            Alert.alert('Erro na conexão', message);
          }}
        />
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>HOJE</Text>
            <Text style={styles.title}>Sua vida financeira, sem ruído.</Text>
          </View>
          <Pressable onPress={() => void signOut()}>
            <Text style={styles.link}>Sair</Text>
          </Pressable>
        </View>
        {dashboard.isLoading && <ActivityIndicator />}
        {dashboard.isError && (
          <View style={styles.cardFull}>
            <Text style={styles.label}>Dados indisponíveis</Text>
            <Text style={styles.muted}>
              {getApiErrorMessage(
                dashboard.error,
                'Sincronize uma instituição ou tente novamente.',
              )}
            </Text>
          </View>
        )}
        {dashboard.data && (
          <>
            <View style={styles.heroCard}>
              <Text style={styles.label}>Saldo disponível</Text>
              <Text style={styles.money}>
                {money(dashboard.data.availableCash, dashboard.data.currency)}
              </Text>
              <Text style={styles.muted}>Qualidade: {dashboard.data.dataQuality}</Text>
              {!!dashboard.data.dataQualityReasons.length && (
                <Text style={styles.muted}>
                  Motivos: {dashboard.data.dataQualityReasons.join(', ')}
                </Text>
              )}
            </View>
            <View style={styles.row}>
              <Metric
                title="Saúde financeira"
                value={
                  dashboard.data.financialHealth.score === null
                    ? '—'
                    : `${dashboard.data.financialHealth.score} / 100`
                }
              />
                <Metric
                  title="Faturas abertas"
                  value={money(dashboard.data.creditCardExposure, dashboard.data.currency)}
                />
            </View>
            <View style={styles.row}>
                <Metric
                  title="Receitas no mês"
                  value={money(dashboard.data.monthlyIncome, dashboard.data.currency)}
                />
                <Metric
                  title="Despesas no mês"
                  value={money(dashboard.data.monthlyExpenses, dashboard.data.currency)}
                />
            </View>
            <View style={styles.cardFull}>
              <Text style={styles.section}>Patrimônio</Text>
              <Text style={styles.metric}>
                {money(dashboard.data.netWorth, dashboard.data.currency)}
              </Text>
              <Text style={styles.muted}>
                Investimentos {money(dashboard.data.investments, dashboard.data.currency)} · Dívidas{' '}
                {money(dashboard.data.liabilities, dashboard.data.currency)}
              </Text>
            </View>
          </>
        )}
        <Action title="Conectar instituição" onPress={() => void connect()} />
        <View style={styles.cardFull}>
          <Text style={styles.section}>Conexões</Text>
          {connections.data?.length ? (
            connections.data.map((connection) => (
              <View key={connection.id} style={styles.connection}>
                <View style={styles.connectionText}>
                  <Text>{connection.institution ?? 'Instituição financeira'}</Text>
                  <Text style={styles.muted}>{connectionStatusLabel(connection.status)}</Text>
                  {connection.lastErrorMessage && (
                    <Text style={styles.error}>{connection.lastErrorMessage}</Text>
                  )}
                </View>
                {(connection.status === 'ERROR' || connection.status === 'REAUTH_REQUIRED') && (
                  <Pressable
                    onPress={async () => {
                      try {
                        setConnectToken((await reconnectPluggyToken(connection.id)).accessToken);
                      } catch (error) {
                        Alert.alert(
                          'Reconexão indisponível',
                          getApiErrorMessage(error, 'Tente novamente em instantes.'),
                        );
                      }
                    }}
                  >
                    <Text style={styles.link}>Reconectar</Text>
                  </Pressable>
                )}
              </View>
            ))
          ) : (
            <Text style={styles.muted}>Nenhuma instituição conectada.</Text>
          )}
        </View>
        <Text style={styles.muted}>
          Última sincronização:{' '}
          {dashboard.data?.lastSyncedAt
            ? new Date(dashboard.data.lastSyncedAt).toLocaleString()
            : '—'}
        </Text>
        <View style={styles.cardFull}>
          <Text style={styles.section}>Contas</Text>
          {accounts.isLoading && <ActivityIndicator />}
          {accounts.isError && (
            <Text style={styles.error}>
              {getApiErrorMessage(accounts.error, 'Não foi possível carregar as contas.')}
            </Text>
          )}
          {accounts.data?.length ? (
            accounts.data.map((account) => (
              <View key={account.id} style={styles.connection}>
                <Text>{account.name}</Text>
                <Text style={styles.muted}>
                  {account.availableBalance === null
                    ? '—'
                    : money(account.availableBalance, account.currency)}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.muted}>As contas aparecerão após a sincronização.</Text>
          )}
        </View>
        <View style={styles.cardFull}>
          <Text style={styles.section}>Movimentações recentes</Text>
          {transactions.isLoading && <ActivityIndicator />}
          {transactions.isError && (
            <Text style={styles.error}>
              {getApiErrorMessage(
                transactions.error,
                'Não foi possível carregar as movimentações.',
              )}
            </Text>
          )}
          {transactions.data?.data.length ? (
            transactions.data.data.map((transaction) => (
              <View key={transaction.id} style={styles.connection}>
                <View style={styles.connectionText}>
                  <Text numberOfLines={1}>
                    {transaction.merchantNormalized ?? transaction.description}
                  </Text>
                  <Text style={styles.muted}>{transaction.account.name}</Text>
                </View>
                <Text style={transaction.direction === 'INFLOW' ? styles.inflow : styles.outflow}>
                   {transaction.direction === 'INFLOW' ? '+' : '-'}{' '}
                   {money(transaction.amount, transaction.account.currency)}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.muted}>As movimentações aparecerão após a sincronização.</Text>
          )}
        </View>
        {dashboard.data && (
          <View style={styles.cardFull}>
            <Text style={styles.section}>Detalhes da saúde financeira</Text>
            <Text style={styles.muted}>
              Cobertura {(dashboard.data.financialHealth.coverage * 100).toFixed(0)}% · Confiança{' '}
              {dashboard.data.financialHealth.confidence}
            </Text>
            {dashboard.data.financialHealth.components.map((component) => (
              <View key={component.key} style={styles.component}>
                <Text>{component.key}</Text>
                <Text style={styles.muted}>
                  {component.score === null ? 'Indisponível' : `${component.score} pts`}
                </Text>
                <Text style={styles.muted}>{component.explanation}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{title}</Text>
      <Text style={styles.metric}>{value}</Text>
    </View>
  );
}
function Action({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={[styles.action, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.actionText}>{title}</Text>
    </Pressable>
  );
}
function Centered({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.centered}>{children}</View>
    </SafeAreaView>
  );
}
function money(value: string | null | undefined, currency: string | null | undefined) {
  const number = Number(value);
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    !Number.isFinite(number) ||
    !currency
  )
    return '—';
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(number);
  } catch {
    return '—';
  }
}

function connectionStatusLabel(status: string) {
  const labels: Record<string, string> = {
    PENDING: 'Aguardando sincronização',
    CONNECTED: 'Conectada',
    SYNCING: 'Sincronizando dados…',
    STALE: 'Dados desatualizados',
    ERROR: 'Erro na sincronização',
    REAUTH_REQUIRED: 'Reconexão necessária',
    DISCONNECTED: 'Desconectada',
  };
  return labels[status] ?? 'Status indisponível';
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F7F3' },
  container: { padding: tokens.spacing.lg, gap: tokens.spacing.md },
  centered: {
    flex: 1,
    padding: tokens.spacing.lg,
    gap: tokens.spacing.md,
    justifyContent: 'center',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  eyebrow: { fontSize: 12, letterSpacing: 1.4, opacity: 0.55 },
  title: { fontSize: tokens.typography.title, fontWeight: '700', maxWidth: 330 },
  heroCard: { backgroundColor: '#FFFFFF', padding: 22, borderRadius: 24, gap: 6 },
  label: { fontSize: 13, opacity: 0.58 },
  money: { fontSize: 34, fontWeight: '700' },
  muted: { fontSize: 14, opacity: 0.58, lineHeight: 20 },
  row: { flexDirection: 'row', gap: 12 },
  card: { flex: 1, backgroundColor: '#FFFFFF', padding: 18, borderRadius: 18, minHeight: 100 },
  cardFull: { backgroundColor: '#FFFFFF', padding: 20, borderRadius: 20, gap: 8 },
  section: { fontSize: tokens.typography.section, fontWeight: '700' },
  metric: { marginTop: 10, fontSize: 22, fontWeight: '700' },
  input: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, fontSize: 16 },
  action: { backgroundColor: '#183A37', padding: 16, borderRadius: 14, alignItems: 'center' },
  actionText: { color: '#FFFFFF', fontWeight: '700' },
  disabled: { opacity: 0.5 },
  link: { color: '#27665E', fontWeight: '600', padding: 8 },
  connection: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  connectionText: { flex: 1, gap: 2 },
  component: { paddingVertical: 8, gap: 2 },
  error: { color: '#A33A32', fontSize: 13 },
  inflow: { color: '#237A52', fontWeight: '600' },
  outflow: { color: '#A33A32', fontWeight: '600' },
});
