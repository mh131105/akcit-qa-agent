import { argon2, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isValidEmail, normalizeEmail, type readConfig } from './config.js';

export type PublicUser = { id: string; name: string; email: string; teamName?: string };
export type RegisterInput = { name: string; email: string; password: string; teamName?: string };
type PasswordHash = {
  algorithm: 'argon2id'; version: 19; memory: number; passes: number; parallelism: number;
  tagLength: number; salt: string; hash: string;
};
type Account = PublicUser & { createdAt: string; password: PasswordHash };
type Session = { user: PublicUser; expiresAt: number };
type Counter = { count: number; expiresAt: number };

export class AuthError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

const ARGON2 = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 };
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

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolveKey, reject) => {
    argon2('argon2id', { ...ARGON2, message: password, nonce: salt }, (error, key) => error ? reject(error) : resolveKey(key));
  });
}

function publicUser(account: PublicUser): PublicUser {
  return {
    id: account.id, name: account.name, email: account.email,
    ...(account.teamName === undefined ? {} : { teamName: account.teamName }),
  };
}

function readAccount(value: unknown): Account {
  try {
    if (!object(value)) throw storageFailure();
    const account: Record<string, unknown> = { ...value, password: JSON.parse(value.password_hash as string) };
    if (typeof account.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(account.id) ||
      !validText(account.name) || typeof account.email !== 'string' ||
      account.email !== normalizeEmail(account.email) || !isValidEmail(account.email) ||
      (account.team_name !== null && !validText(account.team_name)) ||
      typeof account.created_at !== 'string' || !Number.isFinite(Date.parse(account.created_at)) ||
      new Date(account.created_at).toISOString() !== account.created_at || !object(account.password)) throw storageFailure();
    const password = account.password;
    if (password.algorithm !== 'argon2id' || password.version !== 19 ||
      !Object.entries(ARGON2).every(([key, expected]) => password[key] === expected) ||
      typeof password.salt !== 'string' || !/^[a-f0-9]{32}$/.test(password.salt) ||
      typeof password.hash !== 'string' || !/^[a-f0-9]{64}$/.test(password.hash)) throw storageFailure();
    return { id: account.id, name: account.name, email: account.email,
      ...(account.team_name === null ? {} : { teamName: account.team_name }),
      createdAt: account.created_at, password: password as PasswordHash };
  } catch { throw storageFailure(); }
}

export class AuthService {
  private readonly directory: string;
  private database: DatabaseSync | undefined;
  private initialization: Promise<void> | undefined;
  private readonly sessions = new Map<string, Session>();
  private readonly attempts = new Map<string, Counter>();
  private readonly dummySalt = randomBytes(16);

  constructor(private readonly config: ReturnType<typeof readConfig>, private readonly now = Date.now) {
    this.directory = join(resolve(config.dataDir), 'auth');
  }

  ensureConfigured(): void {
    if (!this.config.appOrigin) {
      throw new AuthError(503, 'AUTH_NOT_CONFIGURED', 'Configure APP_ORIGIN para habilitar a autenticação.');
    }
  }

  async initialize(): Promise<void> {
    this.initialization ??= this.open();
    return this.initialization;
  }

  private async open(): Promise<void> {
    try {
      for (const directory of [resolve(this.config.dataDir), this.directory]) {
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        if (!(await fs.lstat(directory)).isDirectory()) throw storageFailure();
        await fs.chmod(directory, 0o700);
      }
      // A transição exige arquivamento operacional explícito; nunca importar ou apagar contas antigas.
      try { await fs.lstat(join(this.directory, 'users.json')); throw storageFailure(); }
      catch (error) { if (!object(error) || error.code !== 'ENOENT') throw error; }
      const path = join(this.directory, 'users.sqlite');
      let created = false;
      const file = await fs.open(path, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
        .then(file => { created = true; return file; }, async error => {
          if (!object(error) || error.code !== 'EEXIST') throw error;
          return fs.open(path, constants.O_RDWR | constants.O_NOFOLLOW);
        });
      try {
        if (!(await file.stat()).isFile()) throw storageFailure();
        await file.chmod(0o600);
      } finally { await file.close(); }
      const database = this.database = new DatabaseSync(path);
      const version = database.prepare('PRAGMA user_version').get()!.user_version;
      if (created && version === 0) {
        database.exec(`BEGIN;
          CREATE TABLE users (
            id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
            team_name TEXT, created_at TEXT NOT NULL, password_hash TEXT NOT NULL
          ) STRICT;
          PRAGMA user_version=1;
          COMMIT;`);
      } else if (version !== 1) throw storageFailure();
      if (database.prepare('PRAGMA quick_check').get()!.quick_check !== 'ok') throw storageFailure();
      database.prepare('SELECT id, name, email, team_name, created_at, password_hash FROM users LIMIT 0').all();
      database.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
    } catch {
      this.close();
      throw storageFailure();
    }
  }

  close(): void {
    this.database?.close();
    this.database = undefined;
    this.sessions.clear();
  }

  private stored<T>(operation: (database: DatabaseSync) => T): T {
    try {
      if (!this.database) throw storageFailure();
      return operation(this.database);
    } catch (error) {
      if (error instanceof AuthError) throw error;
      if (object(error) && error.errcode === 2067) throw new AuthError(409, 'ACCOUNT_EXISTS', 'Já existe uma conta para este e-mail.');
      throw storageFailure();
    }
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
    if (!isValidEmail(normalized) || length < 1 || length > 128) throw invalidInput();
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
    if (typeof input.password !== 'string') throw invalidInput();
    if ([...input.password].length < 8 || [...input.password].length > 128 ||
      !/\p{Lu}/u.test(input.password) || !/[0-9]/.test(input.password) || !/[\p{P}\p{S}]/u.test(input.password)) {
      throw new AuthError(400, 'INVALID_PASSWORD', 'Use de 8 a 128 caracteres, incluindo uma letra maiúscula, um número e um caractere especial.');
    }
    const email = this.credentials(input.email, input.password);
    const name = input.name?.trim();
    const teamName = input.teamName?.trim();
    if (!validText(name) || (teamName !== undefined && !validText(teamName))) throw invalidInput();
    this.checkAttempts(email, address);
    await this.initialize();
    const salt = randomBytes(16);
    const hash = await derive(input.password, salt);
    const account: Account = {
      id: randomUUID(), name, email, ...(teamName === undefined ? {} : { teamName }),
      createdAt: new Date(this.now()).toISOString(),
      password: { algorithm: 'argon2id', version: 19, ...ARGON2, salt: salt.toString('hex'), hash: hash.toString('hex') },
    };
    this.stored(database => {
      database.prepare('INSERT INTO users (id, name, email, team_name, created_at, password_hash) VALUES (?, ?, ?, ?, ?, ?)')
        .run(account.id, name, email, teamName ?? null, account.createdAt, JSON.stringify(account.password));
    });
    return this.startSession(account);
  }

  async login(input: { email: string; password: string }, address: string): Promise<{ user: PublicUser; token: string }> {
    this.ensureConfigured();
    const email = this.credentials(input.email, input.password);
    this.checkAttempts(email, address);
    await this.initialize();
    const row = this.stored(database => database.prepare('SELECT * FROM users WHERE email = ?').get(email));
    const account = row ? readAccount(row) : undefined;
    const hash = await derive(input.password, account ? Buffer.from(account.password.salt, 'hex') : this.dummySalt);
    const expected = account ? Buffer.from(account.password.hash, 'hex') : Buffer.alloc(ARGON2.tagLength);
    if (!timingSafeEqual(hash, expected) || !account) {
      throw new AuthError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos.');
    }
    return this.startSession(account);
  }

  async updateProfile(userId: string, input: Record<string, unknown>): Promise<PublicUser> {
    if (Object.keys(input).some(key => !['name', 'teamName'].includes(key)) ||
      typeof input.name !== 'string' || !validText(input.name.trim()) ||
      (input.teamName !== undefined && (typeof input.teamName !== 'string' ||
        input.teamName.trim() !== '' && !validText(input.teamName.trim())))) throw invalidInput();
    const name = input.name.trim();
    const teamName = typeof input.teamName === 'string' ? input.teamName.trim() : undefined;
    await this.initialize();
    return this.stored(database => {
      const row = database.prepare(`UPDATE users SET name = ?, team_name = CASE WHEN ? THEN ? ELSE team_name END
        WHERE id = ? RETURNING *`).get(name, teamName === undefined ? 0 : 1, teamName || null, userId);
      if (!row) throw invalidSession();
      const user = publicUser(readAccount(row));
      for (const session of this.sessions.values()) if (session.user.id === userId) session.user = { ...user };
      return user;
    });
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
    if (!session) throw invalidSession();
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
