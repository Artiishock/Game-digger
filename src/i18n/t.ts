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
  'coins':                           'coins',
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
  'press anywhere to close':         'Press anywhere to close',
  'press anywhere to continue':      'Press anywhere to continue',
  'loss':                            'Loss',
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
  'distance':                        'Distance',
  'depth':                           'Depth',
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
  'music':                           'Music',
  'music desc':                      'Turn off/on music',
  'battery saver':                   'Battery Saver',
  'battery saver desc':              'Save battery life by reducing animation speed',
  'intro screen':                    'Intro Screen',
  'intro screen desc':               'Show the intro screen before starting the game',
  'enable space':                    'Enable Space',
  'enable space desc':               'Press space bar to play',

  // ── start screen slides ─────────────────────────────────────────────────────
  'collect multipliers':             'Collect Multipliers',
  'avoid threats':                   'Avoid Threats',
  'get to safe place':               'Get to a Safe Place to Secure the Winnings',

  // ── info panel ──────────────────────────────────────────────────────────────
  'how to play':                     'How to Play',
  'how to play p1':                  'Choose your bet amount using the controls in the "Bet" field and press the "Start" button. The character will begin the descent. At the start of each round, the multiplier is always x0.0.',
  'how to play p2':                  'During the descent, the character may encounter bombs, rocks, coins, gold nuggets, or diamonds. A bomb halves the current multiplier, rocks subtract from it, coins and gold nuggets increase it, and diamonds multiply the current multiplier by their value.',
  'how to play p3':                  'If the character reaches the house without falling into lava, the player wins, and all multipliers are applied to the bet. If the character hits lava, the bet is lost.',
  'multiplier objects':              'Multiplier Objects',
  'gold nuggets':                    'Gold Nuggets',
  'diamonds':                        'Diamonds',
  'rocks':                           'Rocks',
  'bomb':                            'Bomb',
  'win and loss':                    'Win & Loss',
  'win desc':                        'The character successfully reaches the house without touching lava — your result is counted as a win.',
  'loss desc':                       'The round ends in a loss if the character falls into lava.',
  'rules':                           'Rules',
  'rules p1':                        'The maximum win is capped at x250 of your play amount.',
  'rules p2':                        'If your win exceeds your bet, it is rounded up to the nearest whole number. If it is lower than your bet, it is rounded down.',
  'rules p3':                        'Opening the rules during a round will pause the game.',
  'autoplay':                        'Autoplay',
  'autoplay p1':                     'The game includes an autoplay mode. Press the "Auto" (A) button and select the number of plays. Press it again to stop autoplay.',
  'autoplay p2':                     'You can also configure stop conditions:',
  'autoplay li1':                    'On any win',
  'autoplay li2':                    'If a single win exceeds a set amount',
  'autoplay li3':                    'If balance increases by a set amount',
  'autoplay li4':                    'If balance decreases by a set amount',
  'settings section':                'Settings',
  'settings p1':                     'You can adjust character speed using the four buttons (turtle, human, rabbit, horse).',
  'settings p2':                     'The menu provides:',
  'settings li1':                    'Music and sound volume control',
  'settings li2':                    'Moving the "Start" button anywhere on screen',
  'settings li3':                    'Battery saver mode (reduces visual effects)',
  'settings p3':                     'You can also access rules and history from this menu.',
  'return to player':                'Return to Player',
  'rtp value':                       'The overall RTP is 96.7%.',
  'path generation':                 'Path Generation',
  'path generation li1':             'The character\'s path is randomly generated each round.',
  'path generation li2':             'Objects are generated at the moment the "Start" button is pressed.',
  'additional information':          'Additional Information',
  'additional info p1':              'In case of technical issues, all rounds and winnings may be voided. Every 24 hours, unfinished rounds are automatically resolved.',
  'additional info p2':              'If a "Collect" option is available, winnings are credited automatically. Otherwise, results are calculated as if the player chose the safest option.',
  'rules version':                   'Rules version 1.0 (April 26, 2026). Game version 1.0.0.',

  // ── replay table ────────────────────────────────────────────────────────────
  'time':                            'Time',
  'currency':                        'Currency',
  'replay':                          'Replay',
  'plays history empty':             'plays history is empty',
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
  'coins':                           'monedas',
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
  'press anywhere to close':         'Toca en cualquier lugar para cerrar',
  'press anywhere to continue':      'Toca en cualquier lugar para continuar',
  'loss':                            'Pérdida',
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
  'distance':                        'Distancia',
  'depth':                           'Profundidad',
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
  'music':                           'Música',
  'music desc':                      'Activar/desactivar música',
  'battery saver':                   'Ahorro de batería',
  'battery saver desc':              'Ahorra batería reduciendo la velocidad de animación',
  'intro screen':                    'Pantalla de inicio',
  'intro screen desc':               'Mostrar la pantalla de inicio antes de comenzar el juego',
  'enable space':                    'Activar espacio',
  'enable space desc':               'Presiona la barra espaciadora para jugar',

  // ── start screen slides ─────────────────────────────────────────────────────
  'collect multipliers':             'Recolecta multiplicadores',
  'avoid threats':                   'Evita amenazas',
  'get to safe place':               'Llega a un lugar seguro para asegurar las ganancias',

  // ── info panel ──────────────────────────────────────────────────────────────
  'how to play':                     'Cómo jugar',
  'how to play p1':                  'Elige tu monto de apuesta usando los controles en el campo "Apuesta" y presiona el botón "Inicio". El personaje comenzará el descenso. Al inicio de cada ronda, el multiplicador siempre es x0.0.',
  'how to play p2':                  'Durante el descenso, el personaje puede encontrar bombas, rocas, monedas, pepitas de oro o diamantes. Una bomba reduce a la mitad el multiplicador actual, las rocas lo restan, las monedas y pepitas de oro lo aumentan, y los diamantes multiplican el multiplicador actual por su valor.',
  'how to play p3':                  'Si el personaje llega a la casa sin caer en la lava, el jugador gana y todos los multiplicadores se aplican a la apuesta. Si el personaje toca la lava, la apuesta se pierde.',
  'multiplier objects':              'Objetos multiplicadores',
  'gold nuggets':                    'Pepitas de oro',
  'diamonds':                        'Diamantes',
  'rocks':                           'Rocas',
  'bomb':                            'Bomba',
  'win and loss':                    'Victoria y derrota',
  'win desc':                        'El personaje llega exitosamente a la casa sin tocar la lava — tu resultado se cuenta como victoria.',
  'loss desc':                       'La ronda termina en derrota si el personaje cae en la lava.',
  'rules':                           'Reglas',
  'rules p1':                        'La ganancia máxima está limitada a x250 de tu monto de jugada.',
  'rules p2':                        'Si tu ganancia supera tu apuesta, se redondea al número entero superior. Si es menor, se redondea hacia abajo.',
  'rules p3':                        'Abrir las reglas durante una ronda pausará el juego.',
  'autoplay':                        'Juego automático',
  'autoplay p1':                     'El juego incluye un modo de juego automático. Presiona el botón "Auto" (A) y selecciona el número de jugadas. Presiona de nuevo para detenerlo.',
  'autoplay p2':                     'También puedes configurar condiciones de parada:',
  'autoplay li1':                    'En cualquier ganancia',
  'autoplay li2':                    'Si una ganancia supera una cantidad establecida',
  'autoplay li3':                    'Si el saldo aumenta en una cantidad establecida',
  'autoplay li4':                    'Si el saldo disminuye en una cantidad establecida',
  'settings section':                'Configuración',
  'settings p1':                     'Puedes ajustar la velocidad del personaje usando los cuatro botones (tortuga, humano, conejo, caballo).',
  'settings p2':                     'El menú ofrece:',
  'settings li1':                    'Control de volumen de música y sonido',
  'settings li2':                    'Mover el botón "Inicio" a cualquier lugar de la pantalla',
  'settings li3':                    'Modo ahorro de batería (reduce efectos visuales)',
  'settings p3':                     'También puedes acceder a las reglas e historial desde este menú.',
  'return to player':                'Retorno al jugador',
  'rtp value':                       'El RTP general es del 96.7%.',
  'path generation':                 'Generación del recorrido',
  'path generation li1':             'El recorrido del personaje se genera aleatoriamente en cada ronda.',
  'path generation li2':             'Los objetos se generan en el momento en que se presiona el botón "Inicio".',
  'additional information':          'Información adicional',
  'additional info p1':              'En caso de problemas técnicos, todas las rondas y ganancias pueden anularse. Cada 24 horas, las rondas inconclusas se resuelven automáticamente.',
  'additional info p2':              'Si hay una opción de "Cobrar" disponible, las ganancias se acreditan automáticamente. De lo contrario, los resultados se calculan como si el jugador hubiera elegido la opción más segura.',
  'rules version':                   'Versión de reglas 1.0 (26 de abril de 2026). Versión del juego 1.0.0.',

  // ── replay table ────────────────────────────────────────────────────────────
  'time':                            'Hora',
  'currency':                        'Moneda',
  'replay':                          'Repetición',
  'plays history empty':             'el historial de jugadas está vacío',
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
  'coins':                           'Münzen',
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
  'press anywhere to close':         'Tippe irgendwo, um zu schließen',
  'press anywhere to continue':      'Tippe irgendwo, um fortzufahren',
  'loss':                            'Verlust',
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
  'distance':                        'Distanz',
  'depth':                           'Tiefe',
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
  'music':                           'Musik',
  'music desc':                      'Musik ein-/ausschalten',
  'battery saver':                   'Energiesparmodus',
  'battery saver desc':              'Akku schonen durch reduzierte Animationsgeschwindigkeit',
  'intro screen':                    'Intro-Bildschirm',
  'intro screen desc':               'Intro-Bildschirm vor dem Spielstart anzeigen',
  'enable space':                    'Leertaste aktivieren',
  'enable space desc':               'Drücke die Leertaste zum Spielen',

  // ── start screen slides ─────────────────────────────────────────────────────
  'collect multipliers':             'Multiplikatoren sammeln',
  'avoid threats':                   'Bedrohungen ausweichen',
  'get to safe place':               'Erreiche einen sicheren Ort, um die Gewinne zu sichern',

  // ── info panel ──────────────────────────────────────────────────────────────
  'how to play':                     'Spielanleitung',
  'how to play p1':                  'Wähle deinen Einsatz über die Steuerelemente im Feld "Einsatz" und drücke den "Start"-Button. Der Charakter beginnt den Abstieg. Am Anfang jeder Runde beträgt der Multiplikator immer x1,0.',
  'how to play p2':                  'Während des Abstiegs kann der Charakter auf Bomben, Steine, Münzen, Goldnuggets oder Diamanten treffen. Eine Bombe halbiert den aktuellen Multiplikator, Steine ziehen ihn ab, Münzen und Goldnuggets erhöhen ihn, und Diamanten multiplizieren den aktuellen Multiplikator mit ihrem Wert.',
  'how to play p3':                  'Erreicht der Charakter das Haus, ohne in Lava zu fallen, gewinnt der Spieler und alle Multiplikatoren werden auf den Einsatz angewendet. Berührt der Charakter Lava, ist der Einsatz verloren.',
  'multiplier objects':              'Multiplikator-Objekte',
  'gold nuggets':                    'Goldnuggets',
  'diamonds':                        'Diamanten',
  'rocks':                           'Steine',
  'bomb':                            'Bombe',
  'win and loss':                    'Sieg & Niederlage',
  'win desc':                        'Der Charakter erreicht erfolgreich das Haus, ohne Lava zu berühren — dein Ergebnis wird als Sieg gewertet.',
  'loss desc':                       'Die Runde endet mit einer Niederlage, wenn der Charakter in Lava fällt.',
  'rules':                           'Regeln',
  'rules p1':                        'Der maximale Gewinn ist auf x250 deines Spieleinsatzes begrenzt.',
  'rules p2':                        'Übersteigt dein Gewinn deinen Einsatz, wird er auf die nächste ganze Zahl aufgerundet. Ist er niedriger, wird er abgerundet.',
  'rules p3':                        'Das Öffnen der Regeln während einer Runde pausiert das Spiel.',
  'autoplay':                        'Automatisches Spielen',
  'autoplay p1':                     'Das Spiel bietet einen Automatikmodus. Drücke den "Auto" (A)-Button und wähle die Anzahl der Spiele. Drücke erneut, um den Automatikmodus zu beenden.',
  'autoplay p2':                     'Du kannst auch Stoppbedingungen konfigurieren:',
  'autoplay li1':                    'Bei jedem Gewinn',
  'autoplay li2':                    'Wenn ein Einzelgewinn einen festgelegten Betrag übersteigt',
  'autoplay li3':                    'Wenn das Guthaben um einen festgelegten Betrag steigt',
  'autoplay li4':                    'Wenn das Guthaben um einen festgelegten Betrag sinkt',
  'settings section':                'Einstellungen',
  'settings p1':                     'Du kannst die Charaktergeschwindigkeit mit den vier Buttons (Schildkröte, Mensch, Hase, Pferd) anpassen.',
  'settings p2':                     'Das Menü bietet:',
  'settings li1':                    'Lautstärkeregelung für Musik und Sound',
  'settings li2':                    'Den "Start"-Button an beliebiger Stelle auf dem Bildschirm platzieren',
  'settings li3':                    'Energiesparmodus (reduziert visuelle Effekte)',
  'settings p3':                     'Regeln und Verlauf sind ebenfalls über dieses Menü zugänglich.',
  'return to player':                'Auszahlungsquote',
  'rtp value':                       'Die Gesamtauszahlungsquote beträgt 96,7%.',
  'path generation':                 'Pfaderzeugung',
  'path generation li1':             'Der Weg des Charakters wird in jeder Runde zufällig generiert.',
  'path generation li2':             'Objekte werden beim Drücken des "Start"-Buttons generiert.',
  'additional information':          'Zusätzliche Informationen',
  'additional info p1':              'Bei technischen Problemen können alle Runden und Gewinne annulliert werden. Alle 24 Stunden werden unvollendete Runden automatisch abgeschlossen.',
  'additional info p2':              'Wenn eine "Auszahlen"-Option verfügbar ist, werden Gewinne automatisch gutgeschrieben. Andernfalls werden die Ergebnisse berechnet, als hätte der Spieler die sicherste Option gewählt.',
  'rules version':                   'Regelversion 1.0 (26. April 2026). Spielversion 1.0.0.',

  // ── replay table ────────────────────────────────────────────────────────────
  'time':                            'Zeit',
  'currency':                        'Währung',
  'replay':                          'Wiederholung',
  'plays history empty':             'Spielverlauf ist leer',
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
  'coins':                           'монеты',
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
  'press anywhere to close':         'Нажмите в любое место, чтобы закрыть',
  'press anywhere to continue':      'Нажмите в любое место, чтобы продолжить',
  'loss':                            'Проигрыш',
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
  'distance':                        'Дистанция',
  'depth':                           'Глубина',
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
  'music':                           'Музыка',
  'music desc':                      'Включить/выключить музыку',
  'battery saver':                   'Экономия батареи',
  'battery saver desc':              'Экономьте заряд батареи, снижая скорость анимации',
  'intro screen':                    'Вступительный экран',
  'intro screen desc':               'Показывать вступительный экран перед началом игры',
  'enable space':                    'Включить пробел',
  'enable space desc':               'Нажмите пробел для игры',

  // ── start screen slides ─────────────────────────────────────────────────────
  'collect multipliers':             'Собирай множители',
  'avoid threats':                   'Избегай угроз',
  'get to safe place':               'Доберись до безопасного места, чтобы сохранить выигрыш',

  // ── info panel ──────────────────────────────────────────────────────────────
  'how to play':                     'Как играть',
  'how to play p1':                  'Выберите сумму ставки с помощью элементов управления в поле «Ставка» и нажмите кнопку «Старт». Персонаж начнёт спуск. В начале каждого раунда множитель всегда равен x0.0.',
  'how to play p2':                  'Во время спуска персонаж может встретить бомбы, камни, монеты, золотые самородки или бриллианты. Бомба уменьшает текущий множитель вдвое, камни вычитают из него, монеты и самородки увеличивают, а бриллианты умножают текущий множитель на своё значение.',
  'how to play p3':                  'Если персонаж достигает домика, не упав в лаву, игрок побеждает и все множители применяются к ставке. Если персонаж попадает в лаву, ставка проиграна.',
  'multiplier objects':              'Объекты-множители',
  'gold nuggets':                    'Золотые самородки',
  'diamonds':                        'Бриллианты',
  'rocks':                           'Камни',
  'bomb':                            'Бомба',
  'win and loss':                    'Победа и поражение',
  'win desc':                        'Персонаж успешно достигает домика, не коснувшись лавы — результат засчитывается как победа.',
  'loss desc':                       'Раунд заканчивается поражением, если персонаж падает в лаву.',
  'rules':                           'Правила',
  'rules p1':                        'Максимальный выигрыш ограничен x250 от суммы ставки.',
  'rules p2':                        'Если выигрыш превышает ставку, он округляется до ближайшего целого числа вверх. Если он ниже ставки — округляется вниз.',
  'rules p3':                        'Открытие правил во время раунда приостанавливает игру.',
  'autoplay':                        'Автоигра',
  'autoplay p1':                     'В игре есть режим автоигры. Нажмите кнопку «Авто» (A) и выберите количество игр. Нажмите ещё раз, чтобы остановить автоигру.',
  'autoplay p2':                     'Вы также можете настроить условия остановки:',
  'autoplay li1':                    'При любом выигрыше',
  'autoplay li2':                    'Если один выигрыш превышает заданную сумму',
  'autoplay li3':                    'Если баланс увеличится на заданную сумму',
  'autoplay li4':                    'Если баланс уменьшится на заданную сумму',
  'settings section':                'Настройки',
  'settings p1':                     'Вы можете регулировать скорость персонажа с помощью четырёх кнопок (черепаха, человек, кролик, лошадь).',
  'settings p2':                     'Меню предоставляет:',
  'settings li1':                    'Регулировка громкости музыки и звука',
  'settings li2':                    'Перемещение кнопки «Старт» в любое место экрана',
  'settings li3':                    'Режим экономии батареи (снижает визуальные эффекты)',
  'settings p3':                     'Также из этого меню можно открыть правила и историю.',
  'return to player':                'Возврат игроку',
  'rtp value':                       'Общий RTP составляет 96,7%.',
  'path generation':                 'Генерация пути',
  'path generation li1':             'Путь персонажа генерируется случайно в каждом раунде.',
  'path generation li2':             'Объекты генерируются в момент нажатия кнопки «Старт».',
  'additional information':          'Дополнительная информация',
  'additional info p1':              'В случае технических проблем все раунды и выигрыши могут быть аннулированы. Каждые 24 часа незавершённые раунды автоматически закрываются.',
  'additional info p2':              'Если доступна опция «Забрать», выигрыши начисляются автоматически. В противном случае результаты рассчитываются так, как если бы игрок выбрал наиболее безопасный вариант.',
  'rules version':                   'Версия правил 1.0 (26 апреля 2026 г.). Версия игры 1.0.0.',

  // ── replay table ────────────────────────────────────────────────────────────
  'time':                            'Время',
  'currency':                        'Валюта',
  'replay':                          'Повтор',
  'plays history empty':             'история игр пуста',
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
  'coins':                           'jetonlar',
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
  'press anywhere to close':         'Kapatmak için herhangi bir yere dokunun',
  'press anywhere to continue':      'Devam etmek için herhangi bir yere dokunun',
  'loss':                            'Kayıp',
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
  'distance':                        'Mesafe',
  'depth':                           'Derinlik',
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
  'music':                           'Müzik',
  'music desc':                      'Müziği aç/kapat',
  'battery saver':                   'Pil tasarrufu',
  'battery saver desc':              'Animasyon hızını azaltarak pil tasarrufu sağla',
  'intro screen':                    'Giriş ekranı',
  'intro screen desc':               'Oyun başlamadan önce giriş ekranını göster',
  'enable space':                    'Boşluk tuşunu etkinleştir',
  'enable space desc':               'Oynamak için boşluk tuşuna bas',

  // ── start screen slides ─────────────────────────────────────────────────────
  'collect multipliers':             'Çarpanları topla',
  'avoid threats':                   'Tehditlerden kaçın',
  'get to safe place':               'Kazançlarını güvence altına almak için güvenli bir yere ulaş',

  // ── info panel ──────────────────────────────────────────────────────────────
  'how to play':                     'Nasıl oynanır',
  'how to play p1':                  '"Bahis" alanındaki kontrolleri kullanarak bahis miktarını seçin ve "Başlat" düğmesine basın. Karakter inişe başlayacak. Her turun başında çarpan her zaman x1,0\'dır.',
  'how to play p2':                  'İniş sırasında karakter bombalar, kayalar, bozuk paralar, altın külçeler veya elmaslarla karşılaşabilir. Bomba mevcut çarpanı yarıya indirir, kayalar çıkarır, bozuk paralar ve altın külçeler artırır, elmaslar ise mevcut çarpanı kendi değerleriyle çarpar.',
  'how to play p3':                  'Karakter lavaya düşmeden eve ulaşırsa oyuncu kazanır ve tüm çarpanlar bahse uygulanır. Karakter lavaya değerse bahis kaybedilir.',
  'multiplier objects':              'Çarpan nesneleri',
  'gold nuggets':                    'Altın külçeleri',
  'diamonds':                        'Elmaslar',
  'rocks':                           'Kayalar',
  'bomb':                            'Bomba',
  'win and loss':                    'Kazanç & Kayıp',
  'win desc':                        'Karakter lavaya değmeden başarıyla eve ulaşır — sonucunuz kazanç olarak sayılır.',
  'loss desc':                       'Karakter lavaya düşerse tur kayıpla sona erer.',
  'rules':                           'Kurallar',
  'rules p1':                        'Maksimum kazanç, oyun miktarınızın x250\'si ile sınırlıdır.',
  'rules p2':                        'Kazancınız bahsinizi aşarsa bir üst tam sayıya yuvarlanır. Bahsinizden düşükse aşağı yuvarlanır.',
  'rules p3':                        'Tur sırasında kuralların açılması oyunu duraklatır.',
  'autoplay':                        'Otomatik oyun',
  'autoplay p1':                     '"Oto" (A) düğmesine basın ve oyun sayısını seçin. Otomatik oyunu durdurmak için tekrar basın.',
  'autoplay p2':                     'Ayrıca durdurma koşullarını yapılandırabilirsiniz:',
  'autoplay li1':                    'Herhangi bir kazançta',
  'autoplay li2':                    'Tek bir kazanç belirli bir miktarı aşarsa',
  'autoplay li3':                    'Bakiye belirli bir miktar artarsa',
  'autoplay li4':                    'Bakiye belirli bir miktar azalırsa',
  'settings section':                'Ayarlar',
  'settings p1':                     'Dört düğme (kaplumbağa, insan, tavşan, at) kullanarak karakter hızını ayarlayabilirsiniz.',
  'settings p2':                     'Menü şunları sunar:',
  'settings li1':                    'Müzik ve ses seviyesi kontrolü',
  'settings li2':                    '"Başlat" düğmesini ekranın herhangi bir yerine taşıma',
  'settings li3':                    'Pil tasarrufu modu (görsel efektleri azaltır)',
  'settings p3':                     'Bu menüden kurallara ve geçmişe de erişebilirsiniz.',
  'return to player':                'Oyuncuya dönüş',
  'rtp value':                       'Genel RTP %96,7\'dir.',
  'path generation':                 'Yol oluşturma',
  'path generation li1':             'Karakterin yolu her turda rastgele oluşturulur.',
  'path generation li2':             'Nesneler "Başlat" düğmesine basıldığı anda oluşturulur.',
  'additional information':          'Ek bilgi',
  'additional info p1':              'Teknik sorunlar durumunda tüm turlar ve kazançlar iptal edilebilir. Her 24 saatte bir tamamlanmamış turlar otomatik olarak çözüme kavuşturulur.',
  'additional info p2':              '"Topla" seçeneği mevcutsa kazançlar otomatik olarak yatırılır. Aksi takdirde sonuçlar, oyuncunun en güvenli seçeneği seçmiş gibi hesaplanır.',
  'rules version':                   'Kurallar sürüm 1.0 (26 Nisan 2026). Oyun sürümü 1.0.0.',

  // ── replay table ────────────────────────────────────────────────────────────
  'time':                            'Zaman',
  'currency':                        'Para birimi',
  'replay':                          'Tekrar izle',
  'plays history empty':             'oyun geçmişi boş',
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
