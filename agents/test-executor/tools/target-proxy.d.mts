import type { TargetLookup } from './target-policy.mjs';
export interface TargetProxy {
  url: string;
  close(): Promise<void>;
}
export function createTargetProxy(options?: {
  trustedOrigins?: readonly string[];
  lookup?: TargetLookup;
  onBlocked?: (origin: string) => void;
}): Promise<TargetProxy>;
