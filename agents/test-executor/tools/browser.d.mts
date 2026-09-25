/** Tipos da integração browser.mjs com TypeScript; mantém o build atual. */
export interface BrowserObservationRecord {
  id: string;
  assetId: string;
  at: string;
  width: number;
  height: number;
}
export interface BrowserActionRecord {
  id: string;
  at: string;
  tool: 'observe_screen' | 'pointer' | 'keyboard_scroll' | 'fill_credential';
  params: Record<string, unknown>;
  outcome: 'ok' | 'error';
  observationId?: string;
  note?: string;
}
export interface BrowserSessionOptions {
  startUrl: string;
  allowedOrigins: readonly string[];
  credential: { username: string; password: string } | null;
  mediaDir: string;
  display?: string;
  chromiumPath?: string;
  remainingActions: () => Promise<number>;
  onObservation: (record: BrowserObservationRecord) => Promise<void>;
  onAction: (record: BrowserActionRecord) => Promise<void>;
}
export interface BrowserSession {
  tools: unknown[];
  blockedDestinations: string[];
  /** Somente para smoke/teste medir coordenadas; nunca exposto ao modelo. */
  page: unknown;
  close(): Promise<void>;
}
export function openBrowserSession(options: BrowserSessionOptions): Promise<BrowserSession>;
