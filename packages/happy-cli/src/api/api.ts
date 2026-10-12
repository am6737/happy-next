import axios from 'axios'
import { ChannelMessageSchema, TeammateChannelMessageSendRequestSchema, type ChannelMessage, type TeammateChannelMessageSendRequest, type PermissionMode, TeammateTaskAgentUpdateRequestSchema, TeammateTaskCommentRequestSchema, TeammateSessionRegisterRequestSchema, type TeammateTaskAgentUpdateRequest, type TeammateTaskCommentRequest, type TeammateSessionRegisterRequest, TeammateTaskSchema, TeammateTaskCommentResponseSchema, TeammateTaskCreateRequestSchema, TeammateTaskCreateResponseSchema, type TeammateTaskCreateRequest, TeammateActiveSessionsResponseSchema, type TeammateActiveSessionsResponse, type TeammateRunStartedRequest, type TeammateRunFinishedRequest, type TeammateContextEventRequest } from 'happy-wire'
import { logger } from '@/ui/logger'
import type { AgentState, CreateSessionResponse, Metadata, Session, Machine, MachineMetadata, DaemonState } from '@/api/types'
import { ApiSessionClient } from './apiSession';
import { ApiMachineClient } from './apiMachine';
import { decodeBase64, encodeBase64, encrypt, decrypt, libsodiumEncryptForPublicKey } from './encryption';
import { resolveSessionDataKey } from './sessionDataKey';
import { PushNotificationClient } from './pushNotifications';
import { configuration } from '@/configuration';
import chalk from 'chalk';
import { Credentials } from '@/persistence';
import { connectionState, isNetworkError } from '@/utils/serverConnectionErrors';


export class ApiClient {

  static async create(credential: Credentials) {
    return new ApiClient(credential);
  }

  private readonly credential: Credentials;
  private readonly pushClient: PushNotificationClient;

  private constructor(credential: Credentials) {
    this.credential = credential
    this.pushClient = new PushNotificationClient(credential.token, configuration.serverUrl)
  }

  /**
   * Create a new session or load existing one with the given tag
   */
  async getOrCreateSession(opts: {
    tag: string,
    metadata: Metadata,
    state: AgentState | null
  }): Promise<Session | null> {

    // Resolve encryption key
    let dataEncryptionKey: Uint8Array | null = null;
    let encryptionKey: Uint8Array;
    let encryptionVariant: 'legacy' | 'dataKey';
    if (this.credential.encryption.type === 'dataKey') {

      // Use the daemon-provided session key when present, otherwise generate one.
      encryptionKey = await resolveSessionDataKey();
      encryptionVariant = 'dataKey';

      // Derive and encrypt data encryption key
      // const contentDataKey = await deriveKey(this.secret, 'Happy EnCoder', ['content']);
      // const publicKey = libsodiumPublicKeyFromSecretKey(contentDataKey);
      let encryptedDataKey = libsodiumEncryptForPublicKey(encryptionKey, this.credential.encryption.publicKey);
      dataEncryptionKey = new Uint8Array(encryptedDataKey.length + 1);
      dataEncryptionKey.set([0], 0); // Version byte
      dataEncryptionKey.set(encryptedDataKey, 1); // Data key
    } else {
      encryptionKey = this.credential.encryption.secret;
      encryptionVariant = 'legacy';
    }

    // Create session
    try {
      const response = await axios.post<CreateSessionResponse>(
        `${configuration.serverUrl}/v1/sessions`,
        {
          tag: opts.tag,
          metadata: encodeBase64(encrypt(encryptionKey, encryptionVariant, opts.metadata)),
          agentState: opts.state ? encodeBase64(encrypt(encryptionKey, encryptionVariant, opts.state)) : null,
          dataEncryptionKey: dataEncryptionKey ? encodeBase64(dataEncryptionKey) : null,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.credential.token}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000 // 1 minute timeout for very bad network connections
        }
      )

      logger.debug(`Session created/loaded: ${response.data.session.id} (tag: ${opts.tag})`)
      let raw = response.data.session;
      let session: Session = {
        id: raw.id,
        seq: raw.seq,
        metadata: decrypt(encryptionKey, encryptionVariant, decodeBase64(raw.metadata)),
        metadataVersion: raw.metadataVersion,
        agentState: raw.agentState ? decrypt(encryptionKey, encryptionVariant, decodeBase64(raw.agentState)) : null,
        agentStateVersion: raw.agentStateVersion,
        encryptionKey: encryptionKey,
        encryptionVariant: encryptionVariant
      }
      return session;
    } catch (error) {
      logger.debug('[API] [ERROR] Failed to get or create session:', error);

      // Check if it's a connection error
      if (error && typeof error === 'object' && 'code' in error) {
        const errorCode = (error as any).code;
        if (isNetworkError(errorCode)) {
          connectionState.fail({
            operation: 'Session creation',
            caller: 'api.getOrCreateSession',
            errorCode,
            url: `${configuration.serverUrl}/v1/sessions`
          });
          return null;
        }
      }

      // Handle 404 gracefully - server endpoint may not be available yet
      const is404Error = (
        (axios.isAxiosError(error) && error.response?.status === 404) ||
        (error && typeof error === 'object' && 'response' in error && (error as any).response?.status === 404)
      );
      if (is404Error) {
        connectionState.fail({
          operation: 'Session creation',
          errorCode: '404',
          url: `${configuration.serverUrl}/v1/sessions`
        });
        return null;
      }

      // Handle 5xx server errors - use offline mode with auto-reconnect
      if (axios.isAxiosError(error) && error.response?.status) {
        const status = error.response.status;
        if (status >= 500) {
          connectionState.fail({
            operation: 'Session creation',
            errorCode: String(status),
            url: `${configuration.serverUrl}/v1/sessions`,
            details: ['Server encountered an error, will retry automatically']
          });
          return null;
        }
      }

      throw new Error(`Failed to get or create session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Register or update machine with the server
   * Returns the current machine state from the server with decrypted metadata and daemonState
   */
  async getOrCreateMachine(opts: {
    machineId: string,
    metadata: MachineMetadata,
    daemonState?: DaemonState,
  }): Promise<Machine> {

    // Resolve encryption key
    let dataEncryptionKey: Uint8Array | null = null;
    let encryptionKey: Uint8Array;
    let encryptionVariant: 'legacy' | 'dataKey';
    if (this.credential.encryption.type === 'dataKey') {
      // Encrypt data encryption key
      encryptionVariant = 'dataKey';
      encryptionKey = this.credential.encryption.machineKey;
      let encryptedDataKey = libsodiumEncryptForPublicKey(this.credential.encryption.machineKey, this.credential.encryption.publicKey);
      dataEncryptionKey = new Uint8Array(encryptedDataKey.length + 1);
      dataEncryptionKey.set([0], 0); // Version byte
      dataEncryptionKey.set(encryptedDataKey, 1); // Data key
    } else {
      // Legacy encryption
      encryptionKey = this.credential.encryption.secret;
      encryptionVariant = 'legacy';
    }

    // Helper to create minimal machine object for offline mode (DRY)
    const createMinimalMachine = (): Machine => ({
      id: opts.machineId,
      encryptionKey: encryptionKey,
      encryptionVariant: encryptionVariant,
      metadata: opts.metadata,
      metadataVersion: 0,
      daemonState: opts.daemonState || null,
      daemonStateVersion: 0,
    });

    // Create machine
    try {
      const response = await axios.post(
        `${configuration.serverUrl}/v1/machines`,
        {
          id: opts.machineId,
          metadata: encodeBase64(encrypt(encryptionKey, encryptionVariant, opts.metadata)),
          daemonState: opts.daemonState ? encodeBase64(encrypt(encryptionKey, encryptionVariant, opts.daemonState)) : undefined,
          dataEncryptionKey: dataEncryptionKey ? encodeBase64(dataEncryptionKey) : undefined
        },
        {
          headers: {
            'Authorization': `Bearer ${this.credential.token}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000 // 1 minute timeout for very bad network connections
        }
      );


      const raw = response.data.machine;
      logger.debug(`[API] Machine ${opts.machineId} registered/updated with server`);

      // Return decrypted machine like we do for sessions
      const machine: Machine = {
        id: raw.id,
        encryptionKey: encryptionKey,
        encryptionVariant: encryptionVariant,
        metadata: raw.metadata ? decrypt(encryptionKey, encryptionVariant, decodeBase64(raw.metadata)) : null,
        metadataVersion: raw.metadataVersion || 0,
        daemonState: raw.daemonState ? decrypt(encryptionKey, encryptionVariant, decodeBase64(raw.daemonState)) : null,
        daemonStateVersion: raw.daemonStateVersion || 0,
      };
      return machine;
    } catch (error) {
      // Handle connection errors gracefully
      if (axios.isAxiosError(error) && error.code && isNetworkError(error.code)) {
        connectionState.fail({
          operation: 'Machine registration',
          caller: 'api.getOrCreateMachine',
          errorCode: error.code,
          url: `${configuration.serverUrl}/v1/machines`
        });
        return createMinimalMachine();
      }

      // Handle 403/409 - server rejected request due to authorization conflict
      // This is NOT "server unreachable" - server responded, so don't use connectionState
      if (axios.isAxiosError(error) && error.response?.status) {
        const status = error.response.status;

        if (status === 403 || status === 409) {
          // Re-auth conflict: machine registered to old account, re-association not allowed
          console.log(chalk.yellow(
            `⚠️  Machine registration rejected by the server with status ${status}`
          ));
          console.log(chalk.yellow(
            `   → This machine ID is already registered to another account on the server`
          ));
          console.log(chalk.yellow(
            `   → This usually happens after re-authenticating with a different account`
          ));
          console.log(chalk.yellow(
            `   → Run 'happy doctor clean' to reset local state and generate a new machine ID`
          ));
          console.log(chalk.yellow(
            `   → Open a GitHub issue if this problem persists`
          ));
          return createMinimalMachine();
        }

        // Handle 5xx - server error, use offline mode with auto-reconnect
        if (status >= 500) {
          connectionState.fail({
            operation: 'Machine registration',
            errorCode: String(status),
            url: `${configuration.serverUrl}/v1/machines`,
            details: ['Server encountered an error, will retry automatically']
          });
          return createMinimalMachine();
        }

        // Handle 404 - endpoint may not be available yet
        if (status === 404) {
          connectionState.fail({
            operation: 'Machine registration',
            errorCode: '404',
            url: `${configuration.serverUrl}/v1/machines`
          });
          return createMinimalMachine();
        }
      }

      // For other errors, rethrow
      throw error;
    }
  }

  sessionSyncClient(session: Session): ApiSessionClient {
    return new ApiSessionClient(this.credential.token, session);
  }

  machineSyncClient(machine: Machine): ApiMachineClient {
    return new ApiMachineClient(this.credential.token, machine);
  }

  push(): PushNotificationClient {
    return this.pushClient;
  }

  async reportTeammateRunStarted(runId: string, request: TeammateRunStartedRequest): Promise<void> {
    await axios.post(`${configuration.serverUrl}/v1/teammate-runs/${encodeURIComponent(runId)}/started`, request, {
      headers: { Authorization: `Bearer ${this.credential.token}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
  }

  async reportTeammateRunFinished(runId: string, request: TeammateRunFinishedRequest): Promise<void> {
    await axios.post(`${configuration.serverUrl}/v1/teammate-runs/${encodeURIComponent(runId)}/finished`, request, {
      headers: { Authorization: `Bearer ${this.credential.token}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
  }

  async reportTeammateContextEvent(runId: string, request: TeammateContextEventRequest): Promise<void> {
    await axios.post(`${configuration.serverUrl}/v1/teammate-runs/${encodeURIComponent(runId)}/context-event`, request, {
      headers: { Authorization: `Bearer ${this.credential.token}`, 'Content-Type': 'application/json' }, timeout: 30000,
    });
  }

  async getTeammateActiveSessions(machineId: string): Promise<TeammateActiveSessionsResponse> {
    const response = await axios.get(`${configuration.serverUrl}/v1/teammate-runtime/active-sessions`, {
      params: { machineId }, headers: { Authorization: `Bearer ${this.credential.token}` }, timeout: 30000,
    });
    return TeammateActiveSessionsResponseSchema.parse(response.data);
  }

  async getChannelMessages(channelId: string, query: { afterSeq?: number; beforeSeq?: number; limit?: number } = {}): Promise<ChannelMessage[]> {
    const response = await axios.get(`${configuration.serverUrl}/v1/channels/${encodeURIComponent(channelId)}/messages`, {
      params: query, headers: { Authorization: `Bearer ${this.credential.token}` }, timeout: 30000,
    });
    return ChannelMessageSchema.array().parse(response.data.messages);
  }

  async sendTeammateChannelMessage(request: TeammateChannelMessageSendRequest): Promise<ChannelMessage> {
    const response = await axios.post(`${configuration.serverUrl}/v1/teammate-channel-messages`,
      TeammateChannelMessageSendRequestSchema.parse(request), {
        headers: { Authorization: `Bearer ${this.credential.token}`, 'Content-Type': 'application/json' }, timeout: 30000,
      });
    return ChannelMessageSchema.parse(response.data.message);
  }

  async getGithubToken(): Promise<string> {
    const response = await axios.get(`${configuration.serverUrl}/v1/connect/github/token`, {
      headers: { Authorization: `Bearer ${this.credential.token}` }, timeout: 30000,
    });
    if (typeof response.data.token !== 'string' || !response.data.token) throw new Error('Invalid GitHub token response');
    return response.data.token;
  }

  async registerTeammateSession(request: TeammateSessionRegisterRequest): Promise<void> {
    await axios.post(`${configuration.serverUrl}/v1/teammate-sessions`, TeammateSessionRegisterRequestSchema.parse(request), {
      headers: { Authorization: `Bearer ${this.credential.token}` }, timeout: 30000,
    });
  }

  async updateTeammateTask(request: TeammateTaskAgentUpdateRequest) {
    const response = await axios.post(`${configuration.serverUrl}/v1/teammate-task-updates`, TeammateTaskAgentUpdateRequestSchema.parse(request), {
      headers: { Authorization: `Bearer ${this.credential.token}` }, timeout: 30000,
    });
    return { task: TeammateTaskSchema.parse(response.data.task) };
  }

  async commentTeammateTask(request: TeammateTaskCommentRequest) {
    const response = await axios.post(`${configuration.serverUrl}/v1/teammate-task-comments`, TeammateTaskCommentRequestSchema.parse(request), {
      headers: { Authorization: `Bearer ${this.credential.token}` }, timeout: 30000,
    });
    return TeammateTaskCommentResponseSchema.parse(response.data);
  }

  async createTeammateTask(request: TeammateTaskCreateRequest) {
    const response = await axios.post(`${configuration.serverUrl}/v1/teammate-agent-tasks`, TeammateTaskCreateRequestSchema.parse(request), {
      headers: { Authorization: `Bearer ${this.credential.token}` }, timeout: 30000,
    });
    return TeammateTaskCreateResponseSchema.parse(response.data);
  }

  async getSessionMessages(sessionId: string, limit = 40): Promise<{ messages: { seq: number; content: { t: 'encrypted'; c: string } }[]; busy?: boolean }> {
    const response = await axios.get(`${configuration.serverUrl}/v3/sessions/${encodeURIComponent(sessionId)}/messages`, {
      params: { limit }, headers: { Authorization: `Bearer ${this.credential.token}` }, timeout: 30000,
    });
    if (!Array.isArray(response.data.messages)) throw new Error('Invalid session messages response');
    return response.data;
  }

  /**
   * Same user text record and dataKey encryption as the app's send-or-queue path.
   * sentFrom must not be 'cli': the receiving session drops 'cli' user messages as its own echoes.
   */
  async sendSessionMessage(sessionId: string, text: string, key: Uint8Array, localId: string, permissionMode: PermissionMode = 'default', model: string | null = null, reasoningEffort: string | null = null): Promise<'sent' | 'queued'> {
    const content = encodeBase64(encrypt(key, 'dataKey', {
      role: 'user', content: { type: 'text', text },
      meta: { sentFrom: 'teammate', permissionMode, model, reasoningEffort, fallbackModel: null },
    }));
    const response = await axios.post(`${configuration.serverUrl}/v3/sessions/${encodeURIComponent(sessionId)}/send`,
      { localId, content }, {
        headers: { Authorization: `Bearer ${this.credential.token}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      });
    const mode: unknown = response.data.mode;
    if (mode !== 'sent' && mode !== 'queued') throw new Error('Invalid session message delivery mode');
    return mode;
  }

  /**
   * Report orchestrator execution start (daemon -> server)
   */
  async reportOrchestratorExecutionStart(opts: {
    executionId: string;
    dispatchToken: string;
    startedAt: string;
    pid?: number;
  }): Promise<void> {
    await axios.post(
      `${configuration.serverUrl}/v1/orchestrator/executions/${opts.executionId}/start`,
      {
        dispatchToken: opts.dispatchToken,
        startedAt: opts.startedAt,
        ...(typeof opts.pid === 'number' ? { pid: opts.pid } : {}),
      },
      {
        headers: {
          'Authorization': `Bearer ${this.credential.token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000,
      }
    );
  }

  /**
   * Report the provider session id of a running orchestrator execution as soon as it is known
   * (daemon -> server), so clients can follow the conversation before the execution finishes.
   */
  async reportOrchestratorExecutionChildSession(opts: {
    executionId: string;
    dispatchToken: string;
    childSessionId: string;
  }): Promise<void> {
    await axios.post(
      `${configuration.serverUrl}/v1/orchestrator/executions/${opts.executionId}/child-session`,
      {
        dispatchToken: opts.dispatchToken,
        childSessionId: opts.childSessionId,
      },
      {
        headers: {
          'Authorization': `Bearer ${this.credential.token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000,
      }
    );
  }

  /**
   * Report orchestrator execution finish (daemon -> server)
   */
  async reportOrchestratorExecutionFinish(opts: {
    executionId: string;
    dispatchToken: string;
    status: 'completed' | 'failed' | 'cancelled' | 'timeout';
    finishedAt: string;
    childSessionId?: string | null;
    exitCode?: number | null;
    signal?: string | null;
    outputSummary?: string | null;
    outputText?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): Promise<void> {
    await axios.post(
      `${configuration.serverUrl}/v1/orchestrator/executions/${opts.executionId}/finish`,
      {
        dispatchToken: opts.dispatchToken,
        status: opts.status,
        finishedAt: opts.finishedAt,
        ...(opts.childSessionId !== undefined ? { childSessionId: opts.childSessionId } : {}),
        ...(opts.exitCode !== undefined ? { exitCode: opts.exitCode } : {}),
        ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
        ...(opts.outputSummary !== undefined ? { outputSummary: opts.outputSummary } : {}),
        ...(opts.outputText !== undefined ? { outputText: opts.outputText } : {}),
        ...(opts.errorCode !== undefined ? { errorCode: opts.errorCode } : {}),
        ...(opts.errorMessage !== undefined ? { errorMessage: opts.errorMessage } : {}),
      },
      {
        headers: {
          'Authorization': `Bearer ${this.credential.token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000,
      }
    );
  }

  /**
   * Register a vendor API token with the server
   * The token is sent as a JSON string - server handles encryption
   */
  async registerVendorToken(vendor: 'openai' | 'anthropic' | 'gemini', apiKey: any): Promise<void> {
    try {
      const response = await axios.post(
        `${configuration.serverUrl}/v1/connect/${vendor}/register`,
        {
          token: JSON.stringify(apiKey)
        },
        {
          headers: {
            'Authorization': `Bearer ${this.credential.token}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );

      if (response.status !== 200 && response.status !== 201) {
        throw new Error(`Server returned status ${response.status}`);
      }

      logger.debug(`[API] Vendor token for ${vendor} registered successfully`);
    } catch (error) {
      logger.debug(`[API] [ERROR] Failed to register vendor token:`, error);
      throw new Error(`Failed to register vendor token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get vendor API token from the server
   * Returns the token if it exists, null otherwise
   */
  async getVendorToken(vendor: 'openai' | 'anthropic' | 'gemini'): Promise<any | null> {
    try {
      const response = await axios.get(
        `${configuration.serverUrl}/v1/connect/${vendor}/token`,
        {
          headers: {
            'Authorization': `Bearer ${this.credential.token}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );

      if (response.status === 404) {
        logger.debug(`[API] No vendor token found for ${vendor}`);
        return null;
      }

      if (response.status !== 200) {
        throw new Error(`Server returned status ${response.status}`);
      }

      // Log raw response for debugging
      logger.debug(`[API] Raw vendor token response:`, {
        status: response.status,
        dataKeys: Object.keys(response.data || {}),
        hasToken: 'token' in (response.data || {}),
        tokenType: typeof response.data?.token,
      });

      // Token is returned as JSON string, parse it
      let tokenData: any = null;
      if (response.data?.token) {
        if (typeof response.data.token === 'string') {
          try {
            tokenData = JSON.parse(response.data.token);
          } catch (parseError) {
            logger.debug(`[API] Failed to parse token as JSON, using as string:`, parseError);
            tokenData = response.data.token;
          }
        } else if (response.data.token !== null) {
          // Token exists and is not null
          tokenData = response.data.token;
        } else {
          // Token is explicitly null - treat as not found
          logger.debug(`[API] Token is null for ${vendor}, treating as not found`);
          return null;
        }
      } else if (response.data && typeof response.data === 'object') {
        // Maybe the token is directly in response.data
        // But check if it's { token: null } - treat as not found
        if (response.data.token === null && Object.keys(response.data).length === 1) {
          logger.debug(`[API] Response contains only null token for ${vendor}, treating as not found`);
          return null;
        }
        tokenData = response.data;
      }
      
      // Final check: if tokenData is null or { token: null }, return null
      if (tokenData === null || (tokenData && typeof tokenData === 'object' && tokenData.token === null && Object.keys(tokenData).length === 1)) {
        logger.debug(`[API] Token data is null for ${vendor}`);
        return null;
      }
      
      logger.debug(`[API] Vendor token for ${vendor} retrieved successfully`, {
        tokenDataType: typeof tokenData,
        tokenDataKeys: tokenData && typeof tokenData === 'object' ? Object.keys(tokenData) : 'not an object',
      });
      return tokenData;
    } catch (error: any) {
      if (error.response?.status === 404) {
        logger.debug(`[API] No vendor token found for ${vendor}`);
        return null;
      }
      logger.debug(`[API] [ERROR] Failed to get vendor token:`, error);
      return null;
    }
  }
}
