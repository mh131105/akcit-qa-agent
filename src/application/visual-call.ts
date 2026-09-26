import { randomUUID } from 'node:crypto';
import type { MappingServices } from './map-application.js';
import { executeVisualTask, type VisualCallUpdate, type VisualResult, type VisualTask } from '../runtime/pi-visual.js';

/** Executa a sessão visual persistindo início e término de cada inferência
 * reutilizando `PreparationCall`: o histórico fica registrado mesmo quando a
 * sessão inteira falha com JSON inválido, erro, timeout ou cancelamento. */
export async function runVisual(services: MappingServices, task: Omit<VisualTask, 'signal' | 'authPath' | 'onCall'>): Promise<VisualResult> {
  const call = services.visualCall ?? executeVisualTask;
  const running = new Set<string>();
  const onCall = async (event: VisualCallUpdate) => {
    if (event.kind === 'start') {
      await services.update(record => {
        const preparation = record.run.preparation;
        if (!preparation) return undefined;
        preparation.calls.push({
          id: event.callId, role: task.role, ...task.model,
          phase: task.kind === 'execute-test-case' ? 'execution' : task.kind === 'validate-test-result' ? 'execution_validation'
            : task.role === 'test-executor' ? 'mapping' : 'mapping_validation',
          attempt: task.callMeta.attempt, outputRevision: task.callMeta.outputRevision,
          startedAt: event.at, status: 'running', budgetCycleId: preparation.budgetCycleId,
        });
        return undefined;
      });
      running.add(event.callId);
    } else {
      await services.update(record => {
        const found = record.run.preparation?.calls.find(item => item.id === event.callId);
        if (!found || found.status !== 'running') return undefined;
        found.finishedAt = event.at;
        found.durationMs = event.durationMs ?? 0;
        found.status = 'completed';
        if (event.usage) found.usage = event.usage;
        return undefined;
      });
      running.delete(event.callId);
    }
  };
  let result: VisualResult;
  try {
    result = await call({
      ...task,
      signal: services.signal, onCall,
      ...(services.config.piAuthPath ? { authPath: services.config.piAuthPath } : {}),
    });
  } catch (error) {
    // A falha atual também fica registrada; chamadas anteriores foram preservadas.
    const failure = services.failure(error);
    const aborted = services.signal.aborted;
    try {
      await services.update(record => {
        const preparation = record.run.preparation;
        if (!preparation) return undefined;
        for (const callId of running) {
          const found = preparation.calls.find(item => item.id === callId);
          if (found && found.status === 'running') {
            found.finishedAt = services.time();
            found.durationMs = Math.max(0, services.now() - Date.parse(found.startedAt));
            found.status = aborted ? 'cancelled'
              : ['INVALID_OUTPUT', 'INVALID_MODEL_OUTPUT'].includes(failure.code) ? 'invalid' : 'error';
            found.errorCode = failure.code;
          }
        }
        return undefined;
      });
    } catch {
      // Cancelamento já finalizou as chamadas em andamento; nada a salvar.
    }
    throw error;
  }
  // Eventos já foram persistidos; resultados substitutos legados (sem callId)
  // são registrados como concluídos na chegada.
  for (const callEvent of result.calls) {
    await services.update(record => {
      const preparation = record.run.preparation;
      if (!preparation) return undefined;
      if (callEvent.callId) {
        const found = preparation.calls.find(item => item.id === callEvent.callId);
        if (found) {
          if (found.status === 'running') {
            found.finishedAt = callEvent.at;
            found.durationMs = callEvent.durationMs;
            found.status = 'completed';
            if (callEvent.usage) found.usage = callEvent.usage;
          }
          return undefined;
        }
      }
      preparation.calls.push({
        id: randomUUID(), role: task.role, ...task.model,
        phase: task.kind === 'execute-test-case' ? 'execution' : task.kind === 'validate-test-result' ? 'execution_validation'
            : task.role === 'test-executor' ? 'mapping' : 'mapping_validation',
        attempt: task.callMeta.attempt, outputRevision: task.callMeta.outputRevision,
        budgetCycleId: preparation.budgetCycleId,
        startedAt: new Date(Math.max(0, Date.parse(callEvent.at) - callEvent.durationMs)).toISOString(),
        finishedAt: callEvent.at, durationMs: callEvent.durationMs, status: 'completed',
        ...(callEvent.usage ? { usage: callEvent.usage } : {}),
      });
      return undefined;
    });
  }
  return result;
}
