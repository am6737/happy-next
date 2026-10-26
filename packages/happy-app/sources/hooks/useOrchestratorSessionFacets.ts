// The machines and executor kinds one conversation's delegated runs used, for the run list's filter
// drawer opened from that conversation: the drawer offers only those, not every machine of the
// account. They are read from the conversation's runs with no other filter each time the screen
// comes into focus; runs the list fetches in between add theirs (`merge`), so one delegated after
// the scan shows its machine without waiting for the next. Without a conversation there is nothing
// to scan and the facets are undefined: the drawer offers everything.
import * as React from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { AuthCredentials } from '@/auth/tokenStorage';
import {
    collectOrchestratorRunFacets,
    listOrchestratorSessionRunFacets,
    mergeOrchestratorRunFacets,
    type OrchestratorRunDetail,
    type OrchestratorRunFacets,
} from '@/sync/apiOrchestrator';

const EMPTY_FACETS: OrchestratorRunFacets = { machineIds: [], kinds: [] };

export function useOrchestratorSessionFacets(
    credentials: AuthCredentials | null | undefined,
    controllerSessionId: string | undefined,
): { facets: OrchestratorRunFacets | undefined; merge: (runs: Array<Pick<OrchestratorRunDetail, 'machines' | 'providers'>>) => void; } {
    // A facet once seen stays: each scan and each fetched page only adds to it
    const [facets, setFacets] = React.useState<OrchestratorRunFacets>(EMPTY_FACETS);

    const merge = React.useCallback((runs: Array<Pick<OrchestratorRunDetail, 'machines' | 'providers'>>) => {
        if (!controllerSessionId) {
            return;
        }
        setFacets((previous) => mergeOrchestratorRunFacets(previous, collectOrchestratorRunFacets(runs)));
    }, [controllerSessionId]);

    useFocusEffect(React.useCallback(() => {
        if (!credentials || !controllerSessionId) {
            return;
        }
        let active = true;
        void listOrchestratorSessionRunFacets(credentials, controllerSessionId).then((scanned) => {
            if (active) {
                setFacets((previous) => mergeOrchestratorRunFacets(previous, scanned));
            }
        }).catch(() => {
            // The runs the list fetches still add theirs
        });
        return () => {
            active = false;
        };
    }, [credentials, controllerSessionId]));

    return { facets: controllerSessionId ? facets : undefined, merge };
}
