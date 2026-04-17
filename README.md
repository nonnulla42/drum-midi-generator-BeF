# Rule-Based Drum MIDI Generator

Desktop app Python con interfaccia grafica per generare pattern di batteria MIDI in modo parametrico, rule-based e ripetibile.

Il progetto non usa AI per comporre i pattern: il comportamento nasce da regole metriche, priorita ritmiche, fill, ghost notes e humanization controllata.

## Cosa Fa Bene

- genera groove drum coerenti a partire da una struttura metrica definita con `Beat Grouping`
- lavora bene sia in `4/4` sia in metri dispari derivati dal grouping, come `3+2` o `3+2+2`
- mantiene il controllo musicale tramite parametri globali chiari e pannelli strumento separati
- permette ascolto immediato con playback interno e export MIDI standard
- supporta ghost notes dedicate su `Snare`, `Hi-Hat Closed` e `Ride`
- rende il pattern ripetibile tramite `Seed`

## Filosofia Del Tool

L'idea centrale e semplice:

- il `Beat Grouping` definisce come e costruita la battuta
- la `Time Signature` e una conseguenza del grouping, non un input separato
- il motore lavora internamente con `8` slot per ogni quarto
- il denominatore e fissato a `4`, perche oggi il generatore e progettato attorno a questa base

In pratica:

- `4` produce un `4/4`
- `3+2` produce un `5/4`
- `3+2+2` produce un `7/4`

I preset possono valorizzare questa logica senza introdurre un campo separato per la time signature:

- `Alt Groove - 5/4 - Verse` usa `3+2`
- `Math Drive - 7/4 - Verse` usa `3+2+2`

## Avvio Rapido

1. Crea un ambiente virtuale opzionale:

```powershell
python -m venv .venv
.venv\Scripts\activate
```

2. Installa le dipendenze:

```powershell
pip install -r requirements.txt
```

3. Avvia l'app:

```powershell
python main.py
```

## Workflow Consigliato

1. Imposta `BPM` e `Beat Grouping`
2. Se vuoi, carica un `Preset` come punto di partenza
3. Lascia `Pattern Length` a `1` per uno sketch rapido
4. Regola kick, snare e pulse principale
5. Genera il pattern base
6. Se vuoi, attiva `Edit Grid` e correggi il pattern direttamente in griglia
7. Se serve, rigenera solo le ghost notes sul base corrente
8. Solo dopo attiva i fill
9. Ascolta con `Play` oppure esporta in MIDI

Questo ordine aiuta molto a giudicare bene il groove prima di sporcarlo con variazioni e fill.

## Interfaccia

### Global Controls

#### `Presets`

Carica un set di parametri consigliato per un contesto musicale.

Importante:

- un preset imposta solo i parametri
- non genera automaticamente un pattern
- dopo il preset puoi modificare tutto a mano
- il pattern nasce solo quando premi `Generate Pattern`

Questo significa che puoi:

- applicare un preset
- premere `Generate Pattern` piu volte per ottenere varianti diverse con gli stessi parametri, se `Seed` e `Random`
- fissare un `Seed` per rendere quel preset ripetibile

#### `BPM`

Controlla solo la velocita temporale del pattern in playback e in export MIDI.

Non cambia la disposizione dei colpi nella griglia: cambia solo quanto velocemente vengono eseguiti.

#### `Pattern Length`

Numero di battute generate.

Valori disponibili:

- `1`
- `2`
- `4`
- `8`

Default: `1`

E il default migliore per fare prove veloci e capire subito il groove.

#### `Beat Grouping`

E il parametro metrico principale del progetto.

Esempi validi:

- `4`
- `2+2`
- `3+2`
- `3+2+2`

Regole:

- i gruppi ammessi sono `1`, `2`, `3`, `4`
- il campo non puo essere vuoto
- la struttura viene validata prima della generazione

Il grouping influenza:

- accenti metrici
- punti strutturali di kick e snare
- ultima zona di battuta usata dai fill
- numeratore finale della time signature

#### `Time Signature`

Campo read-only derivato automaticamente dal grouping.

Esempi:

- `4` -> `4/4`
- `3+2` -> `5/4`
- `3+2+2` -> `7/4`

#### `Swing`

Sposta in ritardo parte delle suddivisioni nel timing reale.

Effetto pratico:

- non cambia quali slot sono attivi
- cambia quando quei colpi partono in playback e nel file MIDI

#### `Humanize Timing`

Applica micro-spostamenti casuali nel tempo.

Il parametro UI resta `0-24`, ma internamente usa una scala non lineare piu progressiva. Questo rende i valori bassi e medi piu musicali e meno bruschi.

Indicazione pratica:

- `0` = timing rigido
- `4-8` = naturale
- `8-12` = groove vivo
- `12+` = loose

Le ghost notes restano sempre un po piu mobili rispetto ai colpi normali.

Per `Kick`, `Snare`, `Hi-Hat Closed` e `Ride` e disponibile anche `Timing Feel`:

- `Neutral` = nessun bias extra
- `Push` = leggero anticipo costante
- `Drag` = leggero ritardo costante
- `Random` = piccola direzione casuale attorno allo zero

#### `Humanize Velocity`

Applica variazioni casuali di velocity.

Anche qui il valore UI `0-24` viene mappato con una scala non lineare interna, per evitare salti troppo aggressivi nella parte alta.

Indicazione pratica:

- `0` = dinamica piatta
- `4-8` = naturale
- `8-12` = piu espressiva
- `12+` = molto variabile

Le ghost vengono trattate in modo piu controllato, per restare leggere ma leggibili.

#### `Bar Similarity`

Controlla quanto le battute successive restano vicine alla prima.

Effetto:

- `0.0` = ogni battuta piu libera
- `1.0` = battute quasi identiche alla prima

Kick e snare sono i layer che seguono di piu questa logica; gli altri strati restano un po piu elastici.

#### `Fill Every`

Definisce ogni quante battute attivare una regione di fill.

Esempio:

- con `4`, il fill cade sulla quarta, ottava, dodicesima battuta, se presenti

#### `Fill Length`

Definisce quanta parte finale dell'ultimo gruppo metrico viene riservata al fill.

Valori:

- `short`
- `medium`
- `long`

#### `Fill Intensity`

Controlla quanto il fill riscrive davvero la zona finale.

Valori:

- `off`
- `low`
- `medium`
- `high`

Default: `off`

E una scelta voluta: prima si giudica il groove, poi si introduce la distruzione controllata del fill.

#### `Seed`

Serve per rendere la generazione ripetibile.

Comportamento:

- `Random` = ogni generazione puo cambiare
- numero fisso = stesso setup, stesso pattern

Questo e molto utile per:

- confrontare piccoli cambi di parametri
- fare debug del motore
- esportare varianti coerenti

#### `Edit Grid`

Attiva la modifica diretta del pattern nella griglia.

Quando `Edit Grid` e attivo:

- click su una cella vuota aggiunge un `base hit`
- click su un `base hit` lo rimuove
- drag orizzontale su un `base hit` lo sposta sulla stessa riga
- click su una `ghost` la rimuove
- drag orizzontale su una `ghost` la sposta sulla stessa riga

Regole importanti:

- il layer `base` ha sempre priorita sul layer `ghost`
- non puoi creare due hit dello stesso strumento nella stessa cella
- spostare un hit mantiene `velocity`, `micro_timing_offset`, `length_ticks` e `priority`
- l'aggiunta manuale diretta vale solo per i `base hits`, non per le `ghost`

Questa modalita e il modo piu rapido per trasformare il tool da generatore a correttore manuale del groove.

### Playback & Actions

#### `Generate Pattern`

Genera il pattern base a partire dai controlli globali e dai pannelli strumento.

#### `Generate Ghosts`

Rigenera solo le ghost notes del pattern gia esistente.

Le ghost non sono il pattern principale: sono un layer aggiuntivo e separato.

#### `Export MIDI`

Esporta il pattern corrente in un file `.mid` standard.

Il file include:

- tempo
- time signature
- note MIDI della batteria
- swing e micro-timing gia applicati

#### `Clear`

Pulisce il pattern corrente e ferma il playback.

#### `Randomize`

Randomizza parte dei parametri globali e dei parametri strumento.

Utile per esplorare rapidamente nuove direzioni ritmiche.

#### `Play`, `Stop`, `Loop`

Controllano il playback interno del pattern attualmente visualizzato.

## Grid Editing

La griglia non e piu solo un viewer: puo essere usata anche come superficie di editing rapido.

### Cosa Puoi Fare

- aggiungere colpi base direttamente in una cella vuota
- rimuovere colpi base o ghost con click
- spostare orizzontalmente base hits e ghost sulla stessa riga

### Cosa Non Fa Ancora

- non permette di aggiungere ghost manualmente
- non gestisce ancora undo / redo
- non preserva automaticamente i manual edits quando premi `Generate Pattern`

### Regole Di Rigenerazione

- `Generate Pattern` riscrive il pattern base, quindi sostituisce anche le modifiche manuali del layer base
- `Generate Ghosts` riscrive solo il layer ghost e usa il base corrente, incluse eventuali modifiche manuali gia presenti

Questo comportamento e voluto: rende chiaro cosa stai rigenerando e cosa stai correggendo a mano.

## Pannelli Strumento

Ogni strumento ha un ruolo diverso nel motore.

### Kick

Parametri principali:

- `Density`
- `Syncopation`
- `Velocity Min`
- `Velocity Max`

Effetto:

- `Density` aumenta il numero di colpi extra oltre allo scheletro metrico
- `Syncopation` rende gli extra piu liberi e, a livelli alti, puo allentare parte della rigidita strutturale

### Snare

Parametri principali:

- `Density`
- `Syncopation`
- `Velocity Min`
- `Velocity Max`

Ghost disponibili:

- `Enabled`
- `Density`
- `Velocity`
- `Placement`

La snare usa punti forti strutturali derivati dal grouping e puo essere arricchita con colpi extra e ghost.

### Hi-Hat Closed

Parametri principali:

- `Division`
- `Space`
- `Timing Feel`
- `Velocity Min`
- `Velocity Max`

`Division` definisce la griglia base del pulse.

`Space` decide quanto quel pulse viene svuotato:

- `0.0` = pieno
- `1.0` = molto piu arioso

Ghost disponibili:

- `Enabled`
- `Density`
- `Velocity`
- `Placement`

Ruolo:

- e il pulse principale del pattern
- in genere occupa lo strato ritmico piu regolare

### Hi-Hat Open

Parametri principali:

- `Density`
- `Velocity Min`
- `Velocity Max`

Ruolo:

- segue slot metricamente forti o di fine gruppo
- maschera il closed hat negli stessi slot

### Ride

Parametri principali:

- `Division`
- `Space`
- `Timing Feel`
- `Velocity Min`
- `Velocity Max`

Anche il ride usa la coppia `Division` + `Space`, ma con uno thinning leggermente piu conservativo rispetto al closed hat.

Ghost disponibili:

- `Enabled`
- `Density`
- `Velocity`
- `Placement`

Ruolo:

- puo fare da pulse alternativo o secondario
- resta piu rada del closed hat

### Crash

Parametri principali:

- `Density`
- `Velocity Min`
- `Velocity Max`

Ruolo:

- lavora come accento di bordo o di inizio frase
- non satura la griglia in modo continuo

### Toms

I tom non usano `Density` come kick e snare.

Usano invece un budget discreto:

- `High Hits`
- `Mid Hits`
- `Low Hits`

Ogni valore va da `0` a `3`.

Il motore distribuisce i tom in frasi ritmiche coerenti sul pattern gia costruito.

## Playback Audio

Il playback interno usa sample WAV locali in `assets/drums/`.

Nomi previsti:

- `kick.wav`
- `snare.wav`
- `hihat_closed.wav`
- `hihat_open.wav`
- `tom_high.wav`
- `tom_mid.wav`
- `tom_low.wav`
- `crash.wav`
- `ride.wav`

Sono presenti anche sample ghost dedicati:

- `snare_ghost.wav`
- `hihat_closed_ghost.wav`
- `ride_ghost.wav`

Per prove veloci, bastano anche pochi sample di base, ma il playback completo rende meglio con il set intero.

## Come Ragiona Il Motore

Il generatore procede a passaggi:

1. legge `GlobalSettings` e i config strumento
2. interpreta il `Beat Grouping`
3. costruisce lo scheletro metrico della battuta
4. genera kick, snare, pulse layers, open hat e crash
5. distribuisce eventuali tom
6. applica i fill
7. applica la similarita tra battute
8. applica humanize timing e velocity

Le ghost notes vengono rigenerate come layer separato.

Questo approccio rende piu facile:

- controllare il comportamento
- fare test
- capire da dove nasce un cambiamento nel groove

## Limiti Attuali

Ci sono alcune scelte esplicite da conoscere:

- il denominatore e fisso a `4`
- il motore e ottimizzato attorno a `8` slot per quarto
- il playback interno e pensato per ascolto veloce e debugging, non come motore audio da DAW
- i preset sono parametrici: impostano il setup ma non salvano pattern statici

Queste limitazioni sono volute: l'obiettivo attuale e la controllabilita del motore, non la massima generalita dell'interfaccia.

## Struttura Del Progetto

```text
main.py
gui/
  app.py
  controls.py
  grid_view.py
core/
  audio_playback.py
  generator.py
  instruments.py
  midi_export.py
  pattern.py
  presets.py
  timing.py
tests/
  test_grouping_model.py
assets/
  drums/
README.md
requirements.txt
```

## Stack

- Python 3.13+
- PySide6
- mido
- pygame

## Note Tecniche

- `GlobalSettings` vive in `core/pattern.py`
- la logica ritmica e metrica vive soprattutto in `core/timing.py`
- il generatore principale vive in `core/generator.py`
- l'export MIDI vive in `core/midi_export.py`
- l'interfaccia dei controlli globali vive in `gui/controls.py`

## Stato Del Progetto

Il progetto e in una fase in cui il motore sta diventando progressivamente piu leggibile e controllabile.

Priorita attuali:

- chiarezza della UI
- coerenza musicale dei parametri
- riduzione dei controlli fuorvianti
- test del comportamento rule-based

I preset restano nel codice come base futura, ma oggi il focus e sul motore e sul workflow manuale.
