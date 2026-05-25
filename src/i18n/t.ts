/**
 * Minimal phrase lookup using Phrase_*.json vocabulary.
 * lang URL-param (set by Stake Engine host) selects the language map.
 * Falls back to English for unknown languages / missing phrases.
 */

type PhraseMap = Record<string, string>

const en: PhraseMap = {
  // ── existing ────────────────────────────────────────────────────────────────
  'play feature':                    'play feature',
  'win / won':                       'win / won',
  'win':                             'win',
  'play amount':                     'play amount',
  'won':                             'won',
  'play / playing':                  'play / playing',
  'total play':                      'total play',
  'play':                            'play',
  'plays':                           'plays',
  'spin start':                      'Start',
  'spin rewind':                     'Rewind',
  'coins':                               'Coin',
  'winner':                          'winner',
  'wins':                            'wins',
  'instantly triggered':             'instantly triggered',
  'for':                             'for',
  'respin':                          'respin',
  'can be played for':               'can be played for',
  'balance':                         'balance',
  'get bonus':                       'get bonus',
  'get coins':                       'get coins',
  'redeem':                          'redeem',
  'bonus / feature':                 'bonus / feature',
  'appear in player\'s accounts':    'appear in player\'s accounts',
  'playing':                         'playing',
  'come and play / join in the game':'come and play / join in the game',
  'play/s':                          'play/s',
  'token':                           'token',

  // ── overlays ────────────────────────────────────────────────────────────────
  'claim':                           'Claim',
  'press anywhere to close':         'Press anywhere to close',
  'press anywhere to continue':      'Press anywhere to continue',
  'loss':                            'loss',
  'connection error':                'Connection Error',
  'error message':                   'An error occurred. Please try refreshing the page.',
  'refresh':                         'Refresh',
  'game paused':                     'Game paused while menu is open',

  // ── navigation / hud ────────────────────────────────────────────────────────
  'information':                     'Information',
  'history':                         'History',
  'settings':                        'Settings',
  'mute':                            'Mute',
  'unmute':                          'Unmute',
  'win label':                       'WIN',
  'last win':                        'LAST WIN',
  'distance':                        'Distance',
  'depth':                           'Depth',
  'last distance':                   'Last distance',
  'last depth':                      'Last depth',
  'bet':                             'Bet',
  'multiplier':                      'Multiplier',

  // ── autoplay ────────────────────────────────────────────────────────────────
  'stop conditions':                 'Stop Conditions',
  'on any win':                      'On any win',
  'if single win exceeds':           'If single win exceeds',
  'if balance increases by':         'If cash balance increases by',
  'if balance decreases by':         'If cash balance decreases by',
  'custom number of plays':          'Custom number of plays',

  // ── settings panel ──────────────────────────────────────────────────────────
  'music':                           'MASTER VOLUME',
  'music desc':                      'Turns off all game audio — music and sound effects (same as the speaker button).',
  'battery saver':                   'Battery Saver',
  'battery saver desc':              'Save battery life by reducing animation speed',
  'depth hud':                       'Show Distance',
  'depth hud desc':                  'Show distance and depth in the corner while you play.',
  'enable space':                    'Enable Space',
  'enable space desc':               'Press space bar to play',

  // ── start screen slides ─────────────────────────────────────────────────────
  'collect multipliers':             'Collect Multipliers',
  'avoid threats':                   'Avoid Threats',
  'get to safe place':               'Get to a Safe Place to Secure the Winnings',

  // ── info panel ──────────────────────────────────────────────────────────────
  'how to play':                     'How to Play',
  'how to play p1':                      'Choose the bet size using the buttons in the “Bet” field and press the “START” button. The character will begin diving.',
  'how to play p2':                      'During the dive, the character may encounter a bomb, a rock, a coin, a gold nugget, or a diamond. A bomb halves the current multiplier, a rock subtracts from it, a coin and a gold nugget add to the current multiplier, and a diamond (with “x”) multiplies the current multiplier by its number.',
  'how to play p3':                      'If the character reaches the house without falling into lava, the player receives a win. If the character falls into lava, the player loses the bet. The multiplier cannot go below 0.',
  'multiplier objects':                  'Objects affecting the multiplier',
  'gold nuggets':                        'Gold Nuggets',
  'diamonds':                            'Diamond',
  'rocks':                           'Rocks',
  'bomb':                            'Bomb',
  'win and loss':                        'Wins or Loss',
  'win desc':                            'The character successfully reached the house and did not collide with lava — your current result is counted as a win.',
  'loss desc':                           'The round ends in a loss if the character falls into lava',
  'rules':                           'Rules',
  'rules p1':                            'The maximum win is x475 of the bet.',
  'rules p2':                            'If your win exceeds your bet, the game will round your win up to the nearest whole number. If your win is less than your bet, the game will round it down to the nearest whole number.',
  'rules p3':                            'If you open the game rules during a round, the game is paused.',
  'autoplay':                        'Autoplay',
  'autoplay p1':                         'The game has an auto mode. To activate it, press the “Auto” (A) button and select the number of rounds. To exit auto mode, press the “Auto” (A) button again.',
  'autoplay p2':                         'In the same menu, you can configure game stop conditions. Autoplay can be stopped:',
  'autoplay li1':                    'On any win',
  'autoplay li2':                        'If a single win exceeds the specified number',
  'autoplay li3':                        'If the balance value increases by the specified number',
  'autoplay li4':                        'If the balance value decreases by the specified number',
  'settings section':                'Settings',
  'settings p1':                         'You can adjust the character speed using four buttons on the screen (turtle, human, hare, and horse). The menu button opens a panel with the following settings:',
  'settings p2':                         '',
  'settings li1':                        'Music and sound effects volume control',
  'settings li2':                        '',
  'settings li3':                        '',
  'settings p3':                         'In the same menu, you can find the game rules and game history by pressing the button on the right side of the screen.',
  'return to player':                    'Return to Player Percentage',
  'rtp value':                           'The overall return to player percentage is 96.2%',
  'path generation':                     'Route Generation',
  'path generation li1':                 'The character’s game route is randomly generated within each round.',
  'path generation li2':                 'Random objects located on the character’s path are generated in random places when the “Start” button is pressed.',
  'additional information':          'Additional Information',
  'additional info p1':                  'In case of game failures, all played rounds and winnings in them are voided! Every 24 hours, all unfinished rounds are completed. If “Collect” is available in the game, the game will perform “Collect” and the win will be credited to the player’s balance. If the game is waiting for player action, the result is calculated as if the player chose an action without risk and without increasing the initial bet.',
  'additional info p2':                  '',
  'rules version':                       'Game rules version 1.0 dated May 11, 2026. Game version 1.0.0.',

  // ── replay table ────────────────────────────────────────────────────────────
  'time':                            'Time',
  'currency':                        'Currency',
  'replay':                          'Replay',
  'plays history empty':             'plays history is empty',

  // ── balance validation ───────────────────────────────────────────────────────
  'insufficient funds':              'Insufficient funds',
  'demo balance empty':              'Demo balance depleted. Register to play for real!',
}

const es: PhraseMap = {
  // ── existing ────────────────────────────────────────────────────────────────
  'play feature':                    'función de juego',
  'win / won':                       'ganancia / ganado',
  'win':                             'ganancia',
  'play amount':                     'monto de la jugada',
  'won':                             'ganado',
  'play / playing':                  'jugada / jugando',
  'total play':                      'total de jugadas',
  'play':                            'jugar',
  'plays':                           'jugadas',
  'spin start':                      'Iniciar',
  'spin rewind':                     'Rebobinar',
  'coins':                               'Moneda',
  'winner':                          'ganador',
  'wins':                            'ganancias',
  'instantly triggered':             'activado al instante',
  'for':                             'por',
  'respin':                          'regiro (respin)',
  'can be played for':               'se puede jugar por',
  'balance':                         'saldo',
  'get bonus':                       'obtener bono',
  'get coins':                       'obtener monedas',
  'redeem':                          'canjear',
  'bonus / feature':                 'bono / función',
  'appear in player\'s accounts':    'aparece en las cuentas de los jugadores',
  'playing':                         'jugando',
  'come and play / join in the game':'ven y juega / únete al juego',
  'play/s':                          'jugada/s',
  'token':                           'ficha',

  // ── overlays ────────────────────────────────────────────────────────────────
  'claim':                           'Reclamar',
  'press anywhere to close':         'Toca en cualquier lugar para cerrar',
  'press anywhere to continue':      'Toca en cualquier lugar para continuar',
  'loss':                            'pérdida',
  'connection error':                'Error de conexión',
  'error message':                   'Se produjo un error. Intenta recargar la página.',
  'refresh':                         'Recargar',
  'game paused':                     'Juego pausado mientras el menú está abierto',

  // ── navigation / hud ────────────────────────────────────────────────────────
  'information':                     'Información',
  'history':                         'Historial',
  'settings':                        'Configuración',
  'mute':                            'Silenciar',
  'unmute':                          'Activar sonido',
  'win label':                       'GANANCIA',
  'last win':                        'ÚLTIMA GANANCIA',
  'distance':                        'Distancia',
  'depth':                           'Profundidad',
  'last distance':                   'Última distancia',
  'last depth':                      'Última profundidad',
  'bet':                             'Apuesta',
  'multiplier':                      'Multiplicador',

  // ── autoplay ────────────────────────────────────────────────────────────────
  'stop conditions':                 'Condiciones de parada',
  'on any win':                      'En cualquier ganancia',
  'if single win exceeds':           'Si una ganancia supera',
  'if balance increases by':         'Si el saldo aumenta en',
  'if balance decreases by':         'Si el saldo disminuye en',
  'custom number of plays':          'Número personalizado de jugadas',

  // ── settings panel ──────────────────────────────────────────────────────────
  'music':                           'Volumen maestro',
  'music desc':                      'Desactiva todo el audio del juego: música y efectos de sonido (igual que el altavoz).',
  'battery saver':                   'Ahorro de batería',
  'battery saver desc':              'Ahorra batería reduciendo la velocidad de animación',
  'depth hud':                       'Mostrar distancia',
  'depth hud desc':                  'Muestra distancia y profundidad en la esquina durante el juego.',
  'enable space':                    'Activar espacio',
  'enable space desc':               'Presiona la barra espaciadora para jugar',

  // ── start screen slides ─────────────────────────────────────────────────────
  'collect multipliers':             'Recolecta multiplicadores',
  'avoid threats':                   'Evita amenazas',
  'get to safe place':               'Llega a un lugar seguro para asegurar las ganancias',

  // ── info panel ──────────────────────────────────────────────────────────────
  'how to play':                     'Cómo jugar',
  'how to play p1':                      'Elige el tamaño de la apuesta usando los botones del campo “Apuesta” y pulsa el botón “INICIAR”. El personaje comenzará la inmersión.',
  'how to play p2':                      'Durante la inmersión, el personaje puede encontrarse con una bomba, una roca, una moneda, una pepita de oro o un diamante. La bomba divide el multiplicador actual a la mitad, la roca resta, la moneda y la pepita de oro suman al multiplicador actual, y el diamante (con “x”) multiplica el multiplicador actual por su número.',
  'how to play p3':                      'Si el personaje llega a la casa sin caer en la lava, el jugador recibe una ganancia. Si el personaje cae en la lava, el jugador pierde la apuesta. El multiplicador no puede bajar de 0.',
  'multiplier objects':                  'Objetos que afectan al multiplicador',
  'gold nuggets':                        'Pepitas de oro',
  'diamonds':                            'Diamante',
  'rocks':                           'Rocas',
  'bomb':                            'Bomba',
  'win and loss':                        'Victorias o derrota',
  'win desc':                            'El personaje llegó con éxito a la casa y no chocó con la lava — tu resultado actual se cuenta como victoria.',
  'loss desc':                           'La ronda termina en derrota si el personaje cae en la lava',
  'rules':                           'Reglas',
  'rules p1':                            'La ganancia máxima es x475 de la apuesta.',
  'rules p2':                            'Si tu ganancia supera tu apuesta, el juego redondeará tu ganancia hacia arriba al número entero más cercano. Si tu ganancia es menor que tu apuesta, el juego la redondeará hacia abajo al número entero más cercano.',
  'rules p3':                            'Si abres las reglas del juego durante una ronda, el juego se pausa.',
  'autoplay':                        'Juego automático',
  'autoplay p1':                         'El juego tiene un modo automático. Para activarlo, pulsa el botón “Auto” (A) y elige el número de rondas. Para salir del modo automático, pulsa de nuevo el botón “Auto” (A).',
  'autoplay p2':                         'En este mismo menú puedes configurar las condiciones de parada del juego. Puedes elegir detener el juego automático:',
  'autoplay li1':                    'En cualquier ganancia',
  'autoplay li2':                        'Si una sola ganancia supera el número indicado',
  'autoplay li3':                        'si el valor del saldo aumenta en el número indicado',
  'autoplay li4':                        'Si el valor del saldo disminuye en el número indicado',
  'settings section':                'Configuración',
  'settings p1':                         'Puedes ajustar la velocidad del personaje con cuatro botones en la pantalla (tortuga, humano, liebre y caballo). El botón de menú abre un panel con los siguientes ajustes:',
  'settings p2':                         '',
  'settings li1':                        'Control de volumen de la música y los efectos de sonido',
  'settings li2':                        '',
  'settings li3':                        '',
  'settings p3':                         'En este mismo menú puedes encontrar las reglas y el historial del juego pulsando el botón de la parte derecha de la pantalla.',
  'return to player':                    'Porcentaje de retorno al jugador',
  'rtp value':                           'El porcentaje total de retorno al jugador es 96.2%',
  'path generation':                     'Generación de ruta',
  'path generation li1':                 'La ruta de juego del personaje se genera aleatoriamente dentro de cada ronda.',
  'path generation li2':                 'Los objetos aleatorios ubicados en el camino del personaje se generan en lugares aleatorios al pulsar el botón “Iniciar”.',
  'additional information':          'Información adicional',
  'additional info p1':                  'En caso de fallos en el juego, todas las rondas jugadas y sus ganancias se anulan. Cada 24 horas se completan todas las rondas no terminadas. Si “Cobrar” está disponible en el juego, el juego realizará “Cobrar” y la ganancia se acreditará al saldo del jugador. Si el juego espera una acción del jugador, el resultado se calcula como si el jugador hubiera elegido una acción sin riesgo y sin aumentar la apuesta inicial.',
  'additional info p2':                  '',
  'rules version':                       'Versión de las reglas del juego 1.0 del 11 de mayo de 2026. Versión del juego 1.0.0.',

  // ── replay table ────────────────────────────────────────────────────────────
  'time':                            'Hora',
  'currency':                        'Moneda',
  'replay':                          'Repetición',
  'plays history empty':             'el historial de jugadas está vacío',

  // ── balance validation ───────────────────────────────────────────────────────
  'insufficient funds':              'Fondos insuficientes',
  'demo balance empty':              '¡Saldo demo agotado. ¡Regístrate para jugar con dinero real!',
}

const de: PhraseMap = {
  // ── existing ────────────────────────────────────────────────────────────────
  'play feature':                    'Spielfunktion',
  'win / won':                       'Gewinn / gewonnen',
  'win':                             'Gewinn',
  'play amount':                     'Spieleinsatz',
  'won':                             'gewonnen',
  'play / playing':                  'Spiel / spielend',
  'total play':                      'Spiele insgesamt',
  'play':                            'spielen',
  'plays':                           'Spiele',
  'spin start':                      'Start',
  'spin rewind':                     'Zurückspulen',
  'coins':                               'Münze',
  'winner':                          'Gewinner',
  'wins':                            'Gewinne',
  'instantly triggered':             'sofort ausgelöst',
  'for':                             'für',
  'respin':                          'Respin (erneutes Drehen)',
  'can be played for':               'kann gespielt werden für',
  'balance':                         'Guthaben',
  'get bonus':                       'Bonus erhalten',
  'get coins':                       'Münzen erhalten',
  'redeem':                          'einlösen',
  'bonus / feature':                 'Bonus / Funktion',
  'appear in player\'s accounts':    'erscheint auf den Spielerkonten',
  'playing':                         'spielend',
  'come and play / join in the game':'komm und spiele / mach beim Spiel mit',
  'play/s':                          'Spiel/e',
  'token':                           'Token',

  // ── overlays ────────────────────────────────────────────────────────────────
  'claim':                           'Einfordern',
  'press anywhere to close':         'Tippe irgendwo, um zu schließen',
  'press anywhere to continue':      'Tippe irgendwo, um fortzufahren',
  'loss':                            'verlust',
  'connection error':                'Verbindungsfehler',
  'error message':                   'Ein Fehler ist aufgetreten. Bitte lade die Seite neu.',
  'refresh':                         'Neu laden',
  'game paused':                     'Spiel pausiert, während das Menü geöffnet ist',

  // ── navigation / hud ────────────────────────────────────────────────────────
  'information':                     'Informationen',
  'history':                         'Verlauf',
  'settings':                        'Einstellungen',
  'mute':                            'Stummschalten',
  'unmute':                          'Ton einschalten',
  'win label':                       'GEWINN',
  'last win':                        'LETZTER GEWINN',
  'distance':                        'Distanz',
  'depth':                           'Tiefe',
  'last distance':                   'Letzte Distanz',
  'last depth':                      'Letzte Tiefe',
  'bet':                             'Einsatz',
  'multiplier':                      'Multiplikator',

  // ── autoplay ────────────────────────────────────────────────────────────────
  'stop conditions':                 'Stoppbedingungen',
  'on any win':                      'Bei jedem Gewinn',
  'if single win exceeds':           'Wenn ein Einzelgewinn übersteigt',
  'if balance increases by':         'Wenn das Guthaben steigt um',
  'if balance decreases by':         'Wenn das Guthaben sinkt um',
  'custom number of plays':          'Benutzerdefinierte Spielanzahl',

  // ── settings panel ──────────────────────────────────────────────────────────
  'music':                           'Master-Lautstärke',
  'music desc':                      'Schaltet die gesamte Spiel-Audio aus — Musik und Soundeffekte (wie die Lautsprecher-Taste).',
  'battery saver':                   'Energiesparmodus',
  'battery saver desc':              'Akku schonen durch reduzierte Animationsgeschwindigkeit',
  'depth hud':                       'Distanz anzeigen',
  'depth hud desc':                  'Zeigt Weg und Tiefe während des Spiels in der Ecke.',
  'enable space':                    'Leertaste aktivieren',
  'enable space desc':               'Drücke die Leertaste zum Spielen',

  // ── start screen slides ─────────────────────────────────────────────────────
  'collect multipliers':             'Multiplikatoren sammeln',
  'avoid threats':                   'Bedrohungen ausweichen',
  'get to safe place':               'Erreiche einen sicheren Ort, um die Gewinne zu sichern',

  // ── info panel ──────────────────────────────────────────────────────────────
  'how to play':                     'Spielanleitung',
  'how to play p1':                      'Wähle die Einsatzhöhe über die Buttons im Feld „Einsatz“ und drücke den Button „START“. Der Charakter beginnt den Tauchgang.',
  'how to play p2':                      'Während des Tauchgangs kann der Charakter auf eine Bombe, einen Stein, eine Münze, ein Goldnugget oder einen Diamanten treffen. Die Bombe halbiert den aktuellen Multiplikator, der Stein zieht ab, Münze und Goldnugget addieren zum aktuellen Multiplikator, und der Diamant (mit „x“) multipliziert den aktuellen Multiplikator mit seiner Zahl.',
  'how to play p3':                      'Wenn der Charakter das Haus erreicht, ohne in die Lava zu fallen, erhält der Spieler einen Gewinn. Wenn der Charakter in die Lava fällt, verliert der Spieler den Einsatz. Der Multiplikator kann nicht unter 0 fallen.',
  'multiplier objects':                  'Objekte, die den Multiplikator beeinflussen',
  'gold nuggets':                        'Goldnuggets',
  'diamonds':                            'Diamant',
  'rocks':                           'Steine',
  'bomb':                            'Bombe',
  'win and loss':                        'Gewinne oder Niederlage',
  'win desc':                            'Der Charakter hat das Haus erfolgreich erreicht und ist nicht mit Lava kollidiert — dein aktuelles Ergebnis wird als Gewinn gewertet.',
  'loss desc':                           'Die Runde endet mit einer Niederlage, wenn der Charakter in die Lava fällt',
  'rules':                           'Regeln',
  'rules p1':                            'Der maximale Gewinn beträgt x475 des Einsatzes.',
  'rules p2':                            'Wenn dein Gewinn deinen Einsatz übersteigt, rundet das Spiel deinen Gewinn auf die nächste ganze Zahl auf. Wenn dein Gewinn niedriger als dein Einsatz ist, rundet das Spiel ihn auf die nächste ganze Zahl ab.',
  'rules p3':                            'Wenn du die Spielregeln während einer Runde öffnest, wird das Spiel pausiert.',
  'autoplay':                        'Automatisches Spielen',
  'autoplay p1':                         'Das Spiel hat einen Automodus. Um ihn zu aktivieren, drücke den Button „Auto“ (A) und wähle die Anzahl der Runden. Um den Automodus zu verlassen, drücke erneut den Button „Auto“ (A).',
  'autoplay p2':                         'Im selben Menü kannst du die Bedingungen zum Stoppen des Spiels einstellen. Du kannst den Autospiel-Modus stoppen:',
  'autoplay li1':                    'Bei jedem Gewinn',
  'autoplay li2':                        'Wenn ein einzelner Gewinn die angegebene Zahl überschreitet',
  'autoplay li3':                        'wenn sich der Kontostand um die angegebene Zahl erhöht',
  'autoplay li4':                        'Wenn sich der Kontostand um die angegebene Zahl verringert',
  'settings section':                'Einstellungen',
  'settings p1':                         'Du kannst die Geschwindigkeit des Charakters mit vier Buttons auf dem Bildschirm einstellen (Schildkröte, Mensch, Hase und Pferd). Der Menübutton öffnet ein Panel mit den folgenden Einstellungen:',
  'settings p2':                         '',
  'settings li1':                        'Lautstärkeregelung für Musik und Soundeffekte',
  'settings li2':                        '',
  'settings li3':                        '',
  'settings p3':                         'Im selben Menü findest du die Spielregeln und den Spielverlauf, indem du den Button auf der rechten Seite des Bildschirms drückst.',
  'return to player':                    'Rückzahlungsquote an den Spieler',
  'rtp value':                           'Die gesamte Rückzahlungsquote an den Spieler beträgt 96.2%',
  'path generation':                     'Routengenerierung',
  'path generation li1':                 'Die Spielroute des Charakters wird innerhalb jeder Runde zufällig generiert.',
  'path generation li2':                 'Zufällige Objekte auf dem Weg des Charakters werden beim Drücken des Buttons „Start“ an zufälligen Stellen generiert.',
  'additional information':          'Zusätzliche Informationen',
  'additional info p1':                  'Bei Spielstörungen werden alle gespielten Runden und die darin erzielten Gewinne annulliert! Alle 24 Stunden werden alle nicht abgeschlossenen Runden beendet. Wenn im Spiel „Collect“ verfügbar ist, führt das Spiel „Collect“ aus und der Gewinn wird dem Guthaben des Spielers gutgeschrieben. Wenn das Spiel auf eine Aktion des Spielers wartet, wird das Ergebnis so berechnet, als hätte der Spieler eine Aktion ohne Risiko und ohne Erhöhung des ursprünglichen Einsatzes gewählt.',
  'additional info p2':                  '',
  'rules version':                       'Version der Spielregeln 1.0 vom 11. Mai 2026. Spielversion 1.0.0.',

  // ── replay table ────────────────────────────────────────────────────────────
  'time':                            'Zeit',
  'currency':                        'Währung',
  'replay':                          'Wiederholung',
  'plays history empty':             'Spielverlauf ist leer',

  // ── balance validation ───────────────────────────────────────────────────────
  'insufficient funds':              'Nicht genug Guthaben',
  'demo balance empty':              'Demo-Guthaben aufgebraucht. Registriere dich für echtes Geld!',
}

const ru: PhraseMap = {
  // ── existing ────────────────────────────────────────────────────────────────
  'play feature':                    'игровая функция',
  'win / won':                       'выигрыш / выиграл',
  'win':                             'выигрыш',
  'play amount':                     'сумма ставки',
  'won':                             'выиграл',
  'play / playing':                  'игра / играющий',
  'total play':                      'всего игр',
  'play':                            'играть',
  'plays':                           'игр',
  'spin start':                      'Старт',
  'spin rewind':                     'Перемотка',
  'coins':                           'Монета',
  'winner':                          'победитель',
  'wins':                            'выигрыши',
  'instantly triggered':             'мгновенно активируется',
  'for':                             'за',
  'respin':                          'респин (повторное вращение)',
  'can be played for':               'можно сыграть за',
  'balance':                         'баланс',
  'get bonus':                       'получить бонус',
  'get coins':                       'получить монеты',
  'redeem':                          'обменять',
  'bonus / feature':                 'бонус / функция',
  'appear in player\'s accounts':    'появляется на счетах игроков',
  'playing':                         'играющий',
  'come and play / join in the game':'приходи и играй / присоединяйся к игре',
  'play/s':                          'игра/ставка',
  'token':                           'жетон',

  // ── overlays ────────────────────────────────────────────────────────────────
  'claim':                           'Забрать',
  'press anywhere to close':         'Нажмите в любое место, чтобы закрыть',
  'press anywhere to continue':      'Нажмите в любое место, чтобы продолжить',
  'loss':                            'проигрыш',
  'connection error':                'Ошибка соединения',
  'error message':                   'Произошла ошибка. Попробуйте обновить страницу.',
  'refresh':                         'Обновить',
  'game paused':                     'Игра приостановлена пока открыто меню',

  // ── navigation / hud ────────────────────────────────────────────────────────
  'information':                     'Информация',
  'history':                         'История',
  'settings':                        'Настройки',
  'mute':                            'Выключить звук',
  'unmute':                          'Включить звук',
  'win label':                       'ВЫИГРЫШ',
  'last win':                        'ПОСЛЕДНИЙ ВЫИГРЫШ',
  'distance':                        'Дистанция',
  'depth':                           'Глубина',
  'last distance':                   'Последняя дистанция',
  'last depth':                      'Последняя глубина',
  'bet':                             'Ставка',
  'multiplier':                      'Множитель',

  // ── autoplay ────────────────────────────────────────────────────────────────
  'stop conditions':                 'Условия остановки',
  'on any win':                      'При любом выигрыше',
  'if single win exceeds':           'Если один выигрыш превысит',
  'if balance increases by':         'Если баланс увеличится на',
  'if balance decreases by':         'Если баланс уменьшится на',
  'custom number of plays':          'Произвольное количество игр',

  // ── settings panel ──────────────────────────────────────────────────────────
  'music':                           'Общая громкость',
  'music desc':                      'Выключает весь звук игры — музыку и эффекты (как кнопка динамика).',
  'battery saver':                   'Экономия батареи',
  'battery saver desc':              'Экономьте заряд батареи, снижая скорость анимации',
  'depth hud':                       'Показывать дистанцию',
  'depth hud desc':                  'Показывает дистанцию и глубину в углу во время игры.',
  'enable space':                    'Включить пробел',
  'enable space desc':               'Нажмите пробел для игры',

  // ── start screen slides ─────────────────────────────────────────────────────
  'collect multipliers':             'Собирай множители',
  'avoid threats':                   'Избегай угроз',
  'get to safe place':               'Доберись до безопасного места, чтобы сохранить выигрыш',

  // ── info panel ──────────────────────────────────────────────────────────────
  'how to play':                     'Как играть',
  'how to play p1':                  'Выберете размер ставки, используя кнопки в поле “Ставка” и нажмите на кнопку “ПУСК”. Персонаж начнет погружение.',
  'how to play p2':                  'Во время погружения персонаж может наткнуться на бомбу, камень, монетку, золотой самородок или бриллиант. Бомба делит текущий множитель пополам пополам, камень вычитает, монета и золотой самородок прибавляет к текущему множителю, бриллиант (с “х”) умножает текущий множитель на свое число.',
  'how to play p3':                  'Если персонаж добирается до домика, не попав в лаву, игрок получает выигрыш. Если персонаж попадает в лаву, игрок теряет ставку. Множитель не может опуститься ниже 0.',
  'multiplier objects':              'Объекты влияющие на множитель',
  'gold nuggets':                    'Золотые самородки',
  'diamonds':                        'Бриллиант',
  'rocks':                           'Камни',
  'bomb':                            'Бомба',
  'win and loss':                    'Победы или поражение',
  'win desc':                        'Персонаж успешно добрался до дома, и не столкнулся с лавой — ваш текущий результат засчитывается как победа.',
  'loss desc':                       'Раунд заканчивается проигрышем, если персонаж попал в лаву',
  'rules':                           'Правила',
  'rules p1':                        'Максимальный выигрыш составляет х475 от ставки.',
  'rules p2':                        'Если ваш выигрыш превышает вашу ставку, игра округлит ваш выигрыш вверх до ближайшего целого числа. Если ваш выигрыш меньше вашей ставки, игра округлит его вниз до ближайшего целого числа.',
  'rules p3':                        'Если вы откроете правила игры во время раунда, игра приостанавливается.',
  'autoplay':                        'Автоигра',
  'autoplay p1':                     'В игре есть авторежим. Чтобы его активировать, нажмите на кнопку “Авто” (А) и выберете количество раундов. Для выхода из авторежима нужно снова нажать кнопку “авто” (А).',
  'autoplay p2':                     'В этом же меню вы можете настроить условия остановки игры. Можно выбрать остановку автоигры:',
  'autoplay li1':                    'При любом выигрыше',
  'autoplay li2':                    'Если один выигрыш превышает указанное число',
  'autoplay li3':                    'если значение баланса увеличивается на указанное число',
  'autoplay li4':                    'Если значение баланса уменьшается на указанное число',
  'settings section':                'Настройки',
  'settings p1':                     'Вы можете регулировать скорость персонажа с помощью четырех кнопок на экране (черепаха, человек, заяц и лошадь). Кнопка меню открывает панель со следующими настройками:',
  'settings p2':                     '',
  'settings li1':                    'Регулировка громкости музыки и звуковых эффектов',
  'settings li2':                    '',
  'settings li3':                    '',
  'settings p3':                     'В этом же меню вы можете найти правила и историю игры. нажав на кнопку в правой части экрана.',
  'return to player':                'Процент возврата игроку',
  'rtp value':                       'Общий процент возврата игроку составляет 96.2%',
  'path generation':                 'Генерация маршрута',
  'path generation li1':             'Игровой маршрут персонажа имеет случайную генерацию в рамках каждого раунда.',
  'path generation li2':             'Случайный объекты располагающиеся на пути персонажа генерируются в момент нажатия кнопки “Пуск” в случайных местах.',
  'additional information':          'Дополнительная информация',
  'additional info p1':              'В случае сбоев в игре все сыгранные раунды и выигрыши в них аннулируются! Каждые 24 часа происходит завершение всех незавершенных раундов. Если в игре доступен “Коллект” - игра сделает “Коллект” и выигрыш будет зачислен на баланс игрока. Если игра ожидает действия игрока, то результат рассчитывается таким образом, как если бы игрок выбрал действие без риска и повышения первоначальной ставки.',
  'additional info p2':              '',
  'rules version':                   'Версия правил игры 1.0 от 11 мая 2026 года. Версия игры 1.0.0.',

  // ── replay table ────────────────────────────────────────────────────────────
  'time':                            'Время',
  'currency':                        'Валюта',
  'replay':                          'Повтор',
  'plays history empty':             'история игр пуста',

  // ── balance validation ───────────────────────────────────────────────────────
  'insufficient funds':              'Недостаточно средств',
  'demo balance empty':              'Демо-баланс исчерпан. Зарегистрируйтесь для игры на реальные деньги!',
}

const tr: PhraseMap = {
  // ── existing ────────────────────────────────────────────────────────────────
  'play feature':                    'oyun özelliği',
  'win / won':                       'kazanç / kazandı',
  'win':                             'kazanç',
  'play amount':                     'oyun tutarı',
  'won':                             'kazandı',
  'play / playing':                  'oyun / oynuyor',
  'total play':                      'toplam oyun',
  'play':                            'oyna',
  'plays':                           'oyunlar',
  'spin start':                      'Başlat',
  'spin rewind':                     'Geri sar',
  'coins':                               'Jeton',
  'winner':                          'kazanan',
  'wins':                            'kazançlar',
  'instantly triggered':             'anında tetiklenir',
  'for':                             'için',
  'respin':                          'yeniden döndürme (respin)',
  'can be played for':               'ile oynanabilir',
  'balance':                         'bakiye',
  'get bonus':                       'bonus al',
  'get coins':                       'jeton al',
  'redeem':                          'kullan / paraya çevir',
  'bonus / feature':                 'bonus / özellik',
  'appear in player\'s accounts':    'oyuncu hesaplarında görünür',
  'playing':                         'oynuyor',
  'come and play / join in the game':'gel ve oyna / oyuna katıl',
  'play/s':                          'oyun/lar',
  'token':                           'jeton',

  // ── overlays ────────────────────────────────────────────────────────────────
  'claim':                           'Al',
  'press anywhere to close':         'Kapatmak için herhangi bir yere dokunun',
  'press anywhere to continue':      'Devam etmek için herhangi bir yere dokunun',
  'loss':                            'kayıp',
  'connection error':                'Bağlantı Hatası',
  'error message':                   'Bir hata oluştu. Lütfen sayfayı yenileyin.',
  'refresh':                         'Yenile',
  'game paused':                     'Menü açıkken oyun duraklatıldı',

  // ── navigation / hud ────────────────────────────────────────────────────────
  'information':                     'Bilgi',
  'history':                         'Geçmiş',
  'settings':                        'Ayarlar',
  'mute':                            'Sesi kapat',
  'unmute':                          'Sesi aç',
  'win label':                       'KAZANÇ',
  'last win':                        'SON KAZANÇ',
  'distance':                        'Mesafe',
  'depth':                           'Derinlik',
  'last distance':                   'Son mesafe',
  'last depth':                      'Son derinlik',
  'bet':                             'Bahis',
  'multiplier':                      'Çarpan',

  // ── autoplay ────────────────────────────────────────────────────────────────
  'stop conditions':                 'Durdurma koşulları',
  'on any win':                      'Herhangi bir kazançta',
  'if single win exceeds':           'Tek kazanç aşarsa',
  'if balance increases by':         'Bakiye artarsa',
  'if balance decreases by':         'Bakiye azalırsa',
  'custom number of plays':          'Özel oyun sayısı',

  // ── settings panel ──────────────────────────────────────────────────────────
  'music':                           'Ana ses',
  'music desc':                      'Tüm oyun sesini kapatır — müzik ve efektler (hoparlör düğmesiyle aynı).',
  'battery saver':                   'Pil tasarrufu',
  'battery saver desc':              'Animasyon hızını azaltarak pil tasarrufu sağla',
  'depth hud':                       'Mesafeyi göster',
  'depth hud desc':                  'Oynarken köşede mesafe ve derinliği göster.',
  'enable space':                    'Boşluk tuşunu etkinleştir',
  'enable space desc':               'Oynamak için boşluk tuşuna bas',

  // ── start screen slides ─────────────────────────────────────────────────────
  'collect multipliers':             'Çarpanları topla',
  'avoid threats':                   'Tehditlerden kaçın',
  'get to safe place':               'Kazançlarını güvence altına almak için güvenli bir yere ulaş',

  // ── info panel ──────────────────────────────────────────────────────────────
  'how to play':                     'Nasıl oynanır',
  'how to play p1':                      '“Bahis” alanındaki düğmeleri kullanarak bahis boyutunu seçin ve “BAŞLAT” düğmesine basın. Karakter dalışa başlayacaktır.',
  'how to play p2':                      'Dalış sırasında karakter bir bomba, kaya, jeton, altın külçesi veya elmasla karşılaşabilir. Bomba mevcut çarpanı ikiye böler, kaya çıkarır, jeton ve altın külçesi mevcut çarpana ekler, elmas (“x” ile) mevcut çarpanı kendi sayısıyla çarpar.',
  'how to play p3':                      'Karakter lavlara düşmeden eve ulaşırsa oyuncu kazanç elde eder. Karakter lavlara düşerse oyuncu bahsi kaybeder. Çarpan 0’ın altına düşemez.',
  'multiplier objects':                  'Çarpanı etkileyen nesneler',
  'gold nuggets':                        'Altın külçeleri',
  'diamonds':                            'Elmas',
  'rocks':                           'Kayalar',
  'bomb':                            'Bomba',
  'win and loss':                        'Kazançlar veya kayıp',
  'win desc':                            'Karakter başarıyla eve ulaştı ve lavla çarpışmadı — mevcut sonucunuz kazanç olarak sayılır.',
  'loss desc':                           'Karakter lava düşerse tur kayıpla sona erer',
  'rules':                           'Kurallar',
  'rules p1':                            'Maksimum kazanç bahsin x475 katıdır.',
  'rules p2':                            'Kazancınız bahsinizi aşarsa oyun kazancınızı en yakın tam sayıya yukarı yuvarlar. Kazancınız bahsinizden düşükse oyun bunu en yakın tam sayıya aşağı yuvarlar.',
  'rules p3':                            'Bir tur sırasında oyun kurallarını açarsanız oyun duraklatılır.',
  'autoplay':                        'Otomatik oyun',
  'autoplay p1':                         'Oyunda otomatik mod vardır. Etkinleştirmek için “Auto” (A) düğmesine basın ve tur sayısını seçin. Otomatik moddan çıkmak için “Auto” (A) düğmesine tekrar basın.',
  'autoplay p2':                         'Aynı menüde oyun durdurma koşullarını ayarlayabilirsiniz. Otomatik oyunu durdurmayı seçebilirsiniz:',
  'autoplay li1':                    'Herhangi bir kazançta',
  'autoplay li2':                        'Tek bir kazanç belirtilen sayıyı aşarsa',
  'autoplay li3':                        'bakiye değeri belirtilen sayı kadar artarsa',
  'autoplay li4':                        'Bakiye değeri belirtilen sayı kadar azalırsa',
  'settings section':                'Ayarlar',
  'settings p1':                         'Ekrandaki dört düğmeyi kullanarak karakter hızını ayarlayabilirsiniz (kaplumbağa, insan, tavşan ve at). Menü düğmesi aşağıdaki ayarların bulunduğu paneli açar:',
  'settings p2':                         '',
  'settings li1':                        'Müzik ve ses efektleri ses seviyesi ayarı',
  'settings li2':                        '',
  'settings li3':                        '',
  'settings p3':                         'Aynı menüde ekranın sağ tarafındaki düğmeye basarak oyun kurallarını ve oyun geçmişini bulabilirsiniz.',
  'return to player':                    'Oyuncuya dönüş yüzdesi',
  'rtp value':                           'Toplam oyuncuya dönüş yüzdesi 96.2%',
  'path generation':                     'Rota oluşturma',
  'path generation li1':                 'Karakterin oyun rotası her tur kapsamında rastgele oluşturulur.',
  'path generation li2':                 'Karakterin yolunda bulunan rastgele nesneler “Başlat” düğmesine basıldığı anda rastgele yerlerde oluşturulur.',
  'additional information':          'Ek bilgi',
  'additional info p1':                  'Oyunda arıza olması durumunda oynanan tüm turlar ve bu turlardaki kazançlar iptal edilir! Her 24 saatte bir tüm tamamlanmamış turlar tamamlanır. Oyunda “Collect” mevcutsa oyun “Collect” işlemini yapar ve kazanç oyuncunun bakiyesine yatırılır. Oyun oyuncunun eylemini bekliyorsa sonuç, oyuncu risk almadan ve başlangıç bahsini artırmadan bir eylem seçmiş gibi hesaplanır.',
  'additional info p2':                  '',
  'rules version':                       'Oyun kuralları sürümü 1.0, 11 Mayıs 2026. Oyun sürümü 1.0.0.',

  // ── replay table ────────────────────────────────────────────────────────────
  'time':                            'Zaman',
  'currency':                        'Para birimi',
  'replay':                          'Tekrar izle',
  'plays history empty':             'oyun geçmişi boş',

  // ── balance validation ───────────────────────────────────────────────────────
  'insufficient funds':              'Yetersiz bakiye',
  'demo balance empty':              'Demo bakiyesi tükendi. Gerçek parayla oynamak için kaydolun!',
}

const MAPS: Record<string, PhraseMap> = { en, es, de, ru, tr }

let _resolvedLang: string | null = null

function resolveLang(): string {
  if (_resolvedLang !== null) return _resolvedLang
  try {
    const p = new URLSearchParams(window.location.search)
    const raw = p.get('locale') ?? p.get('lang') ?? 'en'
    _resolvedLang = raw.split('-')[0].toLowerCase()
  } catch {
    _resolvedLang = 'en'
  }
  return _resolvedLang
}

/** Returns the localised phrase. Falls back to the key itself if not found. */
export function t(phrase: string): string {
  const map = MAPS[resolveLang()] ?? MAPS.en
  return map[phrase] ?? en[phrase] ?? phrase
}

/** Uppercase variant — convenient for label elements. */
export function T(phrase: string): string {
  return t(phrase).toUpperCase()
}

// ── Dev helper ────────────────────────────────────────────────────────────────
// Available in browser console: __setLang('ru')  __setLang('en')  __setLang('tr')
if (typeof window !== 'undefined') {
  const supported = Object.keys(MAPS).join(' | ')
  ;(window as unknown as Record<string, unknown>).__setLang = (lang: string) => {
    const code = lang.split('-')[0].toLowerCase()
    if (!MAPS[code]) {
      console.warn(`[i18n] unknown lang "${code}". Supported: ${supported}`)
      return
    }
    const url = new URL(window.location.href)
    url.searchParams.delete('locale')
    url.searchParams.set('lang', code)
    window.location.href = url.toString()
  }
  console.info(`[i18n] __setLang(lang) available — supported: ${supported}`)
}
