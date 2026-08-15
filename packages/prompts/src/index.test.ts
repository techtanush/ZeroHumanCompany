import { describe, expect, it } from 'vitest';
import { renderPrompt } from './index';

describe('renderPrompt', () => {
  it('prepends shared preamble and substitutes placeholders', () => {
    const rendered = renderPrompt('prompts/D01/head.md', { venture_name: 'Acme' });
    expect(rendered).toContain('ZeroHumanCompany runs autonomous departments');
    expect(rendered).toContain('Every numeric claim');
    expect(rendered).toContain('Execution playbook');
    expect(rendered).toContain('Department execution matrix');
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

  it('gives every agent concrete department execution rules', () => {
    const rendered = renderPrompt('prompts/D11/head.md');
    expect(rendered).toContain('D09 Leads: mine communities and firmographics');
    expect(rendered).toContain('D11 Finance and HR: reconcile Stripe/Whop/Dodo revenue');
    expect(rendered).toContain('post Terac requisitions');
    expect(rendered).toContain('If a useful API key is missing, use the mock/fallback path');
  });

  it('keeps late-stage department heads executable', () => {
    expect(renderPrompt('prompts/D09/head.md')).toContain('Use leadgen.search for account/person discovery');
    expect(renderPrompt('prompts/D09/head.md')).toContain('leadgen.enrich for contact data');
    expect(renderPrompt('prompts/D10/head.md')).toContain('Use crm.upsert');
    expect(renderPrompt('prompts/D11/head.md')).toContain('Use terac.post_requisition only when a scoped human task has acceptance criteria');
    expect(renderPrompt('prompts/D13/head.md')).toContain('Validate any DepartmentManifestArtifact against schema');
  });

  it('keeps D07 build execution concrete and gated', () => {
    const head = renderPrompt('prompts/D07/head.md');
    expect(head).toContain('Use GitHub only after code review evidence is clean');
    expect(head).toContain('Use Render only after the deploy gate is approved');
    expect(head).toContain('Replay suite id');
    expect(head).toContain('workstream_results');

    expect(renderPrompt('prompts/D07/devops-engineer.md')).toContain('Do not call render.deploy until the deploy gate is approved');
    expect(renderPrompt('prompts/D07/qa.md')).toContain('Block GitHub push or Render deploy');
    expect(renderPrompt('prompts/D07/security-reviewer.md')).toContain('Block Render deploy');
    expect(renderPrompt('prompts/D07/critic-rubric.md')).toContain('D07 blockers');
  });
});
