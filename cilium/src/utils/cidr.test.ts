import { describe, expect, it } from 'vitest';
import {
  blockContainsIP,
  blockSize,
  cidrContainsCIDR,
  cidrContainsIP,
  cidrsOverlap,
  formatCount,
  hasHostBits,
  isValidCIDR,
  isValidCIDROrIP,
  isValidIP,
  parseCIDR,
} from './cidr';

describe('IP and CIDR validation', () => {
  it('validates IPv4 and IPv6 addresses', () => {
    for (const ok of [
      '10.0.0.1',
      '255.255.255.255',
      '::1',
      'fd00::1',
      '2001:db8:0:0:0:0:0:1',
      '::ffff:10.0.0.1',
    ])
      expect(isValidIP(ok)).toBe(true);
    for (const bad of [
      '',
      '10.0.0',
      '256.0.0.1',
      '01.2.3.4',
      'fd00::1::2',
      'g::1',
      '1:2:3:4:5:6:7:8:9',
      undefined,
    ])
      expect(isValidIP(bad)).toBe(false);
  });

  it('validates CIDRs', () => {
    for (const ok of ['10.0.0.0/8', '0.0.0.0/0', '192.168.1.5/32', 'fd00::/64', '::/0'])
      expect(isValidCIDR(ok)).toBe(true);
    for (const bad of ['10.0.0.0', '10.0.0.0/33', 'fd00::/129', '10.0.0.0/8/1', '10.0.0.0/x'])
      expect(isValidCIDR(bad)).toBe(false);
    expect(isValidCIDROrIP('10.0.0.1')).toBe(true);
  });

  it('computes network boundaries and host bits', () => {
    expect(parseCIDR('10.1.2.3/16')).toMatchObject({
      first: [10, 1, 0, 0],
      last: [10, 1, 255, 255],
    });
    expect(parseCIDR('192.168.1.129/25')).toMatchObject({
      first: [192, 168, 1, 128],
      last: [192, 168, 1, 255],
    });
    expect(hasHostBits('10.0.0.5/24')).toBe(true);
    expect(hasHostBits('10.0.0.0/24')).toBe(false);
  });
});

describe('containment', () => {
  it('checks IPs and CIDRs inside CIDRs', () => {
    expect(cidrContainsIP('10.0.0.0/8', '10.255.0.1')).toBe(true);
    expect(cidrContainsIP('10.0.0.0/8', '11.0.0.1')).toBe(false);
    expect(cidrContainsIP('fd00::/64', 'fd00::abcd')).toBe(true);
    expect(cidrContainsIP('10.0.0.0/8', 'fd00::1')).toBe(false);
    expect(cidrContainsCIDR('10.0.0.0/8', '10.96.0.0/12')).toBe(true);
    expect(cidrContainsCIDR('10.96.0.0/12', '10.0.0.0/8')).toBe(false);
    expect(cidrsOverlap('10.0.0.0/24', '10.0.0.128/25')).toBe(true);
    expect(cidrsOverlap('10.0.0.0/24', '10.0.1.0/24')).toBe(false);
  });
});

describe('LB IPAM blocks', () => {
  it('sizes CIDR blocks with and without the first and last address', () => {
    expect(blockSize({ cidr: '192.168.10.0/24' })).toBe(254);
    expect(blockSize({ cidr: '192.168.10.0/24' }, true)).toBe(256);
    expect(blockSize({ cidr: '192.168.10.4/32' })).toBe(1);
    expect(blockSize({ cidr: '192.168.10.4/31' })).toBe(2);
  });

  it('sizes ranges and single addresses', () => {
    expect(blockSize({ start: '10.0.0.10', stop: '10.0.0.19' })).toBe(10);
    expect(blockSize({ start: '10.0.0.10' })).toBe(1);
    expect(blockSize({ start: '10.0.0.10', stop: '10.0.0.1' })).toBeNull();
    expect(blockSize({ cidr: 'nope' })).toBeNull();
  });

  it('finds the block an address belongs to', () => {
    expect(blockContainsIP({ start: '10.0.0.10', stop: '10.0.0.19' }, '10.0.0.15')).toBe(true);
    expect(blockContainsIP({ start: '10.0.0.10', stop: '10.0.0.19' }, '10.0.0.20')).toBe(false);
    expect(blockContainsIP({ cidr: '10.0.1.0/24' }, '10.0.1.200')).toBe(true);
  });

  it('formats large counts', () => {
    expect(formatCount(254)).toBe('254');
    expect(formatCount(65534)).toBe('65.5k');
    expect(formatCount(16777214)).toBe('16.8M');
    expect(formatCount(Math.pow(2, 64))).toBe('2^64');
    expect(formatCount(null)).toBe('-');
  });
});
