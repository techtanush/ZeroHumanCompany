import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadManifests, loadRouting, getManifest } from './index';

const promptRoot = resolve(process.cwd(), '../prompts');
const knownTools = new Set([
  'web_search','web_fetch','calc','memory_read','memory_write','apify.run_actor','solari.browse',
  'composio.gmail_send','stripe.create_payment_link','whop.create_checkout','dodo.create_checkout',
  'terac.post_requisition','elevenlabs.tts','render.deploy','replay.run_suite','linq.send_card',
  'band.publish','pioneer.classify','simpop.build_panel','simpop.poll',
  'leadgen.search','leadgen.enrich','crm.upsert','support.upsert_ticket','metrics.record_signal','github.push',
]);

function promptExists(ref: string) {
  return existsSync(resolve(promptRoot, ref.replace(/^prompts\//, '')));
}

describe('department manifests', () => {
  it('parses all 13 department manifests', () => {
    const manifests = loadManifests();
    expect(manifests).toHaveLength(13);
    expect(new Set(manifests.map((m) => m.id)).size).toBe(13);
    expect(getManifest('D03').name).toBe('Market Research');
  });

  it('references existing prompts and known tools', () => {
    const manifests = loadManifests();
    for (const manifest of manifests) {
      expect(promptExists(manifest.head.system_prompt_ref), manifest.head.system_prompt_ref).toBe(true);
      if (manifest.critic) expect(promptExists(manifest.critic.rubric_ref), manifest.critic.rubric_ref).toBe(true);
      for (const agent of [manifest.head, ...manifest.workers]) {
        expect(promptExists(agent.system_prompt_ref), agent.system_prompt_ref).toBe(true);
        for (const tool of agent.tools) expect(knownTools.has(tool), `${manifest.id} ${agent.agent_id} ${tool}`).toBe(true);
      }
    }
  });

  it('keeps every department staffed with at least 10 agents', () => {
    const manifests = loadManifests();
    for (const manifest of manifests) {
      const workerCount = manifest.workers.reduce((count, worker) => count + worker.replicas, 0);
      const totalAgents = 1 + (manifest.critic ? 1 : 0) + workerCount;
      expect(totalAgents, manifest.id).toBeGreaterThanOrEqual(10);
    }
  });
});

describe('routing table', () => {
  it('parses structured routing rules', () => {
    const routing = loadRouting();
    expect(routing).toHaveLength(9);
    expect(routing[0].when).toMatchObject({ event: 'ops.daily_briefing_started' });
    expect(routing[1].when).toMatchObject({ event: 'artifact.signed', artifact_type: 'SharpenedIdea' });
    expect(routing.some((rule) => rule.when.gate_type === 'niche_selection')).toBe(true);
    expect(routing.some((rule) => rule.id === 'daily_0700_to_executive_briefing')).toBe(true);
  });
});
