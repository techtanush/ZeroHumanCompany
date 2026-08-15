/** The HQ floor plan (rooms) and how rooms map onto the 13 kernel departments. */

export interface Room { id: string; name: string; color: string; props: string[]; depts: string[]; short: string }

export const ROOMS: Room[] = [
  { id: 'research', name: 'Research & Product', color: '#4fb3a6', props: ['Idea Wall', 'Research Shelf', 'Sketch Table'], depts: ['D01', 'D02', 'D03'], short: 'RESEARCH' },
  { id: 'outreach', name: 'Outreach & Customer Validation', color: '#3f72c6', props: ['Call Booth', 'Calendar Board', 'Message Screens'], depts: ['D04', 'D05'], short: 'OUTREACH' },
  { id: 'engineering', name: 'Engineering & Build', color: '#8a5fbf', props: ['Server Rack', 'Code Review Board', 'Deploy Lights'], depts: ['D07'], short: 'ENGINEERING' },
  { id: 'strategy', name: 'Strategy & Growth', color: '#caa23c', props: ['Sticky Wall', 'Growth Charts', 'Campaign Board'], depts: ['D06', 'D08'], short: 'STRATEGY' },
  { id: 'leadintel', name: 'Lead Intelligence', color: '#cf6aa0', props: ['Data Wall', 'Network Graph', 'Prospect Table'], depts: ['D09'], short: 'LEAD INTEL' },
  { id: 'sales', name: 'Sales', color: '#c64f3f', props: ['Deal Bell', 'Pipeline Wall', 'Demo Screen'], depts: ['D10'], short: 'SALES' },
  { id: 'finance', name: 'Finance & Treasury', color: '#46a35a', props: ['Ledger Shelf', 'Secure Cabinet', 'Finance Table'], depts: ['D11'], short: 'FINANCE' },
  { id: 'hr', name: 'People & Terac Hiring', color: '#d0823f', props: ['Org Chart', 'Terac Requisitions', 'Welcome Lounge'], depts: ['D11'], short: 'PEOPLE' },
  { id: 'recruitment', name: 'Chief of Staff', color: '#6c7a99', props: ['Gap Board', 'Manifest Forge', 'Dispatch Table'], depts: ['D13'], short: 'COS' },
  { id: 'support', name: 'Customer Support & Retention', color: '#3fb5b0', props: ['Ticket Queue', 'Knowledge Wall', 'Feedback Board'], depts: ['D12'], short: 'SUPPORT' },
  { id: 'improvement', name: 'Improvement Branch', color: '#7a5fd0', props: ['Test Bench', 'Performance Screen', 'Upgrade Station'], depts: ['D13'], short: 'IMPROVE' },
];
export const EXEC: Room = { id: 'exec', name: 'Central Executive Meeting Room', color: '#E66A2C', props: [], depts: ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10', 'D11', 'D12', 'D13'], short: 'EXEC' };
export const ROOM_BY_ID: Record<string, Room> = Object.fromEntries([...ROOMS, EXEC].map((r) => [r.id, r]));

export const FLOOR_LAYOUT: string[][] = [
  ['exec'],
  ['strategy', 'leadintel', 'sales'],
  ['research', 'outreach', 'engineering'],
  ['finance', 'hr', 'recruitment'],
  ['support', 'improvement', 'LOBBY'],
];

export const DEPT_NAMES: Record<string, string> = {
  D01: 'Intake', D02: 'Office Hours', D03: 'Market Research', D04: 'Outreach & Validation', D05: 'Synthetic Population',
  D06: 'Pivot & Decision', D07: 'Build', D08: 'Strategy', D09: 'Leads', D10: 'Sales', D11: 'Finance & HR', D12: 'Support', D13: 'Chief of Staff',
};

/** Where a kernel department id lives on the floor plan (first matching room). */
export function roomForDept(dept: string): Room | undefined {
  return ROOMS.find((r) => r.depts.includes(dept));
}

/** "build.frontend-engineer" → "Frontend Engineer" */
export function humanizeAgent(agent_id: string): { name: string; role: string } {
  const [prefix, ...rest] = agent_id.split('.');
  const role = (rest.join('.') || prefix).replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { name: role, role: `${prefix} · ${role}` };
}
