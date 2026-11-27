/**
 * The GitHub repository this build is released from. Version checks, release
 * notes, the source link and the bundled `manage-skills` skill all point here,
 * so a fork that ships its own builds never offers someone else's release as
 * an update. Keep in sync with `APP_REPO` in src-tauri/src/commands/settings.rs
 * and the updater endpoint in tauri.conf.json.
 */
export const APP_REPO = "adham-2002/agent-hangar";
export const APP_REPO_URL = `https://github.com/${APP_REPO}`;
export const APP_RELEASES_URL = `${APP_REPO_URL}/releases`;

/**
 * The open-source project this app was forked from (MIT). Credited on the
 * Settings page; `npm run upstream` reports its new commits.
 */
export const UPSTREAM_REPO = "xingkongliang/skills-manager";
export const UPSTREAM_REPO_URL = `https://github.com/${UPSTREAM_REPO}`;
