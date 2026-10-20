import { formatParams, parseModelUri, parseSize, uriScheme } from './modelInfo';

describe('uriScheme', () => {
  it.each([
    ['hf://Qwen/Qwen2.5-7B-Instruct', 'hf'],
    ['s3://bucket/models/llama', 's3'],
    ['pvc://gpt-oss-20b-pvc', 'pvc'],
    ['oci://quay.io/org/modelcar:1.0', 'oci'],
    ['gs://kfserving-examples/models/sklearn', 'gs'],
    ['/mnt/models', 'local'],
    ['ftp://x', 'unknown'],
  ])('%s -> %s', (uri, scheme) => {
    expect(uriScheme(uri)).toBe(scheme);
  });
});

describe('parseSize', () => {
  it('parses plain, MoE, active-parameter and million sizes', () => {
    expect(parseSize('Qwen2.5-7B-Instruct')).toEqual({ paramsB: 7, sizeLabel: '7B' });
    expect(parseSize('Mixtral-8x7B-Instruct-v0.1')).toEqual({ paramsB: 56, sizeLabel: '8x7B' });
    expect(parseSize('Qwen3-30B-A3B')).toEqual({
      paramsB: 30,
      activeParamsB: 3,
      sizeLabel: '30B-A3B',
    });
    expect(parseSize('opt-125m')).toEqual({ paramsB: 0.125, sizeLabel: '125M' });
    expect(parseSize('gpt-oss-20b')).toEqual({ paramsB: 20, sizeLabel: '20B' });
    expect(parseSize('Llama-3.1-8B')).toEqual({ paramsB: 8, sizeLabel: '8B' });
  });

  it('does not treat versions as sizes', () => {
    expect(parseSize('Qwen2.5-Instruct')).toEqual({});
    expect(parseSize('Mistral-Small-3.2-24B-Instruct-2506').paramsB).toBe(24);
  });
});

describe('parseModelUri', () => {
  it('enriches Hugging Face URIs', () => {
    const info = parseModelUri('hf://meta-llama/Meta-Llama-3.1-8B-Instruct');
    expect(info).toMatchObject({
      scheme: 'hf',
      publisher: 'meta-llama',
      name: 'Meta-Llama-3.1-8B-Instruct',
      family: 'Llama-3.1',
      paramsB: 8,
      variant: 'Instruct',
    });
    expect(info.provider?.id).toBe('meta');
  });

  it('attributes re-quantized copies to the original family creator', () => {
    const info = parseModelUri('hf://RedHatAI/Qwen2.5-7B-Instruct-FP8-dynamic');
    expect(info.provider?.id).toBe('qwen');
    expect(info.publisher).toBe('RedHatAI');
    expect(info.quantization).toBe('FP8');
  });

  it('uses the served model name for PVC URIs', () => {
    const info = parseModelUri('pvc://gpt-oss-20b-pvc', 'RedHatAI/gpt-oss-20b');
    expect(info.name).toBe('gpt-oss-20b');
    expect(info.provider?.id).toBe('openai');
    expect(info.family).toBe('gpt-oss');
  });

  it('handles OCI tags and unknown models', () => {
    const info = parseModelUri('oci://registry.example.com/models/my-model:1.2');
    expect(info.name).toBe('my-model');
    expect(info.provider).toBeUndefined();
  });

  it('survives empty input', () => {
    expect(parseModelUri('').scheme).toBe('unknown');
  });
});

describe('formatParams', () => {
  it('formats billions and millions', () => {
    expect(formatParams(7)).toBe('7B');
    expect(formatParams(0.125)).toBe('125M');
    expect(formatParams(1.5)).toBe('1.5B');
    expect(formatParams(undefined)).toBe('');
  });
});
