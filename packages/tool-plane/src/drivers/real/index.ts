import * as apify from './apify.js';
import * as band from './band.js';
import * as business from './business.js';
import * as composio from './composio.js';
import * as dodo from './dodo.js';
import * as elevenlabs from './elevenlabs.js';
import * as github from './github.js';
import * as linq from './linq.js';
import * as pioneer from './pioneer.js';
import * as render from './render.js';
import * as replay from './replay.js';
import * as simpop from './simpop.js';
import * as solari from './solari.js';
import * as stripe from './stripe.js';
import * as terac from './terac.js';
import * as whop from './whop.js';

interface RealModule { run(args: unknown): Promise<unknown>; hasKey(): boolean }
const modules: Record<string, RealModule> = { apify, band, composio, dodo, elevenlabs, github, linq, pioneer, render, replay, simpop, solari, stripe, terac, whop };
const vendorByTool: Record<string, string> = { 'stripe.create_payment_link':'stripe','render.deploy':'render','elevenlabs.tts':'elevenlabs','composio.gmail_send':'composio','linq.send_card':'linq','terac.post_requisition':'terac','whop.create_checkout':'whop','dodo.create_checkout':'dodo','apify.run_actor':'apify','solari.browse':'solari','replay.run_suite':'replay','band.publish':'band','github.push':'github','pioneer.classify':'pioneer','simpop.build_panel':'simpop','simpop.poll':'simpop','leadgen.search':'business','leadgen.enrich':'business','crm.upsert':'business','support.upsert_ticket':'business','metrics.record_signal':'business' };
export async function runRealTool(tool_name: string, args: unknown, degraded: (reason: string) => void, fallback: () => Promise<unknown>): Promise<unknown> { const vendor = vendorByTool[tool_name]; if (vendor === 'business') { if (!business.hasKey()) { degraded('missing business tools url'); return fallback(); } return business.runTool(tool_name, args); } const mod = vendor ? modules[vendor] : undefined; if (!mod) return fallback(); if (!mod.hasKey()) { degraded(`missing ${vendor} api key`); return fallback(); } return mod.run(args); }
