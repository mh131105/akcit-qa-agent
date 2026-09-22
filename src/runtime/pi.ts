import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import type { AgentRole } from '../agents/registry.js';

/** Cria uma sessão isolada por papel. Não executa uma solicitação ao modelo. */
export async function createSpecialistSession(role: AgentRole, root: string) {
  const directory = join(root, 'agents', role);
  await mkdir(directory, { recursive: true });
  const resourceLoader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    systemPromptOverride: () => `Você é o especialista ${role}. A implementação da metodologia ainda não foi habilitada.`,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  const modelRuntime = await ModelRuntime.create({ allowModelNetwork: false });
  return createAgentSession({
    cwd: directory,
    agentDir: directory,
    modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.inMemory(directory),
    noTools: 'all',
  });
}
