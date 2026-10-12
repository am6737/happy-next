import { memo, type RefObject } from 'react';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import type { Machine } from '@/sync/storageTypes';
import { FolderPickerSheet } from '@/components/FolderPickerSheet';
import { NewTerminalSheet } from './NewTerminalSheet';

/** The questions asked before a new terminal starts, as `useTerminalWorkspace` keeps them. */
export interface TerminalNewSheetsState {
    machineSheetRef: RefObject<BottomSheetModal | null>;
    folderSheetRef: RefObject<BottomSheetModal | null>;
    folderRequest: { machineId: string; initialPath?: string } | null;
    lastUsedMachineId: string | undefined;
    machines: readonly Machine[];
    machineNameById: ReadonlyMap<string, string>;
    onMachinePicked: (machineId: string) => void;
    onMachineSheetDismissed: () => void;
    onDirectoryPicked: (cwd: string) => void;
}

/** Which machine, then which directory: the sheets a terminal surface asks with. */
export const TerminalNewSheets = memo(({ state }: { state: TerminalNewSheetsState }) => {
    const { folderRequest } = state;
    return (
        <>
            <NewTerminalSheet
                ref={state.machineSheetRef}
                lastUsedMachineId={state.lastUsedMachineId}
                machines={state.machines}
                names={state.machineNameById}
                onDismiss={state.onMachineSheetDismissed}
                onSelect={state.onMachinePicked}
            />
            {folderRequest ? (
                <FolderPickerSheet
                    ref={state.folderSheetRef}
                    homeDir={state.machines.find((machine) => machine.id === folderRequest.machineId)?.metadata?.homeDir}
                    initialPath={folderRequest.initialPath}
                    machineId={folderRequest.machineId}
                    onSelect={state.onDirectoryPicked}
                />
            ) : null}
        </>
    );
});
