// UI translation. Views render English; when Polish is selected, a MutationObserver rewrites
// rendered text nodes and placeholders/titles through this dictionary (exact phrases) and
// a few patterns (phrases with numbers). Chart labels go through t() directly.

let lang = 'en';

export function setLang(l) { lang = l === 'pl' ? 'pl' : 'en'; document.documentElement.lang = lang; }
export const getLang = () => lang;
export const locale = () => (lang === 'pl' ? 'pl-PL' : undefined);

const PL = {
  // navigation & shell
  'Dashboard': 'Pulpit', 'Holdings': 'Pozycje', 'Transactions': 'Transakcje', 'Dividends': 'Dywidendy', 'Analysis': 'Analiza',
  'Rebalance': 'Rebalansowanie', 'Goals': 'Cele', 'Calendar': 'Kalendarz', 'Taxes (PIT-38)': 'Podatki (PIT-38)', 'Watchlist': 'Obserwowane',
  'Settings': 'Ustawienia', 'All portfolios': 'Wszystkie portfele', 'Currency': 'Waluta', 'Toggle dark mode': 'Tryb ciemny',
  'Source on GitHub': 'Kod na GitHubie', 'Portfolio': 'Portfel', 'Investor': 'Inwestor',
  'Crunching numbers…': 'Liczę…', 'Something went wrong': 'Coś poszło nie tak',
  // empty state
  'Track your whole portfolio — free, private, no account': 'Śledź cały portfel — za darmo, prywatnie, bez konta',
  '+ Add first transaction': '+ Dodaj pierwszą transakcję', 'Load demo portfolio': 'Wczytaj portfel demo',
  // dashboard
  'Portfolio value': 'Wartość portfela', 'Total profit': 'Zysk całkowity', 'Today': 'Dziś', 'Return (TWR)': 'Stopa zwrotu (TWR)',
  'Annual return (XIRR)': 'Roczna stopa zwrotu (XIRR)', 'time-weighted, since start': 'ważona czasem, od początku', 'money-weighted, p.a.': 'ważona kapitałem, rocznie',
  'Returns by period': 'Stopy zwrotu w okresach', 'Allocation': 'Alokacja', 'details →': 'szczegóły →', "Today's movers": 'Dzisiejsze zmiany',
  'Upcoming events': 'Nadchodzące wydarzenia', 'calendar →': 'kalendarz →', 'No price changes.': 'Brak zmian cen.', 'Nothing in the next 30 days.': 'Nic w ciągu 30 dni.',
  'Master chart': 'Wykres główny', 'Value': 'Wartość', 'Invested': 'Zainwestowano', 'Profit': 'Zysk', 'Return %': 'Stopa zwrotu %', 'Drawdown': 'Obsunięcie',
  'Deposits / withdrawals': 'Wpłaty / wypłaty', 'Buys & sells': 'Kupno i sprzedaż', 'Dividend markers': 'Znaczniki dywidend', 'Events': 'Wydarzenia',
  'Return': 'Stopa zwrotu', 'time-weighted (TWR)': 'ważona czasem (TWR)', 'money-weighted (XIRR p.a.)': 'ważona kapitałem (XIRR rocznie)', 'profit ÷ invested': 'zysk ÷ wkład',
  'Benchmarks': 'Benchmarki', '% change': 'zmiana %', 'same money invested': 'te same wpłaty', 'Points': 'Punkty', 'auto': 'auto', 'daily': 'dzienne', 'weekly': 'tygodniowe', 'monthly': 'miesięczne',
  'log scale': 'skala log.', 'Assets: all': 'Aktywa: wszystkie', 'All': 'Wszystkie', 'Open only': 'Tylko otwarte', 'Reset zoom': 'Resetuj zoom',
  'Download chart as PNG': 'Pobierz wykres jako PNG', 'Download visible data as CSV': 'Pobierz widoczne dane jako CSV',
  'Drag across the chart to zoom in. Hover for every value on that date.': 'Przeciągnij po wykresie, aby przybliżyć. Najedź, aby zobaczyć wszystkie wartości z danego dnia.',
  'Net money in': 'Wpłaty netto', 'XIRR p.a.': 'XIRR rocznie', 'Max drawdown': 'Maks. obsunięcie',
  'Retirement accounts': 'Konta emerytalne', 'limits →': 'limity →', 'counted from': 'liczone z', 'deposits': 'wpłat', 'net purchases': 'zakupów netto',
  // holdings
  'Market value': 'Wartość rynkowa', 'Cost basis': 'Koszt zakupu', 'Unrealized': 'Niezrealizowany', 'Realized': 'Zrealizowany', 'Fees paid': 'Zapłacone prowizje',
  'Open positions': 'Otwarte pozycje', 'click a row for details': 'kliknij wiersz, aby zobaczyć szczegóły', 'Closed positions': 'Zamknięte pozycje', 'Cash': 'Gotówka',
  'Asset': 'Aktywo', 'Shares': 'Liczba', 'Avg price': 'Śr. cena', 'Price': 'Kurs', 'Weight': 'Udział', 'Total return': 'Wynik całkowity', 'Total': 'Razem',
  'No closed positions.': 'Brak zamkniętych pozycji.', 'manual': 'ręczna', 'Position': 'Pozycja', 'Dividend yield': 'Stopa dywidendy',
  'Sector': 'Sektor', 'Industry': 'Branża', 'Country': 'Kraj', 'Market': 'Rynek', 'P/E': 'C/Z', 'Fwd P/E': 'Prognozowane C/Z', 'Market cap': 'Kapitalizacja',
  '52w range': 'Zakres 52 tyg.', 'Beta': 'Beta', 'Open lots (FIFO)': 'Otwarte partie (FIFO)', 'Bought': 'Kupiono', 'Gain': 'Zysk',
  // transactions
  '+ Add': '+ Dodaj', '+ Treasury bonds': '+ Obligacje skarbowe', 'Import CSV': 'Import', 'Export CSV': 'Eksport CSV', 'All types': 'Wszystkie typy',
  'Search ticker / note…': 'Szukaj tickera / notatki…', 'Date': 'Data', 'Type': 'Typ', 'Ticker': 'Ticker', 'Qty': 'Ilość', 'Fee / tax': 'Prowizja / podatek', 'Note': 'Notatka',
  'Edit': 'Edytuj', 'Delete': 'Usuń', 'No transactions match.': 'Brak pasujących transakcji.', 'Add transaction': 'Dodaj transakcję', 'Edit transaction': 'Edytuj transakcję',
  'Quantity': 'Ilość', 'Price per share': 'Cena za akcję', 'Fee / commission': 'Prowizja', 'Amount': 'Kwota', 'Gross amount': 'Kwota brutto', 'Tax withheld': 'Podatek pobrany',
  'Paid / received in another currency (e.g. PLN account buying USD shares)': 'Rozliczone w innej walucie (np. konto PLN kupujące akcje w USD)',
  'Account currency': 'Waluta rachunku', 'Total charged': 'Pobrana kwota', 'Total received': 'Otrzymana kwota',
  'The exact amount that left or reached your account, including fees and the broker\'s FX spread. Used for cost basis and cash.': 'Dokładna kwota, która zeszła z rachunku lub na niego wpłynęła, z prowizjami i spreadem walutowym brokera. Używana do kosztu zakupu i gotówki.',
  'Cancel': 'Anuluj', 'Save': 'Zapisz', 'Add': 'Dodaj', 'Import transactions': 'Import transakcji', 'Import': 'Importuj', 'or paste CSV below': 'lub wklej CSV poniżej',
  'Into portfolio': 'Do portfela', 'Default / account currency': 'Domyślna waluta / rachunku', 'Ticker suffix': 'Sufiks tickera', 'Default type': 'Domyślny typ',
  '(from column / sign)': '(z kolumny / znaku)', 'Dates are month-first (US)': 'Daty w formacie miesiąc/dzień (USA)', 'Skip duplicates': 'Pomiń duplikaty', 'Column mapping': 'Mapowanie kolumn',
  'Symbols': 'Symbole', 'no market data yet': 'brak danych rynkowych', 'Settled': 'Rozliczono', 'Skipped rows': 'Pominięte wiersze', 'Price check:': 'Kontrola cen:',
  'Upload a broker statement —': 'Wgraj wyciąg od brokera —', 'e.g. AAPL, PKO.WA, SAP.DE': 'np. AAPL, PKO.WA, SAP.DE',
  '— use Yahoo Finance tickers (AAPL, PKO.WA, VWCE.DE). Saved for future imports.': '— użyj tickerów Yahoo Finance (AAPL, PKO.WA, VWCE.DE). Zapamiętane na przyszłe importy.',
  // bonds
  'Add treasury bonds': 'Dodaj obligacje skarbowe', 'Add bonds': 'Dodaj obligacje', 'Edit bond terms': 'Edytuj warunki obligacji', 'Purchase date': 'Data zakupu',
  'First-year rate (%)': 'Oprocentowanie w 1. roku (%)', 'Margin above inflation (%)': 'Marża ponad inflację (%)', 'Number of bonds (100 PLN each)': 'Liczba obligacji (po 100 zł)',
  'Price per bond': 'Cena za obligację', '99.90 when rolling over (zamiana)': '99,90 przy zamianie', 'Early redemption fee per bond (PLN)': 'Opłata za wcześniejszy wykup (zł/szt.)',
  'Treasury bonds': 'Obligacje skarbowe', 'Government bonds': 'Obligacje skarbowe', 'Bonds': 'Obligacje', 'Interest earned': 'Odsetki', 'capitalised': 'kapitalizowane',
  'If redeemed today': 'Przy wykupie dziś', 'At maturity': 'W dniu wykupu', 'Matures': 'Wykup', 'Rate %': 'Oproc. %', 'Basis': 'Podstawa', 'Value at end': 'Wartość na koniec',
  'Edit terms': 'Edytuj warunki', 'Record redemption…': 'Zapisz wykup…', 'first year': 'pierwszy rok', 'entered': 'wpisane', 'current rate': 'bieżące oprocentowanie',
  'OTS — 3-month fixed': 'OTS — 3-miesięczne, stałe', 'ROR — 1-year, NBP rate, monthly interest': 'ROR — roczne, stopa NBP, odsetki co miesiąc',
  'DOR — 2-year, NBP rate + margin, monthly interest': 'DOR — 2-letnie, stopa NBP + marża, odsetki co miesiąc', 'TOS — 3-year fixed, capitalised': 'TOS — 3-letnie, stałe, kapitalizowane',
  'COI — 4-year inflation-linked, yearly interest': 'COI — 4-letnie indeksowane inflacją, odsetki co rok', 'ROS — 6-year inflation-linked (family 800+)': 'ROS — 6-letnie indeksowane inflacją (rodzinne 800+)',
  'EDO — 10-year inflation-linked, capitalised': 'EDO — 10-letnie indeksowane inflacją, kapitalizowane', 'ROD — 12-year inflation-linked (family 800+)': 'ROD — 12-letnie indeksowane inflacją (rodzinne 800+)',
  // dividends
  'Last 12 months': 'Ostatnie 12 mies.', 'Forecast next 12m': 'Prognoza na 12 mies.', 'gross, from trailing payouts': 'brutto, na podstawie wypłat', 'Portfolio yield': 'Stopa dywidendy portfela',
  'forward, on market value': 'prognozowana, od wartości', 'Yield on cost': 'Stopa od kosztu', 'All-time received': 'Otrzymane łącznie', 'Monthly dividends': 'Dywidendy miesięcznie',
  'last 24 months received + next 12 months forecast': 'otrzymane z 24 mies. + prognoza na 12 mies.', 'By year': 'Wg lat', 'Upcoming (forecast)': 'Nadchodzące (prognoza)',
  'By company': 'Wg spółek', 'Payments': 'Wypłaty', 'Company': 'Spółka', 'Received (all)': 'Otrzymane (razem)', 'Last 12m': '12 mies.', 'Next 12m': 'Kolejne 12 mies.',
  'Yield': 'Stopa', 'Gross': 'Brutto', 'Tax': 'Podatek', 'est.': 'szac.', 'No dividends yet.': 'Brak dywidend.', 'No dividend payers in the portfolio.': 'Brak spółek dywidendowych w portfelu.',
  // analysis
  'Annualised TWR': 'TWR rocznie', 'Volatility': 'Zmienność', 'annualised, daily returns': 'roczna, z dziennych stóp zwrotu', 'Sharpe (rf=0)': 'Sharpe (rf=0)', 'Positions': 'Pozycje',
  'Asset type': 'Rodzaj aktywów', 'Stocks': 'Akcje', 'ETFs': 'ETF-y', 'Funds': 'Fundusze', 'Crypto': 'Krypto', 'Other': 'Inne', 'Unknown': 'Nieznane',
  'Actual vs “same money into a benchmark”': 'Portfel vs „te same wpłaty w benchmark”', 'Returns by year': 'Stopy zwrotu wg lat', 'Monthly returns (TWR)': 'Miesięczne stopy zwrotu (TWR)',
  'Year': 'Rok', 'End value': 'Wartość na koniec', 'Share allocation link': 'Udostępnij alokację', 'Copy a link that shows weights and returns, never amounts': 'Skopiuj link z udziałami i stopami zwrotu, bez kwot',
  'Jan': 'Sty', 'Feb': 'Lut', 'Mar': 'Mar', 'Apr': 'Kwi', 'May': 'Maj', 'Jun': 'Cze', 'Jul': 'Lip', 'Aug': 'Sie', 'Sep': 'Wrz', 'Oct': 'Paź', 'Nov': 'Lis', 'Dec': 'Gru',
  // rebalance
  'Target allocation': 'Docelowa alokacja', 'Use current weights': 'Użyj obecnych udziałów', 'Equal weights': 'Równe udziały', 'Clear': 'Wyczyść', 'Mode': 'Tryb',
  'Buy only (invest new cash, never sell)': 'Tylko kupno (inwestuj nowe środki, bez sprzedaży)', 'Full rebalance (buy and sell)': 'Pełne rebalansowanie (kupno i sprzedaż)',
  'whole shares': 'całe akcje', 'Add ticker': 'Dodaj ticker', 'Now': 'Teraz', 'Target %': 'Cel %', 'Drift': 'Odchylenie', 'Trade': 'Transakcja', 'After': 'Po',
  'Orders to place': 'Zlecenia do złożenia', 'Copy': 'Kopiuj', 'Cash left': 'Pozostała gotówka', 'Nothing to do — you are on target (or add new cash).': 'Nic do zrobienia — portfel jest zgodny z celem (albo dodaj nowe środki).',
  'No targets yet — start with “Use current weights”.': 'Brak celów — zacznij od „Użyj obecnych udziałów”.',
  'Set a target % for each asset (they are scaled to 100%). Assets without a target are left out. Targets are saved per portfolio selection (currently: all portfolios).': 'Ustaw docelowy % dla każdego aktywa (zostaną przeskalowane do 100%). Aktywa bez celu są pomijane. Cele zapisują się dla wybranego portfela (teraz: wszystkie portfele).',
  'Set a target % for each asset (they are scaled to 100%). Assets without a target are left out. Targets are saved per portfolio selection.': 'Ustaw docelowy % dla każdego aktywa (zostaną przeskalowane do 100%). Aktywa bez celu są pomijane. Cele zapisują się dla wybranego portfela.',
  // goals
  'Goal': 'Cel', 'Goal type': 'Rodzaj celu', 'Financial independence (live off the portfolio)': 'Niezależność finansowa (życie z portfela)', 'Monthly dividend income': 'Miesięczny dochód z dywidend',
  'Reach an amount': 'Osiągnięcie kwoty', 'Safe withdrawal rate (%)': 'Bezpieczna stopa wypłat (%)', 'Monthly contribution': 'Miesięczna wpłata', 'Expected return (% a year)': 'Oczekiwana stopa zwrotu (% rocznie)',
  'Inflation (% a year)': 'Inflacja (% rocznie)', 'Contributions grow (% a year)': 'Wzrost wpłat (% rocznie)', 'Horizon (years)': 'Horyzont (lata)', 'Target': 'Cel', 'Progress': 'Postęp',
  'Reached in': 'Osiągnięty za', 'Projection': 'Projekcja', "projections are in today's money (after inflation)": 'projekcje w dzisiejszych pieniądzach (po inflacji)', 'you are on track': 'jesteś na dobrej drodze',
  'already there 🎉': 'już osiągnięty 🎉', 'not within 80 y': 'nie w ciągu 80 lat',
  // calendar
  'earnings': 'wyniki', 'dividend': 'dywidenda', 'split': 'split', 'expected dividend': 'oczekiwana dywidenda', 'exp. div': 'ocz. dyw.', 'Only my holdings': 'Tylko moje pozycje',
  'Next 14 days': 'Najbliższe 14 dni', 'Nothing scheduled.': 'Nic zaplanowanego.', 'month': 'miesiąc', 'list': 'lista', 'today': 'dziś', 'month view': 'widok miesiąca', 'list view': 'lista',
  'Previous month': 'Poprzedni miesiąc', 'Next month': 'Następny miesiąc', 'This month': 'Ten miesiąc',
  // taxes
  'Tax year': 'Rok podatkowy', 'Przychód (revenue)': 'Przychód', 'Koszty (costs)': 'Koszty uzyskania przychodu', 'Dochód (income)': 'Dochód', 'Strata (loss)': 'Strata',
  'Podatek 19% (tax)': 'Podatek 19%', 'Foreign dividends: tax to pay': 'Dywidendy zagraniczne: podatek do zapłaty', 'Total due': 'Razem do zapłaty', 'Prior losses deducted': 'Odliczone straty z lat ubiegłych',
  'By country': 'Wg krajów', 'helps with PIT/ZG': 'pomocne przy PIT/ZG', 'Losses to carry forward': 'Straty do rozliczenia', 'settings →': 'ustawienia →', 'Gains': 'Zyski',
  'Tax abroad': 'Podatek za granicą', 'To pay in PL': 'Do zapłaty w PL', 'Loss year': 'Rok straty', 'Loss': 'Strata', 'Still deductible': 'Pozostało do odliczenia', 'Usable until': 'Do wykorzystania do',
  'Sold': 'Sprzedano', 'NBP rate': 'Kurs NBP', 'Bought (FIFO)': 'Kupiono (FIFO)', 'Revenue': 'Przychód', 'Costs': 'Koszty', 'Income': 'Dochód', 'Withheld': 'Pobrany',
  'field 23': 'poz. 23', 'field 24': 'poz. 24', 'field 25 — carry forward': 'poz. 25 — do odliczenia', 'PIT-38 sec. C, field 22': 'PIT-38 cz. C, poz. 22',
  'No sales this year.': 'Brak sprzedaży w tym roku.', 'No unused losses.': 'Brak nierozliczonych strat.', 'Nothing this year.': 'Brak w tym roku.',
  'Estimate of the Polish': 'Szacunek polskiego', 'No taxable events yet': 'Brak zdarzeń podatkowych',
  // watchlist
  'Next event': 'Najbliższe wydarzenie', 'Div. yield': 'Stopa dyw.', 'Day': 'Dzień', 'Alert': 'Alert', 'Add price alert': 'Dodaj alert cenowy', 'Remove alert': 'Usuń alert',
  'Add ticker (Yahoo symbol)': 'Dodaj ticker (symbol Yahoo)', 'held': 'w portfelu', 'no data': 'brak danych', 'manage alerts': 'zarządzaj alertami', 'Remove': 'Usuń', 'Tickers in': 'Tickery z',
  // settings
  'General': 'Ogólne', 'Base currency': 'Waluta bazowa', 'Language': 'Język', 'Portfolios': 'Portfele', 'Account type': 'Rodzaj konta', 'Rename': 'Zmień nazwę',
  'Regular (taxable)': 'Zwykły (opodatkowany)', 'OIPE (PEPP)': 'OIPE (PEPP)', 'New portfolio name (e.g. IKE, XTB, mBank)': 'Nazwa nowego portfela (np. IKE, XTB, mBank)',
  'IKE / IKZE limits': 'Limity IKE / IKZE', 'IKE limit': 'Limit IKE', 'IKZE limit': 'Limit IKZE', 'I am self-employed (IKZE limit × 1.5)': 'Prowadzę działalność (limit IKZE × 1,5)',
  'Annual contribution limits in PLN. Edit if the official figure differs.': 'Roczne limity wpłat w zł. Popraw, jeśli oficjalna kwota jest inna.',
  'Estimate dividends from market data for tickers without recorded dividends': 'Szacuj dywidendy z danych rynkowych dla spółek bez zapisanych dywidend',
  'Backup & data': 'Kopia zapasowa i dane', 'Export backup (JSON)': 'Eksportuj kopię (JSON)', 'Import backup': 'Importuj kopię', 'merge instead of replace': 'scal zamiast zastąpić',
  'Erase all data': 'Usuń wszystkie dane', 'Sync between devices': 'Synchronizacja między urządzeniami', 'GitHub token': 'Token GitHub', 'Encryption passphrase (recommended)': 'Hasło szyfrowania (zalecane)',
  'Connect': 'Połącz', 'The token and passphrase are stored only in this browser.': 'Token i hasło są przechowywane tylko w tej przeglądarce.', 'Sync now': 'Synchronizuj teraz',
  'Disconnect this device': 'Odłącz to urządzenie', 'create token': 'utwórz token', 'private GitHub Gist': 'prywatnym Gist na GitHubie',
  'Market data': 'Dane rynkowe', 'All your tickers are tracked. ✓': 'Wszystkie Twoje tickery są śledzone. ✓', 'Copy tickers.json': 'Kopiuj tickers.json',
  'Edit tickers.json on GitHub': 'Edytuj tickers.json na GitHubie', 'Run data refresh': 'Odśwież dane', 'Manual prices': 'Ceny ręczne', 'None.': 'Brak.',
  'For assets without Yahoo data (bonds, private funds, delisted stocks). Used whenever no market price exists.': 'Dla aktywów bez danych w Yahoo (fundusze, wycofane spółki). Używane, gdy brak ceny rynkowej.',
  'Taxes': 'Podatki', 'Exchange-rate date for trades': 'Data kursu dla transakcji', 'Trade date (NBP rate from the day before)': 'Data transakcji (kurs NBP z dnia poprzedniego)',
  'Settlement date T+2': 'Data rozliczenia T+2', 'Deduct prior-year losses automatically': 'Automatycznie odliczaj straty z lat ubiegłych',
  "Estimated dividends: subtract typical withholding tax of the issuer's country (US 15%, DE 26.4%, CH 35%, PL 19%…)": 'Szacowane dywidendy: odejmij typowy podatek u źródła kraju emitenta (USA 15%, DE 26,4%, CH 35%, PL 19%…)',
  'Everything you enter is stored only in this browser (localStorage). Export a backup regularly — clearing browser data deletes it. Import the file on another device to sync.': 'Wszystko, co wpiszesz, jest przechowywane tylko w tej przeglądarce (localStorage). Regularnie eksportuj kopię — wyczyszczenie danych przeglądarki ją usunie. Zaimportuj plik na innym urządzeniu.',
  'Export a backup or turn on sync →': 'Wyeksportuj kopię lub włącz synchronizację →',
  'Your portfolio lives only in this browser. You have never exported a backup.': 'Twój portfel istnieje tylko w tej przeglądarce. Nigdy nie wyeksportowano kopii.',
  'estimated': 'szacowanych', 'from market data (ex-date × shares held, before tax) because you have not recorded dividends for those tickers. Record actual DIVIDEND transactions for exact numbers, or turn estimation off in Settings.':
    'na podstawie danych rynkowych (dzień ustalenia prawa × liczba akcji), bo nie zapisano dywidend dla tych spółek. Dodaj faktyczne transakcje DYWIDENDA, aby mieć dokładne kwoty, albo wyłącz szacowanie w Ustawieniach.',
  'Not tax advice — check against your broker\'s PIT-8C.': 'To nie jest porada podatkowa — porównaj z PIT-8C od brokera.',
  'A shared portfolio snapshot from': 'Udostępniony portfel z dnia', 'Holdings ': 'Pozycje', 'Weights': 'Udziały', 'By sector': 'Wg sektorów',
  'Return since start (TWR)': 'Stopa zwrotu od początku (TWR)',
  'Prices, FX and events come from Yahoo Finance and NBP via a GitHub Action that runs on weekdays and publishes them with the site.': 'Ceny, kursy walut i wydarzenia pochodzą z Yahoo Finance i NBP; pobiera je w dni robocze GitHub Action i publikuje razem ze stroną.',
  'Last update:': 'Ostatnia aktualizacja:',
  'Prices, FX and events come from Yahoo Finance and NBP via a GitHub Action that runs on weekdays and publishes them with the site. Last update:': 'Ceny, kursy walut i wydarzenia pochodzą z Yahoo Finance i NBP; pobiera je w dni robocze GitHub Action i publikuje razem ze stroną. Ostatnia aktualizacja:', 'Losses from years before your data (PLN), e.g.': 'Straty z lat sprzed Twoich danych (zł), np.',
  'get daily prices and events. Tickers you add here are saved in your browser; to get their data add them to': 'mają codzienne ceny i wydarzenia. Tickery dodane tutaj zapisują się w przeglądarce; aby pobierać ich dane, dodaj je też do',
  'too (': '(', 'Keep the portfolio in a': 'Przechowuj portfel w',
  'and sync it automatically on every device. Create a token with only the': 'i synchronizuj go automatycznie na każdym urządzeniu. Utwórz token tylko z uprawnieniem',
  'scope (': '(', ') and use the same token + passphrase on each device. With a passphrase everything is encrypted in your browser before upload.': ') i używaj tego samego tokenu i hasła na każdym urządzeniu. Z hasłem wszystko jest szyfrowane w przeglądarce przed wysłaniem.',
  '(cash operations, xlsx or csv),': '(operacje gotówkowe, xlsx lub csv),', '(Transactions.csv and Account.csv),': '(Transactions.csv i Account.csv),', '(activity statement csv) and': '(activity statement csv) oraz',
  'are recognised automatically. Anything else (mBank, Bossa, your own sheet…) goes through the column mapper; Polish and English headers are detected.': 'są rozpoznawane automatycznie. Pozostałe pliki (mBank, Bossa, własny arkusz…) przechodzą przez mapowanie kolumn; rozpoznawane są nagłówki polskie i angielskie.',
  'Polish retail treasury bonds (obligacje skarbowe). Enter the terms of your series from': 'Detaliczne obligacje skarbowe. Wpisz warunki swojej serii ze strony',
  'or your bond account: first-year rate and, for inflation-linked bonds, the margin. Later rates follow inflation automatically and can be corrected per period.': 'lub z rachunku obligacji: oprocentowanie w pierwszym roku i — dla obligacji indeksowanych — marżę. Kolejne okresy liczone są z inflacji i można je poprawić.',
  'Type the official rate into any period to override the estimate.': 'Wpisz oficjalne oprocentowanie w dowolnym okresie, aby zastąpić szacunek.',
  'Add your transactions (or import a CSV from your broker) and get value history, profit, time- and money-weighted returns, dividends, allocation, a corporate events calendar and a Polish PIT-38 tax estimate. Your data stays in this browser.': 'Dodaj transakcje (albo zaimportuj plik od brokera) i zobacz historię wartości, zysk, stopy zwrotu TWR i XIRR, dywidendy, alokację, kalendarz wydarzeń i szacunek PIT-38. Dane zostają w tej przeglądarce.',
  'Don’t know the ticker? Leave it empty and add the ISIN to': 'Nie znasz tickera? Zostaw puste i dodaj ISIN do',
  '— the data workflow resolves ISINs automatically, then re-import.': '— workflow danych sam zamieni ISIN na ticker; potem zaimportuj ponownie.',
  'Heatmap': 'Mapa cieplna', 'Contribution to profit': 'Wkład w zysk', 'Since buy': 'Od zakupu',
  'Closed trades': 'Zamknięte transakcje', 'every sale, matched FIFO': 'każda sprzedaż, rozliczenie FIFO', 'Trades': 'Transakcje', 'Average winner': 'Średni zysk', 'Average loser': 'Średnia strata',
  'Profit factor': 'Współczynnik zysku', 'gains ÷ losses': 'zyski ÷ straty', 'Average holding': 'Średni czas trzymania', 'Winners': 'Zyskowne', 'Held': 'Trzymane', 'No sales yet.': 'Brak sprzedaży.',
  'P/B': 'C/WK', 'Profit margin': 'Marża zysku', 'ROE': 'ROE', 'Revenue growth': 'Wzrost przychodów', 'Earnings growth': 'Wzrost zysków', 'Debt / equity': 'Dług / kapitał',
  'Payout ratio': 'Stopa wypłaty', '5y avg yield': 'Śr. stopa dyw. 5 lat', 'Analyst target': 'Cena docelowa analityków', 'Rating': 'Rekomendacja', 'Employees': 'Pracownicy',
  'Dividend history': 'Historia dywidend', 'Growth 1y': 'Wzrost 1 rok', 'Growth 3y': 'Wzrost 3 lata', 'Growth 5y': 'Wzrost 5 lat', 'per year': 'rocznie', 'Raised in a row': 'Podwyżki z rzędu',
  'Received amount': 'Otrzymana kwota', 'Received currency': 'Otrzymana waluta', 'Amount sold': 'Sprzedana kwota', 'Change ticker…': 'Zmień ticker…',
  'Ticker changed, merger, or wrong symbol: rewrite all transactions': 'Zmiana tickera, fuzja lub błędny symbol: popraw wszystkie transakcje', 'CONVERSION': 'WYMIANA',
  'Print / PDF': 'Drukuj / PDF',
  'Compare portfolios': 'Porównanie portfeli', 'each from its own start': 'każdy od własnego początku', 'Add benchmark': 'Dodaj benchmark',
  'Compare your portfolio with the indices from': 'Porównuj portfel z indeksami z', 'or with any tracked ticker (for example the ETF you would otherwise buy).': 'albo z dowolnym śledzonym tickerem (np. ETF-em, który kupił(a)byś zamiast).',
  '+ Other asset': '+ Inne aktywo', 'Add other asset': 'Dodaj inne aktywo', 'Name': 'Nazwa', 'Kind': 'Rodzaj', 'Amount paid (total)': 'Zapłacona kwota (łącznie)', 'Current value (optional)': 'Obecna wartość (opcjonalnie)',
  'Interest rate (% a year)': 'Oprocentowanie (% rocznie)', 'Add asset': 'Dodaj aktywo', 'Update value': 'Aktualizuj wartość', 'Save rate': 'Zapisz oprocentowanie', 'Valuations': 'Wyceny', 'Last valuation': 'Ostatnia wycena',
  'Real estate': 'Nieruchomości', 'Deposit / savings': 'Lokata / oszczędności', 'Gold / metals': 'Złoto / metale', 'Vehicle': 'Pojazd', 'Collectibles': 'Kolekcje', 'Private equity / loans': 'Udziały prywatne / pożyczki',
  'held flat until the next update': 'stała do następnej aktualizacji', 'New value (total)': 'Nowa wartość (łącznie)', 'deposits only': 'tylko lokaty',
  'Anything without a market price: a flat, a term deposit, a crypto wallet, gold, a loan you gave… You update its value by hand; deposits can grow at a fixed rate.': 'Wszystko bez ceny rynkowej: mieszkanie, lokata, portfel krypto, złoto, udzielona pożyczka… Wartość aktualizujesz ręcznie; lokaty mogą rosnąć według stałego oprocentowania.',
  'Paid with new money — also record a deposit (this portfolio tracks cash)': 'Zapłacone nowymi środkami — zapisz też wpłatę (ten portfel śledzi gotówkę)',
  'Report': 'Raport', 'Value at start': 'Wartość na początku', 'Value at end': 'Wartość na końcu', 'Best and worst': 'Najlepsze i najgorsze', 'No changes.': 'Brak zmian.', 'No dividends in this period.': 'Brak dywidend w tym okresie.',
  'Payout': 'Wypłata', 'Div. growth': 'Wzrost dyw.', 'Held': 'W portfelu', 'Not held': 'Poza portfelem', 'My notes': 'Moje notatki', 'Add a note': 'Dodaj notatkę',
  'Why you bought it, target price, when you would sell…': 'Dlaczego kupiłeś, cena docelowa, kiedy sprzedasz…',
  "Welcome! Let's set up your portfolio": 'Witaj! Skonfigurujmy Twój portfel', 'Language and currency': 'Język i waluta', 'Show values in': 'Pokazuj wartości w', 'Your accounts': 'Twoje rachunki',
  'One portfolio per broker account. Mark IKE / IKZE accounts so their limits are tracked and they are left out of PIT-38.': 'Jeden portfel na każdy rachunek maklerski. Oznacz IKE / IKZE, aby śledzić limity i pominąć je w PIT-38.',
  '+ Add account': '+ Dodaj rachunek', 'Add your investments': 'Dodaj swoje inwestycje', 'Import a broker file (XTB, Degiro, IBKR, Revolut, CSV)': 'Zaimportuj plik od brokera (XTB, Degiro, IBKR, Revolut, CSV)',
  'Add a transaction by hand': 'Dodaj transakcję ręcznie', 'Add treasury bonds': 'Dodaj obligacje skarbowe', 'Just look around (demo data)': 'Tylko się rozejrzę (dane demo)', 'e.g. XTB, mBank, IKE': 'np. XTB, mBank, IKE',
  'Free and private: everything stays in this browser (you can turn on encrypted sync later). Three quick steps.': 'Za darmo i prywatnie: wszystko zostaje w tej przeglądarce (szyfrowaną synchronizację możesz włączyć później). Trzy szybkie kroki.',
  // misc
  'Heads up:': 'Uwaga:', 'Nothing here yet.': 'Nic tu jeszcze nie ma.', 'No positions.': 'Brak pozycji.', 'BUY': 'KUPNO', 'SELL': 'SPRZEDAŻ',
  'Stocks/ETF': 'Akcje/ETF', 'Poland': 'Polska', 'United States': 'USA', 'Germany': 'Niemcy', 'Netherlands': 'Holandia', 'United Kingdom': 'Wielka Brytania', 'France': 'Francja',
  'Technology': 'Technologia', 'Financial Services': 'Usługi finansowe', 'Basic Materials': 'Surowce', 'Industrials': 'Przemysł', 'Healthcare': 'Ochrona zdrowia',
  'Consumer Cyclical': 'Dobra cykliczne', 'Consumer Defensive': 'Dobra podstawowe', 'Energy': 'Energia', 'Utilities': 'Użyteczność publiczna', 'Real Estate': 'Nieruchomości',
  'Communication Services': 'Komunikacja', 'Net invested': 'Wpłacono netto', 'Received': 'Otrzymane', 'Forecast': 'Prognoza', 'Net dividends': 'Dywidendy netto',
  'Your portfolio': 'Twój portfel', 'Contributed': 'Wpłacono', 'Buy': 'Kupno', 'Sell': 'Sprzedaż', 'Dividend': 'Dywidenda', 'Event': 'Wydarzenie',
};

const PATTERNS = [
  [/^Received (\d{4})$/, 'Otrzymane $1'], [/^Retirement accounts (\d{4})$/, 'Konta emerytalne $1'], [/^Sales \((\d+)\)$/, 'Sprzedaże ($1)'],
  [/^Dividends \((\d+)\)$/, 'Dywidendy ($1)'], [/^(\d+) tx$/, '$1 transakcji'], [/^(\d+) months left$/, 'zostało $1 mies.'], [/^over ([\d.,]+) years$/, 'w ciągu $1 lat'],
  [/^Value in (\d+) y$/, 'Wartość za $1 lat'], [/^Needed monthly for (\d+) y$/, 'Potrzebne miesięcznie przez $1 lat'], [/^Show all (\d+) payments$/, 'Pokaż wszystkie $1 wypłat'],
  [/^(\d+) transactions in (\d+) portfolio\(s\)\.$/, '$1 transakcji w $2 portfelach.'], [/^top 3 = (.+)$/, 'top 3 = $1'], [/^trough (.+)$/, 'dołek $1'],
  [/^Prices as of (.+)$/, 'Ceny z $1'], [/^Series (\S+) · matures (.+)$/, 'Seria $1 · wykup $2'], [/^Value \(([A-Z]{3})\)$/, 'Wartość ($1)'], [/^Net \(([A-Z]{3})\)$/, 'Netto ($1)'],
  [/^Target amount \(([A-Z]{3})\)$/, 'Kwota docelowa ($1)'], [/^Monthly income wanted \(([A-Z]{3})\)$/, 'Oczekiwany dochód miesięczny ($1)'], [/^Starting value \(([A-Z]{3})\)$/, 'Wartość początkowa ($1)'],
  [/^Monthly contribution \(([A-Z]{3})\)$/, 'Miesięczna wpłata ($1)'], [/^New cash to invest \(([A-Z]{3})\)$/, 'Nowe środki do zainwestowania ($1)'], [/^(\d+) positions$/, '$1 pozycji'],
  [/^Dividends \(per (week|month)\)$/, (m, p) => `Dywidendy (na ${p === 'week' ? 'tydzień' : 'miesiąc'})`], [/^Net deposits \(per (week|month)\)$/, (m, p) => `Wpłaty netto (na ${p === 'week' ? 'tydzień' : 'miesiąc'})`],
  [/^(\d+) payments are$/, '$1 wypłat jest'],
  [/^Every contribution and withdrawal you made is replayed into the benchmark \(converted to ([A-Z]{3})\)\.$/, 'Każda Twoja wpłata i wypłata jest odtworzona w benchmarku (w przeliczeniu na $1).'],
  [/^your portfolio today: (.+)$/, 'Twój portfel dziś: $1'], [/^your annualised TWR so far: (.+)$/, 'Twoje dotychczasowe TWR rocznie: $1'],
  [/^(.+?) of (.+?(?:zł|PLN|USD|EUR))$/, '$1 z $2'], [/^(.+) more than now$/, 'o $1 więcej niż teraz'], [/^(.+)\/month at (.+)$/, '$1/mies. przy $2'],
  [/^at (.+) dividend yield( \(yours\))?$/, (m, a, b) => `przy stopie dywidendy ${a}${b ? ' (Twojej)' : ''}`], [/^nominal (.+)$/, 'nominalnie $1'],
  [/^using FIFO per portfolio \(treat each portfolio as one broker account\) and NBP mid rates from the business day before each transaction\. Rates use the (trade date|T\+2 settlement date); prior-year losses are (not deducted|deducted automatically \(oldest first, one-off up to PLN 5M, else 50% a year, 5 years\)) — change in Settings\. Not tax advice — check against your broker's PIT-8C\.$/,
    (m, d, l) => `metodą FIFO w każdym portfelu (każdy portfel traktowany jak osobny rachunek maklerski) i po średnich kursach NBP z dnia roboczego poprzedzającego transakcję. Kursy według ${d === 'trade date' ? 'daty transakcji' : 'daty rozliczenia T+2'}; straty z lat ubiegłych ${l === 'not deducted' ? 'nie są odliczane' : 'są odliczane automatycznie (od najstarszych, jednorazowo do 5 mln zł, inaczej 50% rocznie, przez 5 lat)'} — zmienisz to w Ustawieniach. To nie jest porada podatkowa — porównaj z PIT-8C od brokera.`],
  [/^Excluded as tax-free: (.+) \(IKE \/ IKZE \/ OIPE\)\.$/, 'Pominięte jako zwolnione z podatku: $1 (IKE / IKZE / OIPE).'],
  [/^(.+) left for (\d{4})$/, 'zostało $1 na $2'], [/^PIT deduction on (.+?): ≈ (.+) at 12% · (.+) at 32% · (.+) at 19% \(linear\)\. Withdrawal after 65 is taxed at a flat 10%\.$/, 'Odliczenie w PIT od $1: ≈ $2 przy 12% · $3 przy 32% · $4 przy 19% (liniowy). Wypłata po 65. roku życia: 10% podatku.'],
  [/^(.+) left for (\d{4}) · counted from (deposits|net purchases)(.*)$/, (m, a, y, k, rest) => `zostało ${a} na ${y} · liczone z ${k === 'deposits' ? 'wpłat' : 'zakupów netto'}${rest}`],
  [/^\. Tracked: (\d+) tickers\.$/, '. Śledzone: $1 tickerów.'], [/^Inflation: (.+)\. Type the official rate into any period to override the estimate\.$/, 'Inflacja: $1. Wpisz oficjalne oprocentowanie w dowolnym okresie, aby zastąpić szacunek.'],
  [/^incl\. cash (.+)$/, 'w tym gotówka $1'], [/^net invested (.+)$/, 'wpłacono netto $1'], [/^last 12m · next 12m ≈ (.+)$/, 'ost. 12 mies. · prognoza ≈ $1'],
  [/^([\d\s,.\u00a0]+) sh · avg (.+)$/, '$1 szt. · śr. $2'], [/^unrealized (.+)$/, 'niezrealizowany $1'], [/^TTM (.+)\/sh$/, '12 mies.: $1/akcję'],
  [/^base (.+) rounded$/, 'podstawa $1 (po zaokr.)'], [/^sec\. G · gross (.+), withheld (.+)$/, 'cz. G · brutto $1, pobrano $2'], [/^paid out (.+)$/, 'wypłacono $1'],
  [/^fee (.+) · tax (.+?)( \(IKE\/IKZE: no tax\))?$/, (m, a, b, c) => `opłata ${a} · podatek ${b}${c ? ' (IKE/IKZE: bez podatku)' : ''}`], [/^since (.+)$/, 'od $1'],
  [/^([\d\s,.\u00a0]+) bonds × (.+)$/, '$1 obligacji × $2'], [/^matured — record the payout$/, 'wykupione — zapisz wypłatę'], [/^(\d+) y (\d+) m$/, '$1 l. $2 mies.'],
  [/^Targets add up to$/, 'Suma celów:'], [/^(.+) is ([\d.,]+) pp (above|below) its target weight\.$/, (m, a, b, c) => `${a} odbiega o ${b} pp ${c === 'above' ? 'w górę' : 'w dół'} od docelowego udziału.`],
  [/^positions (.+) · cash, fees & FX (.+)$/, 'pozycje $1 · gotówka, opłaty i kursy $2'],
  [/^(\d+)% winners$/, '$1% zyskownych'], [/^(\d+) d$/, '$1 dni'],
  [/^per share, ([A-Z]{3})$/, 'na akcję, $1'], [/^About (.+)$/, 'O spółce: $1'], [/^(\d+) y$/, '$1 lat'],
  [/^PIT-38 (\d{4}) — estimate$/, 'PIT-38 $1 — szacunek'],
  [/^(.+) change$/, 'zmiana $1'], [/^(\d+) payments$/, '$1 wypłat'], [/^Transactions \((\d+)\)$/, 'Transakcje ($1)'],
  [/^Old prices for (.+) — the ticker may be delisted or renamed \(use “Change ticker…” in its details\) or set a manual price\.$/, 'Stare ceny dla $1 — spółka mogła zostać wycofana lub zmienić ticker (użyj „Zmień ticker…” w szczegółach) albo ustaw cenę ręcznie.'],
  [/^No market data for (.+)\. Add them to tickers\.json \(Settings → Market data\) or set a manual price\.$/, 'Brak danych rynkowych dla $1. Dodaj je do tickers.json (Ustawienia → Dane rynkowe) lub ustaw cenę ręcznie.'],
  [/^Sync error: (.+)$/, 'Błąd synchronizacji: $1'], [/^Synced (.+)$/, 'Zsynchronizowano $1'], [/^(\d+) transactions ready/, (m) => m.replace(/^(\d+) transactions ready/, '$1 transakcji gotowych')],
];

export function t(s) {
  if (lang !== 'pl' || !s) return s;
  const key = String(s).replace(/\s+/g, ' ').trim();
  if (PL[key]) return PL[key];
  for (const [re, rep] of PATTERNS) if (re.test(key)) return key.replace(re, rep);
  return s;
}

function translateNode(node) {
  if (node.nodeType === 3) {
    const v = node.nodeValue;
    if (!v || !/[A-Za-z]/.test(v)) return;
    const out = t(v);
    if (out !== v) {
      const lead = v.match(/^\s*/)[0], trail = v.match(/\s*$/)[0];
      node.nodeValue = lead + out + trail;
    }
    return;
  }
  if (node.nodeType !== 1 || node.matches?.('script, style, textarea, code, .no-i18n')) return;
  for (const attr of ['placeholder', 'title', 'aria-label']) {
    const v = node.getAttribute?.(attr);
    if (v) { const out = t(v); if (out !== v) node.setAttribute(attr, out); }
  }
  for (const c of node.childNodes) translateNode(c);
}

let observer = null;
export function startTranslation(root = document.body) {
  observer?.disconnect();
  if (lang !== 'pl') return;
  translateNode(root);
  observer = new MutationObserver((muts) => {
    observer.disconnect(); // avoid reacting to our own edits
    for (const m of muts) {
      if (m.type === 'characterData') translateNode(m.target);
      for (const n of m.addedNodes || []) translateNode(n);
    }
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
}
