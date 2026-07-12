/**
 * Tool Gate
 * Per-tool allow/deny filtering, applied at tool registration and to
 * operations nested inside batch_execute and run_workflow
 */

export type ToolGate = (toolName: string) => boolean;

/**
 * Build a gate from allow/deny lists.
 * - Deny always wins over allow.
 * - A non-empty allow list means "only these tools"; an empty or absent
 *   allow list permits everything not denied.
 */
export function createToolGate(allow?: string[], deny?: string[]): ToolGate {
  const allowSet = allow && allow.length > 0 ? new Set(allow) : null;
  const denySet = new Set(deny ?? []);

  return (toolName: string): boolean => {
    if (denySet.has(toolName)) return false;
    if (allowSet && !allowSet.has(toolName)) return false;
    return true;
  };
}
