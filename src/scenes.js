// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// The "paused" switch of a device is already a Gladys scene action ("control
// a device"), but it cannot say for how long, nor reach every server at once.
// These can: pause one server or all of them for a number of minutes (0:
// until resumed), resume, restart the failed files, add links (only when the
// configuration allows it). Never a deletion, never a restart of pyLoad.
// Gladys applies the field defaults to scene actions.
// -----------------------------------------------------------------------------

import { parseMinutes } from './hub.js';

export const SCENE_ACTIONS = {
  async pause_downloads(hub, { fields = {} }) {
    const minutes = parseMinutes(fields.minutes);
    const servers = await hub.pause(fields.device || null, minutes);
    return { servers, minutes };
  },

  async resume_downloads(hub, { fields = {} }) {
    const servers = await hub.resume(fields.device || null);
    return { servers };
  },

  async restart_failed(hub, { fields = {} }) {
    const servers = await hub.restartFailed(fields.device || null);
    return { servers };
  },

  async add_links(hub, { fields = {} }) {
    const packageId = await hub.addLinks(fields.device || null, fields.links, fields.package);
    return { package_id: packageId ?? 0 };
  },
};
