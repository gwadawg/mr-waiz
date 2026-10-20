/**
 * Launch Kit — 04 Resource index.
 *
 * Only the client resources the team selected for this kit. Internal playbooks are not
 * listed as a fallback.
 */

import type { KitBlock } from '../types';
import type { LaunchKitResource } from '../intake';

const EMPTY_RESOURCES =
  'Your CSM will share the playbooks that apply to this account.';

export function resourceTable(resources: LaunchKitResource[] = []): KitBlock {
  const selectedRows = resources
    .map(resource => {
      const title = resource.title.trim();
      const description = resource.description.trim();
      const url = resource.url.trim();
      if (!title && !description && !url) return null;
      const label = title && description ? `${title} - ${description}` : title || description || 'Open this resource';
      return [label, url || title];
    })
    .filter((row): row is string[] => !!row);

  if (!selectedRows.length) {
    return { type: 'body', text: EMPTY_RESOURCES };
  }

  return {
    type: 'table',
    variant: 'kv',
    headers: ['When you need', 'Open'],
    col_widths: [0.44, 0.56],
    rows: selectedRows,
  };
}
