// Durchsucht die Einstellungen anhand dessen, was tatsaechlich auf dem Bildschirm steht.
//
// Der Inhalt der Einstellungsseite ist ueber tausende Zeilen handgeschriebenes JSX
// verteilt. Eine gepflegte Liste aller Optionen waere beim ersten neuen Schalter wieder
// unvollstaendig, deshalb wird der gerenderte Text gelesen: damit ist jede bestehende und
// jede kuenftige Einstellung automatisch auffindbar.
//
// Bewusst als eigene Funktion und nicht direkt im Effect, damit sie ohne Browser
// pruefbar bleibt - sie braucht vom DOM nur querySelector(All), children, textContent
// und hidden.

export type SettingsMatchCounts = Record<string, number>;

type Searchable = {
    getAttribute(name: string): string | null;
    querySelector(selector: string): Searchable | null;
    querySelectorAll(selector: string): ArrayLike<Searchable>;
    children: ArrayLike<Searchable>;
    textContent: string | null;
    hidden: boolean;
};

const SECTION = '[data-settings-section]';
const CARD = '[data-slot="card"]';
const CARD_CONTENT = '[data-slot="card-content"]';
const CARD_HEADER = '[data-slot="card-header"]';

export function applySettingsSearch(root: Searchable | null, rawQuery: string): SettingsMatchCounts {
    if (!root) return {};

    const query = String(rawQuery || '').trim().toLowerCase();
    const counts: SettingsMatchCounts = {};

    for (const panel of Array.from(root.querySelectorAll(SECTION))) {
        const sectionId = panel.getAttribute('data-settings-section') || '';
        let sectionHits = 0;

        for (const card of Array.from(panel.querySelectorAll(CARD))) {
            const content = card.querySelector(CARD_CONTENT);
            const header = card.querySelector(CARD_HEADER);
            const headerText = (header?.textContent || '').toLowerCase();

            // Passt die Ueberschrift, bleibt die ganze Karte stehen. Einzelne Zeilen ohne
            // ihren Zusammenhang zu zeigen, waere schwerer zu lesen als ein paar Treffer
            // zu viel.
            const cardMatches = query.length > 0 && headerText.includes(query);
            let visibleRows = 0;

            for (const row of Array.from(content?.children || [])) {
                if (!query) {
                    row.hidden = false;
                    continue;
                }

                const text = (row.textContent || '').trim().toLowerCase();
                if (text.length === 0) {
                    // Trennlinien tragen keinen Text und wuerden sonst frei schweben.
                    row.hidden = true;
                    continue;
                }

                const matches = cardMatches || text.includes(query);
                row.hidden = !matches;
                if (matches) visibleRows += 1;
            }

            const cardVisible = !query || cardMatches || visibleRows > 0;
            card.hidden = !cardVisible;
            if (query && cardVisible) sectionHits += Math.max(visibleRows, 1);
        }

        counts[sectionId] = sectionHits;
    }

    return counts;
}

export default applySettingsSearch;
