import { sha1Base64 } from './sha1';

describe('sha1Base64', () => {
  it('matches the reference digests', () => {
    expect(sha1Base64('')).toBe('2jmj7l5rSw0yVb/vlWAYkK/YBwk=');
    expect(sha1Base64('abc')).toBe('qZk+NkcGgWq6PiVxeFDCbJzQ2J0=');
    // 56 bytes: the length no longer fits in the first block.
    expect(sha1Base64('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      'hJg+RBw70m66rkqh+VEp5eVGcPE='
    );
  });

  it('hashes UTF-8 text like htpasswd -s', () => {
    // printf '<text>' | openssl dgst -sha1 -binary | base64
    expect(sha1Base64('password')).toBe('W6ph5Mm5Pz8GgiULbPgzG37mj9g=');
    expect(sha1Base64('şifre')).toBe('8D6mD29bg7ZBA+v/EcUkmsri5oc=');
  });
});
