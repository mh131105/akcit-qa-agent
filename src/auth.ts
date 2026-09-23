import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isValidEmail, normalizeEmail, type readConfig } from './config.js';

export type PublicUser = { id: string; name: string; email: string; teamName?: string };
export type RegisterInput = { name: string; email: string; password: string; teamName?: string };
type PasswordHash = {
  algorithm: 'scrypt'; N: number; r: number; p: number; maxmem: number;
  keyLength: number; salt: string; hash: string;
};
type Account = PublicUser & { createdAt: string; password: PasswordHash };
type Accounts = { schemaVersion: 1; users: Account[] };
type Session = { user: PublicUser; expiresAt: number };
type Counter = { count: number; expiresAt: number };

export class AuthError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

const SCRYPT = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const SESSION_MS = 8 * 60 * 60 * 1000;
const ATTEMPT_MS = 15 * 60 * 1000;
const MAX_COUNTERS = 10_000;
const COOKIE = 'akcit_session';
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const invalidInput = () => new AuthError(400, 'INVALID_INPUT', 'Dados de autenticação inválidos.');
const storageFailure = () => new AuthError(503, 'AUTH_STORAGE_UNAVAILABLE', 'Armazenamento de contas indisponível; os dados foram preservados.');
const invalidSession = () => new AuthError(401, 'INVALID_SESSION', 'Sessão ausente, inválida ou expirada.');
const tooManyAttempts = () => new AuthError(429, 'TOO_MANY_ATTEMPTS', 'Limite de tentativas excedido. Tente novamente mais tarde.');
const validText = (value: unknown): value is string =>
  typeof value === 'string' && value === value.trim() && [...value].length >= 1 && [...value].length <= 120;

// ponytail: trava global de contas para o único processo escritor do piloto;
// múltiplos processos exigirão coordenação externa, como no RunStore.
let pending: Promise<unknown> = Promise.resolve();
function locked<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation);
  pending = result.catch(() => {});
  return result;
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolveKey, reject) => {
    scrypt(password, salt, 64, SCRYPT, (error, key) => error ? reject(error) : resolveKey(key));
  });
}

function publicUser(account: PublicUser): PublicUser {
  return {
    id: account.id, name: account.name, email: account.email,
    ...(account.teamName === undefined ? {} : { teamName: account.teamName }),
  };
}

function validateAccounts(value: unknown): asserts value is Accounts {
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.users)) throw storageFailure();
  const ids = new Set<string>();
  const emails = new Set<string>();
  for (const account of value.users) {
    if (!object(account) || typeof account.id !== 'string' || !account.id || ids.has(account.id) ||
      !validText(account.name) || typeof account.email !== 'string' ||
      account.email !== normalizeEmail(account.email) || !isValidEmail(account.email) || emails.has(account.email) ||
      (account.teamName !== undefined && !validText(account.teamName)) ||
      typeof account.createdAt !== 'string' || !Number.isFinite(Date.parse(account.createdAt)) ||
      new Date(account.createdAt).toISOString() !== account.createdAt || !object(account.password)) throw storageFailure();
    const password = account.password;
    if (password.algorithm !== 'scrypt' || password.keyLength !== 64 ||
      !Object.entries(SCRYPT).every(([key, expected]) => password[key] === expected) ||
      typeof password.salt !== 'string' || !/^[a-f0-9]{32}$/.test(password.salt) ||
      typeof password.hash !== 'string' || !/^[a-f0-9]{128}$/.test(password.hash)) throw storageFailure();
    ids.add(account.id);
    emails.add(account.email);
  }
}

export class AuthService {
  private readonly directory: string;
  private readonly allowedEmails: Set<string>;
  private readonly sessions = new Map<string, Session>();
  private readonly attempts = new Map<string, Counter>();
  private readonly dummySalt = randomBytes(16);

  constructor(private readonly config: ReturnType<typeof readConfig>, private readonly now = Date.now) {
    this.directory = join(resolve(config.dataDir), 'auth');
    this.allowedEmails = new Set(config.pilotAllowedEmails);
  }

  ensureConfigured(): void {
    if (!this.config.appOrigin) {
      throw new AuthError(503, 'AUTH_NOT_CONFIGURED', 'Configure APP_ORIGIN para habilitar a autenticação.');
    }
  }

  async initialize(): Promise<void> {
    try {
      for (const directory of [resolve(this.config.dataDir), this.directory]) {
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        if (!(await fs.lstat(directory)).isDirectory()) throw storageFailure();
        await fs.chmod(directory, 0o700);
      }
    } catch { throw storageFailure(); }
  }

  private async read(): Promise<Accounts> {
    try {
      const file = await fs.open(join(this.directory, 'users.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if (!(await file.stat()).isFile()) throw storageFailure();
        await file.chmod(0o600);
        const accounts: unknown = JSON.parse(await file.readFile('utf8'));
        validateAccounts(accounts);
        return accounts;
      } finally { await file.close(); }
    } catch (error) {
      if (object(error) && error.code === 'ENOENT') return { schemaVersion: 1, users: [] };
      throw storageFailure();
    }
  }

  private async save(accounts: Accounts): Promise<void> {
    const temporary = join(this.directory, `.users-${randomUUID()}.tmp`);
    try {
      const file = await fs.open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(`${JSON.stringify(accounts)}\n`, 'utf8');
        await file.sync();
      } finally { await file.close(); }
      await fs.rename(temporary, join(this.directory, 'users.json'));
      const directory = await fs.open(this.directory, constants.O_RDONLY);
      try { await directory.sync(); }
      finally { await directory.close(); }
    } catch { throw storageFailure(); }
    finally { await fs.unlink(temporary).catch(() => {}); }
  }

  private checkAttempts(email: string, address: string): void {
    const now = this.now();
    for (const [key, counter] of this.attempts) {
      if (counter.expiresAt <= now) this.attempts.delete(key);
    }
    const entries: [string, number][] = [[`email:${email}`, 10], [`address:${address}`, 30]];
    const missing = entries.filter(([key]) => !this.attempts.has(key)).length;
    // Não remover contadores ativos: isso permitiria contornar os limites.
    if (this.attempts.size + missing > MAX_COUNTERS) throw tooManyAttempts();
    let exceeded = false;
    for (const [key, limit] of entries) {
      const counter = this.attempts.get(key) ?? { count: 0, expiresAt: now + ATTEMPT_MS };
      counter.count = Math.min(counter.count + 1, limit + 1);
      this.attempts.set(key, counter);
      exceeded ||= counter.count > limit;
    }
    if (exceeded) throw tooManyAttempts();
  }

  private credentials(email: string, password: string): string {
    if (typeof email !== 'string' || typeof password !== 'string') throw invalidInput();
    const normalized = normalizeEmail(email);
    const length = [...password].length;
    if (!isValidEmail(normalized) || length < 15 || length > 128) throw invalidInput();
    return normalized;
  }

  private pruneSessions(): void {
    const now = this.now();
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(token);
    }
  }

  private startSession(account: Account): { user: PublicUser; token: string } {
    this.pruneSessions();
    const token = randomBytes(32).toString('base64url');
    const user = publicUser(account);
    this.sessions.set(token, { user, expiresAt: this.now() + SESSION_MS });
    return { user: { ...user }, token };
  }

  async register(input: RegisterInput, address: string): Promise<{ user: PublicUser; token: string }> {
    this.ensureConfigured();
    const email = this.credentials(input.email, input.password);
    const name = input.name?.trim();
    const teamName = input.teamName?.trim();
    if (!validText(name) || (teamName !== undefined && !validText(teamName))) throw invalidInput();
    this.checkAttempts(email, address);
    if (!this.allowedEmails.has(email)) {
      throw new AuthError(403, 'REGISTRATION_NOT_ALLOWED', 'Cadastro não habilitado para este e-mail.');
    }
    await this.initialize();
    const account = await locked(async () => {
      const accounts = await this.read();
      if (accounts.users.some(user => user.email === email)) {
        throw new AuthError(409, 'ACCOUNT_EXISTS', 'Já existe uma conta para este e-mail.');
      }
      const salt = randomBytes(16);
      const hash = await derive(input.password, salt);
      const account: Account = {
        id: randomUUID(), name, email, ...(teamName === undefined ? {} : { teamName }),
        createdAt: new Date(this.now()).toISOString(),
        password: { algorithm: 'scrypt', ...SCRYPT, keyLength: 64, salt: salt.toString('hex'), hash: hash.toString('hex') },
      };
      accounts.users.push(account);
      await this.save(accounts);
      return account;
    });
    return this.startSession(account);
  }

  async login(input: { email: string; password: string }, address: string): Promise<{ user: PublicUser; token: string }> {
    this.ensureConfigured();
    const email = this.credentials(input.email, input.password);
    this.checkAttempts(email, address);
    await this.initialize();
    const account = (await this.read()).users.find(user => user.email === email);
    const hash = await derive(input.password, account ? Buffer.from(account.password.salt, 'hex') : this.dummySalt);
    const expected = account ? Buffer.from(account.password.hash, 'hex') : Buffer.alloc(64);
    if (!timingSafeEqual(hash, expected) || !account || !this.allowedEmails.has(email)) {
      throw new AuthError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos.');
    }
    return this.startSession(account);
  }

  private token(cookieHeader: string | undefined): string | undefined {
    const values = (cookieHeader ?? '').split(';').map(cookie => cookie.trim())
      .filter(cookie => cookie.startsWith(`${COOKIE}=`));
    if (values.length !== 1) return undefined;
    const token = values[0]!.slice(COOKIE.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
  }

  authenticate(cookieHeader?: string): { userId: string; user: PublicUser } {
    this.ensureConfigured();
    this.pruneSessions();
    const token = this.token(cookieHeader);
    const session = token ? this.sessions.get(token) : undefined;
    if (!session || !this.allowedEmails.has(session.user.email)) throw invalidSession();
    return { userId: session.user.id, user: { ...session.user } };
  }

  logout(cookieHeader?: string): void {
    this.authenticate(cookieHeader);
    this.sessions.delete(this.token(cookieHeader)!);
  }

  cookie(token: string): string {
    return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${this.config.appOrigin?.startsWith('https:') ? '; Secure' : ''}`;
  }

  clearCookie(): string {
    return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${this.config.appOrigin?.startsWith('https:') ? '; Secure' : ''}`;
  }
}
