/**
 * Warenkorb pro Session (#15), Fake-Daten im RAM (keine Datenbank, kein echtes Bezahlen).
 * Kleine Obergrenze an Sessions, damit der Speicher auf dem 1-Kern/512-MB-Droplet begrenzt bleibt.
 */
export type CartItems = Record<string, number>; // slug -> Menge

const MAX_SESSIONS = 5000;

export class CartStore {
	private carts = new Map<string, CartItems>();

	add(sessionId: string, slug: string): void {
		let cart = this.carts.get(sessionId);
		if (!cart) {
			if (this.carts.size >= MAX_SESSIONS) {
				// Älteste Session verwerfen (einfache Begrenzung, kein echtes LRU nötig für die Übung).
				const oldest = this.carts.keys().next().value;
				if (oldest !== undefined) this.carts.delete(oldest);
			}
			cart = {};
			this.carts.set(sessionId, cart);
		}
		cart[slug] = (cart[slug] ?? 0) + 1;
	}

	get(sessionId: string): CartItems {
		return this.carts.get(sessionId) ?? {};
	}

	sessionCount(): number {
		return this.carts.size;
	}
}
