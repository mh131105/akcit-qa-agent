import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Artifact } from '../domain/preparation.js';

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FIELDS_BYTES = 16 * 1024;
const execute = promisify(execFile);
export type UploadedFile = { name: string; type: string; data: Buffer };
export type InputArtifact = Artifact & {
  originalId?: string; format?: 'txt' | 'md' | 'pdf'; sizeBytes?: number; sha256?: string;
  pages?: { page: number; firstLine: number; lastLine: number }[];
};
export class ArtifactInputError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); }
}
const invalid = () => new ArtifactInputError('INVALID_UPLOAD', 'Arquivo ou formulário inválido. Use texto UTF-8, .txt, .md ou PDF com texto.');
const tooLarge = () => new ArtifactInputError('FILE_TOO_LARGE', 'Cada arquivo deve ter até 10 MiB. Reduza o arquivo e tente novamente.', 413);

/** Limites conferidos à medida que chegam os dados, inclusive sem Content-Length. */
export async function readMultipart(request: IncomingMessage): Promise<{ body: Record<string, unknown>; files: UploadedFile[] }> {
  const contentType = request.headers['content-type'] ?? '';
  const match = /^multipart\/form-data\s*;\s*boundary=(?:"([!#$%&'*+.^_`|~0-9A-Za-z()-]{1,70})"|([!#$%&'*+.^_`|~0-9A-Za-z()-]{1,70}))\s*$/i.exec(contentType);
  if (!match) throw invalid();
  const boundary = Buffer.from(`--${match[1] ?? match[2]}`);
  const separator = Buffer.from(`\r\n${boundary.toString()}`);
  const maximum = MAX_FILES * MAX_FILE_BYTES + MAX_FIELDS_BYTES + 64 * 1024;
  if (Number(request.headers['content-length']) > maximum) throw tooLarge();
  let buffer = Buffer.alloc(0); let state: 'boundary' | 'headers' | 'body' | 'done' = 'boundary';
  let total = 0; let partBytes = 0; let fieldBytes = 0; let parts: Buffer[] = [];
  let name = ''; let filename: string | null = null; let type = '';
  const body: Record<string, unknown> = {}; const files: UploadedFile[] = [];
  const append = (data: Buffer) => {
    partBytes += data.length;
    if (filename !== null && partBytes > MAX_FILE_BYTES) throw tooLarge();
    if (filename === null && partBytes + fieldBytes > MAX_FIELDS_BYTES) throw new ArtifactInputError('BODY_TOO_LARGE', 'Os campos de texto excedem 16 KiB.', 413);
    parts.push(data);
  };
  const consume = () => {
    while (true) {
      if (state === 'done') { if (buffer.length > 2 || buffer.length === 2 && buffer.toString() !== '\r\n') throw invalid(); return; }
      if (state === 'boundary') {
        if (buffer.length < boundary.length + 2) return;
        if (!buffer.subarray(0, boundary.length).equals(boundary)) throw invalid();
        const ending = buffer.subarray(boundary.length, boundary.length + 2).toString();
        buffer = buffer.subarray(boundary.length + 2);
        if (ending === '--') { state = 'done'; continue; }
        if (ending !== '\r\n') throw invalid();
        state = 'headers';
      }
      if (state === 'headers') {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) { if (buffer.length > 8192) throw invalid(); return; }
        if (end > 8192) throw invalid();
        const headers = buffer.subarray(0, end).toString('utf8').split('\r\n');
        const disposition = headers.filter(line => /^content-disposition:/i.test(line));
        const content = headers.filter(line => /^content-type:/i.test(line));
        if (disposition.length !== 1 || content.length > 1) throw invalid();
        const part = /^content-disposition:\s*form-data;\s*name="([A-Za-z]+)"(?:;\s*filename="([^"\r\n]*)")?\s*$/i.exec(disposition[0]!);
        if (!part) throw invalid();
        name = part[1]!; filename = part[2] ?? null; type = content[0]?.slice(content[0].indexOf(':') + 1).trim() ?? '';
        if (filename !== null) {
          if (name !== 'files' || files.length >= MAX_FILES) throw new ArtifactInputError('FILE_LIMIT', 'Selecione no máximo cinco arquivos.');
          validateFile({ name: filename, type, data: Buffer.alloc(0) }, false);
        } else if (!['name', 'applicationName', 'objective', 'text'].includes(name) || Object.hasOwn(body, name)) throw invalid();
        buffer = buffer.subarray(end + 4); state = 'body'; partBytes = 0; parts = [];
      }
      if (state === 'body') {
        const end = buffer.indexOf(separator);
        if (end < 0) {
          const safe = Math.max(0, buffer.length - separator.length - 2);
          if (safe) { append(buffer.subarray(0, safe)); buffer = buffer.subarray(safe); }
          return;
        }
        append(buffer.subarray(0, end));
        const data = Buffer.concat(parts, partBytes);
        if (filename !== null) files.push({ name: filename, type, data });
        else {
          try { body[name] = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { throw invalid(); }
          fieldBytes += partBytes;
        }
        buffer = buffer.subarray(end + 2); state = 'boundary'; parts = [];
      }
    }
  };
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    total += chunk.length;
    if (total > maximum) throw tooLarge();
    buffer = Buffer.concat([buffer, chunk]); consume();
  }
  consume();
  if ((state as string) !== 'done') throw invalid();
  return { body, files };
}

function validateFile(file: UploadedFile, requireContent = true): 'txt' | 'md' | 'pdf' {
  if (file.data.length > MAX_FILE_BYTES) throw tooLarge();
  const extension = /\.([^.]+)$/.exec(file.name)?.[1]?.toLowerCase();
  if (!['txt', 'md', 'pdf'].includes(extension ?? '') || !file.name.trim() || file.name.length > 255 || /[\x00-\x1f/\\]/.test(file.name)) throw invalid();
  if (requireContent && !file.data.length) throw new ArtifactInputError('EMPTY_FILE', `${file.name}: arquivo vazio.`);
  return extension as 'txt' | 'md' | 'pdf';
}

export function pdfPages(extracted: string): Pick<InputArtifact, 'text' | 'pages'> {
  const pages = extracted.replace(/\r\n?/g, '\n').split('\f');
  if (pages.at(-1) === '') pages.pop();
  const locations: NonNullable<InputArtifact['pages']> = []; let nextLine = 1;
  const texts = pages.map((text, index) => {
    const lines = text.split('\n').length;
    locations.push({ page: index + 1, firstLine: nextLine, lastLine: nextLine + lines - 1 });
    nextLine += lines; return text;
  });
  return { text: texts.join('\n'), pages: locations };
}

export async function extractArtifacts(files: readonly UploadedFile[]): Promise<InputArtifact[]> {
  if (files.length > MAX_FILES) throw new ArtifactInputError('FILE_LIMIT', 'Selecione no máximo cinco arquivos.');
  const artifacts: InputArtifact[] = [];
  for (const file of files) {
    const format = validateFile(file);
    let text: string; let pages: InputArtifact['pages'];
    if (format === 'pdf') {
      if (!file.data.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw invalid();
      const temporary = await mkdtemp(join(tmpdir(), 'akcit-pdf-'));
      try {
        const path = join(temporary, 'document.pdf');
        await writeFile(path, file.data, { mode: 0o600 });
        let extracted: string;
        try { extracted = (await execute('pdftotext', ['-layout', '-enc', 'UTF-8', path, '-'], { shell: false, timeout: 30000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' })).stdout; }
        catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new ArtifactInputError('CONTEXT_LIMIT', 'O texto extraído é grande demais. Reduza explicitamente o material; nenhum conteúdo foi truncado.'); throw new ArtifactInputError('PDF_EXTRACTION_FAILED', `${file.name}: não foi possível extrair texto. Envie um PDF válido, sem senha e com texto selecionável.`); }
        ({ text, pages } = pdfPages(extracted));
        if (!text.trim()) throw new ArtifactInputError('PDF_WITHOUT_TEXT', `${file.name}: PDF sem texto selecionável. OCR não está disponível; envie .txt, .md ou PDF com texto.`);
      } finally { await rm(temporary, { recursive: true, force: true }); }
    } else {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(file.data); } catch { throw invalid(); }
      if (text.includes('\0') || !text.trim()) throw invalid();
    }
    artifacts.push({ id: randomUUID(), originalId: randomUUID(), name: file.name, version: '1', text,
      format, sizeBytes: file.data.length, sha256: createHash('sha256').update(file.data).digest('hex'), ...(pages ? { pages } : {}) });
  }
  return artifacts;
}

export async function saveArtifactFiles(dataDir: string, runId: string, artifacts: InputArtifact[], files: readonly UploadedFile[]): Promise<() => Promise<void>> {
  if (!files.length) return async () => {};
  const directory = join(dataDir, 'artifacts', runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const written: string[] = [];
  const cleanup = async () => { await Promise.all(written.map(path => rm(path, { force: true }))); };
  try {
    for (let i = 0; i < files.length; i++) {
      const artifact = artifacts[i]!;
      for (const [id, suffix, content] of [[artifact.originalId!, 'original', files[i]!.data], [artifact.id, 'txt', artifact.text]] as const) {
        const path = join(directory, `${id}.${suffix}`);
        const handle = await open(path, 'wx', 0o600); written.push(path);
        try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
      }
    }
    return cleanup;
  } catch (error) { await cleanup(); throw error; }
}

export async function originalFile(dataDir: string, runId: string, artifact: InputArtifact): Promise<UploadedFile> {
  if (!artifact.originalId || !/^[a-f0-9-]{36}$/i.test(artifact.originalId)) throw invalid();
  const file = await open(join(dataDir, 'artifacts', runId, `${artifact.originalId}.original`), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw invalid();
    return { name: artifact.name, type: '', data: await file.readFile() };
  } finally { await file.close(); }
}
