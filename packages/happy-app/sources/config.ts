import { loadAppConfig } from "./sync/appConfig";
import { initServerConfig } from "./sync/serverConfig";
import { initVoiceConfig } from "./sync/voiceConfig";

export const config = loadAppConfig();
initServerConfig(config);
initVoiceConfig(config);
