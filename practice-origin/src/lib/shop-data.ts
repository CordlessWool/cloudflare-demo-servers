/**
 * Fiktive Produkte der Kaffeerösterei "Bohnenkraft" (#13). Feste Liste als const-Objekt.
 */

export interface Product {
	slug: string;
	name: string;
	kurzbeschreibung: string;
	beschreibung: string;
	preis: string; // formatiert, z.B. "12,90 €"
	bild: string; // Name ohne Hash/Extension, siehe assets.ts
}

export const PRODUCTS: readonly Product[] = [
	{
		slug: 'aequatortraum',
		name: 'Äquatortraum',
		kurzbeschreibung: 'Milder Filterkaffee aus Kolumbien, Noten von Karamell und Nuss.',
		beschreibung:
			'Unser Äquatortraum wird schonend bei niedriger Temperatur geröstet. Sortenrein von einer ' +
			'Kooperative aus der Sierra Nevada. Passt zu Filter und French Press.',
		preis: '12,90 €',
		bild: 'kaffeetuete-rot'
	},
	{
		slug: 'mitternachtsroestung',
		name: 'Mitternachtsröstung',
		kurzbeschreibung: 'Kräftiger Espresso-Blend, dunkel geröstet, schokoladige Tiefe.',
		beschreibung:
			'Ein kräftiger Blend aus Brasilien und Indien für Espresso und Vollautomat. Dunkel geröstet, mit ' +
			'einem Abgang nach Zartbitterschokolade und geröstetem Brot.',
		preis: '13,50 €',
		bild: 'kaffeetuete-schwarz'
	},
	{
		slug: 'hochlandbluete',
		name: 'Hochlandblüte',
		kurzbeschreibung: 'Fruchtiger Single Origin aus Äthiopien, blumig und hell geröstet.',
		beschreibung:
			'Hell geröstet, mit floralen und fruchtigen Aromen. Ideal für Handfilter und Aeropress. Direkter ' +
			'Einkauf von einer Kleinbauern-Kooperative im Hochland von Yirgacheffe.',
		preis: '14,20 €',
		bild: 'kaffeetuete-gelb'
	},
	{
		slug: 'waldrand-crema',
		name: 'Waldrand Crema',
		kurzbeschreibung: 'Ausgewogener Vollautomat-Kaffee, nussig mit leichter Süße.',
		beschreibung:
			'Ein unkomplizierter Begleiter für den Alltag: ausgewogen, nussig, mit einer feinen Süße im Abgang. ' +
			'Mittlere Röstung, gut für Vollautomat und Siebträger geeignet.',
		preis: '11,80 €',
		bild: 'kaffeetuete-rot'
	},
	{
		slug: 'nachtfrost-dekaf',
		name: 'Nachtfrost (entkoffeiniert)',
		kurzbeschreibung: 'Schonend entkoffeinierter Filterkaffee mit vollem Aroma.',
		beschreibung:
			'Für den Abend: schonend mit dem CO2-Verfahren entkoffeiniert, ohne auf Aroma zu verzichten. ' +
			'Mittlere Röstung, rund und mild im Geschmack.',
		preis: '13,90 €',
		bild: 'kaffeetuete-schwarz'
	},
	{
		slug: 'inselwind-blend',
		name: 'Inselwind Blend',
		kurzbeschreibung: 'Exotischer Blend mit Noten von Kokos und brauner Butter.',
		beschreibung:
			'Eine ungewöhnliche Mischung aus indonesischen und mittelamerikanischen Bohnen, mit Noten von ' +
			'Kokos, brauner Butter und einer leichten Würze. Für Filter und French Press.',
		preis: '15,60 €',
		bild: 'kaffeetuete-gelb'
	}
] as const;

export function findProduct(slug: string): Product | undefined {
	return PRODUCTS.find((p) => p.slug === slug);
}
