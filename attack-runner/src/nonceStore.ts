/**
 * Erkennt wiederholt verwendete Nonces innerhalb der Lebenszeit der Machine (#37: "kein
 * Replay"). Rein im RAM -- die Machine ist kurzlebig (Selbstzerstörungs-Timer), ein
 * persistenter Store ist nicht nötig; die App führt zusätzlich ihr eigenes Nonce-Register für
 * Meldungen (siehe attackCommand.ts).
 */
export class NonceStore {
	private readonly seen = new Set<string>();

	has(nonce: string): boolean {
		return this.seen.has(nonce);
	}

	add(nonce: string): void {
		this.seen.add(nonce);
	}
}
