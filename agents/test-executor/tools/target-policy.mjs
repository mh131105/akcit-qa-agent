import { lookup as systemLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const nonPublicV4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) nonPublicV4.addSubnet(address, prefix, 'ipv4');
// Azure's platform virtual IP is not a public application endpoint.
nonPublicV4.addAddress('168.63.129.16', 'ipv4');

const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const nonPublicV6 = new BlockList();
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
]) nonPublicV6.addSubnet(address, prefix, 'ipv6');

export class TargetPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TargetPolicyError';
    this.code = code;
  }
}

export function isPublicAddress(address) {
  if (typeof address !== 'string' || address.includes('%')) return false;
  const family = isIP(address);
  if (family === 4) return !nonPublicV4.check(address, 'ipv4');
  // Restrict IPv6 to global unicast. This also rejects IPv4-mapped IPv6,
  // NAT64 prefixes, loopback, link-local, ULA, multicast and scoped addresses.
  return family === 6 && globalV6.check(address, 'ipv6') && !nonPublicV6.check(address, 'ipv6');
}

function hostnameOf(url) {
  return url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

export function validateTargetUrl(value, trustedOrigins = []) {
  let url;
  try {
    if (typeof value !== 'string' || !value.trim()) throw new Error();
    url = new URL(value.trim());
  } catch {
    throw new TargetPolicyError('INVALID_URL', 'Endereço da aplicação inválido.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TargetPolicyError('INVALID_URL', 'O endereço deve usar o protocolo HTTP ou HTTPS.');
  }
  if (url.username || url.password) {
    throw new TargetPolicyError('INVALID_URL', 'O endereço não deve conter credenciais embutidas.');
  }
  if (url.port && Number(url.port) < 1) {
    throw new TargetPolicyError('INVALID_URL', 'A porta do endereço deve estar entre 1 e 65535.');
  }
  if (trustedOrigins.includes(url.origin)) return url;
  const hostname = hostnameOf(url);
  const family = isIP(hostname);
  if ((family && !isPublicAddress(hostname)) || (!family && (
    !hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|lan|home)$/.test(hostname) ||
    hostname === 'home.arpa' || hostname.endsWith('.home.arpa')
  ))) {
    throw new TargetPolicyError('TARGET_NOT_ALLOWED', 'Informe uma aplicação pública. Endereços locais e redes internas não são permitidos.');
  }
  return url;
}

async function lookupAddresses(hostname, lookup) {
  let timer;
  try {
    return await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS_TIMEOUT')), 5000);
        timer.unref?.();
      }),
    ]);
  } catch {
    throw new TargetPolicyError('TARGET_NOT_ALLOWED', 'Não foi possível confirmar o endereço público da aplicação. Confira o domínio e tente novamente.');
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve all answers and return an address for a direct, pinned connection. */
export async function resolveTarget(value, trustedOrigins = [], lookup = systemLookup) {
  const url = validateTargetUrl(value instanceof URL ? value.href : value, trustedOrigins);
  const hostname = hostnameOf(url);
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookupAddresses(hostname, lookup);
  const trusted = trustedOrigins.includes(url.origin);
  if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some(result =>
    !result || !isIP(result.address) || result.family !== isIP(result.address) ||
    (!trusted && !isPublicAddress(result.address)))) {
    throw new TargetPolicyError('TARGET_NOT_ALLOWED', 'O domínio resolve para um endereço não público e não pode ser testado.');
  }
  // The VPS may have no IPv6 route even when DNS publishes AAAA first. All
  // answers were validated above; prefer an A record without weakening that check.
  const selected = addresses.find(result => result.family === 4) ?? addresses[0];
  return { address: selected.address, family: selected.family };
}

export async function assertTargetUrl(value, trustedOrigins = [], lookup = systemLookup) {
  const url = validateTargetUrl(value, trustedOrigins);
  // Test/development fixtures may have synthetic names without DNS records.
  if (!trustedOrigins.includes(url.origin)) await resolveTarget(url, trustedOrigins, lookup);
  return url;
}
