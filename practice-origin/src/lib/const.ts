/**
 * Feste Wertemengen als const-Objekte statt loser Strings (Projekt-Vorgabe).
 */

export const ServerStatus = {
	NONE: 'none',
	CREATING: 'creating',
	SETTING_UP: 'setting-up',
	READY: 'ready',
	ERROR: 'error'
} as const;
export type ServerStatus = (typeof ServerStatus)[keyof typeof ServerStatus];

/** Env-Variablen-Namen (zentral, damit sie nur an einer Stelle als String vorkommen). */
export const EnvName = {
	STATS_TOKEN: 'STATS_TOKEN',
	CAPACITY_RPS: 'CAPACITY_RPS',
	HARD_LIMIT_RPS: 'HARD_LIMIT_RPS',
	PORT: 'PORT',
	BIND_HOST: 'BIND_HOST',
	COUNTER_CAP: 'COUNTER_CAP'
} as const;

export const DEFAULT_CAPACITY_RPS = 20;
export const DEFAULT_HARD_LIMIT_RPS = 60; // 3x Kapazität: harte Grenze je Domain, darüber 503.
export const DEFAULT_COUNTER_CAP = 20000; // RAM-Ringpuffer, Obergrenze an Einträgen.
export const SESSION_COOKIE_NAME = 'bohnenkraft_session';
export const SESSION_MAX_AGE_S = 60 * 60 * 24;
export const MAX_USERNAME_LENGTH = 40;
