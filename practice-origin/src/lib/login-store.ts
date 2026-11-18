/**
 * Angemeldeter Benutzer pro Session (Session-ID aus dem Cookie -> Benutzername), nur im RAM.
 * Keine echten Konten: jeder Name gilt. Begrenzt wie der Warenkorb, damit der Speicher auf dem
 * 1-Kern/512-MB-Droplet klein bleibt.
 */
const MAX_SESSIONS = 5000;

export class LoginStore {
	private users = new Map<string, string>();

	login(sessionId: string, username: string): void {
		this.users.delete(sessionId); // neu einfügen, damit die Session als jüngste gilt
		if (this.users.size >= MAX_SESSIONS) {
			const oldest = this.users.keys().next().value;
			if (oldest !== undefined) this.users.delete(oldest);
		}
		this.users.set(sessionId, username);
	}

	logout(sessionId: string): void {
		this.users.delete(sessionId);
	}

	userOf(sessionId: string | undefined): string | null {
		return sessionId ? (this.users.get(sessionId) ?? null) : null;
	}
}
