/**
 * IP address and CIDR helpers (validation, sizes, containment) for IPv4 and IPv6.
 *
 * Addresses are kept as byte arrays so the same code handles both families without BigInt
 * (the plugin build targets ES2017).
 */

export interface ParsedIP {
  family: 4 | 6;
  /** 4 bytes for IPv4, 16 for IPv6, most significant first. */
  bytes: number[];
}

const IPV4_PART = /^(0|[1-9]\d{0,2})$/;

function parseIPv4(text: string): number[] | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!IPV4_PART.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes.push(n);
  }
  return bytes;
}

function parseIPv6(text: string): number[] | null {
  let input = text;
  // An embedded IPv4 tail ("::ffff:10.0.0.1") counts as the last two groups.
  if (input.includes('.')) {
    const lastColon = input.lastIndexOf(':');
    const v4 = parseIPv4(input.slice(lastColon + 1));
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    input = `${input.slice(0, lastColon + 1)}${hi}:${lo}`;
  }
  const halves = input.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    const n = parseInt(group, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  return bytes;
}

export function parseIP(text?: string): ParsedIP | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.includes(':')) {
    const v6 = parseIPv6(trimmed);
    return v6 ? { family: 6, bytes: v6 } : null;
  }
  const v4 = parseIPv4(trimmed);
  return v4 ? { family: 4, bytes: v4 } : null;
}

export function isValidIP(text?: string): boolean {
  return parseIP(text) !== null;
}

/** Lexicographic comparison of two addresses of the same family. */
function compareBytes(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/** Numeric value of an address; exact for IPv4, approximate for large IPv6 values. */
function toNumber(bytes: number[]): number {
  return bytes.reduce((value, byte) => value * 256 + byte, 0);
}

export interface ParsedCIDR {
  family: 4 | 6;
  /** First address of the network. */
  first: number[];
  /** Last address of the network. */
  last: number[];
  prefix: number;
}

export function parseCIDR(text?: string): ParsedCIDR | null {
  if (!text) return null;
  const [address, prefixText, extra] = text.trim().split('/');
  if (extra !== undefined || prefixText === undefined || !/^\d{1,3}$/.test(prefixText)) return null;
  const ip = parseIP(address);
  if (!ip) return null;
  const bits = ip.bytes.length * 8;
  const prefix = Number(prefixText);
  if (prefix > bits) return null;
  const first: number[] = [];
  const last: number[] = [];
  ip.bytes.forEach((byte, i) => {
    const networkBits = Math.max(0, Math.min(8, prefix - i * 8));
    const mask = (0xff << (8 - networkBits)) & 0xff;
    first.push(byte & mask);
    last.push((byte & mask) | (~mask & 0xff));
  });
  return { family: ip.family, first, last, prefix };
}

export function isValidCIDR(text?: string): boolean {
  return parseCIDR(text) !== null;
}

/** Accepts both a CIDR and a bare IP address (as Cilium does for several fields). */
export function isValidCIDROrIP(text?: string): boolean {
  return isValidCIDR(text) || isValidIP(text);
}

/** Whether the CIDR's address has host bits set (10.0.0.5/24 instead of 10.0.0.0/24). */
export function hasHostBits(text?: string): boolean {
  const cidr = parseCIDR(text);
  if (!cidr || !text) return false;
  const ip = parseIP(text.split('/')[0]);
  return !!ip && compareBytes(ip.bytes, cidr.first) !== 0;
}

export function cidrContainsIP(cidrText: string, ipText: string): boolean {
  const cidr = parseCIDR(cidrText);
  const ip = parseIP(ipText);
  if (!cidr || !ip || cidr.family !== ip.family) return false;
  return compareBytes(ip.bytes, cidr.first) >= 0 && compareBytes(ip.bytes, cidr.last) <= 0;
}

export function cidrContainsCIDR(outerText: string, innerText: string): boolean {
  const outer = parseCIDR(outerText);
  const inner = parseCIDR(innerText);
  if (!outer || !inner || outer.family !== inner.family) return false;
  return compareBytes(inner.first, outer.first) >= 0 && compareBytes(inner.last, outer.last) <= 0;
}

export function cidrsOverlap(aText: string, bText: string): boolean {
  const a = parseCIDR(aText);
  const b = parseCIDR(bText);
  if (!a || !b || a.family !== b.family) return false;
  return compareBytes(a.first, b.last) <= 0 && compareBytes(b.first, a.last) <= 0;
}

export interface IPBlock {
  cidr?: string;
  start?: string;
  stop?: string;
}

interface Range {
  family: 4 | 6;
  first: number[];
  last: number[];
}

/** Resolves an LB IPAM block (CIDR, or start[–stop] range) to an address range. */
export function blockRange(block: IPBlock): Range | null {
  if (block.cidr) {
    const cidr = parseCIDR(block.cidr);
    return cidr ? { family: cidr.family, first: cidr.first, last: cidr.last } : null;
  }
  const start = parseIP(block.start);
  if (!start) return null;
  if (!block.stop) return { family: start.family, first: start.bytes, last: start.bytes };
  const stop = parseIP(block.stop);
  if (!stop || stop.family !== start.family || compareBytes(stop.bytes, start.bytes) < 0) {
    return null;
  }
  return { family: start.family, first: start.bytes, last: stop.bytes };
}

export function blockContainsIP(block: IPBlock, ipText: string): boolean {
  const range = blockRange(block);
  const ip = parseIP(ipText);
  if (!range || !ip || range.family !== ip.family) return false;
  return compareBytes(ip.bytes, range.first) >= 0 && compareBytes(ip.bytes, range.last) <= 0;
}

/**
 * Number of addresses LB IPAM can hand out from a block. For CIDR blocks the first and last
 * address are reserved unless `allowFirstLast` is set; ranges are always used in full.
 */
export function blockSize(block: IPBlock, allowFirstLast = false): number | null {
  const range = blockRange(block);
  if (!range) return null;
  if (block.cidr) {
    const cidr = parseCIDR(block.cidr)!;
    const size = Math.pow(2, range.first.length * 8 - cidr.prefix);
    return !allowFirstLast && size > 2 ? size - 2 : size;
  }
  return toNumber(range.last) - toNumber(range.first) + 1;
}

/** Formats a (possibly huge) address count: 254, 65.5k, 16.8M, 2^64. */
export function formatCount(count: number | null | undefined): string {
  if (count === null || count === undefined || Number.isNaN(count)) return '-';
  if (count < 10000) return String(Math.round(count));
  if (count < 1e6) return `${(count / 1e3).toFixed(1)}k`;
  if (count < 1e9) return `${(count / 1e6).toFixed(1)}M`;
  return `2^${Math.round(Math.log2(count))}`;
}
