import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { loadClawasConfig } from '@howaboua/pi-clawa/clawas/config-loader';
import { resolveClawaDefaults } from '@howaboua/pi-clawa/config';
import { config } from '../config.js';
import { getDiscordDeliveryBacklog } from '../db.js';
import { getClawasWorkerStatus } from './invoke-clawas-rpc.js';
import { getSessionFileStatus, type ChannelSessionStatus } from './session-status.js';

type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ClawaMappedStatus {
	workerId: string;
	title: string;
	model: string;
	thinking: ThinkingLevel | 'pi runtime default';
	cwd: string;
	runtime: 'idle' | 'busy' | 'offline';
	sessionStatus: ChannelSessionStatus;
	deliveryQueue: { pending: number; dead: number };
}

interface RegistryRecord {
	path?: string;
	model?: string;
	thinking?: ThinkingLevel;
	cwd?: string;
}

export async function getMappedClawaStatus(workerId: string): Promise<ClawaMappedStatus> {
	const clawasConfig = await loadClawasConfig(config.piCwd);
	const worker = clawasConfig?.workers.find((item) => item.id === workerId);
	if (!worker) {
		throw new Error(`Mapped Clawa worker is not configured: ${workerId}`);
	}

	const cwd = isAbsolute(worker.cwd) ? worker.cwd : resolve(config.piCwd, worker.cwd);
	const registryRecord = readWorkerRegistryRecord(workerId);
	const sessionFile = registryRecord?.path;
	const sessionStatus = sessionFile && existsSync(sessionFile)
		? await getSessionFileStatus(sessionFile)
		: { statsSource: 'none' as const };
	const runtime = await readWorkerRuntime(workerId);

	return {
		workerId,
		title: worker.title,
		model: worker.model ?? registryRecord?.model ?? 'pi runtime default',
		thinking: worker.thinking ?? registryRecord?.thinking ?? 'pi runtime default',
		cwd,
		runtime,
		sessionStatus,
		deliveryQueue: getDiscordDeliveryBacklog(),
	};
}

async function readWorkerRuntime(workerId: string): Promise<ClawaMappedStatus['runtime']> {
	try {
		const status = await getClawasWorkerStatus(workerId);
		return status.isIdle && !status.hasPendingMessages ? 'idle' : 'busy';
	} catch {
		return 'offline';
	}
}

function readWorkerRegistryRecord(workerId: string): RegistryRecord | undefined {
	const defaults = resolveClawaDefaults(config.piCwd);
	const registryPath = join(config.piCwd, '.pi', defaults.controlPlaneDir, 'session-registry.json');
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(registryPath, 'utf8'));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
		throw error;
	}

	if (!parsed || typeof parsed !== 'object') return undefined;
	const workers = (parsed as { workers?: unknown }).workers;
	if (!workers || typeof workers !== 'object') return undefined;
	const entry = (workers as Record<string, unknown>)[workerId];
	if (typeof entry === 'string') return { path: entry };
	if (!entry || typeof entry !== 'object') return undefined;
	return entry as RegistryRecord;
}
