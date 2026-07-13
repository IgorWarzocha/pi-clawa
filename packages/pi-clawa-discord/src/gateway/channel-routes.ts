import { parseJsonc } from '@howaboua/pi-clawa/jsonc';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import { getAllChannels, getChannel } from './db.js';
import type { RegisteredChannel } from './types.js';

export interface DiscordRoute {
  channel: string;
  worker: string;
}

export interface DiscordRoutesFile {
  routes: DiscordRoute[];
}

export function ensureDiscordRoutesFile(): void {
  if (existsSync(config.routesPath)) return;
  mkdirSync(dirname(config.routesPath), { recursive: true });
  writeFileSync(
    config.routesPath,
    [
      '{',
      '  // Route Discord channels/DMs to Clawa workers.',
      '  // The gateway resolves names to Discord ids; Clawas should edit names, not ids.',
      '  "routes": [',
      '    { "channel": "dm", "worker": "discord-clawa" }',
      '  ]',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
}

export function readDiscordRoutes(): DiscordRoute[] {
  ensureDiscordRoutesFile();
  const value = parseJsonc(readFileSync(config.routesPath, 'utf8'));
  const root = asRecord(value, 'Discord routes file');
  const routes = root['routes'];
  if (!Array.isArray(routes)) throw new Error('Discord routes file must contain a routes array');
  return routes.map((entry, index) => parseDiscordRoute(entry, index));
}

export function resolveClawaWorkerForDiscordChannel(jid: string): string | undefined {
  const channel = getChannel(jid);
  if (!channel) return undefined;
  for (const route of readDiscordRoutes()) {
    if (channelMatchesRoute(channel, route.channel)) return route.worker;
  }
  return undefined;
}

export function isRegisteredDiscordDm(jid: string): boolean {
  return getChannel(jid)?.name.toLowerCase().startsWith('dm:') === true;
}

export function resolveRoutedDiscordChannel(label: string, workerId?: string | undefined): string | undefined {
  const normalized = normalizeRouteLabel(label);
  if (!normalized) return undefined;
  const routes = readDiscordRoutes().filter((route) => {
    if (workerId && route.worker !== workerId) return false;
    return normalizeRouteLabel(route.channel) === normalized;
  });
  if (routes.length !== 1) return undefined;
  return resolveRegisteredChannel(routes[0]?.channel ?? '');
}

export function listDiscordRouteTags(workerId?: string | undefined): string[] {
  const tags = readDiscordRoutes()
    .filter((route) => !workerId || route.worker === workerId)
    .map((route) => normalizeRouteLabel(route.channel))
    .filter(Boolean)
    .map((route) => (route === 'dm' ? '[dm]' : `[${route}]`));

  return Array.from(new Set([...tags, '[main_clawa]', '[quiet]']));
}

export function listDiscordRouteWorkers(): string[] {
  return Array.from(new Set(readDiscordRoutes().map((route) => route.worker).filter(Boolean)));
}

function parseDiscordRoute(value: unknown, index: number): DiscordRoute {
  const route = asRecord(value, `Discord route ${index + 1}`);
  const channel = asString(route['channel'], `Discord route ${index + 1} channel`);
  const worker = asString(route['worker'], `Discord route ${index + 1} worker`);
  const normalized = normalizeRouteLabel(channel);
  if (!normalized) throw new Error(`Discord route ${index + 1} channel is empty`);
  if (!worker.trim()) throw new Error(`Discord route ${index + 1} worker is empty`);
  return { channel: normalized, worker: worker.trim() };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return value.trim();
}

function resolveRegisteredChannel(label: string): string | undefined {
  const matches = getAllChannels().filter((channel) => channelMatchesRoute(channel, label));
  return matches.length === 1 ? matches[0]?.jid : undefined;
}

function channelMatchesRoute(channel: RegisteredChannel, routeLabel: string): boolean {
  const label = normalizeRouteLabel(routeLabel);
  if (!label) return false;
  if (label === 'dm') return channel.name.toLowerCase().startsWith('dm:');
  return channelLabel(channel) === label;
}

function channelLabel(channel: RegisteredChannel): string {
  const name = channel.name.trim();
  const hashIndex = name.lastIndexOf('#');
  if (hashIndex !== -1) return normalizeRouteLabel(name.slice(hashIndex));
  return normalizeRouteLabel(`#${channel.jid.replace(/^dc:/, '')}`);
}

function normalizeRouteLabel(input: string): string {
  const value = input.trim().toLowerCase();
  if (!value) return '';
  if (value === 'dm') return 'dm';
  return value.startsWith('#') ? value : `#${value}`;
}
