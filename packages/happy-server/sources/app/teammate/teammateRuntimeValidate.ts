import { isPermissionModeForAgent, type TeammateControllerProvider, type TeammateWorkerProvider } from 'happy-wire';
import { TeammateError } from './teammateError';

/** Each runtime role's permission mode must belong to that role's provider. */
export function teammateRuntimeValidate(config: {
    controllerProvider: TeammateControllerProvider; controllerPermissionMode: string;
    workerProvider: TeammateWorkerProvider; workerPermissionMode: string;
}): void {
    if (!isPermissionModeForAgent(config.controllerProvider, config.controllerPermissionMode)
        || !isPermissionModeForAgent(config.workerProvider, config.workerPermissionMode)) {
        throw new TeammateError('invalid_request');
    }
}
