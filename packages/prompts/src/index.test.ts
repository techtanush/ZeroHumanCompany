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

  it('encodes the D02 office-hours forcing loop', () => {
    const rendered = renderPrompt('prompts/D02/questioner.md');
    for (const lens of ['Demand reality', 'Status quo', 'Desperate specificity', 'Narrowest wedge', 'Observation and surprise', 'Future-fit']) {
      expect(rendered).toContain(lens);
    }
    expect(rendered).toContain('Ask one question at a time');
    expect(rendered).toContain('do not accept waitlists or compliments as proof');
  });

  it('makes the D02 critic reject generic founder-friendly output', () => {
    const rendered = renderPrompt('prompts/D02/critic-rubric.md');
    expect(rendered).toContain('Office-hours blockers');
    expect(rendered).toContain('all six forcing lenses');
    expect(rendered).toContain('Reject founder-friendly praise');
  });
});
