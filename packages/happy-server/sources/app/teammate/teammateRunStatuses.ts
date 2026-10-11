export const TEAMMATE_IN_FLIGHT_RUN_STATUSES = ['dispatching', 'running'];
export const TEAMMATE_ACTIVE_RUN_STATUSES = ['queued', ...TEAMMATE_IN_FLIGHT_RUN_STATUSES];
// Reasons the owner already knows about: they cancelled, or the budget notice explains it.
export const SILENT_FAILURE_REASONS = ['cancelled_by_user', 'budget_exceeded'];
