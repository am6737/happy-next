import type { ClientSideConnection } from '@agentclientprotocol/sdk';
import type { Metadata } from '@/api/types';
import { mergeAcpSessionConfigIntoMetadata } from '@/agent/acp/sessionConfigMetadata';

export type AcpModel = NonNullable<Metadata['models']>[number] & {
  /** Reasoning efforts the model takes; absent when it has no effort control. */
  efforts?: NonNullable<Metadata['thoughtLevels']>;
  /** The effort the agent picks when the model is selected. */
  defaultEffort?: string;
};

/**
 * Lists the models an ACP agent offers, with the efforts each takes, through a
 * session opened for the purpose and never prompted. An agent only reports a
 * model's efforts once it is selected, and may reset the effort to the model's
 * own default on every switch, so each model is selected in turn.
 */
export async function listAcpModels(connection: ClientSideConnection, cwd: string): Promise<AcpModel[]> {
  const { sessionId, configOptions, models } = await connection.newSession({ cwd, mcpServers: [] });
  const listed = mergeAcpSessionConfigIntoMetadata({} as Metadata, { configOptions, models }).models ?? [];
  const result: AcpModel[] = [];
  for (const model of listed) {
    const selected = await connection.setSessionConfigOption({ sessionId, configId: 'model', value: model.code });
    const { thoughtLevels, currentThoughtLevelCode } = mergeAcpSessionConfigIntoMetadata({} as Metadata, { configOptions: selected.configOptions });
    result.push(thoughtLevels?.length ? { ...model, efforts: thoughtLevels, defaultEffort: currentThoughtLevelCode } : model);
  }
  return result;
}
