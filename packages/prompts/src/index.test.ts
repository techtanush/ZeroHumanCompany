import { describe, expect, it } from 'vitest';
import { renderPrompt } from './index';

describe('renderPrompt', () => {
  it('prepends shared preamble and substitutes placeholders', () => {
    const rendered = renderPrompt('prompts/D01/head.md', { venture_name: 'Acme' });
    expect(rendered).toContain('ZeroHumanCompany runs autonomous departments');
    expect(rendered).toContain('Every numeric claim');
    expect(rendered).toContain('Output contract');
    expect(rendered).toContain('Intake head');
    expect(rendered).not.toContain('{{venture_name}}');
  });

  it('throws for missing referenced files', () => {
    expect(() => renderPrompt('prompts/D99/missing.md')).toThrow(/Prompt file not found/);
  });
});
