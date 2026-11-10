export class TargetPolicyError extends Error {
  code: 'INVALID_URL' | 'TARGET_NOT_ALLOWED';
  constructor(code: 'INVALID_URL' | 'TARGET_NOT_ALLOWED', message: string);
}
export type TargetLookup = (hostname: string, options: { all: true; verbatim: true }) => Promise<readonly { address: string; family: number }[]>;
export function isPublicAddress(address: string): boolean;
export function validateTargetUrl(value: string, trustedOrigins?: readonly string[]): URL;
export function resolveTarget(value: URL | string, trustedOrigins?: readonly string[], lookup?: TargetLookup): Promise<{ address: string; family: number }>;
export function assertTargetUrl(value: string, trustedOrigins?: readonly string[], lookup?: TargetLookup): Promise<URL>;
