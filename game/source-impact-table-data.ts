/** The staged original bullet-impact table, as this build ships it.
 *
 * Kept apart from the rules in `source-impact-table.ts` so the Node server can share the
 * rules without importing JSON (Node ESM needs an import attribute for that). The same
 * bytes are also served from the web root for the server to read; a test asserts the two
 * copies are identical, so there is one source of truth and two delivery paths.
 */
import raw from './source-impact-table.json';

export const SOURCE_IMPACT_TABLE = raw as unknown;
