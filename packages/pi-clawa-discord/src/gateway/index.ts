import { GatewayRuntime } from './runtime.js';

export async function startGateway(): Promise<void> {
  await new GatewayRuntime().run();
}
